import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallerClient } from '../src/lib/installerClient.ts';
import { bindInstallerOAuthProject, completeInstallerReconnect } from '../src/lib/installerReconnect.ts';
import { markInstallerResumeUpdate, hasInstallerResumeUpdate, clearInstallerResumeUpdate } from '../src/lib/installer.ts';

for (const failure of ['CREATED', 'missing-key', 'invalid-key', 'status', 'public-key', 'mismatch']) {
  test(`OAuth bind refuses ${failure} before navigation/update/config persistence`, async () => {
    const calls: string[] = [];
    const client = new InstallerClient('https://frontend.example', async input => {
      const path = new URL(input).pathname.split('/').pop()!; calls.push(path);
      if (path === 'session') return Response.json({ status: failure === 'CREATED' ? 'CREATED' : 'AUTHORIZED', ...(failure === 'missing-key' ? {} : { publishableKey: failure === 'invalid-key' ? 'service_role_blocked' : 'sb_publishable_synthetic' }) });
      if (path === 'status' && failure === 'status') return Response.json({ code: 'INSTALLER_SESSION_REQUIRED' }, { status: 401 });
      return Response.json({ status: 'INSTALLED' });
    });
    await assert.rejects(bindInstallerOAuthProject(client, { ref: 'test-project' }, 'synthetic-install', failure === 'mismatch' ? 'different-project' : 'test-project', async () => { if (failure === 'public-key') throw new Error('public verification failed'); }));
    assert.equal(calls.includes('update'), false);
    if (failure === 'mismatch') assert.deepEqual(calls, []);
  });
}
for (const failure of ['update', 'PARTIAL', 'post-status', 'UPDATE_REQUIRED']) {
  test(`Reconnect keeps failure visible for ${failure} instead of accepting update HTTP 200`, async () => {
    const client = new InstallerClient('https://frontend.example', async input => {
      const path = new URL(input).pathname.split('/').pop();
      if (path === 'update') return failure === 'update' ? Response.json({ code: 'INSTALLER_BUSY' }, { status: 409 }) : Response.json({ status: failure === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE' });
      return failure === 'post-status' ? Response.json({ code: 'INSTALLER_SESSION_REQUIRED' }, { status: 401 }) : Response.json({ status: 'UPDATE_REQUIRED' });
    });
    await assert.rejects(completeInstallerReconnect(client, { target: { projectRef: 'test-project', projectUrl: 'https://test-project.supabase.co', release: 'spatial-math-v1' }, status: { status: 'UPDATE_REQUIRED' } }));
  });
}
test('resume marker is read repeatedly and cleared only after success', () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, { window: {}, sessionStorage: { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
  try { markInstallerResumeUpdate(); assert.equal(hasInstallerResumeUpdate(), true); assert.equal(hasInstallerResumeUpdate(), true); clearInstallerResumeUpdate(); assert.equal(hasInstallerResumeUpdate(), false); }
  finally { delete (globalThis as { window?: unknown }).window; delete (globalThis as { sessionStorage?: unknown }).sessionStorage; }
});

test('Reconnect manual review is an authorized state but never starts OAuth/update or completes navigation', async () => {
  const calls: string[] = [];
  const client = new InstallerClient('https://frontend.example', async input => {
    calls.push(new URL(input).pathname);
    return Response.json({ status: 'DRIFT_REQUIRES_REVIEW' });
  });
  const verified = await bindInstallerOAuthProject(new InstallerClient('https://frontend.example', async input => {
    const path = new URL(input).pathname; calls.push(path);
    return Response.json(path.endsWith('/session') ? { status: 'AUTHORIZED', publishableKey: 'sb_publishable_synthetic' } : { status: 'DRIFT_REQUIRES_REVIEW' });
  }), { ref: 'test-project' }, 'synthetic-install', 'test-project', async () => {});
  await assert.rejects(completeInstallerReconnect(client, verified), { code: 'INSTALLER_MANUAL_REVIEW_REQUIRED' });
  assert.equal(calls.some(path => /update|authorize/.test(path)), false);
});

test('cached public config is offered only to an authenticated matching project and never saved on verification failure',async()=>{
  const saved={installationId:'cached',supabaseUrl:'https://test-project.supabase.co',supabasePublishableKey:'sb_publishable_cached'};
  for(const ref of ['test-project','other-project']){
    let sent:Record<string,unknown>={};
    const client=new InstallerClient('https://frontend.example',async(_input,init)=>{sent=JSON.parse(String(init?.body));return Response.json({status:'AUTHORIZED',publicKeyError:{code:'INSTALLER_PUBLIC_KEY_PROBE_FAILED',stage:'public-key',upstreamStatus:401}});});
    await assert.rejects(bindInstallerOAuthProject(client,{ref},'cached',null,async()=>{},saved),{code:'INSTALLER_PUBLIC_KEY_PROBE_FAILED'});
    assert.equal(sent.publishableKey,ref==='test-project'?saved.supabasePublishableKey:undefined);
  }
});
