import { expect, test, type Page } from '@playwright/test';
import type { InstallerRecoveryPlanResponse } from '../src/lib/installerClient';

const config = { installationId: 'synthetic-recovery-consent', supabaseUrl: 'https://recovery-consent.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_consent' };
const objects = ['sb_block_snapshots','sb_challenge_solves','sb_classes','sb_lesson_settings','sb_problem_attempts','sb_problems','sb_projects','sb_self_evaluations','sb_shared_challenges','sb_student_pin_vault','sb_student_progress','sb_student_rewards','sb_student_sessions','sb_students','sb_teacher_settings','sb_worksheet_imports','sb_owns_class(uuid)','sb_owns_student(uuid)','sb_public_class_info(text)','sb_reset_progress(uuid,integer)','sb_touch_updated_at()','sb_track_challenge_author()'];
const drift = { status: 'DRIFT_REQUIRES_REVIEW', project: { ref: 'recovery-consent' }, databaseReview: { reason: 'UNRECOGNIZED_SCHEMA', baseline: 'history-prefix-24', comparisonBaseline: 'history-prefix-24', objects: objects.map(object => ({ key: object, change: 'CHANGED' })) } };
const makePlan = (expiresInMs = 60_000): InstallerRecoveryPlanResponse => ({ recoverable: true, reason: 'ACL_RECOVERY_READY', plan: { id: 'synthetic-session-bound-plan', expiresAt: new Date(Date.now() + expiresInMs).toISOString(), projectRef: 'recovery-consent', profile: 'history-prefix-24', preservesStudentData: true, changes: objects.map((object, index) => ({ object, kind: index < 16 ? 'table' : 'function', action: 'REVOKE', role: 'anon', privileges: [index < 16 ? 'TRUNCATE' : 'EXECUTE'] })) } });
async function prepare(page: Page, plan: () => InstallerRecoveryPlanResponse = () => makePlan(), executeError?: string) {
  let recovered = false;
  const executions: unknown[] = [];
  const plans: unknown[] = [];
  await page.addInitScript(config => {
    if (sessionStorage.getItem('recovery-fixture')) return;
    sessionStorage.setItem('recovery-fixture', '1');
    localStorage.setItem('stacking-installation-config', JSON.stringify(config));
    localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: 4, updatedAt: new Date().toISOString() }));
  }, config);
  await page.route('https://recovery-consent.supabase.co/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/installer/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: recovered ? { status: 'INSTALLED', requiredMigrationCount: 24, satisfiedMigrationCount: 24 } : drift });
    if (path.endsWith('/recovery-plan')) { plans.push(route.request().postDataJSON()); return route.fulfill({ json: plan() }); }
    if (path.endsWith('/recovery-execute')) {
      executions.push(route.request().postDataJSON());
      if (executeError) return route.fulfill({ status: 409, json: { code: executeError } });
      recovered = true;
      return route.fulfill({ json: { status: 'COMPLETE' } });
    }
    return route.fulfill({ status: 401, json: { code: 'INSTALLER_SESSION_REQUIRED' } });
  });
  await page.goto('/setup');
  await expect(page.getByRole('button', { name: '설치 문제 자동 진단', exact: true })).toBeVisible();
  return { executions, plans };
}

test('ACL22 diagnosis and preview make no writes; explicit approval alone recovers then enables step5', async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
  await expect(page.getByRole('button', { name: '복구 내용 확인', exact: true })).toBeVisible();
  expect(state.executions).toHaveLength(0);
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '복구 내용 확인', exact: true }).click();
  const preview = page.getByLabel('승인할 복구 내용');
  await expect(preview).toContainText('recovery-consent');
  await expect(preview).toContainText('22개 항목의 접근 권한 22건');
  await expect(preview).toContainText('학생·PIN·답안·진도·작품·보상·학급 코드는 변경하지 않습니다');
  expect(state.executions).toHaveLength(0);
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '복구 승인 및 진행', exact: true }).click();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
  expect(state.executions).toEqual([{ planId: 'synthetic-session-bound-plan', approved: true }]);
  await page.reload();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
  expect(state.executions).toHaveLength(1);
  await page.getByRole('button', { name: '교사 확인으로 계속', exact: true }).click();
  await expect(page.getByText('5/8', { exact: true })).toBeVisible();
});

for (const [scenario, reason] of [['RLS drift', 'UNSAFE_STRUCTURE'], ['RPC definition drift', 'STRUCTURAL_REVIEW_REQUIRED'], ['unknown inheritance', 'UNKNOWN_PERMISSION_CONTEXT'], ['data conflict', 'DATA_REVIEW_REQUIRED']]) test(`unsafe diagnosis ${scenario} provides no approval and performs no write`, async ({ page }) => {
  const state = await prepare(page, () => ({ recoverable: false, reason }));
  await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
  await expect.poll(() => state.plans.length).toBe(1);
  await expect(page.getByRole('button', { name: '복구 내용 확인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
  expect(state.executions).toHaveLength(0);
});

test('reload forgets unapproved plan and never restores or executes consent', async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
  await page.getByRole('button', { name: '복구 내용 확인', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '설치 문제 자동 진단', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toHaveCount(0);
  expect(state.executions).toHaveLength(0);
  expect(state.plans).toHaveLength(1);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain('synthetic-session-bound-plan');
});

test('expired server plan is consumed and requires a new diagnosis, never an implicit retry', async ({ page }) => {
  const state = await prepare(page, () => makePlan(), 'INSTALLER_RECOVERY_PLAN_EXPIRED');
  await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
  await page.getByRole('button', { name: '복구 내용 확인', exact: true }).click();
  await page.getByRole('button', { name: '복구 승인 및 진행', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('복구 계획이 만료');
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
  expect(state.executions).toHaveLength(1);
  expect(state.plans).toHaveLength(1);
});

test('approval is disabled when a displayed plan expires, without sending a write', async ({ page }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
  await page.getByRole('button', { name: '복구 내용 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toBeEnabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: '복구 승인 및 진행', exact: true })).toBeDisabled();
  await expect(page.getByText('복구 계획이 만료되었습니다. ‘설치 문제 자동 진단’으로 새 계획을 확인해 주세요.', { exact: true })).toBeVisible();
  expect(state.executions).toHaveLength(0);
});
