import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallerServer } from '../scripts/installer/http-server.ts';
import { createFakeInstallerBackend, createFakeManagementExtras } from '../scripts/installer/fake-backend.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';
import { InstallerError } from '../scripts/installer/contract.ts';
import { existingInstallerTarget } from '../src/lib/installerReconnect.ts';
import { SupabaseManagementBackend } from '../scripts/installer/management-api.ts';

const target = { environment: 'TEST', projectRef: 'existing-project', projectUrl: 'https://existing-project.supabase.co', release: 'spatial-math-v1' };
const config = { installationId: 'existing-install', supabaseUrl: target.projectUrl, supabasePublishableKey: 'sb_publishable_synthetic' };

test('Management API prefers ref, supports legacy id, and strips non-public fields', async () => {
  for (const upstream of [{ref:'existing-project',id:'different-internal-id'},{id:'existing-project'}]) {
    const backend = new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async input=>Response.json(String(input).endsWith('/projects') ? [upstream] : {...upstream,password:'synthetic-hidden',database:{password:'synthetic-hidden'}})});
    assert.equal((await backend.listAccessibleProjects())[0].ref,'existing-project');
    const project=await backend.inspectProject({...target,environment:'TEST'});
    assert.equal(project.ref,'existing-project'); assert.equal(JSON.stringify(project).includes('synthetic-hidden'),false);
  }
});

test('existing recovery is derived strictly from runtime config URL', () => {
  assert.equal(existingInstallerTarget(null), undefined);
  assert.equal(existingInstallerTarget(config)?.projectRef, target.projectRef);
  for (const url of ['http://existing-project.supabase.co', target.projectUrl + '/', target.projectUrl + ':443', target.projectUrl + '?key=synthetic', 'https://user@existing-project.supabase.co', target.projectUrl + '.evil.test']) {
    assert.throws(() => existingInstallerTarget({ ...config, supabaseUrl: url }), { code: 'INSTALLER_EXISTING_CONFIG_INVALID' });
  }
});

for (const outcome of ['success', '403', '404', 'mismatch', 'fresh', 'bad-url', 'unverified-bind', 'access-revoked'] as const) {
  test(`empty OAuth projects recovery: ${outcome}`, async () => {
    const backend = createFakeInstallerBackend();
    let inspections = 0;
    backend.inspectProject = async t => {
      inspections++;
      if (outcome === '403' || outcome === '404' || (outcome === 'access-revoked' && inspections > 1)) throw new InstallerError('UPSTREAM_FAILURE', 'target', 'synthetic', outcome === '404' ? 404 : 403);
      return { ref: outcome === 'mismatch' ? 'different-project' : t.projectRef };
    };
    const extras = createFakeManagementExtras({ accessibleProjects: [], publishableKeys: { [target.projectRef]: config.supabasePublishableKey } });
    const server = createInstallerServer({ plan: { migrations: [], functions: [], appVersion: 'test', schemaVersion: 'test', productionRef: 'blocked-project' }, productionRef: 'blocked-project', allowedOrigins: ['https://frontend.example'], createBackend: () => backend, createManagementExtras: () => extras,
      oauth: { clientId: 'synthetic', clientSecret: new EphemeralCredential('synthetic-secret'), redirectUri: 'https://frontend.example/api/installer/oauth/callback', fetchImpl: async () => Response.json({ access_token: 'synthetic-token' }) } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const authorization = await fetch(base + '/api/installer/authorize', { method: 'POST', headers: { origin: 'https://frontend.example' } });
      const browserCookie = authorization.headers.getSetCookie()[0].split(';')[0];
      const auth = await authorization.json();
      const state = new URL(auth.authorizeUrl).searchParams.get('state');
      const callback = await fetch(base + '/api/installer/oauth/callback?code=synthetic&state=' + state, { redirect: 'manual', headers: { cookie: browserCookie } });
      const cookie = callback.headers.getSetCookie()[0].split(';')[0];
      const requested = { ...target, projectUrl: outcome === 'bad-url' ? target.projectUrl + '?unexpected=yes' : target.projectUrl };
      if (outcome !== 'unverified-bind') {
        const response = await fetch(base + '/api/installer/projects' + (outcome === 'fresh' ? '' : '?' + new URLSearchParams(requested)), { headers: { cookie } });
        const body = await response.json();
        if (outcome === 'fresh') { assert.deepEqual(body.projects, []); assert.equal(inspections, 0); return; }
        if (['403', '404', 'mismatch', 'bad-url'].includes(outcome)) {
          assert.notEqual(response.status, 200);
          assert.equal(body.code, outcome === '403' ? 'INSTALLER_EXISTING_PROJECT_FORBIDDEN' : outcome === '404' ? 'INSTALLER_EXISTING_PROJECT_NOT_FOUND' : outcome === 'bad-url' ? 'INSTALLER_EXISTING_CONFIG_INVALID' : 'INSTALLER_TARGET_MISMATCH');
          assert.equal(backend.calls.some(c => /^(apply|setSecrets|deploy)/.test(c)), false); return;
        }
        assert.equal(response.status, 200); assert.equal(body.projects[0].ref, target.projectRef);
      }
      const bind = await fetch(base + '/api/installer/session', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(target) });
      const body = await bind.json();
      if (outcome === 'unverified-bind') assert.equal(body.code, 'INSTALLER_PROJECT_NOT_ALLOWED');
      else if (outcome === 'access-revoked') assert.equal(body.code, 'INSTALLER_EXISTING_PROJECT_FORBIDDEN');
      else { assert.equal(bind.status, 201); assert.equal(body.status, 'AUTHORIZED'); assert.equal(inspections, 2); }
      assert.equal(backend.calls.some(c => /^(apply|setSecrets|deploy)/.test(c)), false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
