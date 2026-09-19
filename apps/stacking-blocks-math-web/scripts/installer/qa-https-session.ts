/** Real HTTPS/CORS/cookies only. No PAT, Supabase request or installation write. */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeTarget, assertTargetBinding } from "./security.ts";

const frontend = new URL(process.env.INSTALLER_FRONTEND_URL ?? "").origin;
const endpoint = new URL(process.env.INSTALLER_REMOTE_URL ?? "").origin;
const ref = process.env.INSTALLER_TEST_PROJECT_REF ?? "";
const target = { environment: "TEST", projectRef: ref, projectUrl: `https://${ref}.supabase.co`, release: "spatial-math-v1" };
assertSafeTarget(target, process.env.INSTALLER_PRODUCTION_REF ?? "stacking-blocks-math");
assertTargetBinding(target);
if (!frontend.startsWith("https://") || !endpoint.startsWith("https://")) throw new Error("HTTPS_REQUIRED");
const directory = join(process.cwd(), "qa/installer/runtime", `https-session-${Date.now()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const checks: Record<string, string> = {};
let stage = "load";
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin === frontend || (url.origin === endpoint && ["/health", "/api/installer/session", "/api/installer/status"].includes(url.pathname))) return route.continue();
  return route.abort();
});
async function call(path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ endpoint, path, method, body }) => {
    const response = await fetch(endpoint + path, { method, signal: AbortSignal.timeout(60_000), credentials: "include", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    return { status: response.status, code: payload.code, mode: payload.mode, service: payload.service };
  }, { endpoint, path, method, body });
}
try {
  await page.goto(frontend + "/setup");
  await expect(page.getByRole("heading", { name: "공간과 입체 수업앱 설치", exact: true })).toBeVisible();
  checks.setup = "PASS";
  stage = "health-cors";
  const health = await call("/health"); expect(health.status).toBe(200); expect(health.mode).toBe("TEST");
  checks.healthCORS = "PASS";
  stage = "session-cors-cookie";
  expect((await call("/api/installer/session", "POST", target)).status).toBe(201);
  const cookie = (await context.cookies(endpoint)).find(item => item.name === "installer_session");
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.secure).toBe(true); expect(cookie?.sameSite).toBe("None");
  checks.cookie = "HttpOnly/Secure/SameSite=None";
  stage = "reload-session";
  await page.reload();
  const status = await call("/api/installer/status"); expect(status.status).toBe(401); expect(status.code).toBe("INSTALLER_AUTH_REQUIRED");
  checks.reconnect = "PASS: cookie retained, no PAT supplied";
  stage = "production-block";
  expect((await call("/api/installer/session", "POST", { ...target, projectRef: "lpjpwrgzwumnikroledh", projectUrl: "https://lpjpwrgzwumnikroledh.supabase.co" })).status).toBe(403);
  checks.productionBlock = "PASS: rejected before Supabase access";
  stage = "revoke";
  expect((await call("/api/installer/session", "DELETE")).status).toBe(200);
  expect((await call("/api/installer/status")).code).toBe("INSTALLER_SESSION_REQUIRED");
  checks.revoke = "PASS";
  await page.screenshot({ path: join(directory, "setup.png"), fullPage: true });
} catch {
  checks[stage] = "FAIL"; process.exitCode = 1;
  await page.screenshot({ path: join(directory, "failed.png"), fullPage: true });
} finally {
  // Always discard this credential-free server session as well as local cookies.
  await call("/api/installer/session", "DELETE").catch(() => undefined);
  await browser.close();
  await writeFile(join(directory, "result.json"), JSON.stringify({ executedAt: new Date().toISOString(), kind: "LIVE_INSTALLER_HTTPS_SESSION_ONLY", frontend, endpoint, codeCommit: process.env.INSTALLER_BUILD_COMMIT ?? "NOT_RECORDED", checks, supabaseAccess: false, credentialUsed: false }, null, 2));
}
console.log(JSON.stringify({ checks, directory }));
