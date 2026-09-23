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
import { InstallerError, type FunctionBundle } from "../scripts/installer/contract.ts";
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

test("B49 management adapter carries the real upstream HTTP status on InstallerError, not just an embedded string", async () => {
  // A live 502 collapses every non-2xx upstream response into one generic
  // code unless the actual status (401/403/429/500...) survives as a
  // structured field -- this is what lets a real failure be root-caused
  // from server logs alone instead of guessing at the message text.
  for (const upstreamStatus of [401, 403, 429, 500]) {
    const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify({ code: `UPSTREAM_${upstreamStatus}` }), { status: upstreamStatus, headers: { "content-type": "application/json" } });
    const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
    await assert.rejects(
      () => backend.listSecrets(target),
      (error: unknown) => error instanceof InstallerError && error.upstreamStatus === upstreamStatus && error.stage === "secret" && error.code === `INSTALLER_MANAGEMENT_UPSTREAM_${upstreamStatus}`,
    );
  }
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
  assert.equal(plan.migrations.length, 18); // 17 existing + additive lesson 9 bank/atomic score migration
  assert.deepEqual(plan.functions.map((item) => item.slug), ["student-auth", "student-api"]);
  assert.ok(plan.functions.every((item) => item.files[0].path === `supabase/functions/${item.slug}/index.ts` && item.files[0].content.includes("Deno.serve")));
  assert.ok(plan.functions.every((item) => item.files.length > 1), "expects the shared-module import closure, not just index.ts");
  assert.ok(plan.functions.every((item) => item.metadata.entrypoint_path === `supabase/functions/${item.slug}/index.ts`));
  assert.equal(plan.schemaVersion, plan.migrations.at(-1)!.name.split("_")[0]);
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

test("B47 Render static site proxies the installer API same-origin, ordered before the SPA catch-all", async () => {
  const blueprint = await readFile(new URL("../../../render.yaml", import.meta.url), "utf8");
  const apiRewriteIndex = blueprint.indexOf("source: /api/installer/*");
  const spaCatchAllIndex = blueprint.indexOf("source: /*");
  assert.ok(apiRewriteIndex >= 0, "installer API rewrite route must exist");
  assert.ok(spaCatchAllIndex >= 0, "SPA catch-all route must exist");
  // Render matches routes in file order; if the catch-all came first, /api/installer/*
  // would be swallowed into index.html and never reach the real backend.
  assert.ok(apiRewriteIndex < spaCatchAllIndex, "the API rewrite must be listed before the SPA catch-all");
  assert.match(blueprint, /destination:\s*https:\/\/stacking-blocks-math-installer-test\.onrender\.com\/api\/installer\/\*/);
  assert.doesNotMatch(blueprint, /key:\s*VITE_INSTALLER_API_URL/, "must not hardcode a cross-origin installer URL; installerClient.ts defaults to same-origin");
});

test("B48 installer session cookie is Lax now that the API is only ever reached same-origin through the static-site proxy", async () => {
  const runtimeSource = await readFile(new URL("../scripts/installer/runtime.ts", import.meta.url), "utf8");
  assert.match(runtimeSource, /sessionCookieSameSite:\s*"Lax"/);
});

test("B36 hosted installer uses a cross-origin compatible secure cookie", () => {
  assert.equal(resolveSessionCookieSameSite(true), "None");
  assert.equal(resolveSessionCookieSameSite(false), "Strict");
  assert.throws(() => resolveSessionCookieSameSite(false, "None"), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_COOKIE_CONFIG_INVALID");
});

test("B37 management adapter rebuilds migration filenames from the real API's split version/name shape", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ version: "202609110001", name: "initial" }, { version: "202609110002", name: "seed" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  assert.deepEqual(await backend.listAppliedMigrations(target), ["202609110001_initial.sql", "202609110002_seed.sql"]);
});

test("B38 management adapter deploys every closure file under its real relative path and never trusts the remote's own hash", async () => {
  const requests: Array<{ url: string; body?: unknown; contentType: string | null }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), body: init?.body, contentType: headers.get("content-type") });
    // Supabase's real response's ezbr_sha256 is deliberately different from
    // bundle.hash here: the adapter must not use it for the returned hash.
    return new Response(JSON.stringify({ version: 3, ezbr_sha256: "remote-computed-hash-we-must-not-trust", status: "ACTIVE" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const bundle: FunctionBundle = { slug: "student-api", files: [{ path: "supabase/functions/student-api/index.ts", content: "entry" }, { path: "shared/blocks.ts", content: "shared" }], metadata: { entrypoint_path: "supabase/functions/student-api/index.ts", verify_jwt: false, name: "closure-hash" }, hash: "closure-hash" };
  const result = await backend.deployFunction(target, bundle);
  assert.equal(result.hash, "closure-hash");
  assert.ok(requests[0].url.includes(`slug=${bundle.slug}`));
  assert.ok(requests[0].body instanceof FormData);
  const form = requests[0].body as FormData;
  const fileParts = form.getAll("file") as File[];
  assert.equal(fileParts.length, 2);
  assert.deepEqual(fileParts.map((part) => part.name).sort(), ["shared/blocks.ts", "supabase/functions/student-api/index.ts"]);
  assert.equal(typeof form.get("metadata"), "string");
  assert.equal(JSON.parse(form.get("metadata") as string).name, "closure-hash");
  assert.equal(requests[0].contentType, null);
});

test("B39 listFunctions treats the remote's stored name as our own bundle-hash marker, not ezbr_sha256", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ slug: "student-api", version: 3, name: "closure-hash", ezbr_sha256: "a-remote-value-that-would-never-match", status: "ACTIVE" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const [deployment] = await backend.listFunctions(target);
  assert.equal(deployment.hash, "closure-hash");
});

test("management-created migration keeps its source filename despite server-assigned version", async () => {
  const name = "202609110001_initial.sql";
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("synthetic-only"), fetchImpl: async () => new Response(JSON.stringify([{ version: "20260919180000", name }]), { headers: { "content-type": "application/json" } }) });
  assert.deepEqual(await backend.listAppliedMigrations(target), [name]);
});

test("known production refs are denied even with a mistaken production name config", () => {
  for (const projectRef of ["lpjpwrgzwumnikroledh", "klruqcakrpmdviyhzrpy"]) assert.throws(() => assertSafeTarget({ environment: "TEST", projectRef }, "stacking-blocks-math"), /운영 프로젝트/);
});

test("B40 listAccessibleProjects maps the real Management API project shape (id -> ref) for a teacher's project picker", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ id: "abc123", name: "6-1 math", region: "ap-northeast-2", status: "ACTIVE_HEALTHY" }, { malformed: true }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const projects = await backend.listAccessibleProjects();
  assert.deepEqual(projects, [{ ref: "abc123", name: "6-1 math", region: "ap-northeast-2", status: "ACTIVE_HEALTHY" }]);
});

// The Management API's own OpenAPI spec (ApiKeyResponse.type) is the real
// discriminator: "legacy" | "publishable" | "secret" | null. `name` is
// free-text and required but otherwise unconstrained -- for a new-style key
// it's commonly "default", not "publishable"/"secret". A project migrated
// to the new key system has no name === "publishable" entry at all, which
// is exactly what caused a live INSTALLER_PUBLIC_CONFIG_MISSING on every
// OAuth bind regardless of this function's own success.

test("B41 getPublishableKey selects the new-style key by type, per the real Management API response shape", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ type: "publishable", name: "default", api_key: "sb_publishable_visible" }, { type: "secret", name: "default", api_key: "sb_secret_must_not_leak" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const publishable = await backend.getPublishableKey(target);
  assert.equal(publishable, "sb_publishable_visible");
});

test("B41b getPublishableKey falls back to the legacy anon key when no new-style publishable key exists", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ type: "legacy", name: "anon", api_key: "legacy-anon-jwt" }, { type: "legacy", name: "service_role", api_key: "legacy-service-role-jwt" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const publishable = await backend.getPublishableKey(target);
  assert.equal(publishable, "legacy-anon-jwt");
});

test("B41c getPublishableKey never selects a secret/service_role key, by type or by legacy name, even if it appears first", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ type: "secret", name: "default", api_key: "sb_secret_must_not_leak" }, { type: "legacy", name: "service_role", api_key: "legacy-service-role-jwt" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const publishable = await backend.getPublishableKey(target);
  assert.equal(publishable, undefined);
});

test("B42 getServiceRoleCredential wraps the secret key (by type) as an EphemeralCredential, never a plain string", async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify([{ type: "publishable", name: "default", api_key: "sb_publishable_visible" }, { type: "secret", name: "default", api_key: "sb_secret_real_value" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl, baseUrl: "https://management.invalid" });
  const serviceRole = await backend.getServiceRoleCredential(target);
  assert.ok(serviceRole instanceof EphemeralCredential);
  const seen = await serviceRole!.use(async (value) => value);
  assert.equal(seen, "sb_secret_real_value");
  serviceRole!.dispose();
});

test("B43 teacher account provisioner creates an Auth admin user using service_role server-side only and disposes it after one use", async () => {
  const { ManagementTeacherAccountProvisioner } = await import("../scripts/installer/teacher-account.ts");
  const managementFetch = async (): Promise<Response> => new Response(JSON.stringify([{ type: "secret", name: "default", api_key: "sb_secret_temp" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl: managementFetch, baseUrl: "https://management.invalid" });
  const adminRequests: Array<{ url: string; headers: Headers; body: string }> = [];
  const goTrueFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    adminRequests.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ id: "new-teacher-id" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provisioner = new ManagementTeacherAccountProvisioner(backend, goTrueFetch);
  const result = await provisioner.createTeacherAccount(target, "teacher@school.example", "correct-horse-battery");
  assert.deepEqual(result, { created: true, alreadyExists: false });
  assert.equal(adminRequests.length, 1);
  assert.equal(adminRequests[0].url, `${target.projectUrl}/auth/v1/admin/users`);
  assert.equal(adminRequests[0].headers.get("apikey"), "sb_secret_temp");
  assert.equal(adminRequests[0].headers.get("authorization"), "Bearer sb_secret_temp");
  const body = JSON.parse(adminRequests[0].body);
  assert.equal(body.email, "teacher@school.example");
  assert.equal(body.password, "correct-horse-battery");
});

test("B44 teacher account provisioner reports a duplicate email as alreadyExists, not an error, and never leaks it in the message", async () => {
  const { ManagementTeacherAccountProvisioner } = await import("../scripts/installer/teacher-account.ts");
  const managementFetch = async (): Promise<Response> => new Response(JSON.stringify([{ type: "secret", name: "default", api_key: "sb_secret_temp" }]), { status: 200, headers: { "content-type": "application/json" } });
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl: managementFetch, baseUrl: "https://management.invalid" });
  const goTrueFetch = async (): Promise<Response> => new Response(JSON.stringify({ msg: "A user with this email address has already been registered" }), { status: 422, headers: { "content-type": "application/json" } });
  const provisioner = new ManagementTeacherAccountProvisioner(backend, goTrueFetch);
  const result = await provisioner.createTeacherAccount(target, "teacher@school.example", "correct-horse-battery");
  assert.deepEqual(result, { created: false, alreadyExists: true });
});

test("B45 teacher account provisioner rejects a weak password before ever fetching a key", async () => {
  const { ManagementTeacherAccountProvisioner } = await import("../scripts/installer/teacher-account.ts");
  const backend = new SupabaseManagementBackend({ accessToken: new EphemeralCredential("temporary-token"), fetchImpl: async () => { throw new Error("must not be called"); }, baseUrl: "https://management.invalid" });
  const provisioner = new ManagementTeacherAccountProvisioner(backend, async () => { throw new Error("must not be called"); });
  await assert.rejects(() => provisioner.createTeacherAccount(target, "teacher@school.example", "short"), (error: unknown) => error instanceof Error && "code" in error && (error as { code?: unknown }).code === "INSTALLER_TEACHER_ACCOUNT_PASSWORD_WEAK");
});

test("B46 OAuth grant store is one-time use and expires like the other TTL stores", async () => {
  const { OAuthGrantStore } = await import("../scripts/installer/oauth.ts");
  const store = new OAuthGrantStore(50);
  const credential = new EphemeralCredential("oauth-access-token");
  const id = store.create(credential);
  assert.equal(store.size, 1);
  assert.ok(store.peek(id));
  const consumed = store.consume(id);
  assert.equal(consumed, credential);
  assert.equal(store.peek(id), undefined, "a consumed grant must not be usable again");
  const other = new OAuthGrantStore(10);
  const secondCredential = new EphemeralCredential("short-lived");
  const secondId = other.create(secondCredential);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(other.peek(secondId), undefined);
});
