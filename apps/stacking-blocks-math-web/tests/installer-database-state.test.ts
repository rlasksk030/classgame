import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { legacyBackend } from './support/installer-legacy-db.ts';
import { createFixture } from '../qa/live-required-progress/installer-fixture.mjs';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { assessDatabaseState, inspectMigrationState, type Catalog } from '../scripts/installer/database-state.ts';
import { runInstaller, functionMatches, type InstallerPlan } from '../scripts/installer/orchestrator.ts';
import { createFakeInstallerBackend } from '../scripts/installer/fake-backend.ts';
import { SupabaseManagementBackend } from '../scripts/installer/management-api.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';
import { createInstallerServer } from '../scripts/installer/http-server.ts';

const target = { environment: 'TEST' as const, projectRef: 'synthetic-state-project', projectUrl: 'https://synthetic-state-project.supabase.co', publishableKey: 'sb_publishable_synthetic', release: 'spatial-math-v1' };
const sql = readFileSync('scripts/installer/catalog.sql', 'utf8');
const delta = readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql', 'utf8');
let plan: InstallerPlan;
let manual: PGlite;
let previous: Catalog;
let latest: Catalog;
async function catalog(db: PGlite): Promise<Catalog> { return (await db.query<{ snapshot: Catalog }>(sql)).rows[0].snapshot; }
function backendFor(state: Catalog, history: string[], oldApi = false) {
  const backend = createFakeInstallerBackend({ migrations: history, secrets: ['APP_SESSION_SECRET'], functions: plan.functions.map(f => ({ slug: f.slug, hash: oldApi && f.slug === 'student-api' ? 'older-source-fingerprint' : f.hash, version: 17, status: 'ACTIVE', verifyJwt: false })) });
  return Object.assign(backend, { async inspectDatabaseCatalog() { backend.calls.push('inspectDatabaseCatalog'); return structuredClone(state); }, async inspectDataEvidence() {return { seedMissing:0,seedOutdated:0,storageMissing:0,progressMissing:0,dataConflict:0 };}, async applyLegacyTransition() { backend.calls.push('applyLegacyTransition'); state=latest; } });
}
const writes = (calls: string[]) => calls.filter(c => /^(applyMigration|applyLegacyTransition|deployFunction|setSecrets)/.test(c));
before(async () => {
  plan = await readMathInstallerPlan(process.cwd());
  manual = await createFixture(); previous = await catalog(manual);
  await manual.exec(delta); latest = await catalog(manual);
});
after(async () => { await manual?.close(); });

test('A/B fresh project installs all migrations and Edge; exact history resumes and stays installed', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
    const backend = createFakeInstallerBackend();
    const adapter = legacyBackend(db, plan);
    backend.inspectDataEvidence=adapter.inspectDataEvidence;
    backend.applyLegacyTransition=adapter.applyLegacyTransition;
    backend.inspectDatabaseCatalog = () => catalog(db);
    const apply = backend.applyMigration.bind(backend);
    backend.applyMigration = async (t, m) => { await db.exec(m.query.replace('create extension if not exists "pgcrypto";', '')); await apply(t, m); };
    const empty = await inspectMigrationState(backend, target, plan);
    assert.equal(empty.drift, false); assert.equal(empty.migrations.filter(m => m.status === "PENDING").length, 24);
    // An interrupted fresh installation must match the exact prefix before resuming.
    for (const m of plan.migrations.slice(0, 7)) await backend.applyMigration(target, m);
    const partial = await inspectMigrationState(backend, target, plan);
    assert.equal(partial.drift, false); assert.equal(partial.migrations.filter(m => m.status === 'PENDING').length, 17);
    // Same schema, missing history: diagnose provenance separately from schema
    // differences. Do not silently opt a teacher into replaying old SQL.
    const missingHistory = await inspectMigrationState(backend, target, plan, []);
    assert.equal(missingHistory.drift, false);
    assert.equal(missingHistory.recovery, 'LEGACY_RESUME_CANDIDATE');
    assert.equal(missingHistory.baseline, 'history-prefix-7');
    assert.deepEqual(missingHistory.differences, []);
    assert.ok(missingHistory.migrations.slice(0,7).every(m => m.status === 'SATISFIED_BY_STATE' || m.status === 'PENDING'));
    const result = await runInstaller({ target, plan, backend });
    assert.equal(result.status, 'COMPLETE');
    assert.equal(backend.calls.filter(c => c.startsWith('applyMigration')).length, 7);
    assert.equal(backend.calls.filter(c => c.startsWith('deployFunction')).length, 2);
    assert.equal(backend.calls.filter(c => c === 'setSecrets').length, 1);
    const installed = await inspectMigrationState(backend, target, plan);
    assert.equal(installed.drift, false); assert.ok(installed.migrations.every(m => ['APPLIED_BY_HISTORY','SATISFIED_BY_STATE'].includes(m.status)));
    const first = writes(backend.calls).length;
    await runInstaller({ target, plan, backend });
    assert.equal(writes(backend.calls).length, first);
  } finally { await db.close(); }
});
for (const [name, size] of [['C no history', 0], ['D partial history', 9], ['G original 20-history regression', 20]] as const) {
  test(`${name}: manual minimum delta satisfies all 24 migrations; replay 0, API/auth/secret updates 0`, async () => {
    const history = plan.migrations.slice(0, size).map(m => m.name);
    if (size === 20) assert.equal(plan.migrations.filter(m => !history.includes(m.name)).length, 4, "original failure remains reproduced by history-only planner");
    const backend = backendFor(latest, history);
    const assessment = await inspectMigrationState(backend, target, plan);
    assert.equal(assessment.drift, false);
    assert.equal(assessment.migrations.filter(m => m.status === 'PENDING').length, 0);
    assert.equal(assessment.migrations.filter(m => m.status === 'SATISFIED_BY_STATE').length, 24 - size);
    assert.equal((await runInstaller({ target, plan, backend })).status, 'COMPLETE');
    assert.deepEqual(writes(backend.calls), []);
  });
}
test('F manual original schema uses reviewed delta, never historical four-migration replay', async () => {
  const backend = backendFor(previous, plan.migrations.slice(0, 20).map(m => m.name));
  const state = await inspectMigrationState(backend, target, plan);
  assert.equal(state.drift,false); assert.equal(state.baseline,'manual-previous-contract');
  assert.equal(state.recovery,'LEGACY_RESUME_CANDIDATE');
  await runInstaller({target,plan,backend});
  assert.deepEqual(writes(backend.calls), ['applyLegacyTransition']);
});
test('H/I source fingerprint controls Edge plan, older API updates once; compatible auth updates zero', async () => {
  const backend = backendFor(latest, [], true);
  await runInstaller({ target, plan, backend });
  assert.deepEqual(writes(backend.calls), ['deployFunction:student-api']);
  await runInstaller({ target, plan, backend });
  assert.deepEqual(writes(backend.calls), ['deployFunction:student-api']);
  const auth = (await backend.listFunctions(target)).find(f => f.slug === 'student-auth')!;
  assert.equal(functionMatches(auth, plan.functions.find(f => f.slug === 'student-auth')!, true), true);
  assert.equal(functionMatches({ ...auth, verifyJwt: true }, plan.functions.find(f => f.slug === 'student-auth')!, true), false);
  assert.equal(functionMatches({ ...auth, status: 'REMOVED' }, plan.functions.find(f => f.slug === 'student-auth')!, true), false);
});
const driftSql = {
  nullability: 'alter table sb_students alter column name drop not null',
  default: "alter table sb_students alter column status set default 'disabled'",
  type: 'alter table sb_students alter column student_no type bigint',
  constraint: 'alter table sb_students drop constraint sb_students_status_check',
  rpcBody: () => String(latest.rpc_definitions.find(f => f.name === 'sb_record_attempt')!.definition).replace(/p\.order_index\s*=\s*2/, 'p.order_index=3'),
  rpcGrants: () => `grant execute on function sb_reset_class_progress(${latest.rpcs.find(f => f.name === 'sb_reset_class_progress')!.arguments}) to anon`,
  rpcSearchPath: () => `alter function sb_record_attempt(${latest.rpcs.find(f => f.name === 'sb_record_attempt')!.arguments}) set search_path to public,auth`,
  trigger: () => `alter table sb_shared_challenges disable trigger "${latest.triggers.find(t => t.table === 'sb_shared_challenges' && String(t.name).includes('author'))!.name}"`,
  rls: 'alter table sb_classes disable row level security',
  policy: () => `drop policy "${latest.policies.find(p => p.table === 'sb_classes')!.name}" on sb_classes`,
  tableGrants: 'grant select on sb_student_sessions to anon',
  columnGrants: 'grant select (pin_hash) on sb_students to anon',
};
for (const [name, query] of Object.entries(driftSql)) {
  test(`E real SQL ${name} drift blocks all mutation even with full history`, async () => {
    await manual.exec('BEGIN');
    try {
      await manual.exec(typeof query === 'function' ? query() : query);
      const changed = await catalog(manual);
      const backend = backendFor(changed, plan.migrations.map(m => m.name), true);
      const assessment = await inspectMigrationState(backend, target, plan);
      assert.equal(assessment.drift, true);
      assert.equal(assessment.review?.reason, 'UNRECOGNIZED_SCHEMA');
      assert.ok(assessment.differences.length > 0);
      assert.ok(assessment.review?.objects.every(item => ['MISSING', 'ADDITIONAL', 'CHANGED'].includes(item.change)));
      await assert.rejects(runInstaller({ target, plan, backend }), { code: 'INSTALLER_MANUAL_REVIEW_REQUIRED' });
      assert.deepEqual(writes(backend.calls), []);
    } finally { await manual.exec('ROLLBACK'); }
  });
}
test('Missing catalog capability, malformed catalog or changed migration SQL fail closed', async () => {
  const backend = createFakeInstallerBackend();
  await assert.rejects(runInstaller({ target, plan, backend }), { code: 'INSTALLER_MANUAL_REVIEW_REQUIRED' });
  assert.throws(() => assessDatabaseState(plan, [], {}), { code: 'INSTALLER_MANUAL_REVIEW_REQUIRED' });
  const changedPlan = { ...plan, migrations: plan.migrations.map((m, i) => i ? m : { ...m, query: m.query + '\n-- unreviewed change' }) };
  assert.throws(() => assessDatabaseState(changedPlan, [], latest), { code: 'INSTALLER_MANUAL_REVIEW_REQUIRED' });
  assert.deepEqual(writes(backend.calls), []);
});
test('Review reports object-level missing/additional/changed metadata without catalog bodies', () => {
  const changed = structuredClone(latest);
  changed.columns = changed.columns.filter(c => !(c.table === 'sb_students' && c.name === 'name'));
  changed.columns.push({ table: 'sb_students', name: 'unreviewed_column', type: 'text', nullable: 'YES', default: null });
  changed.tables.find(t => t.name === 'sb_classes')!.rls = false;
  const assessment = assessDatabaseState(plan, [], changed);
  assert.equal(assessment.drift, true);
  const objects = assessment.review!.objects;
  assert.ok(objects.some(o => o.key === 'columns:sb_students:name:' && o.change === 'MISSING'));
  assert.ok(objects.some(o => o.key === 'columns:sb_students:unreviewed_column:' && o.change === 'ADDITIONAL'));
  assert.ok(objects.some(o => o.key === 'tables::sb_classes:' && o.change === 'CHANGED'));
  assert.ok(objects.every(o => Object.keys(o).sort().join(',') === 'change,key'));
  assert.equal(assessDatabaseState(plan, [], latest, {seedMissing:0,seedOutdated:0,storageMissing:0,progressMissing:0,dataConflict:0}).review, undefined);
});
test('Catalog request is fixed server-only metadata SQL, read_only true; no rows or credentials returned', async () => {
  const credential = new EphemeralCredential('synthetic-management-credential');
  const backend = new SupabaseManagementBackend({ accessToken: credential, fetchImpl: async (input, init) => {
    assert.ok(String(input).endsWith('/database/query'));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.read_only, true); assert.equal(body.query, sql);
    assert.equal(/\b(?:insert|update|delete|alter|drop|truncate)\b/i.test(sql), false);
    assert.equal(/from\s+(?:public\.)?sb_|auth\.users/i.test(sql), false);
    return Response.json([{ snapshot: latest }]);
  } });
  assert.deepEqual(await backend.inspectDatabaseCatalog(target), latest);
  credential.dispose();
});
test('Evidence uses read_only aggregates, strips unexpected response fields and rejects malformed counts',async()=>{
  const credential=new EphemeralCredential('synthetic-evidence-only');
  let malformed=false;
  const query=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-17')!.evidenceQuery;
  const backend=new SupabaseManagementBackend({accessToken:credential,fetchImpl:async(_input,init)=>{
    const body=JSON.parse(String(init?.body)); assert.equal(body.read_only,true); assert.equal(body.query,query);
    assert.equal(/\b(?:insert|update|delete|alter|drop|truncate)\s/i.test(query),false);
    return Response.json([{evidence:{seedMissing:malformed?'unknown':0,seedOutdated:0,storageMissing:0,progressMissing:0,dataConflict:0,unexpectedPrivateRow:'must-not-escape'}}]);
  }});
  try {
    assert.deepEqual(await backend.inspectDataEvidence(target,query),{seedMissing:0,seedOutdated:0,storageMissing:0,progressMissing:0,dataConflict:0});
    malformed=true; await assert.rejects(backend.inspectDataEvidence(target,query),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'});
  }finally{credential.dispose();}
});
test('HTTP status/plan/update/install/repair agree: fully satisfied installed, drift gets 409 and writes zero', async () => {
  const backend = backendFor(latest, plan.migrations.slice(0, 20).map(m => m.name));
  let current = latest;
  backend.inspectDatabaseCatalog = async () => structuredClone(current);
  const server = createInstallerServer({ plan, productionRef: plan.productionRef, createBackend: () => backend, allowedOrigins: [] });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/installer`;
    const created = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target) });
    const cookie = created.headers.get('set-cookie')!.split(';')[0];
    await fetch(base + '/credential', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ pat: 'synthetic-pat' }) });
    const req = (path: string, method = 'GET') => fetch(base + path, { method, headers: { cookie } });
    const status = await (await req('/status')).json(); assert.equal(status.status, 'INSTALLED'); assert.equal(status.missingMigrations.length, 0);
    const proposed = await (await req('/plan', 'POST')).json(); assert.equal(proposed.action, 'NO_RUNTIME_CHANGES'); assert.equal(proposed.migrations.filter((m: { status: string }) => m.status === 'SATISFIED_BY_STATE').length, 4);
    assert.equal((await req('/update', 'POST')).status, 200); assert.deepEqual(writes(backend.calls), []);
    current = structuredClone(latest);
    current.columns.find(c => c.table === 'sb_students' && c.name === 'name')!.nullable = 'YES';
    const review = await (await req('/status')).json();
    assert.equal(review.status, 'DRIFT_REQUIRES_REVIEW');
    assert.equal(review.databaseReview.reason, 'UNRECOGNIZED_SCHEMA');
    assert.equal(review.databaseReview.baseline, 'manual-required-progress-contract');
    assert.equal(JSON.stringify(review).includes('CREATE OR REPLACE FUNCTION'), false);
    assert.equal((await (await req('/plan', 'POST')).json()).action, 'DRIFT_REQUIRES_REVIEW');
    for (const path of ['/update', '/install', '/repair']) {
      const response = await req(path, 'POST'); assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'INSTALLER_MANUAL_REVIEW_REQUIRED');
    }
    assert.deepEqual(writes(backend.calls), []);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
