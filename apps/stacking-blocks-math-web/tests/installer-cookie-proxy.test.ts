import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as upstreamRequest, type Server } from 'node:http';
import { createInstallerServer } from '../scripts/installer/http-server.ts';
import { createFakeInstallerBackend, createFakeManagementExtras, fakeBundle } from '../scripts/installer/fake-backend.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { await new Promise<void>(resolve => server.close(() => resolve())); }

test('same-origin proxy cookie jar: authorize/callback/grant/projects/session/status/update and missing-cookie 401', async () => {
  const origin = 'https://frontend.example';
  const target = { environment: 'TEST', projectRef: 'cookie-project', projectUrl: 'https://cookie-project.supabase.co', release: 'spatial-math-v1' };
  const backend = createFakeInstallerBackend();
  const extras = createFakeManagementExtras({ accessibleProjects: [{ ref: target.projectRef }], publishableKeys: { [target.projectRef]: 'sb_publishable_synthetic_cookie' } });
  const installer = createInstallerServer({ mode: 'PRODUCTION', productionRef: 'blocked-production', allowedOrigins: [origin],
    sessionCookieSecure: true, sessionCookieSameSite: 'Lax', sessionSecret: 'synthetic-signature-only-32-characters',
    createBackend: () => backend, createManagementExtras: () => extras,
    plan: { migrations: [{ name: '202609110001_initial.sql', query: 'select 1' }], functions: [fakeBundle('student-auth'), fakeBundle('student-api')], appVersion: '1.0.0', schemaVersion: '202609110001', productionRef: 'blocked-production' },
    oauth: { clientId: 'synthetic', clientSecret: new EphemeralCredential('synthetic-only'), redirectUri: origin + '/api/installer/oauth/callback', fetchImpl: async () => Response.json({ access_token: 'synthetic-only', expires_in: 3600 }) },
  });
  const installerBase = await listen(installer);
  const proxy = createServer((req, res) => {
    const upstream = upstreamRequest(installerBase + req.url, { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  const frontendBase = await listen(proxy);
  // Signed values stay in the test's memory; artifacts/assertions contain only
  // cookie names and attributes. This jar carries Set-Cookie through a real
  // reverse proxy, including the array that sets session AND clears grant.
  const jar = new Map<string, { pair: string; path: string }>();
  const attributes: Array<{ name: string; path: string; secure: boolean; sameSite: string; httpOnly: boolean }> = [];
  async function call(path: string, method = 'GET', body?: unknown, omitCookies = false) {
    const cookie = [...jar.values()].filter(c => path.startsWith(c.path)).map(c => c.pair).join('; ');
    const response = await fetch(frontendBase + path, { method, redirect: 'manual', headers: { origin, 'content-type': 'application/json', ...(!omitCookies && cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...fields] = header.split(';').map(p => p.trim());
      const name = pair.split('=')[0]; const cookiePath = fields.find(f => f.startsWith('Path='))?.slice(5) ?? '/';
      if (fields.includes('Max-Age=0')) { jar.delete(name); continue; }
      jar.set(name, { pair, path: cookiePath });
      attributes.push({ name, path: cookiePath, secure: fields.includes('Secure'), httpOnly: fields.includes('HttpOnly'), sameSite: fields.find(f => f.startsWith('SameSite='))?.slice(9) ?? '' });
    }
    return response;
  }
  try {
    const authorization = await call('/api/installer/authorize', 'POST'); assert.equal(authorization.status, 200);
    const state = new URL((await authorization.json()).authorizeUrl).searchParams.get('state'); assert(state);
    const callback = await call('/api/installer/oauth/callback?code=synthetic&state=' + state); assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), origin + '/setup?oauth=granted'); assert(jar.has('installer_oauth_grant'));
    assert.equal((await call('/api/installer/projects')).status, 200);
    const created = await call('/api/installer/session', 'POST', target); assert.equal(created.status, 201);
    assert.equal((await created.json()).status, 'AUTHORIZED'); assert(jar.has('installer_session')); assert.equal(jar.has('installer_oauth_grant'), false);
    assert.deepEqual(attributes, ['installer_oauth_browser', 'installer_oauth_grant', 'installer_session'].map(name => ({ name, path: '/api/installer', secure: true, httpOnly: true, sameSite: 'Lax' })));
    assert.equal((await call('/api/installer/status')).status, 200);
    assert.equal((await call('/api/installer/status', 'GET', undefined, true)).status, 401);
    assert.equal((await call('/api/installer/update', 'POST', target)).status, 200);
    assert.equal((await (await call('/api/installer/status')).json()).status, 'INSTALLED');
    assert.equal((await call('/api/installer/session', 'DELETE')).status, 200); assert.equal(jar.has('installer_session'), false);
    assert.equal((await call('/api/installer/status')).status, 401);
  } finally { await close(proxy); await close(installer); }
});
