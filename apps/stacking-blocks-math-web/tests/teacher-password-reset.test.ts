import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Teacher login recovery: a teacher's account existed but the password
// didn't work, and the app had no self-service way to recover it -- the
// only prior path was contacting whoever has Management API access to the
// connected Supabase project, which for a teacher-owned Easy Setup project
// is nobody but the teacher themselves. This adds standard Supabase Auth
// password-reset (email link -> PASSWORD_RECOVERY session -> updateUser),
// which only needs the already-configured public client for whichever
// project is connected -- no admin/service-role access, and structurally
// cannot create a new account or touch any class/student/progress table.

async function readSource(): Promise<string> {
  return readFile(new URL("../src/pages/TeacherGate.tsx", import.meta.url), "utf8");
}

test("password reset uses the existing public getSupabase() client (the one already connected to whatever project the app is bound to) -- no separate admin/service-role client is introduced", async () => {
  const source = await readSource();
  assert.match(source, /getSupabase\(\)\.auth\.resetPasswordForEmail\(resetEmail, \{/);
  assert.doesNotMatch(source, /service_role|serviceRole|admin\.|createClient\(/, "must not introduce a second, privileged client");
});

test("the reset flow never creates a new account: only resetPasswordForEmail (existing account) and updateUser (change password on the session the recovery link itself established) are called -- no signUp anywhere in this file", async () => {
  const source = await readSource();
  assert.doesNotMatch(source, /\.auth\.signUp\(/, "must never create a new teacher account as part of password recovery");
  assert.match(source, /getSupabase\(\)\.auth\.updateUser\(\{ password: newPassword \}\);/);
});

test("the confirmation message after sending a reset email is identical whether or not the address is registered -- never reveals account existence", async () => {
  const source = await readSource();
  const resetBlock = source.match(/\{resetMode\) \{[\s\S]*?\n {2}\}/)?.[0] ?? source.match(/if \(resetMode\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(resetBlock, "reset-mode render block not found");
  assert.match(resetBlock!, /해당 이메일로 가입된 계정이 있는 경우/, "wording must not assert the account exists");
});

test("the new-password form (PASSWORD_RECOVERY state) only renders after Supabase's own PASSWORD_RECOVERY auth event, never for an ordinary login -- and this file never touches sb_classes/sb_students/sb_problem_attempts or any other app data table", async () => {
  const source = await readSource();
  assert.match(source, /if \(event === 'PASSWORD_RECOVERY'\) setRecovering\(true\);/);
  assert.doesNotMatch(source, /from\("sb_|from\('sb_/, "TeacherGate must stay Auth-only -- no direct table access");
});

test("password reset requires a minimum length and matching confirmation before calling updateUser, client-side, before any network call", async () => {
  const source = await readSource();
  const submitFn = source.match(/const submitNewPassword = async \(event: FormEvent\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(submitFn);
  assert.match(submitFn!, /newPassword\.length < 6/);
  assert.match(submitFn!, /newPassword !== newPasswordConfirm/);
});
