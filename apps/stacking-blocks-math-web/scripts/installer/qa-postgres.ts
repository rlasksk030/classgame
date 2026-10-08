/** Disposable CI PostgreSQL only. No Supabase, URLs, API tokens or remote DBs. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from './math-plan.ts';
import { catalogAttributeFingerprints, catalogFingerprints, assessDatabaseState, type Catalog } from './database-state.ts';
import { catalogDigestQuery, schemaDelta } from './legacy-sql.ts';
import { classifyPermissionDifference, type PermissionSnapshot } from './permission-audit.ts';
import { assertSupabaseDefaultDrift } from '../../tests/support/installer-default-grants.ts';

if (process.env.CI !== 'true' || process.env.INSTALLER_PG_DISPOSABLE !== 'YES' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'installer_catalog_ci' || process.env.PGUSER !== 'postgres') throw new Error('DISPOSABLE_LOCAL_POSTGRES_REQUIRED');
function sql(query: string): string {
  const result = spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', maxBuffer: 32*1024*1024, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`POSTGRES_SQL_FAILED: ${result.error?.code ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
const plan = await readMathInstallerPlan(process.cwd());
const catalogQuery = readFileSync('scripts/installer/catalog.sql','utf8');
const permissionQuery = readFileSync('scripts/installer/permission-audit.sql','utf8');
const catalog = (): Catalog => JSON.parse(sql(catalogQuery));
const permissions = (): PermissionSnapshot => JSON.parse(sql(permissionQuery));
console.log('POSTGRES ENVIRONMENT: '+sql("select jsonb_build_object('version',current_setting('server_version'),'collation',datcollate,'ctype',datctype) from pg_database where datname=current_database()"));
const bootstrap = `create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`;
// Refuse any populated DB even when someone supplies the same CI env names.
assert.equal(sql("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')"),'0','database must start empty');
sql('create role anon;create role authenticated;create role service_role bypassrls;'+bootstrap);
function resetOwnedFixture() {
  sql(`drop schema auth,storage,public cascade;create schema public authorization pg_database_owner;grant usage on schema public to public;${bootstrap}`);
}
function assertProfile(name: string) {
  const expected = plan.databaseBaseline!.profiles.find(p=>p.name===name)!;
  const actual = catalog();
  assert.deepEqual(catalogFingerprints(actual),expected.objects,`${name} native PostgreSQL fingerprints`);
  assert.deepEqual(catalogAttributeFingerprints(actual),expected.attributes,`${name} attribute digests`);
  if (name!=='fresh-empty') {
    const tx = plan.legacyRecovery!.transitions.find(t=>t.from===name)!;
    const guardDigest = tx.query.match(/actual is distinct from '([a-f0-9]{32})'/)?.[1];
    assert.equal(sql(catalogDigestQuery(catalogQuery)),guardDigest,`${name} in-transaction guard`);
  }
}
assertProfile('fresh-empty');
for (const [i,m] of plan.migrations.entries()) { sql(m.query); assertProfile(`history-prefix-${i+1}`); }
const latest=`history-prefix-${plan.migrations.length}`;
// Actual SQL semantics: NULL function ACL and explicit PUBLIC execute are
// equivalent; neither representation is automatically accepted by the gate.
sql('grant execute on function sb_owns_class(uuid) to public;');
const equivalent = classifyPermissionDifference({profile:latest,key:'rpcs::sb_owns_class:target uuid',migrationHashes:plan.databaseBaseline!.migrationHashes,actual:permissions(),structural:false});
assert.equal(equivalent,'A_EQUIVALENT');
assert.equal(assessDatabaseState(plan,[],catalog()).drift,true,'equivalence diagnostics do not relax exact catalog gate');

resetOwnedFixture();
for (const m of plan.migrations.slice(0,17)) sql(m.query);
sql(plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-17')!.query);
assertProfile(latest);
const beforeRetry = sql("select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from sb_problems p");
sql(plan.legacyRecovery!.transitions.find(t=>t.from===latest)!.query);
assert.equal(sql("select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from sb_problems p"),beforeRetry,'no-op retry preserves seeded rows');

resetOwnedFixture();
const manual = JSON.parse(readFileSync('tests/fixtures/manual-installation-catalog.json','utf8')) as Catalog;
sql(schemaDelta(catalog(),manual));
assertProfile('manual-previous-contract');
sql(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
assertProfile('manual-required-progress-contract');

for (const mode of ['historical-defaults','crud-opt-out'] as const) {
  resetOwnedFixture();
  sql(`alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;${mode==='crud-opt-out'?'alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon,authenticated;':''}`);
  for (const m of plan.migrations) sql(m.query);
  const state = assertSupabaseDefaultDrift(plan,catalog(),mode);
  const actual = permissions();
  assert.equal(classifyPermissionDifference({profile:latest,key:'tables::sb_students:',migrationHashes:plan.databaseBaseline!.migrationHashes,actual,structural:false}),'B_BROADER_PERMISSION');
  assert.ok(actual.objects['tables::sb_students:'].roles.anon.privileges.includes('TRUNCATE'));
  console.log(`POSTGRES ${mode}: migration-release ACL differences=22; nearest=${state.review!.comparisonBaseline}, differences=${state.review!.objects.length}; BLOCKED, TRUNCATE detected`);
}
console.log(`POSTGRES PASS: ${plan.databaseBaseline!.profiles.length} exact profiles, SQL guards, legacy upgrade, retry, effective permissions and 2 Supabase-default fixtures; no remote activity`);
