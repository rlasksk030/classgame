import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { catalogAttributeFingerprints, catalogFingerprints, type Catalog, type DatabaseBaseline } from './database-state.ts';
import { readMigrationPlan } from './orchestrator.ts';
import { createHash } from 'node:crypto';
import { createFixture } from '../../qa/live-required-progress/installer-fixture.mjs';
import { compileRecovery, type CapturedProfile } from './legacy-generation.ts';
import { catalogDigestQuery } from './legacy-sql.ts';
// LOCAL ONLY: immutable source migrations + schema-only manual fixture, no credentials.
const migrations = await readMigrationPlan('supabase/migrations');
const query = await readFile('scripts/installer/catalog.sql', 'utf8');
const result: DatabaseBaseline = { migrationHashes: migrations.map(m => createHash('sha256').update(m.query).digest('hex')), profiles: [] };
const captured: CapturedProfile[] = [];
const tableOwners = new Map<string, Record<string,string>>();
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth, public to anon, authenticated, service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
async function capture(database: PGlite, name: string, kind: DatabaseBaseline['profiles'][number]['kind'], prefix: number) {
  const owners = (await database.query<{name:string,owner:string}>("select c.relname name,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and left(c.relname,3)='sb_' and c.relkind in ('r','p')")).rows;
  tableOwners.set(name,Object.fromEntries(owners.map(o=>[o.name,o.owner])));
  const snapshot = (await database.query<{ snapshot: Catalog }>(query)).rows[0].snapshot;
  result.profiles.push({ name, kind, prefix, objects: catalogFingerprints(snapshot), attributes: catalogAttributeFingerprints(snapshot) });
  const digest = (await database.query<{digest: string}>(catalogDigestQuery(query))).rows[0].digest;
  const seeds = snapshot.tables.some(t => t.name === 'sb_problems') ? (await database.query<Record<string,unknown>>('select * from sb_problems order by code')).rows : [];
  const storagePolicies = (await database.query<Record<string,unknown>>("select * from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('sb_worksheet_files','sb_problem_crops') order by policyname")).rows;
  captured.push({ name, prefix, catalog: snapshot, digest, seeds, storagePolicies });
}
try {
  await capture(db, 'fresh-empty', 'RESUME', 0);
  for (const [i, migration] of migrations.entries()) {
    await db.exec(migration.query.replace('create extension if not exists "pgcrypto";', ''));
    await capture(db, `history-prefix-${i + 1}`, i === migrations.length - 1 ? 'RELEASE' : 'RESUME', i + 1);
  }
} finally { await db.close(); }
const manual = await createFixture();
try {
  await capture(manual, 'manual-previous-contract', 'MANUAL_DELTA_REQUIRED', 20);
  await manual.exec(await readFile('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql', 'utf8'));
  await capture(manual, 'manual-required-progress-contract', 'RELEASE', 0);
  // Reviewed real-world sequence: the existing manual delta followed by the
  // four shipped October migrations. Capture the WHOLE schema, not eight
  // ignored differences. The live-v4 RPC and tighter ACLs must stay intact.
  for (const migration of migrations.slice(20)) await manual.exec(migration.query);
  await capture(manual, 'manual-live-v4-contract', 'RELEASE', 0);
} finally { await manual.close(); }
await writeFile('scripts/installer/database-baseline.json', JSON.stringify(result, null, 2) + '\n');
await writeFile('scripts/installer/legacy-recovery.json', JSON.stringify(await compileRecovery(captured, result.migrationHashes, query), null, 2) + '\n');
// Only trusted offline fixtures provide ACL repair targets. Never reconstruct
// grants from untrusted remote ACL text or from a nearest-profile guess.
await writeFile('scripts/installer/permission-recovery-baseline.json', JSON.stringify({
  migrationHashes: result.migrationHashes,
  profiles: Object.fromEntries(captured.map(p => [p.name, { objects: Object.fromEntries([
    ...p.catalog.tables.map(t => [`tables::${t.name}:`, { kind: 'table', name: t.name, owner: tableOwners.get(p.name)![t.name], acl: t.acl }]),
    ...p.catalog.rpcs.map(f => [`rpcs::${f.name}:${f.arguments}`, { kind: 'function', name: f.name, arguments: f.arguments, owner: p.catalog.rpc_definitions.find(d => d.name === f.name && d.arguments === f.arguments)?.owner, acl: f.acl }]),
  ]) }])),
}, null, 2)+'\n');
console.log(`LOCAL baseline generated: ${result.profiles.length} supported profiles`);
