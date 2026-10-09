import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallerServer } from '../scripts/installer/http-server.ts';
import { createDataRecoveryFixture } from './support/installer-data-recovery.ts';

const origin = 'https://synthetic-data-correction.example';
async function start(profile: 'manual-required-progress-contract' | 'manual-live-v4-contract' = 'manual-required-progress-contract') {
  const fixture = await createDataRecoveryFixture('data-recovery',profile);
  const clock = { now: Date.now() };
  const server = createInstallerServer({ plan: fixture.plan, productionRef: 'blocked-production', mode: 'TEST', allowedOrigins: [origin], allowedProjectRefs: [fixture.target.projectRef], now: () => clock.now, sessionSecret: 'synthetic-correction-signature', createBackend: () => fixture.backend });
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { await fixture.db.close(); throw error; }
  const address = server.address(); assert(address && typeof address !== 'string');
  const call = (path: string, cookie = '', body?: unknown, from: string | null = origin, method = body === undefined ? 'GET' : 'POST') => fetch(`http://127.0.0.1:${address.port}/api/installer${path}`, { method, headers: { ...(from === null ? {} : { origin: from }), cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const session = async () => {
    const response = await call('/session', '', fixture.target); assert.equal(response.status, 201);
    const cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    assert.equal((await call('/credential', cookie, { pat: 'synthetic-correction-credential' })).status, 200);
    return cookie;
  };
  const getPlan = async (cookie: string) => {
    const response = await call('/data-recovery-plan', cookie, {}); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.recoverable, true, JSON.stringify(result));
    assert.equal(result.reason, 'DATA_CORRECTION_READY');
    assert.equal(result.plan.changes[0].code, 'L1-03');
    assert.deepEqual(result.plan.changes[0].fields, ['answer', 'updated_at']);
    assert.equal(result.plan.changes[0].referenceCounts.attemptCount, 1);
    assert.equal(result.plan.changes[0].referenceCounts.snapshotCount, 1);
    const text = JSON.stringify(result);
    assert.equal(text.includes(fixture.correction.id), false);
    assert.equal(text.includes(JSON.stringify(fixture.correction.before.answer)), false);
    assert.equal(text.includes('query'), false);
    return result.plan as { id: string };
  };
  return { ...fixture, clock, call, session, getPlan, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fixture.db.close(); } };
}
const consent = (id: string) => ({ planId: id, approved: true, acknowledgesHistoricalFeedbackChange: true });
async function expectCode(response: Response, status: number, code: string) { assert.equal(response.status, status); assert.equal((await response.json()).code, code); }

test('data correction requires both approvals and is distinct from ACL; invalid origin/session/project/plan/expiry never writes', async () => {
  const f = await start();
  try {
    const cookie = await f.session(), other = await f.session(), plan = await f.getPlan(cookie);
    await expectCode(await f.call('/data-recovery-execute', cookie, { planId: plan.id, acknowledgesHistoricalFeedbackChange: true }), 409, 'INSTALLER_RECOVERY_APPROVAL_REQUIRED');
    await expectCode(await f.call('/data-recovery-execute', cookie, { planId: plan.id, approved: true }), 409, 'INSTALLER_DATA_RECOVERY_ACK_REQUIRED');
    await expectCode(await f.call('/data-recovery-execute', cookie, { ...consent(plan.id), acknowledgesHistoricalFeedbackChange: 'true' }), 409, 'INSTALLER_DATA_RECOVERY_ACK_REQUIRED');
    await expectCode(await f.call('/recovery-execute', cookie, consent(plan.id)), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await f.call('/data-recovery-execute', cookie, consent('wrong-plan')), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await f.call('/data-recovery-execute', other, consent(plan.id)), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    await expectCode(await f.call('/data-recovery-execute', cookie, { ...consent(plan.id), projectRef: 'other', projectUrl: 'https://other.supabase.co' }), 403, 'INSTALLER_TARGET_MISMATCH');
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(plan.id), null), 403, 'INSTALLER_ORIGIN_BLOCKED');
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(plan.id), 'https://untrusted.example'), 403, 'INSTALLER_ORIGIN_BLOCKED');
    f.clock.now += 300_001;
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(plan.id)), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    const next = await f.getPlan(cookie);
    assert.equal((await f.call('/session', cookie, undefined, origin, 'DELETE')).status, 200);
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(next.id)), 401, 'INSTALLER_SESSION_REQUIRED');
    assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});

for (const profile of ['manual-required-progress-contract','manual-live-v4-contract'] as const) test(`${profile}: explicit data correction applies once under concurrent clicks and preserves linked attempts, snapshots, progress, XP and all other rows`, async () => {
  const f = await start(profile);
  try {
    const before = await f.protectedHash(), cookie = await f.session(), plan = await f.getPlan(cookie);
    assert.equal(f.writes(), 0);
    const results = await Promise.all([1, 2].map(() => f.call('/data-recovery-execute', cookie, consent(plan.id))));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const result = await results.find(r => r.status === 200)!.json();
    assert.equal(result.action, 'DATA_CORRECTION'); assert.equal(result.installationStatus, 'INSTALLED');
    assert.equal(f.writes(), 1);
    assert.deepEqual((await f.db.query('select answer from sb_problems where id=$1', [f.correction.id])).rows[0].answer, f.correction.after.answer);
    assert.equal(await f.protectedHash(), before);
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(plan.id)), 409, 'INSTALLER_RECOVERY_PLAN_EXPIRED');
    assert.equal((await (await f.call('/status', cookie)).json()).status, 'INSTALLED');
    const again = await (await f.call('/data-recovery-plan', cookie, {})).json();
    assert.equal(again.recoverable, false); assert.equal(again.reason, 'NO_DATA_REPAIR_REQUIRED');
    assert.equal(f.writes(), 1);
  } finally { await f.close(); }
});

test('data correction rereads changed evidence and does not overwrite an independently edited answer', async () => {
  const f = await start();
  try {
    const cookie = await f.session(), plan = await f.getPlan(cookie);
    await f.db.query("update sb_problems set answer='{}'::jsonb where id=$1", [f.correction.id]);
    await expectCode(await f.call('/data-recovery-execute', cookie, consent(plan.id)), 409, 'INSTALLER_RECOVERY_STATE_CHANGED');
    assert.deepEqual((await f.db.query('select answer from sb_problems where id=$1', [f.correction.id])).rows[0].answer, {});
    assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});
