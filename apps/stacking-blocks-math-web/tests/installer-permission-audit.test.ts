import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyPermissionDifference, permissionContext, type PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { inspectMigrationState } from '../scripts/installer/database-state.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';
import { emptyLegacyDb, legacyBackend } from './support/installer-legacy-db.ts';

const query = readFileSync('scripts/installer/permission-audit.sql','utf8');
const target = {environment:'TEST' as const,projectRef:'permission-synthetic',projectUrl:'https://permission-synthetic.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',release:'test'};
test('SQL permissions distinguish A/B/C/D/E; only proven A equivalence passes without an ACL write',async()=>{
  const plan = await readMathInstallerPlan(process.cwd()), db = await emptyLegacyDb();
  const profile=`history-prefix-${plan.migrations.length}`;
  try {
    for (const m of plan.migrations) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    const snapshot = async()=> (await db.query<{snapshot:PermissionSnapshot}>(query)).rows[0].snapshot;
    const classify = (actual: unknown,key='tables::sb_students:',structural=false) => classifyPermissionDifference({profile,key,migrationHashes:plan.databaseBaseline!.migrationHashes,actual,structural});
    assert.equal(classify(await snapshot()),'A_EQUIVALENT');
    await db.exec('grant execute on function sb_owns_class(uuid) to public');
    assert.equal(classify(await snapshot(),'rpcs::sb_owns_class:target uuid'),'A_EQUIVALENT','NULL ACL and explicit PUBLIC execute');
    const backend = legacyBackend(db,plan,[]);
    backend.inspectDatabasePermissions = snapshot;
    assert.equal((await inspectMigrationState(backend,target,plan)).drift,false);
    await runInstaller({target,plan,backend});
    assert.equal(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c)),false);
    await db.exec('grant truncate on sb_students to anon');
    assert.equal(classify(await snapshot()),'B_BROADER_PERMISSION');
    await assert.rejects(runInstaller({target,plan,backend}),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'},'broader ACL still needs separate explicit consent');
    await db.exec('revoke truncate on sb_students from anon;revoke select on sb_students from authenticated');
    assert.equal(classify(await snapshot()),'C_MISSING_PERMISSION');
    assert.equal(classify(await snapshot(),'tables::sb_students:',true),'D_STRUCTURAL_CHANGE');
    assert.equal(classify(undefined),'E_UNKNOWN');
    backend.inspectDatabasePermissions = async()=>{throw new Error('private upstream details must not escape');};
    const state=await inspectMigrationState(backend,target,plan);
    assert.ok(state.review!.objects.every(o=>o.category==='E_UNKNOWN'));
    assert.deepEqual(state.review!.permissionContext,{available:false});
    assert.equal(JSON.stringify(state).includes('private upstream'),false);
  } finally {await db.close();}
});

test('unknown owner/membership, schema CREATE, grant options and malformed permissions cannot report equivalence',()=>{
  const data=JSON.parse(readFileSync('scripts/installer/permission-baseline.json','utf8'));
  const profile=`history-prefix-${data.migrationHashes.length}`,expected=data.profiles[profile],key='tables::sb_students:';
  const normal: PermissionSnapshot={roles:expected.roles,schema:expected.schema,defaultPrivileges:[],objects:{[key]:data.models[expected.objects[key]]}};
  const classify=(mutate:(s:PermissionSnapshot)=>void)=>{const actual=structuredClone(normal);mutate(actual);return classifyPermissionDifference({profile,key,migrationHashes:data.migrationHashes,structural:false,actual});};
  assert.equal(classify(s=>{s.schema.create.anon=true;}),'B_BROADER_PERMISSION');
  assert.equal(classify(s=>{s.schema.usage.authenticated=false;}),'C_MISSING_PERMISSION');
  assert.equal(classify(s=>{s.schema.owner='OTHER';}),'E_UNKNOWN');
  assert.equal(classify(s=>{s.objects[key].owner='OTHER';}),'E_UNKNOWN');
  assert.equal(classify(s=>{s.roles.authenticated.memberships=1;}),'E_UNKNOWN');
  assert.equal(classify(s=>{s.roles.anon.bypassRls=true;}),'E_UNKNOWN');
  assert.equal(classify(s=>{s.objects[key].roles.authenticated.grantOptions.push('SELECT');}),'B_BROADER_PERMISSION');
  assert.equal(classify(s=>{s.objects[key].otherGrantees=-1;}),'E_UNKNOWN');
  assert.equal(classify(s=>{s.objects[key].otherGrantees=1;}),'E_UNKNOWN');
  assert.deepEqual(permissionContext(undefined),{available:false});
  assert.equal(permissionContext(normal).applicationRoleContextChanged,false);
  assert.equal(classifyPermissionDifference({profile,key,migrationHashes:[],structural:false,actual:normal}),'E_UNKNOWN');
});

test('recognized catalog does not require optional diagnostics or emit owner/role/SQL details',async()=>{
  const db=await emptyLegacyDb(),plan=await readMathInstallerPlan(process.cwd());
  try {
    const backend=legacyBackend(db,plan,[]);let reads=0;
    backend.inspectDatabasePermissions=async()=>{reads++;throw new Error('must not be called');};
    assert.equal((await inspectMigrationState(backend,target,plan)).drift,false);assert.equal(reads,0);
    assert.equal(/\b(insert|update|delete|alter|grant|revoke|truncate)\s+(table|into|on|from)\b/i.test(query),false);
  }finally{await db.close();}
});
