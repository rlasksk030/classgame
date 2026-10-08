import { expect, test, type Page } from '@playwright/test';

const config = { installationId: 'synthetic-data-evidence', supabaseUrl: 'https://data-evidence.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_readonly' };
const conflict = {
  status: 'DRIFT_REQUIRES_REVIEW', project: { ref: 'data-evidence' },
  databaseReview: {
    reason: 'DATA_EVIDENCE_CONFLICT', baseline: 'manual-required-progress-contract', comparisonBaseline: 'manual-required-progress-contract', objects: [],
    dataEvidence: {
      classification: 'REVIEW_REQUIRED', readOnly: true,
      counts: { seedMissing: 2, seedOutdated: 1, storageMissing: 0, progressMissing: 0, dataConflict: 3, duplicateSeedCount: 1, duplicateSeedReferencedCount: 1, storageBucketConflictCount: 1, storagePolicyConflictCount: 1, customizedSeedCount: 2, classProblemCount: 4 },
      triggers: ['DUPLICATE_SEED', 'STORAGE_BUCKET_CONFLICT', 'STORAGE_POLICY_CONFLICT', 'SEED_MISSING_WITH_HISTORY', 'SEED_OUTDATED_WITH_HISTORY'],
      outdatedSeeds: [{code:'L1-03',attemptCount:17,snapshotCount:16,progressCount:5,lessonProgressCount:0,practiceAssignmentCount:0}],
    },
  },
};
async function prepare(page: Page, status: () => unknown) {
  const calls: Array<{ method: string; path: string }> = [];
  await page.addInitScript(config => {
    localStorage.setItem('stacking-installation-config', JSON.stringify(config));
    localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: 4, updatedAt: new Date().toISOString() }));
  }, config);
  await page.route('https://data-evidence.supabase.co/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/installer/**', route => {
    const path = new URL(route.request().url()).pathname;
    calls.push({ method: route.request().method(), path });
    return route.fulfill(path.endsWith('/status') ? { json: status() } : { status: 401, json: { code: 'INSTALLER_SESSION_REQUIRED' } });
  });
  await page.goto('/setup');
  await expect(page.getByText('4/8', { exact: true })).toBeVisible();
  return calls;
}
async function assertBlocked(page: Page) {
  for (const name of ['수학 앱 설치', '이어서 복구', '업데이트', '교사 확인으로 계속']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
}

test('data evidence conflict shows safe per-kind counts with zero catalog differences and performs no writes', async ({ page }) => {
  const calls = await prepare(page, () => conflict);
  const details = page.getByLabel('데이터 검증 상세');
  await expect(details).toBeVisible();
  await expect(details.getByText('기본 문제 중복', { exact: true }).locator('..')).toContainText('1건');
  await expect(details.getByText('기본 문제 누락', { exact: true }).locator('..')).toContainText('2건');
  await expect(details.getByText('파일 저장소 접근 정책 충돌', { exact: true }).locator('..')).toContainText('1건');
  await expect(details.getByText('기존 풀이가 연결된 중복 문제', { exact: true }).locator('..')).toContainText('1건');
  await expect(details).toContainText('실제 수정이 필요한지 검토');
  await expect(details).toContainText('읽기 전용');
  await expect(details).toContainText('학생·PIN·문제·답안·진도·작품·보상을 변경하지 않습니다');
  await expect(page.getByLabel('확인이 필요한 기본 문제')).toContainText('L1-03: 풀이 17건, 블록 저장 16건, 진도 위치 5건');
  await expect(page.getByLabel('확인이 필요한 기본 문제')).toContainText('별도 승인 없이 내용을 변경하지 않습니다');
  await expect(page.getByLabel('설치 진단 정보').getByText('객체 차이', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('0');
  await expect(page.getByText('기존 설치 구조 확인이 필요합니다.', { exact: true })).toHaveCount(0);
  await assertBlocked(page);
  await page.getByRole('button', { name: '설치 확인', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/status')).length).toBeGreaterThanOrEqual(2);
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('missing evidence details remain unknown rather than zero and never allow unsafe continuation', async ({ page }) => {
  const payload = { ...conflict, databaseReview: { ...conflict.databaseReview, reason: 'DATA_EVIDENCE_REQUIRED', dataEvidence: { classification: 'REVIEW_REQUIRED', counts: {}, readOnly: true, triggers: ['EVIDENCE_UNAVAILABLE', 'synthetic-private-value-do-not-display'] } } };
  const calls = await prepare(page, () => payload);
  const details = page.getByLabel('데이터 검증 상세');
  await expect(details.getByText('기본 문제 중복', { exact: true }).locator('..')).toContainText('미확인');
  await expect(details).toContainText('미확인은 0건을 뜻하지 않습니다');
  await expect(details.locator('dd')).toHaveText(Array(12).fill('미확인'));
  await assertBlocked(page);
  await expect(page.locator('body')).not.toContainText('synthetic-private-value-do-not-display');
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

test('read-only recheck advances only after server confirms installed; client does not override a conflict', async ({ page }) => {
  let resolved = false;
  const calls = await prepare(page, () => resolved ? { status: 'INSTALLED', appliedMigrationCount: 24, requiredMigrationCount: 24 } : conflict);
  await expect(page.getByLabel('데이터 검증 상세')).toBeVisible();
  await assertBlocked(page);
  resolved = true;
  await page.getByRole('button', { name: '설치 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '교사 확인으로 계속', exact: true }).click();
  await expect(page.getByText('5/8', { exact: true })).toBeVisible();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
