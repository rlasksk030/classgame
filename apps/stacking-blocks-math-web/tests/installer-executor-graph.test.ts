import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLegacyDb } from './support/installer-legacy-db.ts';
import { hostedExecutorRolesSql } from './support/installer-hosted-roles.ts';
import { hasKnownHostedExecutorGraph } from '../scripts/installer/hosted-role-proof.ts';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit.ts';

const query=readFileSync('scripts/installer/permission-audit.sql','utf8');
test('read-only SQL proves the real non-superuser hosted graph, rejects a nested extra role and bounds unknown output',async()=>{
  const db=await emptyLegacyDb(true);
  const snapshot=async()=>(await db.query<{snapshot:PermissionSnapshot}>(query)).rows[0].snapshot;
  try {
    await db.exec(hostedExecutorRolesSql);
    const before=await snapshot();
    assert.equal(before.roles.postgres.superuser,false);
    assert.equal(before.roles.postgres.memberships,9);
    assert.equal(before.executorGraph!.roles.length,13);assert.equal(before.executorGraph!.edges.length,15);
    assert.equal(hasKnownHostedExecutorGraph(before.executorGraph),true);
    await db.exec('begin read only');
    assert.deepEqual(await snapshot(),before);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(),before,'diagnostics do not mutate role flags, memberships or permissions');
    await db.exec('set session authorization installer_fixture_admin;create role synthetic_private_nested_role;grant synthetic_private_nested_role to pg_monitor;set session authorization postgres;');
    const nested=await snapshot();
    assert.equal(nested.roles.postgres.memberships,9,'direct membership count alone cannot prove the full graph');
    assert.equal(hasKnownHostedExecutorGraph(nested.executorGraph),false);
    assert.equal(nested.executorGraph!.roles.some(role=>role.name==='OTHER'),true);
    assert.equal(JSON.stringify(nested).includes('synthetic_private_nested_role'),false,'unknown role identifiers stay inside the database');
    await db.exec('set session authorization installer_fixture_admin;'+Array.from({length:33},(_,i)=>`create role synthetic_bounded_role_${i};grant synthetic_bounded_role_${i} to postgres;`).join('')+'set session authorization postgres;');
    const oversized=await snapshot();
    assert.deepEqual(oversized.executorGraph,{databaseOwner:'OTHER',roles:[],edges:[]});
    assert.equal(hasKnownHostedExecutorGraph(oversized.executorGraph),false,'oversized graph cannot be truncated into a valid proof');
    assert.equal(JSON.stringify(oversized).includes('synthetic_bounded_role'),false);
  }finally{await db.close();}
});
