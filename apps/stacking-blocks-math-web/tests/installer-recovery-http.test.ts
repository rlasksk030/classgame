import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createInstallerServer } from '../scripts/installer/http-server.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import type { InstallerPlan } from '../scripts/installer/orchestrator.ts';
import { InstallerError, type InstallerBackend, type InstallerTarget } from '../scripts/installer/contract.ts';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { emptyLegacyDb, legacyBackend, seedProtectedRows } from './support/installer-legacy-db.ts';

const origin = 'https://synthetic-recovery.example';
const permissionQuery = readFileSync('scripts/installer/permission-audit.sql', 'utf8');
let plan: InstallerPlan;
let archive: Blob;
before(async () => {
  plan = await readMathInstallerPlan(process.cwd());
  const db = await emptyLegacyDb();
  try {
    await db.exec('alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role; alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;');
    for (const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";', ''));
    await seedProtectedRows(db);
    // This fixture has already saved the progress matching its published
    // challenge and submitted project. Isolate ACL-only recovery from backfill.
    await db.exec(`insert into sb_student_progress(student_id,lesson,completed,completed_at)
      values ('33333333-3333-4333-8333-333333333333',9,false,null),
      ('33333333-3333-4333-8333-333333333333',10,true,'2026-01-01'),
      ('33333333-3333-4333-8333-333333333333',11,true,'2026-01-01')
      on conflict(student_id,lesson) do update set completed=sb_student_progress.completed or excluded.completed,completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at);`);
    archive = await db.dumpDataDir();
  } finally { await db.close(); }
});

async function fixture(label = 'alpha') {
  const db = new PGlite({ loadDataDir: archive });
  const target: InstallerTarget = { environment: 'TEST', projectRef: `synthetic-${label}`, projectUrl: `https://synthetic-${label}.supabase.co`, publishableKey: 'sb_publishable_synthetic', release: 'test' };
  const backend = legacyBackend(db, plan, plan.migrations.map(m => m.name));
  backend.inspectDatabasePermissions = async () => (await db.query<{ snapshot: PermissionSnapshot }>(permissionQuery)).rows[0].snapshot;
  backend.applyPermissionRecovery = async (_target, query) => { backend.calls.push('applyPermissionRecovery'); await db.exec(query); };
  const writes = () => backend.calls.filter(c => /^(apply|deploy|setSecrets)/.test(c)).length;
  return { db, target, backend, writes, credential: `synthetic-credential-${label}` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(fixtures: Fixture[]) {
  const clock = { now: Date.now() };
  const server = createInstallerServer({
    plan, productionRef: 'blocked-production', mode: 'TEST', allowedOrigins: [origin],
    allowedProjectRefs: fixtures.map(f => f.target.projectRef), now: () => clock.now,
    sessionSecret: 'synthetic-http-recovery-signature',
    createBackend: credential => new Proxy({} as InstallerBackend, {
      get: (_unused, method: keyof InstallerBackend) => async (...args: unknown[]) => credential.use(async value => {
        const f = fixtures.find(item => item.credential === value);
        if (!f || (args[0] as InstallerTarget)?.projectRef !== f.target.projectRef) throw new InstallerError('INSTALLER_TARGET_MISMATCH', 'target', 'synthetic target mismatch');
        const fn = f.backend[method];
        assert.equal(typeof fn, 'function');
        return Reflect.apply(fn as (...a: unknown[]) => unknown, f.backend, args);
      }),
    }),
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { for (const f of fixtures) await f.db.close(); throw error; }
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/installer`;
  const call = (path: string, cookie = '', body?: unknown, requestOrigin: string | null = origin, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, {
    method, headers: { ...(requestOrigin === null ? {} : { origin: requestOrigin }), cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual',
  });
  return {
    clock, call, base,
    async session(f: Fixture) {
      const response = await call('/session', '', f.target); assert.equal(response.status, 201);
      const cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
      assert.equal((await call('/credential', cookie, { pat: f.credential })).status, 200);
      return cookie;
    },
    async recovery(cookie: string) {
      const response = await call('/recovery-plan', cookie, {});
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.recoverable, true, JSON.stringify(result));
      assert.equal(result.reason, 'ACL_RECOVERY_READY');
      assert.equal(result.plan.preservesStudentData, true);
      assert.equal(new Set(result.plan.changes.map((c: { object: string }) => c.object)).size, 22);
      assert.equal(Object.hasOwn(result.plan, 'query'), false);
      assert.equal(Object.hasOwn(result.plan, 'fingerprint'), false);
      return result.plan as { id: string; projectRef: string };
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
const dataHash = async (f: Fixture) => {
  const names = (await f.db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const rows = await f.db.query(names.map(({ tablename }) => `select '${tablename}' table_name,to_jsonb(t) row_data from public."${tablename}" t`).join(' union all '));
  return createHash('sha256').update(JSON.stringify(rows.rows.map(r => JSON.stringify(r)).sort())).digest('hex');
};
async function expectCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).code, code);
}

test('HTTP recovery requires explicit approval, a live session plan, target binding and exact origin; denial writes zero', async () => {
  const a = await fixture(), b = await fixture('bravo'); const server = await start([a, b]);
  try {
    const cookie = await server.session(a), other = await server.session(a), otherProject = await server.session(b);
    const recovery = await server.recovery(cookie);
    assert.equal(a.writes(), 0, 'diagnosis and plan are read only');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id }), 409, 'INSTALLER_RECOVERY_APPROVAL_REQUIRED');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: 'true' }), 409, 'INSTALLER_RECOVERY_APPROVAL_REQUIRED');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: 'wrong', approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await server.call('/recovery-execute', other, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await server.call('/recovery-execute', otherProject, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true, ...b.target }), 403, 'INSTALLER_TARGET_MISMATCH');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }, null), 403, 'INSTALLER_ORIGIN_BLOCKED');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }, 'https://untrusted.example'), 403, 'INSTALLER_ORIGIN_BLOCKED');
    server.clock.now += 5 * 60 * 1000 + 1;
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    const renewed = await server.recovery(cookie);
    assert.equal((await server.call('/session', cookie, undefined, origin, 'DELETE')).status, 200);
    await expectCode(await server.call('/recovery-execute', cookie, { planId: renewed.id, approved: true }), 401, 'INSTALLER_SESSION_REQUIRED');
    assert.equal(a.writes() + b.writes(), 0);
  } finally { await server.close(); await a.db.close(); await b.db.close(); }
});

test('two simultaneous HTTP approvals execute one real ACL transaction and preserve data; consumed approval cannot replay', async () => {
  const f = await fixture(); const server = await start([f]);
  try {
    const before = await dataHash(f), cookie = await server.session(f), recovery = await server.recovery(cookie);
    const responses = await Promise.all([1, 2].map(() => server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const success = await responses.find(r => r.status === 200)!.json();
    assert.equal(success.status, 'COMPLETE'); assert.equal(success.installationStatus, 'INSTALLED');
    assert.equal(f.writes(), 1);
    assert.equal(await dataHash(f), before);
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    assert.equal((await (await server.call('/status', cookie)).json()).status, 'INSTALLED');
    const again = await (await server.call('/recovery-plan', cookie, {})).json();
    assert.equal(again.recoverable, false); assert.equal(again.reason, 'NO_PERMISSION_DRIFT');
    assert.equal(f.writes(), 1);
  } finally { await server.close(); await f.db.close(); }
});

test('disconnect during approved recovery never replays the write; reconnect reads the committed result and preserved rows', { timeout: 30_000 }, async () => {
  const f = await fixture(); const server = await start([f]);
  let release!: () => void, started!: () => void, finished!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const applying = new Promise<void>(resolve => { started = resolve; });
  const applied = new Promise<void>(resolve => { finished = resolve; });
  const apply = f.backend.applyPermissionRecovery!;
  f.backend.applyPermissionRecovery = async (target, query) => {
    started(); await hold;
    try { await apply(target, query); } finally { finished(); }
  };
  try {
    const before = await dataHash(f), cookie = await server.session(f), recovery = await server.recovery(cookie);
    const controller = new AbortController();
    const request = fetch(server.base + '/recovery-execute', {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ planId: recovery.id, approved: true }), signal: controller.signal,
    });
    const disconnected = assert.rejects(request, { name: 'AbortError' });
    await applying;
    controller.abort(); await disconnected;
    assert.equal(f.writes(), 0);
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    release(); await applied;
    assert.equal((await (await server.call('/status', cookie)).json()).status, 'INSTALLED');
    const diagnosis = await (await server.call('/recovery-plan', cookie, {})).json();
    assert.equal(diagnosis.reason, 'NO_PERMISSION_DRIFT');
    assert.equal(f.writes(), 1);
    assert.equal(await dataHash(f), before);
  } finally { release(); await server.close(); await f.db.close(); }
});

test('HTTP recovery rejects a changed catalog after approval without writing', async () => {
  const f = await fixture(); const server = await start([f]);
  try {
    const cookie = await server.session(f), recovery = await server.recovery(cookie);
    await f.db.exec('alter table sb_students disable row level security');
    await expectCode(await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true }), 409, 'INSTALLER_RECOVERY_STATE_CHANGED');
    assert.equal(f.writes(), 0);
  } finally { await server.close(); await f.db.close(); }
});

test('HTTP recovery never authorizes ACL changes over an actual data conflict or unknown permissions', async () => {
  const f = await fixture(); const server = await start([f]);
  try {
    const cookie = await server.session(f);
    // A real storage conflict coexists with the broad ACL fixture. UI gating
    // alone cannot protect an attacker calling recovery-plan directly.
    await f.db.exec("update storage.buckets set public=true where id='sb-worksheets'");
    const data = await (await server.call('/recovery-plan', cookie, {})).json();
    assert.equal(data.recoverable, false); assert.equal(data.reason, 'DATA_REVIEW_REQUIRED');
    await f.db.exec("update storage.buckets set public=false where id='sb-worksheets'");
    const read = f.backend.inspectDatabasePermissions!;
    f.backend.inspectDatabasePermissions = async target => {
      const permissions = await read(target) as PermissionSnapshot;
      permissions.roles.authenticated.memberships = 1;
      return permissions;
    };
    const unknown = await (await server.call('/recovery-plan', cookie, {})).json();
    assert.equal(unknown.recoverable, false); assert.equal(unknown.reason, 'UNKNOWN_PERMISSION_CONTEXT');
    assert.equal(f.writes(), 0);
  } finally { await server.close(); await f.db.close(); }
});

test('three teachers keep independent recovery plans, credentials, projects and rows', async () => {
  const fixtures = await Promise.all(['alpha', 'bravo', 'charlie'].map(fixture)); const server = await start(fixtures);
  try {
    const hashes = await Promise.all(fixtures.map(dataHash));
    const sessions = await Promise.all(fixtures.map(f => server.session(f)));
    const plans = await Promise.all(sessions.map(cookie => server.recovery(cookie)));
    assert.equal(new Set(plans.map(p => p.id)).size, 3);
    for (let i = 0; i < fixtures.length; i++) {
      assert.equal(plans[i].projectRef, fixtures[i].target.projectRef);
      await expectCode(await server.call('/recovery-execute', sessions[(i + 1) % 3], { planId: plans[i].id, approved: true }), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    }
    assert.deepEqual(fixtures.map(f => f.writes()), [0, 0, 0]);
    const responses = await Promise.all(sessions.map((cookie, i) => server.call('/recovery-execute', cookie, { planId: plans[i].id, approved: true })));
    for (const response of responses) { assert.equal(response.status, 200); assert.equal((await response.json()).installationStatus, 'INSTALLED'); }
    assert.deepEqual(fixtures.map(f => f.writes()), [1, 1, 1]);
    assert.deepEqual(await Promise.all(fixtures.map(dataHash)), hashes);
    assert.equal((await server.call('/session', sessions[1], undefined, origin, 'DELETE')).status, 200);
    assert.equal((await server.call('/status', sessions[1])).status, 401);
    assert.equal((await server.call('/status', sessions[0])).status, 200);
    assert.equal((await server.call('/status', sessions[2])).status, 200);
  } finally { await server.close(); for (const f of fixtures) await f.db.close(); }
});


test('ACL-only approval does not silently backfill progress or claim installation complete', async () => {
  const f = await fixture(); const server = await start([f]);
  try {
    await f.db.exec('delete from sb_student_progress where lesson=10');
    const before = await dataHash(f), cookie = await server.session(f), recovery = await server.recovery(cookie);
    const response = await server.call('/recovery-execute', cookie, { planId: recovery.id, approved: true });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'COMPLETE'); assert.equal(result.installationStatus, 'UPDATE_REQUIRED');
    assert.equal(f.writes(), 1);
    assert.equal(f.backend.calls.includes('applyLegacyTransition'), false);
    assert.equal(await dataHash(f), before);
  } finally { await server.close(); await f.db.close(); }
});
