import { createServer, request as forward, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createInstallerServer } from '../../scripts/installer/http-server.ts';
import { createFakeInstallerBackend, createFakeManagementExtras, fakeBundle } from '../../scripts/installer/fake-backend.ts';
import { EphemeralCredential } from '../../scripts/installer/security.ts';
import type { InstallerPlan } from '../../scripts/installer/orchestrator.ts';
import type { InstallerBackend } from '../../scripts/installer/contract.ts';

export async function reconnectServer(dropSessionCookie = false, overrides?: { plan: InstallerPlan; backend: InstallerBackend; now?: () => number }) {
  const backend = overrides?.backend ?? createFakeInstallerBackend();
  const extras = createFakeManagementExtras({ accessibleProjects: [{ ref: 'reconnect-project' }], publishableKeys: { 'reconnect-project': 'sb_publishable_synthetic_new' } });
  let upstream = '';
  const events: Array<{ path: string; method: string; grantSent: boolean; sessionSent: boolean }> = [];
  const frontend = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/installer/')) {
      events.push({ path: pathname, method: req.method ?? 'GET', grantSent: Boolean(req.headers.cookie?.includes('installer_oauth_grant=')), sessionSent: Boolean(req.headers.cookie?.includes('installer_session=')) });
      const request = forward(upstream + req.url, { method: req.method, headers: req.headers }, response => {
        const headers = { ...response.headers };
        if (dropSessionCookie && headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].filter(c => !c.startsWith('installer_session='));
        res.writeHead(response.statusCode ?? 502, headers); response.pipe(res);
      });
      request.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(request); return;
    }
    void (async () => {
      try {
        const file = pathname.startsWith('/assets/') && !pathname.includes('..') ? pathname.slice(1) : 'index.html';
        const body = await readFile(new URL('../../dist/' + file, import.meta.url));
        const contentType = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html';
        res.writeHead(200, { 'content-type': contentType }); res.end(body);
      } catch { res.writeHead(404); res.end(); }
    })();
  });
  async function listen(server: Server) {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing local test port');
    return address.port;
  }
  const origin = `http://localhost:${await listen(frontend)}`;
  const installer = createInstallerServer({ mode: 'PRODUCTION', productionRef: 'blocked-production', allowedOrigins: [origin], sessionCookieSecure: true, sessionCookieSameSite: 'Lax', sessionSecret: 'synthetic-signing-only-at-least-32-characters',
    now: overrides?.now,
    plan: overrides?.plan ?? { productionRef: 'blocked-production', migrations: [{ name: '202609110001_initial.sql', query: 'select 1' }], functions: [fakeBundle('student-auth'), fakeBundle('student-api')], appVersion: '1.0.0', schemaVersion: '202609110001' },
    createBackend: () => backend, createManagementExtras: () => extras,
    oauth: { clientId: 'synthetic-id', clientSecret: new EphemeralCredential('synthetic-only'), redirectUri: origin + '/api/installer/oauth/callback', fetchImpl: async () => Response.json({ access_token: 'synthetic-only', expires_in: 3600 }) },
  });
  upstream = `http://127.0.0.1:${await listen(installer)}`;
  return { origin, events, backend, close: async () => { await new Promise<void>(resolve => frontend.close(() => resolve())); await new Promise<void>(resolve => installer.close(() => resolve())); } };
}
