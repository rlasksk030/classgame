import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagementTeacherAccountProvisioner } from '../scripts/installer/teacher-account.ts';
import type { SupabaseManagementBackend } from '../scripts/installer/management-api.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';

const target = { environment: 'TEST' as const, projectRef: 'teacher-deadline-project', projectUrl: 'https://teacher-deadline-project.supabase.co', release: 'test' };
function fixture() {
  const credential = new EphemeralCredential('synthetic-server-only');
  let lookups = 0;
  const management = { async getServiceRoleCredential() { lookups++; return credential; } } as unknown as SupabaseManagementBackend;
  return { credential, management, lookups: () => lookups };
}

test('teacher target host mismatch is rejected before privileged key retrieval', async () => {
  const f = fixture();
  const provisioner = new ManagementTeacherAccountProvisioner(f.management, async () => { throw new Error('must not send'); });
  await assert.rejects(provisioner.createTeacherAccount({ ...target, projectUrl: 'https://attacker.invalid' }, 'teacher@example.invalid', 'synthetic-password'), { code: 'INSTALLER_TARGET_MISMATCH' });
  assert.equal(f.lookups(), 0);
});

test('teacher creation is canonical, never follows redirect, and disposes service credential', async () => {
  const f = fixture();
  let calls = 0;
  const provisioner = new ManagementTeacherAccountProvisioner(f.management, async (url, init) => {
    calls++; assert.equal(String(url), target.projectUrl + '/auth/v1/admin/users');
    assert.equal(init?.redirect, 'error');
    return Response.json({ id: 'synthetic' });
  });
  assert.deepEqual(await provisioner.createTeacherAccount({ ...target, projectUrl: target.projectUrl + '/unused-path?unused=true' }, 'teacher@example.invalid', 'synthetic-password'), { created: true, alreadyExists: false });
  assert.equal(calls, 1);
  assert.equal(f.credential.disposed, true);
});

test('teacher creation includes stalled error bodies in its deadline and never retries an uncertain write', async () => {
  const f = fixture();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const provisioner = new ManagementTeacherAccountProvisioner(f.management, async (_url, init) => {
    calls++; signal = init?.signal ?? undefined;
    return { status: 422, json: () => new Promise(() => {}) } as Response;
  }, 10);
  await assert.rejects(provisioner.createTeacherAccount(target, 'teacher@example.invalid', 'synthetic-password'), { code: 'INSTALLER_TEACHER_ACCOUNT_TIMEOUT' });
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(f.credential.disposed, true);
});

test('teacher creation network errors never expose raw credential-bearing messages', async () => {
  const f = fixture();
  const provisioner = new ManagementTeacherAccountProvisioner(f.management, async () => { throw new Error('synthetic-password must not reach client'); });
  await assert.rejects(provisioner.createTeacherAccount(target, 'teacher@example.invalid', 'synthetic-password'), error => {
    assert(error instanceof Error);
    assert.equal(error.message.includes('synthetic-password'), false);
    return true;
  });
  assert.equal(f.credential.disposed, true);
});
