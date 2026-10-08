// Offline, synthetic database only. Never receives remote credentials.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { emptyLegacyDb } from '../../tests/support/installer-legacy-db.ts';
import { createFixture } from '../../qa/live-required-progress/installer-fixture.mjs';
import { readMigrationPlan } from './orchestrator.ts';
import type { PermissionObject, PermissionSnapshot } from './permission-audit.ts';
const migrations = await readMigrationPlan('supabase/migrations');
const query = await readFile('scripts/installer/permission-audit.sql','utf8');
const models: Record<string, PermissionObject> = {};
const profiles: Record<string, { roles: PermissionSnapshot['roles']; schema: PermissionSnapshot['schema']; objects: Record<string,string> }> = {};
async function capture(db: Awaited<ReturnType<typeof emptyLegacyDb>>, name: string) {
  const s = (await db.query<{snapshot: PermissionSnapshot}>(query)).rows[0].snapshot;
  profiles[name] = { roles: s.roles, schema: s.schema, objects: Object.fromEntries(Object.entries(s.objects).map(([key,value]) => {
    const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex'); models[digest] = value; return [key,digest];
  })) };
}
const db = await emptyLegacyDb();
try {
  await capture(db,'fresh-empty');
  for (const [i,m] of migrations.entries()) { await db.exec(m.query.replace('create extension if not exists "pgcrypto";','')); await capture(db,`history-prefix-${i+1}`); }
} finally { await db.close(); }
const manual = await createFixture();
try {
  await capture(manual,'manual-previous-contract');
  await manual.exec(await readFile('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
  await capture(manual,'manual-required-progress-contract');
} finally { await manual.close(); }
await writeFile('scripts/installer/permission-baseline.json',JSON.stringify({ migrationHashes: migrations.map(m=>createHash('sha256').update(m.query).digest('hex')),models,profiles },null,2)+'\n');
console.log(`PERMISSION_BASELINE: ${Object.keys(profiles).length} profiles / ${Object.keys(models).length} distinct models`);
