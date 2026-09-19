/** Actual /setup controls, synthetic API only. Never writes to Supabase. */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const frontend = process.env.INSTALLER_FRONTEND_URL;
const backend = process.env.INSTALLER_REMOTE_URL;
if (!frontend || !backend) throw new Error("INSTALLER_FRONTEND_URL_AND_REMOTE_URL_REQUIRED");
const origin = new URL(frontend).origin;
const apiOrigin = new URL(backend).origin;
if (!origin.startsWith("https://") || !apiOrigin.startsWith("https://")) throw new Error("HTTPS_REQUIRED");
const output = join(process.cwd(), "qa/installer/runtime", `setup-ui-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const checks: Array<{ name: string; status: string }> = [];
const requests: Array<{ host: string; path: string; method: string }> = [];
const errors: string[] = [];
page.on("requestfailed", request => { errors.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText ?? "REQUEST_FAILED"}`); });
page.on("console", message => { if (message.type() === "error") errors.push(message.text().replace(/synthetic-qa-only-not-a-real-token/g, "[REDACTED]")); });
let authorized = false;
let installed = false;
let installs = 0;
let sessionTarget: Record<string, unknown> = {};
let stage = "load";
const syntheticPat = "synthetic-qa-only-not-a-real-token";
await context.route("**/*", async route => {
  const request = route.request(); const url = new URL(request.url());
  if (url.origin !== origin) requests.push({ host: url.hostname, path: url.pathname, method: request.method() });
  if (url.origin === origin) return route.continue();
  if (url.origin === "https://synthetic-setup-test.supabase.co" && url.pathname === "/auth/v1/settings") return route.fulfill({ json: {} });
  if (url.origin !== apiOrigin) return route.abort();
  const cors = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  let status = 200; let data: unknown;
  if (url.pathname.endsWith("/session")) {
    if (request.method() === "DELETE") { authorized = false; data = { revoked: true }; }
    else { sessionTarget = request.postDataJSON(); status = 201; data = { status: "CREATED" }; }
  } else if (url.pathname.endsWith("/credential")) {
    authorized = request.postDataJSON().pat === syntheticPat && sessionTarget.environment === "TEST";
    status = authorized ? 200 : 400; data = { status: authorized ? "AUTHORIZED" : "REJECTED" };
  } else if (!authorized) { status = 401; data = { code: "INSTALLER_SESSION_REQUIRED" }; }
  else if (url.pathname.endsWith("/status")) data = { status: installed ? "INSTALLED" : "NEW", appliedMigrationCount: installed ? 18 : 0, requiredMigrationCount: 18, functions: [] };
  else if (/\/(install|repair|update)$/.test(url.pathname)) { installed = true; installs++; data = { jobId: "synthetic-job", status: "COMPLETE" }; }
  else { status = 404; data = { code: "UNKNOWN_ROUTE" }; }
  await route.fulfill({ status, headers: cors, json: data });
});
try {
  await page.goto(origin + "/setup");
  await page.getByRole("button", { name: "설치 시작하기", exact: true }).click();
  await page.getByRole("button", { name: "연결 화면으로", exact: true }).click();
  await page.getByLabel("Project URL", { exact: false }).fill("https://synthetic-setup-test.supabase.co");
  await page.locator("#installer-key").fill("synthetic-public-key");
  await page.getByRole("button", { name: "연결 확인", exact: true }).click();
  stage = "authorize";
  await expect(page.getByRole("button", { name: "교사 확인으로 계속" })).toBeDisabled();
  await expect(page.locator("#installer-pat")).toHaveAttribute("type", "password");
  await page.locator("#installer-pat").fill(syntheticPat);
  await page.getByRole("button", { name: "설치 권한 연결", exact: true }).click();
  await expect(page.getByText("아직 앱 데이터 구조가 준비되지 않았습니다.", { exact: true })).toBeVisible();
  await expect(page.locator("#installer-pat")).toHaveValue("");
  checks.push({ name: "public connection, TEST session, masked PAT, authorization", status: "PASS" });
  stage = "install";
  await page.getByRole("button", { name: "설치하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "교사 확인으로 계속" })).toBeEnabled();
  expect(installs).toBe(1);
  await page.screenshot({ path: join(output, "installed.png"), fullPage: true });
  checks.push({ name: "install button, status and teacher gate", status: "PASS" });
  stage = "refresh";
  await page.reload();
  await expect(page.getByText("설치가 완료된 프로젝트입니다.", { exact: true })).toBeVisible();
  checks.push({ name: "reload restores installation and checks current status", status: "PASS" });
  stage = "credential-storage";
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(syntheticPat);
  expect(page.url()).not.toContain(syntheticPat);
  checks.push({ name: "PAT absent from URL and browser storage", status: "PASS" });
  stage = "repair-update-revoke";
  for (const name of ["이어서 복구", "업데이트"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("button", { name: "교사 확인으로 계속" })).toBeEnabled();
  }
  await page.getByRole("button", { name: "설치 권한 해제", exact: true }).click();
  await expect(page.getByRole("button", { name: "교사 확인으로 계속" })).toBeDisabled();
  await page.getByRole("button", { name: "상태 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("만료");
  checks.push({ name: "repair, update, revoke and expired-session recovery", status: "PASS" });
} catch (error) {
  errors.push(error instanceof Error ? error.message.replaceAll(syntheticPat, "[REDACTED]") : "BROWSER_FAILURE");
  checks.push({ name: stage, status: "FAIL" });
  await page.screenshot({ path: join(output, "failed.png"), fullPage: true });
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify({ kind: "UI_WITH_TEST_DATA", remoteSupabaseWrites: false, codeCommit: process.env.INSTALLER_BUILD_COMMIT ?? "NOT_RECORDED", executedAt: new Date().toISOString(), frontend: origin, checks, requests, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ kind: "UI_WITH_TEST_DATA", checks, output }));
