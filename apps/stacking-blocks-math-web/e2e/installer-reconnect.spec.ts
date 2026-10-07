import { test, expect, type Page } from '@playwright/test';

const config = { installationId: 'reconnect-synthetic', supabaseUrl: 'https://reconnect-project.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_old' };
type Scenario = { failure?: 'projects' | 'session' | 'status' | 'update' | 'missing-key' | 'wrong-project'; drift?: boolean; installed?: boolean; newInstall?: boolean; picker?: boolean };
async function fixture(page: Page, scenario: Scenario = {}) {
  const calls: string[] = [];
  let updated = false;
  await page.addInitScript(({ config, newInstall }) => {
    if (!sessionStorage.getItem('fixture-initialized')) {
      sessionStorage.setItem('fixture-initialized', '1');
      if (!newInstall) {
        localStorage.setItem('stacking-installation-config', JSON.stringify(config));
        sessionStorage.setItem('stacking-installer-resume-update', '1');
      }
    }
  }, { config, newInstall: scenario.newInstall });
  await page.route('https://*.supabase.co/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/installer/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').pop()!;
    calls.push(path);
    if (path === 'projects') return route.fulfill(scenario.failure === 'projects'
      ? { status: 401, json: { code: 'INSTALLER_OAUTH_GRANT_REQUIRED' } }
      : { json: { projects: [{ ref: scenario.failure === 'wrong-project' ? 'another-project' : 'reconnect-project', name: 'Synthetic reconnect project' }, ...(scenario.picker ? [{ ref: 'second-project', name: 'Second synthetic project' }] : [])] } });
    if (path === 'session') return route.fulfill(scenario.failure === 'session'
      ? { status: 401, json: { code: 'INSTALLER_OAUTH_GRANT_REQUIRED' } }
      : { status: 201, json: { status: 'AUTHORIZED', ...(scenario.failure === 'missing-key' ? {} : { publishableKey: 'sb_publishable_synthetic_new' }) } });
    if (path === 'status') {
      return route.fulfill(scenario.failure === 'status' || scenario.failure === 'projects'
        ? { status: 401, json: { code: 'INSTALLER_SESSION_REQUIRED' } }
        : { json: { status: scenario.drift ? 'DRIFT_REQUIRES_REVIEW' : scenario.installed || updated ? 'INSTALLED' : 'UPDATE_REQUIRED', appliedMigrationCount: 0, satisfiedMigrationCount: scenario.installed || updated ? 24 : 0, requiredMigrationCount: 24, functions: [{ slug: 'student-auth', status: 'ACTIVE' }, { slug: 'student-api', status: 'ACTIVE' }] } });
    }
    if (path === 'update') {
      if (scenario.failure !== 'update') updated = true;
      return route.fulfill(scenario.failure === 'update'
      ? { status: 502, json: { code: 'SYNTHETIC_UPDATE_FAILED' } }
      : { json: { status: 'COMPLETE', jobId: 'synthetic-job' } });
    }
    return route.fulfill({ json: {} });
  });
  return calls;
}

for (const failure of ['projects', 'session', 'status', 'update', 'missing-key', 'wrong-project'] as const) {
  test(`reconnect ${failure} failure preserves marker and stays on setup`, async ({ page }) => {
    const calls = await fixture(page, { failure });
    await page.goto('/setup?oauth=granted');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/setup$/);
    expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stacking-installation-config')!).supabasePublishableKey)).toBe(failure === 'update' ? 'sb_publishable_synthetic_new' : config.supabasePublishableKey);
    if (failure !== 'update') expect(calls.filter(x => x === 'update')).toHaveLength(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/setup$/);
  });
}

test('fresh bind + cookie status + complete update returns to teacher exactly once', async ({ page }) => {
  const calls = await fixture(page);
  let teacherNavigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/teacher') teacherNavigations++; });
  await page.goto('/setup?oauth=granted');
  await expect(page).toHaveURL(/\/teacher$/);
  expect(calls.slice(0, 5)).toEqual(['projects', 'session', 'status', 'update', 'status']);
  expect(calls.filter(x => x === 'update')).toHaveLength(1);
  expect(teacherNavigations).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBeNull();
});

test('valid session reload recovers after grant was consumed without repeating OAuth', async ({ page }) => {
  const calls = await fixture(page, { installed: true });
  await page.route('**/api/installer/projects', route => route.fulfill({ status: 401, json: { code: 'INSTALLER_OAUTH_GRANT_REQUIRED' } }));
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/teacher$/);
  expect(calls).toContain('status');
  expect(calls).not.toContain('update');
});

test('reload restores a still-valid grant and the project picker for a new wizard', async ({ page }) => {
  const calls = await fixture(page, { newInstall: true, picker: true, installed: true });
  await page.goto('/setup?oauth=granted');
  await expect(page.getByRole('combobox', { name: /프로젝트/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: /프로젝트/ })).toBeVisible();
  expect(calls.filter(x => x === 'projects')).toHaveLength(2);
  await page.getByRole('button', { name: '이 프로젝트 사용' }).click();
  await expect(page.getByRole('heading', { name: '데이터베이스 준비' })).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
  expect(calls).not.toContain('update');
  await page.getByRole('button', { name: '교사 확인으로 계속' }).click();
  await expect(page.getByRole('heading', { name: '교사 계정', exact: true })).toBeVisible();
});

test('persisted config without grant or session never redirects or consumes resume on reload', async ({ page }) => {
  const calls = await fixture(page, { failure: 'projects' });
  await page.goto('/setup');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
  expect(calls).not.toContain('update');
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
});

test('failed update can be retried explicitly without losing its resume marker', async ({ page }) => {
  const scenario: Scenario = { failure: 'update' };
  const calls = await fixture(page, scenario);
  await page.goto('/setup?oauth=granted');
  await expect(page.getByRole('alert').first()).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
  scenario.failure = undefined;
  await page.getByRole('button', { name: '연결 세션 다시 확인', exact: true }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  expect(calls.filter(x => x === 'update')).toHaveLength(2);
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBeNull();
});

test('normal new-install wizard still completes steps 1 through 8', async ({ page }) => {
  await fixture(page, { newInstall: true, picker: true, installed: true });
  const user = { id: '10000000-0000-0000-0000-000000000001', email: 'wizard@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const access = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:4070908800})).toString('base64url')}.synthetic`;
  let createdClass: { id: string; name: string; class_code: string } | null = null;
  const students: Array<{ id: string; name: string; student_no: number; status: string; pinPlain: string }> = [];
  await page.route('https://*.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) return route.fulfill({ json: { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: 4070908800, refresh_token: 'synthetic-only', user } });
    if (path.endsWith('/student-auth')) return route.fulfill({ json: { token: 'synthetic-student-only' } });
    if (!path.endsWith('/student-api')) return route.fulfill({ json: {} });
    const body = route.request().postDataJSON();
    if (body.action === 'teacher:classes') return route.fulfill({ json: { classes: createdClass ? [createdClass] : [] } });
    if (body.action === 'teacher:class-upsert') { createdClass = { id: 'synthetic-class', name: body.name, class_code: 'SYNTHETIC' }; return route.fulfill({ json: { class: createdClass } }); }
    if (body.action === 'teacher:students:create') { const student = { id: 'synthetic-student', name: body.name, student_no: 1, status: 'active', pinPlain: '1234' }; students.push(student); return route.fulfill({ json: { student: { ...student, studentNo: 1 }, pinPlain: student.pinPlain } }); }
    return route.fulfill({ json: { students } });
  });
  await page.goto('/setup');
  await expect(page.getByText('1/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '설치 시작하기', exact: true }).click();
  await expect(page.getByText('2/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '연결 화면으로', exact: true }).click();
  await expect(page.getByText('3/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 프로젝트 사용', exact: true }).click();
  await expect(page.getByText('4/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '교사 확인으로 계속', exact: true }).click();
  await expect(page.getByText('5/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이미 계정이 있어요', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(user.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('synthetic-wizard-only');
  await page.getByRole('button', { name: '교사 로그인', exact: true }).click();
  await expect(page.getByText('6/8', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '새 학급 이름', exact: true }).fill('Synthetic wizard class');
  await page.getByRole('button', { name: '학급 만들기', exact: true }).click();
  await expect(page.getByText('7/8', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '학생 명단', exact: true }).fill('Synthetic student');
  await page.getByRole('button', { name: '학생 계정 만들기', exact: true }).click();
  await expect(page.getByText('현재 학급 학생 1명', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '학생 로그인 확인', exact: true }).click();
  await page.getByRole('button', { name: '완료 화면으로', exact: true }).click();
  await expect(page.getByText('8/8', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '설치 준비가 끝났어요', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
});

test('leaving setup during a slow bind cancels automatic update and teacher return', async ({ page }) => {
  const calls = await fixture(page);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/installer/session', async route => {
    entered(); await delayed;
    await route.fulfill({ status: 201, json: { status: 'AUTHORIZED', publishableKey: 'sb_publishable_synthetic_new' } });
  });
  await page.goto('/setup?oauth=granted');
  await started;
  // A real app link unmounts SetupPage without destroying the network request.
  let teacherNavigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/teacher') teacherNavigations++; });
  await page.getByRole('link', { name: '교사 화면', exact: true }).click();
  release();
  await expect(page).toHaveURL(/\/teacher$/);
  await page.waitForTimeout(400);
  expect(teacherNavigations).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stacking-installation-config')!).supabasePublishableKey)).toBe(config.supabasePublishableKey);
  expect(calls).not.toContain('update');
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
});

test('a route change cancels a slow bind even while setup unmount is deferred', async ({ page }) => {
  const calls = await fixture(page);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/installer/session', async route => {
    entered(); await delayed;
    await route.fulfill({ status: 201, json: { status: 'AUTHORIZED', publishableKey: 'sb_publishable_synthetic_new' } });
  });
  await page.goto('/setup?oauth=granted');
  await started;
  // Model a concurrent route transition: URL changes before the old page unmounts.
  await page.evaluate(() => window.history.pushState(null, '', '/teacher'));
  release();
  await expect.poll(() => calls.includes('status')).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stacking-installation-config')!).supabasePublishableKey)).toBe(config.supabasePublishableKey);
  expect(calls).not.toContain('update');
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
});

test('drift reconnect shows manual review without update, repeat OAuth, or teacher return', async ({ page }) => {
  const calls = await fixture(page, { drift: true });
  await page.goto('/setup?oauth=granted');
  await expect(page.getByRole('alert').first()).toHaveText('자동 업데이트로 변경하기 전에 확인이 필요합니다.');
  await expect(page).toHaveURL(/\/setup$/);
  const before = [...calls];
  await page.waitForTimeout(500);
  expect(calls).toEqual(before);
  expect(calls).not.toContain('update');
  expect(calls).not.toContain('authorize');
  await page.getByRole('button', { name: '연결 세션 다시 확인', exact: true }).click();
  await expect(page.getByRole('alert').first()).toHaveText('자동 업데이트로 변경하기 전에 확인이 필요합니다.');
  expect(calls).not.toContain('update');
  expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
});
test('drift normal setup disables every mutation action and permits status inspection', async ({ page }, testInfo) => {
  const calls = await fixture(page, { newInstall: true, picker: true, drift: true });
  await page.goto('/setup?oauth=granted');
  await page.getByRole('button', { name: '이 프로젝트 사용' }).click();
  await expect(page.getByRole('heading', { name: '데이터베이스 준비' })).toBeVisible();
  for (const name of ['수학 앱 설치', '이어서 복구', '업데이트']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '설치 확인', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
  await expect(page.getByText('기존 설치 구조 확인이 필요합니다.', { exact: true })).toBeVisible();
  await expect(page.getByText(/데이터베이스 준비: 0\/24/)).toHaveCount(0);
  await expect(page.getByText(/학생 로그인 기능 \(인증\): ACTIVE/)).toBeVisible();
  await page.getByRole('button', { name: '설치 확인', exact: true }).click();
  await expect(page.getByText('기존 설치 구조 확인이 필요합니다.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('기존 설치 구조 확인이 필요합니다.', { exact: true })).toBeVisible();
  expect(calls.filter(path => ['install', 'repair', 'update'].includes(path))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('existing-installation-review.png'), fullPage: true });
});
