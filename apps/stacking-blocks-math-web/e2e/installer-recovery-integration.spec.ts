import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInstallerServer } from '../scripts/installer/http-server';
import { readMathInstallerPlan } from '../scripts/installer/math-plan';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit';
import { emptyLegacyDb, legacyBackend, seedProtectedRows } from '../tests/support/installer-legacy-db';

// Browser requests are proxied to the real local installer HTTP handler. Only
// identity/initial installation metadata is synthetic; no success/status/plan
// response is stubbed, and approved recovery runs the real SQL on PGlite.
test('actual setup consent executes one local SQL recovery, preserves rows and reaches teacher step after reload', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  const plan = await readMathInstallerPlan(process.cwd());
  const db = await emptyLegacyDb();
  const target = { environment: 'TEST' as const, projectRef: 'synthetic-browser-recovery', projectUrl: 'https://synthetic-browser-recovery.supabase.co', publishableKey: 'sb_publishable_synthetic_integration', release: 'test' };
  const backend = legacyBackend(db, plan, plan.migrations.map(m => m.name));
  backend.inspectDatabasePermissions = async () => (await db.query<{ snapshot: PermissionSnapshot }>(readFileSync('scripts/installer/permission-audit.sql', 'utf8'))).rows[0].snapshot;
  backend.applyPermissionRecovery = async (_target, query) => { backend.calls.push('applyPermissionRecovery'); await db.exec(query); };
  const server = createInstallerServer({
    plan, productionRef: 'blocked-production', mode: 'TEST', allowedOrigins: [origin], allowedProjectRefs: [target.projectRef],
    sessionSecret: 'synthetic-browser-session-signature', sessionCookieSecure: false,
    createBackend: credential => {
      expect(credential.disposed).toBe(false);
      return backend;
    },
  });
  const writes = () => backend.calls.filter(c => /^(apply|deploy|setSecrets)/.test(c)).length;
  try {
    await db.exec('alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role; alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;');
    for (const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";', ''));
    await seedProtectedRows(db);
    await db.exec(`insert into sb_student_progress(student_id,lesson,completed,completed_at)
      values ('33333333-3333-4333-8333-333333333333',9,false,null),
      ('33333333-3333-4333-8333-333333333333',10,true,'2026-01-01'),
      ('33333333-3333-4333-8333-333333333333',11,true,'2026-01-01')
      on conflict(student_id,lesson) do update set completed=sb_student_progress.completed or excluded.completed,completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at);`);
    const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    const rowQuery = tables.map(({ tablename }) => `select '${tablename}' table_name,to_jsonb(t) row_data from public."${tablename}" t`).join(' union all ');
    const dataHash = async () => createHash('sha256').update(JSON.stringify((await db.query(rowQuery)).rows.map(r => JSON.stringify(r)).sort())).digest('hex');
    const before = await dataHash();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); expect(address && typeof address !== 'string').toBeTruthy();
    if (!address || typeof address === 'string') throw new Error('LOCAL_HTTP_ADDRESS_MISSING');
    const local = `http://127.0.0.1:${address.port}`;
    const created = await fetch(local + '/api/installer/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(target) });
    expect(created.status).toBe(201);
    const cookie = created.headers.getSetCookie().find(c => c.startsWith('installer_session='))!.split(';')[0];
    const authorized = await fetch(local + '/api/installer/credential', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ pat: 'synthetic-browser-only-credential' }) });
    expect(authorized.status).toBe(200);
    await page.context().addCookies([{ name: 'installer_session', value: cookie.slice('installer_session='.length), url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await page.addInitScript(config => {
      if (sessionStorage.getItem('recovery-integration-fixture')) return;
      sessionStorage.setItem('recovery-integration-fixture', '1');
      localStorage.setItem('stacking-installation-config', JSON.stringify(config));
      localStorage.setItem('stacking-installer-progress', JSON.stringify({ installationId: config.installationId, step: 4, updatedAt: new Date().toISOString() }));
    }, { installationId: 'synthetic-browser-recovery-installation', supabaseUrl: target.projectUrl, supabasePublishableKey: target.publishableKey });
    await page.route(target.projectUrl + '/**', route => route.fulfill({ json: {} }));
    const requests: Array<{ path: string; body: unknown }> = [];
    await page.route('**/api/installer/**', async route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null });
      // Same-origin QA reverse proxy, preserving the browser's real HttpOnly
      // session cookie and Origin. Response status/body come from actual HTTP.
      const response = await route.fetch({ url: local + url.pathname + url.search, headers: { ...await request.allHeaders(), origin }, maxRetries: 0 });
      await route.fulfill({ response });
    });
    await page.goto('/setup');
    await expect(page.getByRole('button', { name: '설치 문제 자동 진단', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeDisabled();
    expect(writes()).toBe(0);
    await page.getByRole('button', { name: '설치 문제 자동 진단', exact: true }).click();
    await expect(page.getByRole('button', { name: '복구 내용 확인', exact: true })).toBeVisible();
    expect(writes()).toBe(0);
    await page.getByRole('button', { name: '복구 내용 확인', exact: true }).click();
    await expect(page.getByLabel('승인할 복구 내용')).toContainText(target.projectRef);
    await expect(page.getByLabel('승인할 복구 내용')).toContainText('22개 항목');
    expect(writes()).toBe(0);
    await page.getByRole('button', { name: '복구 승인 및 진행', exact: true }).click();
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
    expect(writes()).toBe(1);
    expect(backend.calls.filter(c => c === 'applyPermissionRecovery')).toHaveLength(1);
    const submissions = requests.filter(r => r.path.endsWith('/recovery-execute'));
    expect(submissions).toHaveLength(1);
    expect(submissions[0].body).toEqual({ planId: expect.any(String), approved: true });
    expect(await dataHash()).toBe(before);
    await page.reload();
    await expect(page.getByRole('button', { name: '교사 확인으로 계속', exact: true })).toBeEnabled();
    expect(writes()).toBe(1);
    const finalStatus = await fetch(local + '/api/installer/status', { headers: { origin, cookie } });
    expect(finalStatus.status).toBe(200);
    expect((await finalStatus.json()).status).toBe('INSTALLED');
    await page.screenshot({ path: testInfo.outputPath('real-http-acl-recovery-complete.png'), fullPage: true });
    await page.getByRole('button', { name: '교사 확인으로 계속', exact: true }).click();
    await expect(page.getByText('5/8', { exact: true })).toBeVisible();
    expect(await dataHash()).toBe(before);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
  }
});
