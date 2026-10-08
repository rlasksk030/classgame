import { expect, test, type Page } from '@playwright/test';

const config = { installationId: 'synthetic-data-consent', supabaseUrl: 'https://data-consent.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic' };
const status = { status: 'DRIFT_REQUIRES_REVIEW', project: { ref: 'data-consent' }, databaseReview: { reason: 'DATA_EVIDENCE_CONFLICT', baseline: 'history-prefix-24', comparisonBaseline: 'history-prefix-24', objects: [], dataEvidence: { classification: 'REVIEW_REQUIRED', counts: { seedOutdated: 1, dataConflict: 0 }, triggers: ['SEED_OUTDATED_WITH_HISTORY'], readOnly: true } } };
const correction = () => ({ recoverable: true, reason: 'DATA_CORRECTION_READY', plan: { id: 'synthetic-data-consent-plan', expiresAt: new Date(Date.now() + 60_000).toISOString(), projectRef: 'data-consent', profile: 'history-prefix-24', preservesStudentData: true, changes: [{ code: 'L1-03', fields: ['answer', 'updated_at'], historicalFeedbackChanges: true, referenceCounts: { attemptCount: 2, snapshotCount: 1, progressCount: 1, lessonProgressCount: 1, practiceAssignmentCount: 0 } }] } });
async function prepare(page: Page, options: { denied?: boolean; error?: string } = {}) {
  let complete = false;
  const executions: unknown[] = [];
  const paths: string[] = [];
  await page.addInitScript(config => {
    if (sessionStorage.getItem('data-consent-fixture')) return;
    sessionStorage.setItem('data-consent-fixture', '1');
    localStorage.setItem('stacking-installation-config', JSON.stringify(config));
    localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: 4, updatedAt: new Date().toISOString() }));
  }, config);
  await page.route('https://data-consent.supabase.co/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/installer/**', route => {
    const path = new URL(route.request().url()).pathname; paths.push(path);
    if (path.endsWith('/status')) return route.fulfill({ json: complete ? { status: 'INSTALLED', requiredMigrationCount: 24, satisfiedMigrationCount: 24 } : status });
    if (path.endsWith('/data-recovery-plan')) return route.fulfill({ json: options.denied ? { recoverable: false, reason: 'UNSUPPORTED_DATA_CHANGE' } : correction() });
    if (path.endsWith('/data-recovery-execute')) {
      executions.push(route.request().postDataJSON());
      if (options.error) return route.fulfill({ status: 409, json: { code: options.error } });
      complete = true;
      return route.fulfill({ json: { status: 'COMPLETE' } });
    }
    return route.fulfill({ status: 401, json: { code: 'INSTALLER_SESSION_REQUIRED' } });
  });
  await page.goto('/setup');
  await expect(page.getByRole('button', { name: '기본 문제 정정 진단', exact: true })).toBeVisible();
  return { executions, paths };
}
async function preview(page: Page) {
  await page.getByRole('button', { name: '기본 문제 정정 진단', exact: true }).click();
  await page.getByRole('button', { name: '정정 내용 확인', exact: true }).click();
}
const acknowledgement = '과거 풀이의 정답·해설 표시가 바뀌며 기존 채점·점수·진도는 유지됨을 확인했습니다.';

test('known seed correction requires separate historical-feedback acknowledgement and explicit approval', async ({ page }) => {
  const state = await prepare(page);
  await expect(page.getByLabel('기존 설치 안전 복구')).toHaveCount(0);
  await preview(page);
  const details = page.getByLabel('승인할 기본 문제 정정 내용');
  await expect(details).toContainText('L1-03');
  await expect(details).toContainText('풀이 2건');
  await expect(details).toContainText('기존 답안·채점 결과·점수·XP·진도는 다시 채점하거나 변경하지 않습니다');
  const approve = page.getByRole('button', { name: '기본 문제 정정 승인 및 진행', exact: true });
  await expect(approve).toBeDisabled();
  expect(state.executions).toHaveLength(0);
  await page.getByLabel(acknowledgement, { exact: true }).check();
  await expect(approve).toBeEnabled();
  expect(state.executions).toHaveLength(0);
  await approve.click();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
  expect(state.executions).toEqual([{ planId: 'synthetic-data-consent-plan', approved: true, acknowledgesHistoricalFeedbackChange: true }]);
  expect(state.paths.some(path => path.endsWith('/recovery-execute'))).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
  expect(state.executions).toHaveLength(1);
});

test('reload discards reviewed data plan and acknowledgement without writing', async ({ page }) => {
  const state = await prepare(page); await preview(page);
  await page.getByLabel(acknowledgement, { exact: true }).check();
  await page.reload();
  await expect(page.getByRole('button', { name: '기본 문제 정정 진단', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '기본 문제 정정 승인 및 진행', exact: true })).toHaveCount(0);
  await preview(page);
  await expect(page.getByLabel(acknowledgement, { exact: true })).not.toBeChecked();
  expect(state.executions).toHaveLength(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('synthetic-data-consent-plan');
  expect(storage).not.toContain('acknowledgesHistoricalFeedbackChange');
});

test('expired data correction plan cannot execute or silently retry', async ({ page }) => {
  await page.clock.install();
  const state = await prepare(page); await preview(page);
  await page.getByLabel(acknowledgement, { exact: true }).check();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: '기본 문제 정정 승인 및 진행', exact: true })).toBeDisabled();
  await expect(page.getByText('정정 계획이 만료되었습니다. ‘기본 문제 정정 진단’으로 새 계획을 확인해 주세요.', { exact: true })).toBeVisible();
  expect(state.executions).toHaveLength(0);
});

test('unrecognized data stays blocked without offering a correction approval', async ({ page }) => {
  const state = await prepare(page, { denied: true });
  await page.getByRole('button', { name: '기본 문제 정정 진단', exact: true }).click();
  await expect(page.getByText('현재 기본 문제를 안전한 정정 대상으로 확인하지 못했습니다. 기존 자료를 그대로 두고 진단 결과를 제작자에게 알려 주세요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '정정 내용 확인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
  expect(state.executions).toHaveLength(0);
});
