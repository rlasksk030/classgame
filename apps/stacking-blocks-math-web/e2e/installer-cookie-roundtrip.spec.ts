import { test, expect, type Page } from '@playwright/test';
import { reconnectServer } from './support/reconnect-server';

const user = { id: '10000000-0000-0000-0000-000000000001', email: 'synthetic-reconnect@example.invalid', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4070908800, role: 'authenticated' })).toString('base64url')}.synthetic`;
const auth = { access_token: token, token_type: 'bearer', expires_at: 4070908800, expires_in: 3600, refresh_token: 'synthetic-only', user };
async function syntheticTeacher(page: Page) {
  await page.addInitScript(({ auth }) => {
    localStorage.setItem('stacking-installation-config', JSON.stringify({ installationId: 'synthetic-cookie-roundtrip', supabaseUrl: 'https://reconnect-project.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_old' }));
    localStorage.setItem('sb-reconnect-project-auth-token', JSON.stringify(auth));
  }, { auth });
  await page.route('https://reconnect-project.supabase.co/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/student-api') ? { classes: [] } : {} }));
  // Only the external consent/token exchange and Supabase APIs are synthetic.
  // App, redirects, HTTP server, proxy, signed cookies, status and update are real.
  await page.route('https://api.supabase.com/v1/oauth/authorize**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_uri')}?code=synthetic&state=${url.searchParams.get('state')}` } });
  });
}

for (const dropped of [false, true]) {
  test(`real browser proxy OAuth cookies ${dropped ? 'missing session stops on setup' : 'complete reconnect returns with latest-version widget'}`, async ({ page, context }) => {
    const server = await reconnectServer(dropped);
    try {
      await syntheticTeacher(page);
      await page.goto(server.origin + '/teacher');
      await expect(page.getByText('Supabase 연결이 필요합니다.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '연결하고 업데이트', exact: true }).click();
      if (dropped) {
        await expect(page.getByRole('alert').first()).toBeVisible();
        await expect(page).toHaveURL(server.origin + '/setup');
        expect(server.events.some(e => e.path.endsWith('/update'))).toBe(false);
        expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBe('1');
      } else {
        await expect(page.getByText('✓ 최신 버전입니다', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(server.origin + '/teacher');
        await expect(page.getByText('Supabase 연결이 필요합니다.', { exact: true })).toHaveCount(0);
        const cookies = (await context.cookies(server.origin + '/api/installer/status')).filter(c => c.name.startsWith('installer_'));
        expect(cookies.map(({ name, path, httpOnly, secure, sameSite }) => ({ name, path, httpOnly, secure, sameSite }))).toEqual([{ name: 'installer_session', path: '/api/installer', httpOnly: true, secure: true, sameSite: 'Lax' }]);
        expect(server.events.filter(e => e.path.endsWith('/update'))).toHaveLength(1);
        expect(server.events.find(e => e.path.endsWith('/session') && e.method === 'POST')?.grantSent).toBe(true);
        expect(server.events.filter(e => e.path.endsWith('/status')).slice(1).every(e => e.sessionSent)).toBe(true);
        expect(await page.evaluate(() => sessionStorage.getItem('stacking-installer-resume-update'))).toBeNull();
      }
    } finally { await server.close(); }
  });
}
