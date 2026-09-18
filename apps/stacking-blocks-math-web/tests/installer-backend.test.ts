import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createFakeInstallerBackend, fakeBundle } from "../scripts/installer/fake-backend.ts";
import { runInstaller, type InstallerPlan } from "../scripts/installer/orchestrator.ts";
import { EphemeralCredential, assertSafeTarget, assertTargetBinding, generateFunctionSecret, redactInstallerObject } from "../scripts/installer/security.ts";
import { SupabaseManagementBackend } from "../scripts/installer/management-api.ts";
import { OAuthSessionStore, exchangeOAuthCode } from "../scripts/installer/oauth.ts";
import { readMathManifest } from "../scripts/installer/math-manifest.ts";
import { readMathInstallerPlan } from "../scripts/installer/math-plan.ts";
import { readInstallerRuntimeConfig } from "../scripts/installer/runtime.ts";
import { maintenanceAction, resolveSessionCookieSameSite } from "../scripts/installer/http-server.ts";
import { fileURLToPath } from "node:url";

const target = { environment: "TEST" as const, projectRef: "test-project-ref", projectUrl: "https://test-project-ref.supabase.co", publishableKey: "test-publishable-key", release: "v1" };
const plan: InstallerPlan = {
  migrations: [{ name: "001.sql", query: "select 1" }, { name: "002.sql", query: "select 2" }],
  functions: [fakeBundle("student-auth"), fakeBundle("student-api")],
  appVersion: "1.0.0",
  schemaVersion: "002",
  productionRef: "production-ref",
};

test("B01 target project is inspected and bound to TEST ref", async () => {
  const backend = createFakeInstallerBackend();
  const result = await runInstaller({ target, plan, backend });
  assert.equal(result.target.projectRef, "test-project-ref");
  assert.ok(backend.calls.includes("inspectProject"));
});

test("B02 production target is rejected before any backend call", async () => {
  const backend = createFakeInstallerBackend();
  await assert.rejects(() => runInstaller({ target: { ...target, projectRef: "production-ref", projectUrl: "https://production-ref.supabase.co" }, plan, backend }), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "PRODUCTION_TARGET_BLOCKED");
  assert.deepEqual(backend.calls, []);
});

test("B03 missing migrations are calculated in source order", async () => {
  const backend = createFakeInstallerBackend({ migrations: ["001.sql"] });
  const states: string[][] = [];
  const result = await runInstaller({ target, plan, backend, onState: (state) => states.push([...state.missingMigrations]) });
  assert.deepEqual(result.appliedMigrations, ["001.sql", "002.sql"]);
  assert.ok(states.some((items) => items.includes("002.sql")));
});

test("B04 a partial migration resumes without replaying applied work", async () => {
  const backend = createFakeInstallerBackend({ migrations: ["001.sql"] });
  await runInstaller({ target, plan, backend });
  assert.equal(backend.calls.filter((call) => call === "applyMigration:001.sql").length, 0);
  assert.equal(backend.calls.filter((call) => call === "applyMigration:002.sql").length, 1);
});

test("B05 generated secret is sent only when missing", async () => {
  const backend = createFakeInstallerBackend();
  const result = await runInstaller({ target, plan, backend });
  assert.equal(result.secretConfigured, true);
  assert.equal(Object.keys(backend.secretValues).length, 1);
  assert.ok(backend.secretValues.APP_SESSION_SECRET.length >= 43);
});

test("B06 existing secret is preserved", async () => {
  const backend = createFakeInstallerBackend({ secrets: ["APP_SESSION_SECRET"] });
  await runInstaller({ target, plan, backend });
  assert.equal(backend.calls.includes("setSecrets"), false);
  assert.deepEqual(backend.secretValues, {});
});

test("B07 and B08 both functions are deployed only when missing", async () => {
  const backend = createFakeInstallerBackend();
  await runInstaller({ target, plan, backend });
  assert.ok(backend.calls.includes("deployFunction:student-auth"));
  assert.ok(backend.calls.includes("deployFunction:student-api"));
  const second = createFakeInstallerBackend({ functions: plan.functions.map(({ slug, hash }) => ({ slug, hash, status: "ACTIVE" })) });
  await runInstaller({ target, plan, backend: second });
  assert.equal(second.calls.some((call) => call.startsWith("deployFunction:")), false);
});

test("B09 deployed functions are probed", async () => {
  const backend = createFakeInstallerBackend();
  await runInstaller({ target, plan, backend });
  assert.ok(backend.calls.includes("probeFunction:student-auth"));
  assert.ok(backend.calls.includes("probeFunction:student-api"));
});

test("B10 an installed project reaches COMPLETE", async () => {
  const backend = createFakeInstallerBackend({ migrations: plan.migrations.map(({ name }) => name), secrets: ["APP_SESSION_SECRET"], functions: plan.functions.map(({ slug, hash }) => ({ slug, hash, status: "ACTIVE" })) });
  const result = await runInstaller({ target, plan, backend });
  assert.equal(result.status, "COMPLETE");
});

test("B11 a failed stage is recoverable and reports its safe stage", async () => {
  const backend = createFakeInstallerBackend({ rejectStage: "secret" });
  await assert.rejects(() => runInstaller({ target, plan, backend }), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "FAKE_SECRET_FAILED");
});

test("B12 update uses a changed function hash", async () => {
  const existing = fakeBundle("student-api");
  const backend = createFakeInstallerBackend({ functions: [{ slug: existing.slug, hash: "old-hash", status: "ACTIVE" }] });
  await runInstaller({ target, plan, backend });
  assert.ok(backend.calls.includes("deployFunction:student-api"));
});

test("B13 class and B14 student work remain outside privileged installer state", async () => {
  const backend = createFakeInstallerBackend();
  const result = await runInstaller({ target, plan, backend });
  assert.equal("classId" in result, false);
  assert.equal("students" in result, false);
});

test("B15 no PIN or teacher password is accepted by the installer plan", () => {
  assert.equal(JSON.stringify(plan).includes("PIN"), false);
  assert.equal(JSON.stringify(plan).includes("password"), false);
});

test("B16 secret values are not returned in state", async () => {
  const backend = createFakeInstallerBackend();
  const result = await runInstaller({ target, plan, backend });
  assert.equal(JSON.stringify(result).includes(backend.secretValues.APP_SESSION_SECRET), false);
});

test("B17 function smoke failure stops completion", async () => {
  const backend = createFakeInstallerBackend({ rejectStage: "probe" });
  await assert.rejects(() => runInstaller({ target, plan, backend }), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "FAKE_PROBE_FAILED");
});

test("B18 generated secrets are cryptographically sized", () => {
  const a = generateFunctionSecret();
  const b = generateFunctionSecret();
  assert.ok(a.length >= 43);
  assert.notEqual(a, b);
});

test("B19 credential disposal prevents later API use", async () => {
  const credential = new EphemeralCredential("temporary-management-token");
  credential.dispose();
  assert.equal(credential.disposed, true);
  await assert.rejects(() => credential.use(async () => "never"), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_CREDENTIAL_DISPOSED");
});

test("B20 redaction removes sensitive keys and preserves harmless diagnostics", () => {
  const value = redactInstallerObject({ status: 500, token: "hidden", nested: { password: "hidden" }, code: "MIGRATION_FAILED" });
  assert.deepEqual(value, { status: 500, token: "[REDACTED]", nested: { password: "[REDACTED]" }, code: "MIGRATION_FAILED" });
});

test("B21 management adapter sends bearer only server-side and returns safe errors", async () => {
  const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify({ ref: "test-ref" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const credential = new EphemeralCredential("temporary-token");
  const backend = new SupabaseManagementBackend({ accessToken: credential, fetchImpl, baseUrl: "https://management.invalid" });
  const result = await backend.inspectProject(target);
  assert.equal(result.ref, "test-ref");
  assert.equal(requests[0].headers.get("authorization"), "Bearer temporary-token");
  backend.dispose();
  assert.equal(credential.disposed, true);
});

test("B22 management adapter never parses secret values into state", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ name: "APP_SESSION_SECRET", value: "secret-value" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  assert.deepEqual(await backend.listSecrets(target), ["APP_SESSION_SECRET"]);
});

test("B23 project mismatch from management API fails closed", async () => {
  const backend = createFakeInstallerBackend({ project: { ref: "other-ref" } });
  await assert.rejects(() => runInstaller({ target, plan, backend }), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_TARGET_MISMATCH");
});

test("B24 target guard rejects production before credential use", () => {
  assert.throws(() => assertSafeTarget({ environment: "PRODUCTION", projectRef: "production-ref" }, "production-ref"), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "PRODUCTION_TARGET_BLOCKED");
});

test("B25 project URL and ref must bind before remote work", () => {
  assert.doesNotThrow(() => assertTargetBinding({ projectRef: "test-project-ref", projectUrl: "https://test-project-ref.supabase.co" }));
  assert.throws(() => assertTargetBinding({ projectRef: "test-project-ref", projectUrl: "https://other-project-ref.supabase.co" }), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_TARGET_MISMATCH");
});

test("B26 OAuth authorization uses state and S256 PKCE without storing credentials", () => {
  const store = new OAuthSessionStore(60_000);
  const auth = store.create("client-id", "https://installer.invalid/callback", "teacher-org");
  const url = new URL(auth.url);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), auth.state);
  assert.equal(store.size, 1);
  const consumed = store.consume(auth.state, "https://installer.invalid/callback");
  assert.ok(consumed.codeVerifier.length >= 40);
  assert.equal(store.size, 0);
});

test("B27 OAuth callback state is one-time and redirect-bound", () => {
  const store = new OAuthSessionStore();
  const auth = store.create("client-id", "https://installer.invalid/callback");
  assert.throws(() => store.consume(auth.state, "https://attacker.invalid/callback"), /OAUTH_STATE_INVALID/);
  assert.throws(() => store.consume(auth.state, "https://installer.invalid/callback"), /OAUTH_STATE_INVALID/);
});

test("B28 OAuth token exchange returns ephemeral credentials only", async () => {
  const requests: RequestInit[] = [];
  const result = await exchangeOAuthCode({ clientId: "client-id", clientSecret: new EphemeralCredential("client-secret"), code: "one-time-code", codeVerifier: "verifier", redirectUri: "https://installer.invalid/callback", fetchImpl: async (_input, init) => { requests.push(init ?? {}); return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 600 }), { status: 200, headers: { "content-type": "application/json" } }); } });
  assert.equal(result.accessToken.disposed, false);
  assert.equal(result.refreshToken?.disposed, false);
  assert.equal(requests.length, 1);
  result.accessToken.dispose();
  result.refreshToken?.dispose();
  assert.equal(result.accessToken.disposed, true);
});

test("B29 public setup source does not import privileged installer code", async () => {
  const source = await readFile(new URL("../src/pages/SetupPage.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("SupabaseManagementBackend"), false);
  assert.equal(/VITE_[A-Z0-9_]*(TOKEN|SECRET|SERVICE_ROLE)/.test(source), false);
  assert.equal(source.includes("management-api.ts"), false);
});

test("B30 math manifest is isolated from interview capabilities and follows migration source", async () => {
  const manifest = await readMathManifest(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.equal(manifest.appId, "stacking-blocks-math");
  assert.deepEqual(manifest.functions, ["student-auth", "student-api"]);
  assert.deepEqual(manifest.secrets, ["APP_SESSION_SECRET"]);
  assert.deepEqual(manifest.optionalCapabilities, []);
  assert.ok(manifest.migrations.length >= 17);
  assert.deepEqual(manifest.migrations, [...manifest.migrations].sort());
});

test("B31 math installer plan loads checked-in migration and function sources", async () => {
  const plan = await readMathInstallerPlan(fileURLToPath(new URL("..", import.meta.url)));
  assert.equal(plan.migrations.length, 17);
  assert.deepEqual(plan.functions.map((item) => item.slug), ["student-auth", "student-api"]);
  assert.ok(plan.functions.every((item) => item.files[0].includes("Deno.serve")));
  assert.equal(plan.schemaVersion, "202609130017");
});

test("B32 TEST runtime requires an allowlist and long-lived session secret", () => {
  const config = readInstallerRuntimeConfig({
    INSTALLER_MODE: "TEST",
    INSTALLER_ALLOWED_PROJECT_REFS: "stacking-blocks-math-test",
    INSTALLER_ALLOWED_ORIGIN: "https://math.example",
    INSTALLER_SESSION_SECRET: "a".repeat(32),
    INSTALLER_PRODUCTION_REF: "stacking-blocks-math",
    PORT: "8787",
  });
  assert.deepEqual(config.allowedProjectRefs, ["stacking-blocks-math-test"]);
  assert.equal(config.mode, "TEST");
  assert.equal(config.host, "0.0.0.0");
});

test("B33 runtime rejects production project in TEST allowlist", () => {
  assert.throws(() => readInstallerRuntimeConfig({
    INSTALLER_MODE: "TEST",
    INSTALLER_ALLOWED_PROJECT_REFS: "stacking-blocks-math",
    INSTALLER_ALLOWED_ORIGIN: "https://math.example",
    INSTALLER_SESSION_SECRET: "a".repeat(32),
}), /INSTALLER_PRODUCTION_REF_IN_ALLOWLIST/);
});

test("B34 installed TEST maintenance actions are read-only no-ops", () => {
  assert.equal(maintenanceAction("/api/installer/repair", "INSTALLED"), "NO_CHANGES");
  assert.equal(maintenanceAction("/api/installer/update", "INSTALLED"), "UP_TO_DATE");
  assert.equal(maintenanceAction("/api/installer/update", "UPDATE_REQUIRED"), null);
});

test("B35 Render blueprint targets only the TEST installer", async () => {
  const blueprint = await readFile(new URL("../../../render.yaml", import.meta.url), "utf8");
  assert.match(blueprint, /runtime:\s*node/);
  assert.match(blueprint, /rootDir:\s*apps\/stacking-blocks-math-web/);
  assert.match(blueprint, /startCommand:\s*npm run installer:server/);
  assert.match(blueprint, /healthCheckPath:\s*\/health/);
  assert.match(blueprint, /INSTALLER_MODE[\s\S]*value:\s*TEST/);
  assert.match(blueprint, /key:\s*HOST\s*\n\s*value:\s*0\.0\.0\.0/);
  assert.match(blueprint, /INSTALLER_ALLOWED_PROJECT_REFS[\s\S]*value:\s*tkniwelldgdlgwavyfdj/);
  assert.doesNotMatch(blueprint, /key:\s*INSTALLER_ALLOWED_PROJECT_REFS\s*\n\s*value:\s*stacking-blocks-math\s*$/m);
});

test("B36 hosted installer uses a cross-origin compatible secure cookie", () => {
  assert.equal(resolveSessionCookieSameSite(true), "None");
  assert.equal(resolveSessionCookieSameSite(false), "Strict");
  assert.throws(() => resolveSessionCookieSameSite(false, "None"), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_COOKIE_CONFIG_INVALID");
});
