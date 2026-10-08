/** Disposable CI PostgreSQL only. No Supabase, URLs, API tokens or remote DBs. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from './math-plan.ts';
import { catalogAttributeFingerprints, catalogFingerprints, assessDatabaseState, type Catalog } from './database-state.ts';
import { catalogDigestQuery, schemaDelta } from './legacy-sql.ts';
import { classifyPermissionDifference, type PermissionSnapshot } from './permission-audit.ts';
import { buildPermissionRecovery, normalizeEquivalentCatalog, prepareEquivalentLegacyTransition } from './permission-recovery.ts';
import { protectedRowsFixtureSql } from '../../tests/support/installer-legacy-db.ts';
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
const evidenceQuery=plan.legacyRecovery!.transitions.find(t=>t.from===latest)!.evidenceQuery;
// pg_policies expressions depend on search_path even when the policy is intact.
assert.equal(JSON.parse(sql('set search_path=public,auth,storage;'+evidenceQuery)).storagePolicyConflictCount,2);
const canonicalEvidence=JSON.parse(sql('begin read only;set local search_path=pg_catalog,public;'+evidenceQuery+';rollback;'));
assert.equal(canonicalEvidence.storagePolicyConflictCount,0);
assert.equal(canonicalEvidence.dataConflict,0);
// Snapshot all app rows before permission-only repair, including synthetic
// students, PIN hashes, progress, attempts, projects and ordinary seed rows.
function allRowHashes() {
  return Object.fromEntries(catalog().tables.map(t=>[String(t.name),sql(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text collate "C")::text,'[]')) from public."${t.name}" t`)]));
}
function requireRecovery() {
  const recovery=buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),catalog(),permissions());
  assert.equal(recovery.recoverable,true,JSON.stringify(recovery.recoverable?{}:recovery));
  if(!recovery.recoverable) throw new Error('PERMISSION_REPAIR_EXPECTED');
  return recovery;
}
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
for (const m of plan.migrations.slice(0,11)) sql(m.query);
sql(protectedRowsFixtureSql);
sql(`insert into sb_students(class_id,name,student_no,pin_hash) select '22222222-2222-4222-8222-222222222222','합성 학생 '||n,n,'synthetic-hash-'||n from generate_series(2,13) n;
update sb_problems set given=given||'{"teacher_extension":{"instruction":"preserve synthetic customization"}}'::jsonb where code='L2-01';`);
const studentRows=sql('select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) from sb_students s');
const customSeed=sql("select given::text from sb_problems where code='L2-01'");
sql(plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-11')!.query);
assertProfile(latest);
assert.equal(sql('select count(*) from sb_students'),'13');
assert.equal(sql('select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) from sb_students s'),studentRows);
assert.equal(sql("select given::text from sb_problems where code='L2-01'"),customSeed);
const preservedEvidence=JSON.parse(sql(evidenceQuery));
assert.equal(preservedEvidence.customizedSeedCount,1);assert.equal(preservedEvidence.classProblemCount,1);
assert.equal(preservedEvidence.seedOutdated,0);assert.equal(preservedEvidence.dataConflict,0);
console.log('POSTGRES data evidence: canonical policy inspection and 13 synthetic students/custom seed preservation PASS');

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
  sql(protectedRowsFixtureSql);
  const rowsBefore=allRowHashes(),defaultsBefore=sql(`select coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text collate "C"),'[]') from pg_default_acl d`);
  let recovery=requireRecovery();
  assert.equal(new Set(recovery.changes.map(c=>c.object)).size,22,'repair every real ACL difference without lowering the 22-object expectation');
  // A changed prestate must invalidate the exact consent plan before any grant.
  sql('revoke truncate on table sb_students from anon;');
  const staleCatalog=catalog(),staleRights=permissions();
  assert.throws(()=>sql(recovery.query),/INSTALLER_PERMISSION_PLAN_STALE/);
  assert.deepEqual(catalog(),staleCatalog);assert.deepEqual(permissions(),staleRights);assert.deepEqual(allRowHashes(),rowsBefore);
  sql('grant truncate on table sb_students to anon;');
  recovery=requireRecovery();
  const rollbackCatalog=catalog(),rollbackRights=permissions();
  const forcedFailure=recovery.query.replace(/COMMIT;\s*$/,"DO $test$ BEGIN RAISE EXCEPTION 'SYNTHETIC_ROLLBACK_CHECK'; END $test$; COMMIT;");
  assert.notEqual(forcedFailure,recovery.query);
  assert.throws(()=>sql(forcedFailure),/SYNTHETIC_ROLLBACK_CHECK/);
  assert.deepEqual(catalog(),rollbackCatalog);assert.deepEqual(permissions(),rollbackRights);assert.deepEqual(allRowHashes(),rowsBefore);
  sql(recovery.query);
  assert.deepEqual(allRowHashes(),rowsBefore,'permission recovery preserves every sb_ row byte-for-byte');
  assert.equal(sql(`select coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text collate "C"),'[]') from pg_default_acl d`),defaultsBefore);
  const normalized=normalizeEquivalentCatalog(plan,catalog(),permissions());
  assert.ok(normalized,'effective privileges AND exact non-ACL structure match trusted baseline');
  assert.deepEqual(catalogFingerprints(normalized),plan.databaseBaseline!.profiles.find(p=>p.name===latest)!.objects);
  assert.equal(buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),catalog(),permissions()).recoverable,false,'second repair has no work');
  const followupRights=permissions(),followupCatalog=catalog(),followupRows=allRowHashes();
  assert.equal(JSON.parse(sql(evidenceQuery)).progressMissing,2,'existing learning evidence still needs additive progress repair');
  const followup=prepareEquivalentLegacyTransition(plan,plan.legacyRecovery!.transitions.find(t=>t.from===latest)!,followupCatalog,followupRights);
  assert.ok(followup,'equivalent explicit ACLs must support the remaining latest data-only repair');
  sql(followup);
  assert.deepEqual(permissions(),followupRights);assert.deepEqual(catalog(),followupCatalog,'data-only repair keeps actual ACL representation');
  assert.equal(JSON.parse(sql(evidenceQuery)).progressMissing,0);
  const finalRows=allRowHashes();
  for(const name of Object.keys(followupRows).filter(name=>name!=='sb_student_progress')) assert.equal(finalRows[name],followupRows[name],`${name} unchanged by progress-only continuation`);
  assert.equal(sql('select completed from sb_student_progress where lesson=1'),'t');
  assert.equal(sql('select total_xp from sb_student_rewards'),'999');
  console.log(`POSTGRES ${mode}: 22 ACL objects repaired with explicit synthetic consent; stale plan/rollback/data preservation/defaults/no-op retry PASS; nearest before=${state.review!.comparisonBaseline}`);
}
console.log(`POSTGRES PASS: ${plan.databaseBaseline!.profiles.length} exact profiles, SQL guards, legacy upgrade, retry, canonical read-only data evidence, effective permissions and 2 consent-repaired Supabase-default fixtures; no remote activity`);
