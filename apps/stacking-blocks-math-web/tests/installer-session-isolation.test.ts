import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createInstallerServer, type InstallerHttpOptions } from '../scripts/installer/http-server.ts';
import { createFakeInstallerBackend, createFakeManagementExtras } from '../scripts/installer/fake-backend.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';
import { InstallerError, type InstallerBackend, type InstallerTarget } from '../scripts/installer/contract.ts';
import { exchangeOAuthCode } from '../scripts/installer/oauth.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';

const origin = 'https://isolated-frontend.example';
const target = { environment: 'TEST' as const, projectRef: 'isolated-teacher-project', projectUrl: 'https://isolated-teacher-project.supabase.co', release: 'test' };
const backend = () => createFakeInstallerBackend();
const options = (extra: Partial<InstallerHttpOptions> = {}): InstallerHttpOptions => ({
  plan: { productionRef: 'blocked-project', migrations: [], functions: [], appVersion: 'test', schemaVersion: 'test' },
  productionRef: 'blocked-project', allowedOrigins: [origin], createBackend: backend,
  createManagementExtras: () => createFakeManagementExtras({ accessibleProjects: [{ ref: target.projectRef }], publishableKeys: { [target.projectRef]: 'sb_publishable_synthetic' } }),
  sessionSecret: 'synthetic-session-signature-only', sessionCookieSecure: true,
  oauth: { clientId: 'synthetic-client', clientSecret: new EphemeralCredential('synthetic-secret'), redirectUri: origin + '/api/installer/oauth/callback', fetchImpl: async () => Response.json({ access_token: 'synthetic-access' }) },
  ...extra,
});
async function start(config = options()) {
  const server = createInstallerServer(config);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/installer`;
  return { server, call: (path: string, method = 'GET', cookie = '', body?: unknown) => fetch(base + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' }) };
}
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

test('OAuth callback requires the initiating browser, while another browser cannot consume its pending state', async () => {
  const running = await start();
  try {
    const auth = await running.call('/authorize', 'POST');
    const browserCookie = cookies(auth);
    assert.match(browserCookie, /installer_oauth_browser=/);
    assert.match(auth.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(auth.headers.get('set-cookie') ?? '', /SameSite=Lax/);
    const state = new URL((await auth.json()).authorizeUrl).searchParams.get('state');
    const stolen = await running.call(`/oauth/callback?code=synthetic&state=${state}`);
    assert.equal(stolen.status, 400);
    const legitimate = await running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', browserCookie);
    assert.equal(legitimate.status, 302);
    assert.equal((await running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', browserCookie)).status, 400);
  } finally { await close(running.server); }
});

test('revoke clears an unconsumed OAuth grant and pending browser authorizations', async () => {
  const running = await start();
  try {
    const auth = await running.call('/authorize', 'POST');
    const browserCookie = cookies(auth);
    const state = new URL((await auth.json()).authorizeUrl).searchParams.get('state');
    const callback = await running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', browserCookie);
    assert.equal(callback.status, 302);
    const grantCookie = cookies(callback);
    const other = await running.call('/authorize', 'POST', browserCookie);
    const pending = new URL((await other.json()).authorizeUrl).searchParams.get('state');
    assert.equal((await running.call('/projects', 'GET', grantCookie)).status, 200);
    const revoked = await running.call('/session', 'DELETE', browserCookie + '; ' + grantCookie);
    assert.equal(revoked.status, 200);
    for (const name of ['installer_session', 'installer_oauth_grant', 'installer_oauth_browser']) {
      assert(revoked.headers.getSetCookie().some(value => value.startsWith(name + '=;') && value.includes('Max-Age=0')));
    }
    assert.equal((await running.call('/projects', 'GET', grantCookie)).status, 401);
    assert.equal((await running.call(`/oauth/callback?code=synthetic&state=${pending}`, 'GET', browserCookie)).status, 400);
  } finally { await close(running.server); }
});

test('two tabs in one browser can complete independent OAuth states out of order without invalidating each other', async () => {
  const running = await start();
  try {
    const first = await running.call('/authorize', 'POST');
    const browserCookie = cookies(first);
    const second = await running.call('/authorize', 'POST', browserCookie);
    assert.equal(cookies(second), browserCookie);
    const states = await Promise.all([first, second].map(async response => new URL((await response.json()).authorizeUrl).searchParams.get('state')));
    assert.notEqual(states[0], states[1]);
    for (const state of states.reverse()) assert.equal((await running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', browserCookie)).status, 302);
  } finally { await close(running.server); }
});

test('authenticated activity renews the browser cookie as well as the server expiry; genuinely idle sessions expire', async () => {
  const now = { value: 0 };
  const running = await start(options({ ttlMs: 10_000, now: () => now.value }));
  try {
    const created = await running.call('/session', 'POST', '', target);
    const cookie = cookies(created);
    await running.call('/credential', 'POST', cookie, { pat: 'synthetic-test-only' });
    now.value = 9_000;
    const read = await running.call('/status', 'GET', cookie);
    assert.equal(read.status, 200);
    assert.match(read.headers.get('set-cookie') ?? '', /Max-Age=10/);
    assert.equal(cookies(read), cookie);
    now.value = 18_000;
    assert.equal((await running.call('/status', 'GET', cookie)).status, 200);
    now.value = 28_001;
    assert.equal((await running.call('/status', 'GET', cookie)).status, 401);
  } finally { await close(running.server); }
});

test('server restart requires reauthorization; an old signed cookie never restores a credential', async () => {
  const first = await start();
  let cookie: string;
  try {
    cookie = cookies(await first.call('/session', 'POST', '', target));
    await first.call('/credential', 'POST', cookie, { pat: 'synthetic-test-only' });
    assert.equal((await first.call('/status', 'GET', cookie)).status, 200);
  } finally { await close(first.server); }
  let backendCalls = 0;
  const second = await start(options({ createBackend: () => { backendCalls++; return backend(); } }));
  try {
    assert.equal((await second.call('/status', 'GET', cookie)).status, 401);
    assert.equal((await second.call('/install', 'POST', cookie, target)).status, 401);
    assert.equal(backendCalls, 0);
  } finally { await close(second.server); }
});

test('revoke during a pending token exchange cannot recreate an authorized grant', async () => {
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const config = options();
  config.oauth!.fetchImpl = async () => { entered(); await pending; return Response.json({ access_token: 'synthetic-late-access' }); };
  const running = await start(config);
  try {
    const auth = await running.call('/authorize', 'POST');
    const browserCookie = cookies(auth);
    const state = new URL((await auth.json()).authorizeUrl).searchParams.get('state');
    const callback = running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', browserCookie);
    await started;
    await running.call('/session', 'DELETE', browserCookie);
    release();
    const response = await callback;
    assert.equal(response.status, 401);
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal((await response.json()).code, 'INSTALLER_SESSION_EXPIRED');
  } finally { release(); await close(running.server); }
});

test('three teachers keep distinct OAuth credentials, project targets and public keys across parallel install/reload/revoke', async () => {
  const teachers = ['alpha', 'bravo', 'charlie'].map(label => ({
    credential: `synthetic-${label}`, key: `sb_publishable_synthetic_${label}`,
    target: { ...target, projectRef: `isolated-${label}`, projectUrl: `https://isolated-${label}.supabase.co` }, backend: backend(),
  }));
  const resolve = async (credential: EphemeralCredential, requested?: InstallerTarget) => credential.use(async value => {
    const teacher = teachers.find(item => item.credential === value);
    assert(teacher);
    if (requested && requested.projectRef !== teacher.target.projectRef) throw new InstallerError('INSTALLER_TARGET_MISMATCH', 'target', 'wrong target');
    return teacher;
  });
  const config = options({
    createBackend: credential => ({
      async inspectProject(t) { return (await resolve(credential, t)).backend.inspectProject(t); },
      async listAppliedMigrations(t) { return (await resolve(credential, t)).backend.listAppliedMigrations(t); },
      async applyMigration(t, m) { return (await resolve(credential, t)).backend.applyMigration(t, m); },
      async listSecrets(t) { return (await resolve(credential, t)).backend.listSecrets(t); },
      async setSecrets(t, s) { return (await resolve(credential, t)).backend.setSecrets(t, s); },
      async listFunctions(t) { return (await resolve(credential, t)).backend.listFunctions(t); },
      async deployFunction(t, f) { return (await resolve(credential, t)).backend.deployFunction(t, f); },
      async probeFunction(t, slug) { return (await resolve(credential, t)).backend.probeFunction(t, slug); },
    } satisfies InstallerBackend),
    createManagementExtras: credential => ({
      async listAccessibleProjects() { const teacher = await resolve(credential); return [{ ref: teacher.target.projectRef }]; },
      async getPublishableKey(t) { return (await resolve(credential, t)).key; },
      async verifyPublishableKey(t, key) { assert.equal(key, (await resolve(credential, t)).key); },
      async createTeacherAccount(t) { await resolve(credential, t); return { created: true, alreadyExists: false }; },
    }),
  });
  config.oauth!.fetchImpl = async (_url, init) => Response.json({ access_token: `synthetic-${new URLSearchParams(String(init?.body)).get('code')}` });
  const running = await start(config);
  try {
    const sessions = await Promise.all(teachers.map(async teacher => {
      const auth = await running.call('/authorize', 'POST');
      const state = new URL((await auth.json()).authorizeUrl).searchParams.get('state');
      const callback = await running.call(`/oauth/callback?code=${teacher.credential.slice(10)}&state=${state}`, 'GET', cookies(auth));
      const created = await running.call('/session', 'POST', cookies(callback), teacher.target);
      assert.equal((await created.json()).publishableKey, teacher.key);
      return created.headers.getSetCookie().find(value => value.startsWith('installer_session='))!.split(';')[0];
    }));
    await Promise.all(sessions.map(async (cookie, index) => {
      assert.equal((await running.call('/install', 'POST', cookie, teachers[index].target)).status, 200);
      const status = await running.call('/status', 'GET', cookie);
      assert.equal((await status.json()).project.ref, teachers[index].target.projectRef);
      const rebound = await running.call('/session', 'POST', cookie, teachers[index].target);
      assert.equal((await rebound.json()).publishableKey, teachers[index].key);
      assert.equal((await running.call('/install', 'POST', cookie, teachers[(index + 1) % 3].target)).status, 403);
      assert.equal(teachers[index].backend.calls.filter(call => call === 'setSecrets').length, 1);
    }));
    await running.call('/session', 'DELETE', sessions[1]);
    assert.equal((await running.call('/status', 'GET', sessions[1])).status, 401);
    assert.equal((await running.call('/status', 'GET', sessions[0])).status, 200);
    assert.equal((await running.call('/status', 'GET', sessions[2])).status, 200);
  } finally { await close(running.server); }
});

test('OAuth exchange is bounded through a stalled response body, never retries a single-use code, and rejects redirects', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  await assert.rejects(exchangeOAuthCode({ clientId: 'synthetic', clientSecret: new EphemeralCredential('synthetic'), code: 'synthetic', codeVerifier: 'synthetic', redirectUri: origin, timeoutMs: 10, fetchImpl: async (_url, init) => {
    calls++; signal = init?.signal ?? undefined; assert.equal(init?.redirect, 'error');
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  } }), { code: 'INSTALLER_OAUTH_TIMEOUT' });
  assert.equal(calls, 1);
  assert.equal(signal?.aborted, true);
});

test('an uncertain migration timeout is recoverable and does not proceed to secret or function writes', async () => {
  const fake = backend();
  fake.applyMigration = async () => { throw new InstallerError('INSTALLER_MANAGEMENT_TIMEOUT', 'migrations', 'timed out'); };
  const states: string[] = [];
  await assert.rejects(runInstaller({ target, backend: fake, plan: { ...options().plan, migrations: [{ name: '001.sql', query: 'select 1' }] }, onState: state => { states.push(state.status); } }), { code: 'INSTALLER_MANAGEMENT_TIMEOUT' });
  assert.equal(states.at(-1), 'RECOVERABLE');
  assert.equal(fake.calls.includes('setSecrets'), false);
  assert.equal(fake.calls.includes('listFunctions'), false);
});

test('a valid bound key is reused only while management access remains authorized', async () => {
  const fake = backend();
  let denied = false;
  fake.inspectProject = async t => { if (denied) throw new InstallerError('INSTALLER_MANAGEMENT_FAILED', 'target', 'safe', 401); return { ref: t.projectRef }; };
  const extras = createFakeManagementExtras({ accessibleProjects: [{ ref: target.projectRef }], publishableKeys: { [target.projectRef]: 'sb_publishable_synthetic' } });
  const running = await start(options({ createBackend: () => fake, createManagementExtras: () => extras }));
  try {
    const auth = await running.call('/authorize', 'POST');
    const state = new URL((await auth.json()).authorizeUrl).searchParams.get('state');
    const callback = await running.call(`/oauth/callback?code=synthetic&state=${state}`, 'GET', cookies(auth));
    const first = await running.call('/session', 'POST', cookies(callback), target);
    const cookie = first.headers.getSetCookie().find(value => value.startsWith('installer_session='))!.split(';')[0];
    const second = await running.call('/session', 'POST', cookie, target);
    assert.equal((await second.json()).publishableKey, 'sb_publishable_synthetic');
    assert.equal(extras.calls.filter(call => call.startsWith('getPublishableKey:')).length, 1);
    denied = true;
    const expired = await (await running.call('/session', 'POST', cookie, target)).json();
    assert.equal(expired.publishableKey, undefined);
    assert.equal(expired.publicKeyError.code, 'INSTALLER_SESSION_EXPIRED');
    assert.equal(extras.calls.filter(call => call.startsWith('getPublishableKey:')).length, 1);
  } finally { await close(running.server); }
});
