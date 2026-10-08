/** Disposable CI PostgreSQL only. No Supabase, URLs, API tokens or remote DBs. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMathInstallerPlan } from './math-plan.ts';
import { catalogAttributeFingerprints, catalogFingerprints, assessDatabaseState, type Catalog } from './database-state.ts';
import { catalogDigestQuery, literal, schemaDelta } from './legacy-sql.ts';
import { buildDataRecovery } from './data-recovery.ts';
import { classifyPermissionDifference, type PermissionSnapshot } from './permission-audit.ts';
import { buildPermissionRecovery, normalizeEquivalentCatalog, prepareEquivalentLegacyTransition } from './permission-recovery.ts';
import { protectedRowsFixtureSql } from '../../tests/support/installer-legacy-db.ts';
import { assertSupabaseDefaultDrift } from '../../tests/support/installer-default-grants.ts';
import { hostedExecutorRolesSql } from '../../tests/support/installer-hosted-roles.ts';
import { hasKnownHostedExecutorGraph } from './hosted-role-proof.ts';

if (process.env.CI !== 'true' || process.env.INSTALLER_PG_DISPOSABLE !== 'YES' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'installer_catalog_ci' || process.env.PGUSER !== 'postgres') throw new Error('DISPOSABLE_LOCAL_POSTGRES_REQUIRED');
const fixtureAdminPassword=randomBytes(24).toString('hex');
function sql(query: string, administrator=false): string {
  // psql can stop on an intentional guard failure before a large stdin pipe is
  // fully written. Feed a private file so Node's EPIPE cannot mask the real DB
  // error; keep ON_ERROR_STOP and every caller's exact failure assertion.
  const directory = mkdtempSync(join(tmpdir(),'installer-pg-query-'));
  try {
    const input = join(directory,'query.sql');
    writeFileSync(input,query,{mode:0o600});
    const result = spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-f',input], { ...(administrator ? {env:{...process.env,PGUSER:'installer_fixture_admin',PGPASSWORD:fixtureAdminPassword}} : {}), stdio:['ignore','pipe','pipe'], encoding: 'utf8', maxBuffer: 32*1024*1024, timeout: 120_000 });
    if (result.error || result.status !== 0) {
      let detail=result.stderr?.trim() || result.error?.code || `EXIT_${result.status ?? result.signal ?? 'UNKNOWN'}`;
      for(const credential of [fixtureAdminPassword,process.env.PGPASSWORD].filter((v):v is string=>Boolean(v))) detail=detail.replaceAll(credential,'[REDACTED]');
      throw new Error(`POSTGRES_SQL_FAILED: ${detail}`);
    }
    return result.stdout.trim();
  } finally { rmSync(directory,{recursive:true,force:true}); }
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
// OID 10 can never lose SUPERUSER. Keep it as a fixture-only administrator,
// then create the separate postgres owner that a hosted installation uses.
sql(`create role installer_fixture_admin login superuser password ${literal(fixtureAdminPassword)};`);
sql(`alter role postgres rename to installer_bootstrap_admin;
create role postgres login superuser password ${literal(process.env.PGPASSWORD ?? '')};
alter database installer_catalog_ci owner to postgres;`,true);
sql('create role anon;create role authenticated;create role service_role bypassrls;'+bootstrap);
function resetOwnedFixture() {
  sql(`drop schema auth,storage,public cascade;create schema public authorization pg_database_owner;grant usage on schema public to public;${bootstrap}`);
}
function enableHostedFixture() {
  sql(hostedExecutorRolesSql);
  const actual=permissions();
  assert.equal(actual.roles.postgres.memberships,9);
  assert.equal(hasKnownHostedExecutorGraph(actual.executorGraph),true,'actual SQL must prove every hosted role and membership option');
  assert.deepEqual(JSON.parse(sql('begin read only;'+permissionQuery+'rollback;')),actual,'permission query remains read-only after demotion');
}
function restoreLocalFixtureExecutor() {
  sql('alter role postgres superuser;',true);
  sql('revoke anon,authenticated,service_role,authenticator,pg_create_subscription,pg_monitor,pg_read_all_data,pg_signal_backend,supabase_privileged_role from postgres;drop role authenticator;drop role supabase_privileged_role;');
  assert.equal(permissions().roles.postgres.memberships,0);
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
for (const migration of plan.migrations.slice(20)) sql(migration.query);
assertProfile('manual-live-v4-contract');

for (const {mode,hosted} of [{mode:'historical-defaults',hosted:false},{mode:'crud-opt-out',hosted:false},{mode:'historical-defaults',hosted:true}] as const) {
  resetOwnedFixture();
  sql(`alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;${mode==='crud-opt-out'?'alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon,authenticated;':''}`);
  for (const m of plan.migrations) sql(m.query);
  if(hosted) enableHostedFixture();
  const state = assertSupabaseDefaultDrift(plan,catalog(),mode);
  const actual = permissions();
  assert.equal(classifyPermissionDifference({profile:latest,key:'tables::sb_students:',migrationHashes:plan.databaseBaseline!.migrationHashes,actual,structural:false}),'B_BROADER_PERMISSION');
  assert.ok(actual.objects['tables::sb_students:'].roles.anon.privileges.includes('TRUNCATE'));
  sql(protectedRowsFixtureSql);
  const rowsBefore=allRowHashes(),defaultsBefore=sql(`select coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text collate "C"),'[]') from pg_default_acl d`);
  let recovery=requireRecovery();
  assert.equal(new Set(recovery.changes.map(c=>c.object)).size,22,'repair every real ACL difference without lowering the 22-object expectation');
  if(hosted) {
    sql('create role synthetic_unreviewed_executor;grant synthetic_unreviewed_executor to postgres;',true);
    const unknown=permissions(),unknownCatalog=catalog();
    assert.equal(hasKnownHostedExecutorGraph(unknown.executorGraph),false);
    assert.equal(JSON.stringify(unknown.executorGraph).includes('synthetic_unreviewed_executor'),false,'unknown role names never leave the database');
    assert.equal(classifyPermissionDifference({profile:latest,key:'tables::sb_students:',migrationHashes:plan.databaseBaseline!.migrationHashes,actual:unknown,structural:false}),'E_UNKNOWN');
    assert.equal(buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),unknownCatalog,unknown).recoverable,false);
    assert.throws(()=>sql(recovery.query),/INSTALLER_PERMISSION_PLAN_STALE/,'a new role edge invalidates an already approved plan inside the transaction');
    assert.deepEqual(catalog(),unknownCatalog);assert.deepEqual(permissions(),unknown);assert.deepEqual(allRowHashes(),rowsBefore);
    sql('revoke synthetic_unreviewed_executor from postgres;drop role synthetic_unreviewed_executor;',true);
  }
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
  console.log(`POSTGRES ${hosted?'hosted executor ':''}${mode}: 22 ACL objects repaired with explicit synthetic consent; stale plan/rollback/data preservation/defaults/no-op retry PASS; nearest before=${state.review!.comparisonBaseline}`);
  if(hosted) restoreLocalFixtureExecutor();
}
// The one explicitly reviewed answer correction must keep linked historical
// answers/completion/rewards and all other app rows, even across a failed write.
for(const {dataProfile,hosted} of [{dataProfile:latest,hosted:false},{dataProfile:'manual-required-progress-contract',hosted:false},{dataProfile:'manual-required-progress-contract',hosted:true},{dataProfile:'manual-live-v4-contract',hosted:false},{dataProfile:'manual-live-v4-contract',hosted:true}]) {
resetOwnedFixture();
if(dataProfile===latest) for (const m of plan.migrations) sql(m.query);
else {
  sql(schemaDelta(catalog(),manual));
  sql(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
  if(dataProfile==='manual-live-v4-contract') for (const migration of plan.migrations.slice(20)) sql(migration.query);
}
assertProfile(dataProfile);
const dataTransition=plan.legacyRecovery!.transitions.find(t=>t.from===dataProfile && t.to===dataProfile)!;
const correctionEvidenceQuery=dataTransition.evidenceQuery;
sql(dataTransition.query);
sql(protectedRowsFixtureSql);
const correction=plan.legacyRecovery!.knownSeedCorrection!;
sql(`insert into sb_students(class_id,name,student_no,pin_hash) select '22222222-2222-4222-8222-222222222222','합성 학생 '||n,n,'synthetic-hash-'||n from generate_series(2,13) n;
insert into sb_problem_attempts(student_id,problem_id,lesson,completed,stars,xp_earned,wrong_count) select id,${literal(correction.id)}::uuid,1,false,2,30,1 from sb_students;
insert into sb_block_snapshots(student_id,problem_id,lesson,blocks) select id,${literal(correction.id)}::uuid,1,'[{"x":0,"y":0,"z":0}]'::jsonb from sb_students;
insert into sb_student_progress(student_id,lesson,last_problem_id,completed,completed_at,stars) select id,1,${literal(correction.id)}::uuid,true,'2026-01-01',3 from sb_students on conflict(student_id,lesson) do update set last_problem_id=excluded.last_problem_id;
insert into sb_lesson_progress_records(installation_id,class_id,student_id,curriculum_version,lesson,stage,set_id,problem_id,question_index,answer,first_attempt_result,attempt_count,final_result) select 'synthetic-native-ci',class_id,id,'v1',1,'solve','synthetic-set',${literal(correction.id)},0,'{"kind":"count","value":6}'::jsonb,'incorrect',1,'incorrect' from sb_students;
insert into sb_practice_assignments(installation_id,class_id,student_id,lesson,curriculum_version,set_id,seed,problem_ids,target_total) select 'synthetic-native-ci',class_id,id,1,'v1','synthetic-set',1,jsonb_build_array(${literal(correction.id)}::text),5 from sb_students;`);
sql(dataTransition.query);
sql(`update sb_problems set answer=${literal(JSON.stringify(correction.before.answer))}::jsonb where id=${literal(correction.id)}::uuid;`);
const oldEvidence=JSON.parse(sql(correctionEvidenceQuery));
assert.equal(oldEvidence.seedOutdated,1);assert.equal(oldEvidence.progressMissing,0);
assert.deepEqual(oldEvidence.outdatedSeedDetails,[{code:'L1-03',attemptCount:13,snapshotCount:13,progressCount:13,lessonProgressCount:13,practiceAssignmentCount:13}]);
if(hosted) enableHostedFixture();
const dataRecovery=buildDataRecovery(plan,plan.migrations.map(m=>m.name),catalog(),permissions(),oldEvidence);
assert.equal(dataRecovery.recoverable,true);
if(!dataRecovery.recoverable) throw new Error('DATA_REPAIR_EXPECTED');
assert.equal(dataRecovery.profile,dataProfile,'approved plan binds the actual catalog profile, including manual prefix 0');
const dataBefore=allRowHashes(),dataCatalog=catalog(),dataPermissions=permissions();
const stableSeedSql=`select (to_jsonb(p)-'answer'-'updated_at')::text from sb_problems p where id=${literal(correction.id)}::uuid`;
const stableSeed=sql(stableSeedSql);
const failedDataQuery=dataRecovery.query.replace(/COMMIT;\s*$/,"DO $test$ BEGIN RAISE EXCEPTION 'SYNTHETIC_DATA_ROLLBACK'; END $test$; COMMIT;");
assert.notEqual(failedDataQuery,dataRecovery.query);
assert.throws(()=>sql(failedDataQuery),/SYNTHETIC_DATA_ROLLBACK/);
assert.deepEqual(allRowHashes(),dataBefore,'failed correction rolls back target answer, timestamp and all student records');
assert.deepEqual(catalog(),dataCatalog);assert.deepEqual(permissions(),dataPermissions);
sql(dataRecovery.query);
const dataAfter=allRowHashes();
for(const name of Object.keys(dataBefore).filter(name=>name!=='sb_problems')) assert.equal(dataAfter[name],dataBefore[name],`${name} unchanged by explicitly approved answer-only correction`);
assert.equal(sql(stableSeedSql),stableSeed);
assert.deepEqual(JSON.parse(sql(`select answer from sb_problems where id=${literal(correction.id)}::uuid`)),correction.after.answer);
assert.equal(JSON.parse(sql(correctionEvidenceQuery)).seedOutdated,0);
assert.deepEqual(catalog(),dataCatalog);assert.deepEqual(permissions(),dataPermissions);
assert.equal(buildDataRecovery(plan,plan.migrations.map(m=>m.name),catalog(),permissions(),JSON.parse(sql(correctionEvidenceQuery))).recoverable,false);
console.log(`POSTGRES ${hosted?'hosted executor ':''}${dataProfile} single known seed correction: 13 linked synthetic students, original answers/rewards/progress preserved; answer-only + existing timestamp trigger, rollback, no-op revisit PASS`);
if(hosted) restoreLocalFixtureExecutor();
}
console.log(`POSTGRES PASS: ${plan.databaseBaseline!.profiles.length} exact profiles, SQL guards, legacy upgrade, retry, canonical read-only data evidence, effective permissions, 3 consent-repaired ACL scenarios and 5 latest/manual/live-v4/hosted 13-student seed contexts; exact hosted graph/unknown-edge rejection verified; no remote activity`);
