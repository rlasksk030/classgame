import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from '../../scripts/installer/math-plan.ts';
import type { PermissionSnapshot } from '../../scripts/installer/permission-audit.ts';
import { emptyLegacyDb, legacyBackend, seedProtectedRows } from './installer-legacy-db.ts';

/** Synthetic known-old seed with saved attempts, blocks and progress. */
export async function createDataRecoveryFixture(label = 'data-recovery') {
  const plan = await readMathInstallerPlan(process.cwd());
  const correction = plan.legacyRecovery?.knownSeedCorrection;
  assert(correction, 'reviewed static seed artifact required');
  const db = await emptyLegacyDb();
  for (const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";', ''));
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
  const target = { environment: 'TEST' as const, projectRef: `synthetic-${label}`, projectUrl: `https://synthetic-${label}.supabase.co`, publishableKey: 'sb_publishable_synthetic', release: 'test' };
  const backend = legacyBackend(db, plan, plan.migrations.map(m => m.name));
  backend.inspectDatabasePermissions = async () => (await db.query<{ snapshot: PermissionSnapshot }>(readFileSync('scripts/installer/permission-audit.sql', 'utf8'))).rows[0].snapshot;
  backend.applyDataRecovery = async (_target, query) => { backend.calls.push('applyDataRecovery'); await db.exec(query); };
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
