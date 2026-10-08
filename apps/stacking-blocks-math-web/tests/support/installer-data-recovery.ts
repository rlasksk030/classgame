import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from '../../scripts/installer/math-plan.ts';
import { catalogFingerprints } from '../../scripts/installer/database-state.ts';
import type { Catalog } from '../../scripts/installer/database-state.ts';
import { schemaDelta } from '../../scripts/installer/legacy-sql.ts';
import type { PermissionSnapshot } from '../../scripts/installer/permission-audit.ts';
import { emptyLegacyDb, legacyBackend, readCatalog, seedProtectedRows } from './installer-legacy-db.ts';
import { hostedExecutorRolesSql } from './installer-hosted-roles.ts';

/** The actual-use manual catalog, with synthetic known-old seed and learning.
 * No remote rows or historical migration replay are used to build the schema. */
export async function createDataRecoveryFixture(label = 'data-recovery') {
  const plan = await readMathInstallerPlan(process.cwd());
  const correction = plan.legacyRecovery?.knownSeedCorrection;
  assert(correction, 'reviewed static seed artifact required');
  const db = await emptyLegacyDb(true);
  const manualCatalog = JSON.parse(readFileSync('tests/fixtures/manual-installation-catalog.json', 'utf8')) as Catalog;
  await db.exec(schemaDelta(await readCatalog(db), manualCatalog));
  await db.exec(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
  const profile='manual-required-progress-contract';
  const transition=plan.legacyRecovery!.transitions.find(t=>t.from===profile && t.to===profile)!;
  await db.exec(transition.query);
  assert.deepEqual(catalogFingerprints(await readCatalog(db)),plan.databaseBaseline!.profiles.find(p=>p.name===profile)!.objects,'HTTP/browser fixture must exactly match the actual-use manual profile');
  await seedProtectedRows(db);
  await db.exec(`insert into sb_student_progress(student_id,lesson,completed,completed_at)
    values ('33333333-3333-4333-8333-333333333333',9,false,null),
    ('33333333-3333-4333-8333-333333333333',10,true,'2026-01-01'),
    ('33333333-3333-4333-8333-333333333333',11,true,'2026-01-01')
    on conflict(student_id,lesson) do update set completed=sb_student_progress.completed or excluded.completed,completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at);`);
  await db.query("update sb_problems set answer=$1::jsonb where id=$2 and code='L1-03' and class_id is null", [JSON.stringify(correction.before.answer), correction.id]);
  await db.query("insert into sb_problem_attempts(student_id,problem_id,lesson,completed,completed_at,stars,xp_earned) values('33333333-3333-4333-8333-333333333333',$1,1,true,'2026-01-01',3,30)", [correction.id]);
  await db.query("insert into sb_block_snapshots(student_id,problem_id,lesson,blocks) values('33333333-3333-4333-8333-333333333333',$1,1,'[{\"x\":0,\"y\":0,\"z\":0}]')", [correction.id]);
  await db.query("update sb_student_progress set last_problem_id=$1 where student_id='33333333-3333-4333-8333-333333333333' and lesson=1", [correction.id]);
  // Model the reviewed hosted executor before any HTTP/browser recovery. The
  // owner is no longer superuser; real local SQL must succeed with this graph.
  await db.exec(hostedExecutorRolesSql);
  const target = { environment: 'TEST' as const, projectRef: `synthetic-${label}`, projectUrl: `https://synthetic-${label}.supabase.co`, publishableKey: 'sb_publishable_synthetic', release: 'test' };
  const backend = legacyBackend(db, plan, plan.migrations.map(m => m.name));
  backend.inspectDatabasePermissions = async () => (await db.query<{ snapshot: PermissionSnapshot }>(readFileSync('scripts/installer/permission-audit.sql', 'utf8'))).rows[0].snapshot;
  const hosted = await backend.inspectDatabasePermissions(target) as PermissionSnapshot;
  assert.deepEqual(hosted.roles.postgres, { superuser: false, bypassRls: true, inherit: true, memberships: 9 });
  assert.equal(hosted.executorGraph?.roles.length, 13);
  assert.equal(hosted.executorGraph?.edges.length, 15);
  backend.applyDataRecovery = async (_target, query) => {
    const catalog=await readCatalog(db),permissions=await backend.inspectDatabasePermissions!(target);
    backend.calls.push('applyDataRecovery');await db.exec(query);
    assert.deepEqual(await readCatalog(db),catalog,'approved data correction keeps the actual manual schema and ACLs');
    assert.deepEqual(await backend.inspectDatabasePermissions!(target),permissions,'approved data correction keeps effective permissions');
  };
  backend.applyPermissionRecovery = async (_target, query) => { backend.calls.push('applyPermissionRecovery'); await db.exec(query); };
  const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const query = tables.map(({ tablename }) => `select '${tablename}' table_name,to_jsonb(t) row_data from public."${tablename}" t`).join(' union all ');
  const protectedHash = async () => {
    const rows = (await db.query<{ table_name: string; row_data: Record<string, unknown> }>(query)).rows;
    for (const row of rows) if (row.table_name === 'sb_problems' && row.row_data.id === correction.id) { delete row.row_data.answer; delete row.row_data.updated_at; }
    return createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');
  };
  const writes = () => backend.calls.filter(call => /^(apply|deploy|setSecrets)/.test(call)).length;
  return { plan, db, backend, target, correction, protectedHash, writes };
}
