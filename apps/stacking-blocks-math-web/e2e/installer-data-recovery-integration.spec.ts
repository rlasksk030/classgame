import { expect, test } from '@playwright/test';
import { createInstallerServer } from '../scripts/installer/http-server';
import { createDataRecoveryFixture } from '../tests/support/installer-data-recovery';

// Only identity/initial UI metadata is synthetic. Every installer response and
// approved change travels through the real HTTP handler and PGlite SQL.
test('teacher acknowledges historical feedback and corrects one seed through real HTTP and SQL without changing saved learning', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const f = await createDataRecoveryFixture('browser-data-recovery');
  const origin = new URL(baseURL!).origin;
  const server = createInstallerServer({ plan: f.plan, productionRef: 'blocked-production', mode: 'TEST', allowedOrigins: [origin], allowedProjectRefs: [f.target.projectRef], sessionSecret: 'synthetic-data-browser-signature', sessionCookieSecure: false, createBackend: () => f.backend });
  try {
    const before = await f.protectedHash();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('LOCAL_HTTP_ADDRESS_MISSING');
    const local = `http://127.0.0.1:${address.port}`;
    const created = await fetch(local + '/api/installer/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(f.target) });
    expect(created.status).toBe(201);
    const cookie = created.headers.getSetCookie().find(c => c.startsWith('installer_session='))!.split(';')[0];
    const authorized = await fetch(local + '/api/installer/credential', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ pat: 'synthetic-data-browser-credential' }) });
    expect(authorized.status).toBe(200);
    await page.context().addCookies([{ name: 'installer_session', value: cookie.slice('installer_session='.length), url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await page.addInitScript(config => {
      if (sessionStorage.getItem('data-recovery-integration')) return;
      sessionStorage.setItem('data-recovery-integration', '1');
      localStorage.setItem('stacking-installation-config', JSON.stringify(config));
      localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: 4, updatedAt: new Date().toISOString() }));
    }, { installationId: 'synthetic-data-browser-installation', supabaseUrl: f.target.projectUrl, supabasePublishableKey: f.target.publishableKey });
    await page.route(f.target.projectUrl + '/**', route => route.fulfill({ json: {} }));
    const requests: Array<{ path: string; body: unknown }> = [];
    await page.route('**/api/installer/**', async route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
      const response = await route.fetch({ url: local + url.pathname + url.search, headers: { ...await request.allHeaders(), origin }, maxRetries: 0 });
      await route.fulfill({ response });
    });
    await page.goto('/setup');
    await expect(page.getByLabel('데이터 검증 상세')).toContainText('L1-03');
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
    await expect(page.getByLabel('기존 설치 안전 복구')).toHaveCount(0);
    await page.getByRole('button', { name: '기본 문제 정정 진단', exact: true }).click();
    await page.getByRole('button', { name: '정정 내용 확인', exact: true }).click();
    const details = page.getByLabel('승인할 기본 문제 정정 내용');
    await expect(details).toContainText(f.target.projectRef);
    await expect(details).toContainText('L1-03');
    await expect(details).toContainText('풀이 1건');
    await expect(details).toContainText('블록 저장 1건');
    await expect(details).toContainText('과거 풀이에서 다시 보는 정답·해설 표시가 바뀝니다');
    const approve = page.getByRole('button', { name: '기본 문제 정정 승인 및 진행', exact: true });
    await expect(approve).toBeDisabled();
    expect(f.writes()).toBe(0);
    await page.getByLabel('과거 풀이의 정답·해설 표시가 바뀌며 기존 채점·점수·진도는 유지됨을 확인했습니다.', { exact: true }).check();
    await expect(approve).toBeEnabled();
    expect(f.writes()).toBe(0);
    await approve.click();
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
    expect(f.writes()).toBe(1);
    expect(f.backend.calls.filter(c => c === 'applyDataRecovery')).toHaveLength(1);
    expect(requests.filter(r => r.path.endsWith('/data-recovery-execute'))).toEqual([{ path: '/api/installer/data-recovery-execute', body: { planId: expect.any(String), approved: true, acknowledgesHistoricalFeedbackChange: true } }]);
    expect(requests.some(r => r.path.endsWith('/recovery-execute'))).toBe(false);
    expect((await f.db.query('select answer from sb_problems where id=$1', [f.correction.id])).rows[0].answer).toEqual(f.correction.after.answer);
    expect(await f.protectedHash()).toBe(before);
    await page.reload();
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
    const finalStatus = await fetch(local + '/api/installer/status', { headers: { origin, cookie } });
    expect((await finalStatus.json()).status).toBe('INSTALLED');
    expect(f.writes()).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('data-correction-preserved-learning.png'), fullPage: true });
    await page.getByRole('button', { name: '교사 확인으로 계속', exact: true }).click();
    await expect(page.getByText('5/8', { exact: true })).toBeVisible();
    expect(await f.protectedHash()).toBe(before);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.db.close();
  }
});
