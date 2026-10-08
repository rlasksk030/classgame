import { test, expect, type Page } from '@playwright/test';

const config = { installationId: 'wizard-resume-synthetic', supabaseUrl: 'https://wizard-resume.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_resume' };
const classes = [{ id: 'class-a', name: 'Synthetic A', class_code: 'SYNTHETICA' }, { id: 'class-b', name: 'Synthetic B', class_code: 'SYNTHETICB' }];
const user = { id: '10000000-0000-0000-0000-000000000001', email: 'wizard@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const access = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:4070908800})).toString('base64url')}.synthetic`;
const session = { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: 4070908800, refresh_token: 'synthetic-only', user };
async function fixture(page: Page, options: { step?: number; classId?: string; loggedIn?: boolean } = {}) {
  await page.addInitScript(({ config, session, options }) => {
    if (sessionStorage.getItem('resume-fixture-initialized')) return;
    sessionStorage.setItem('resume-fixture-initialized', '1');
    localStorage.setItem('stacking-installation-config', JSON.stringify(config));
    localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: options.step ?? 7, classId: options.classId ?? 'class-b', updatedAt: new Date().toISOString() }));
    if (options.loggedIn !== false) localStorage.setItem('sb-wizard-resume-auth-token', JSON.stringify(session));
  }, { config, session, options });
  await page.route('**/api/installer/**', route => route.fulfill({ json: { status: 'INSTALLED' } }));
  const students: Record<string, Array<{ id: string; name: string; student_no: number; status: string; pinPlain: string }>> = {
    'class-a': [{ id: 'student-a', name: 'Synthetic A pupil', student_no: 1, status: 'active', pinPlain: 'synthetic-A-pin' }],
    'class-b': [{ id: 'student-b', name: 'Synthetic B pupil', student_no: 1, status: 'active', pinPlain: 'synthetic-B-pin' }],
  };
  const logins: Array<{ classCode: string; name: string }> = [];
  await page.route('https://wizard-resume.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) return route.fulfill({ json: session });
    if (path.endsWith('/student-auth')) { logins.push({ classCode: route.request().postDataJSON().classCode, name: route.request().postDataJSON().name }); return route.fulfill({ json: { token: 'synthetic-student-only' } }); }
    if (!path.endsWith('/student-api')) return route.fulfill({ json: {} });
    const body = route.request().postDataJSON();
    return route.fulfill({ json: body.action === 'teacher:classes' ? { classes } : { students: students[body.classId] ?? [] } });
  });
  return { students, logins };
}

test('wizard reload restores the selected second class; smoke cannot carry into a different class', async ({ page }) => {
  const { logins } = await fixture(page);
  await page.goto('/setup');
  await expect(page.getByText('Synthetic B 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '학생 로그인 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '완료 화면으로', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '학급 다시 선택', exact: true }).click();
  await page.getByLabel('기존 학급 선택').selectOption('class-a');
  await page.getByRole('button', { name: '학생 만들기로 계속', exact: true }).click();
  await expect(page.getByRole('button', { name: '완료 화면으로', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '학생 로그인 확인', exact: true }).click();
  expect(logins).toEqual([{ classCode: 'SYNTHETICB', name: 'Synthetic B pupil' }, { classCode: 'SYNTHETICA', name: 'Synthetic A pupil' }]);
  await page.reload();
  await expect(page.getByText('Synthetic A 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('restored-class.png'), fullPage: true });
});

test('expired teacher auth resumes at login and then returns to the saved class', async ({ page }) => {
  await fixture(page, { loggedIn: false });
  await page.goto('/setup');
  await expect(page.getByText('5/8', { exact: true })).toBeVisible();
  await page.getByLabel('이메일', { exact: true }).fill(user.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('synthetic-wizard-only');
  await page.getByRole('button', { name: '교사 로그인', exact: true }).click();
  await expect(page.getByText('7/8', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic B 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
});

test('a late student-list response from a previous class cannot replace the active roster', async ({ page }) => {
  const { logins } = await fixture(page, { step: 6, classId: 'class-a' });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://wizard-resume.supabase.co/functions/v1/student-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'teacher:students:list' || body.classId !== 'class-a') return route.fallback();
    entered(); await delayed;
    return route.fulfill({ json: { students: [{ id: 'student-a', name: 'Synthetic A pupil', student_no: 1, status: 'active', pinPlain: 'synthetic-A-pin' }] } });
  });
  await page.goto('/setup');
  await started;
  await page.getByLabel('기존 학급 선택').selectOption('class-b');
  await page.getByRole('button', { name: '학생 만들기로 계속', exact: true }).click();
  await expect(page.getByRole('button', { name: '학생 로그인 확인', exact: true })).toBeEnabled();
  release();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: '학생 로그인 확인', exact: true }).click();
  expect(logins).toEqual([{ classCode: 'SYNTHETICB', name: 'Synthetic B pupil' }]);
});


test('partial student batch preserves confirmed pupils and retries the same remaining name-number pair once', async ({ page }) => {
  const { students } = await fixture(page);
  students['class-b'] = [];
  const created: Array<{ name: string; studentNo: number }> = [];
  let failSecond = true;
  await page.route('https://wizard-resume.supabase.co/functions/v1/student-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'teacher:students:create') return route.fallback();
    if (body.studentNo === 2 && failSecond) { failSecond = false; return route.fulfill({ status: 500, json: { error: 'SYNTHETIC_INTERRUPTION' } }); }
    created.push({ name: body.name, studentNo: body.studentNo });
    const student = { id: `synthetic-${body.studentNo}`, name: body.name, student_no: body.studentNo, status: 'active', pinPlain: 'synthetic-only' };
    students['class-b'].push(student);
    return route.fulfill({ json: { student: { ...student, studentNo: body.studentNo }, pinPlain: student.pinPlain } });
  });
  await page.goto('/setup');
  await expect(page.getByText('Synthetic B 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '학생 명단', exact: true }).fill('First synthetic pupil\nSecond synthetic pupil');
  await page.getByRole('button', { name: '학생 계정 만들기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('명단 추가가 중단');
  await expect(page.getByLabel('새 학생 PIN 목록')).toContainText('First synthetic pupil');
  await expect(page.getByRole('textbox', { name: '학생 명단', exact: true })).toHaveValue('Second synthetic pupil');
  await page.getByRole('button', { name: '학생 계정 만들기', exact: true }).click();
  await expect(page.getByText('현재 학급 학생 2명', { exact: true })).toBeVisible();
  expect(created).toEqual([{ name: 'First synthetic pupil', studentNo: 1 }, { name: 'Second synthetic pupil', studentNo: 2 }]);
});

test('student login smoke preserves an unrelated student session on the shared device', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('sb.student.token', 'synthetic-existing-session'));
  await page.goto('/setup');
  await expect(page.getByRole('button', { name: '학생 로그인 확인', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '학생 로그인 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '완료 화면으로', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('sb.student.token'))).toBe('synthetic-existing-session');
});

test('bulk recovery does not collapse pupils with the same name and different numbers', async ({ page }) => {
  const { students } = await fixture(page);
  students['class-b'] = [{ id: 'existing-same-name', name: 'Same synthetic name', student_no: 2, status: 'active', pinPlain: 'synthetic-only' }];
  let createdNo: number | undefined;
  await page.route('https://wizard-resume.supabase.co/functions/v1/student-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'teacher:students:create') return route.fallback();
    createdNo = body.studentNo;
    const student = { id: 'new-same-name', name: body.name, student_no: body.studentNo, status: 'active', pinPlain: 'synthetic-only' };
    students['class-b'].push(student);
    return route.fulfill({ json: { student: { ...student, studentNo: body.studentNo }, pinPlain: student.pinPlain } });
  });
  await page.goto('/setup');
  await expect(page.getByText('Synthetic B 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '학생 명단', exact: true }).fill('Same synthetic name');
  await page.getByRole('button', { name: '학생 계정 만들기', exact: true }).click();
  await expect(page.getByText('현재 학급 학생 2명', { exact: true })).toBeVisible();
  expect(createdNo).toBe(1);
});

test('lost class-create response and reload recover the exact owned code without creating another class', async ({ page }) => {
  await fixture(page, { step: 6, classId: '' });
  const created: Array<{ id: string; name: string; class_code: string }> = [];
  let writes = 0;
  await page.route('https://wizard-resume.supabase.co/functions/v1/student-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'teacher:classes') return route.fulfill({ json: { classes: [...classes, ...created] } });
    if (body.action !== 'teacher:class-upsert') return route.fallback();
    writes++;
    expect(body.classCode).toMatch(/^[A-Z0-9]{10}$/);
    created.push({ id: 'one-new-class', name: body.name, class_code: body.classCode });
    // The server commits but its response is lost. No handler fabricates a
    // client success: the next real list request must reconcile exact code.
    return route.abort('failed');
  });
  await page.goto('/setup');
  await expect(page.getByText('6/8', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '새 학급 이름', exact: true }).fill('Synthetic pending class');
  await page.getByRole('button', { name: '학급 만들기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('학급 생성 결과를 확인하지 못했습니다');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '새 학급 이름', exact: true })).toHaveValue('Synthetic pending class');
  await page.getByRole('button', { name: '학급 만들기', exact: true }).click();
  await expect(page.getByText('7/8', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic pending class 학생 명단을 붙여 넣어 주세요.', { exact: true })).toBeVisible();
  expect(created).toHaveLength(1);
  expect(writes).toBe(1);
});
