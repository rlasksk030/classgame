import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Json = Record<string, unknown>;

const endpoint = required("INSTALLER_REMOTE_URL").replace(/\/$/, "");
const projectRef = required("INSTALLER_TEST_PROJECT_REF");
const projectUrl = required("INSTALLER_TEST_PROJECT_URL");
const publishableKey = process.env.INSTALLER_TEST_PUBLISHABLE_KEY?.trim();
const pat = required("INSTALLER_TEST_PAT");
if (process.env.TARGET_ENV !== "TEST") fail("TARGET_ENV_MUST_BE_TEST");
if (projectRef === (process.env.INSTALLER_PRODUCTION_REF?.trim() || "stacking-blocks-math")) fail("PRODUCTION_TARGET_BLOCKED");
const endpointUrl = new URL(endpoint);
if (endpointUrl.protocol !== "https:" && endpointUrl.hostname !== "localhost" && endpointUrl.hostname !== "127.0.0.1") fail("INSTALLER_ENDPOINT_MUST_BE_HTTPS");
const targetUrl = new URL(projectUrl);
if (targetUrl.protocol !== "https:" || targetUrl.hostname !== `${projectRef}.supabase.co`) fail("INSTALLER_TARGET_MISMATCH");

const target = { environment: "TEST", projectRef, projectUrl, ...(publishableKey ? { publishableKey } : {}), release: "spatial-math-v1" };
let cookie = "";
const startedAt = new Date().toISOString();
const checks: Json = {};

try {
  const health = await call("GET", "/health");
  checks.health = summarize(health.payload, health.status);
  const session = await call("POST", "/api/installer/session", target);
  cookie = session.cookie;
  checks.session = summarize(session.payload, session.status);
  const authorized = await call("POST", "/api/installer/credential", { pat });
  checks.credential = summarize(authorized.payload, authorized.status);
  const status = await call("GET", "/api/installer/status");
  checks.status = summarize(status.payload, status.status);
  const plan = await call("POST", "/api/installer/plan");
  checks.plan = summarize(plan.payload, plan.status);
  const repair = await call("POST", "/api/installer/repair");
  checks.repair = summarize(repair.payload, repair.status);
  const update = await call("POST", "/api/installer/update");
  checks.update = summarize(update.payload, update.status);
  const revoked = await call("DELETE", "/api/installer/session");
  checks.revoke = summarize(revoked.payload, revoked.status);
  const afterRevoke = await call("GET", "/api/installer/status");
  checks.afterRevoke = summarize(afterRevoke.payload, afterRevoke.status);
  // summarize() lets the response payload's own "status" field (e.g. our
  // INSTALLED/PARTIAL string) overwrite the initial HTTP status number when
  // present, so /status and /plan must be checked against that string, not
  // against the HTTP code 200.
  const pass = (checks.status as Json).status === "INSTALLED" && (checks.plan as Json).status === 200 && (checks.repair as Json).action === "NO_CHANGES" && (checks.update as Json).action === "UP_TO_DATE" && (checks.afterRevoke as Json).status === 401;
  await writeArtifact({ startedAt, projectRefHash: createHash("sha256").update(projectRef).digest("hex").slice(0, 12), checks, result: pass ? "PASS" : "FAIL" });
  console.log(`INSTALLER REMOTE: ${pass ? "PASS" : "FAIL"}`);
  process.exitCode = pass ? 0 : 1;
} catch (error) {
  await writeArtifact({ startedAt, projectRefHash: createHash("sha256").update(projectRef).digest("hex").slice(0, 12), checks, result: "FAIL", error: error instanceof Error ? error.message : "REMOTE_REQUEST_FAILED" });
  console.error(`INSTALLER REMOTE: FAIL (${error instanceof Error ? error.message : "REMOTE_REQUEST_FAILED"})`);
  process.exitCode = 1;
}

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; payload: Json; cookie: string }> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}${path}`, { method, headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Error("REMOTE_NETWORK_FAILED"); }
  const raw = await response.text();
  let payload: Json = {};
  try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object") payload = parsed as Json; } catch { payload = { code: "INVALID_JSON" }; }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const nextCookie = setCookie.split(";")[0] || cookie;
  return { status: response.status, payload, cookie: nextCookie };
}

function summarize(payload: Json, status: number): Json {
  const result: Json = { status };
  for (const key of ["status", "action", "code", "secretConfigured", "missingMigrations"]) if (key in payload) result[key] = payload[key];
  return result;
}

async function writeArtifact(value: Json): Promise<void> {
  const directory = join(process.cwd(), "qa", "installer", "runtime");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "INSTALLER_REMOTE_RESULT.json"), JSON.stringify(value, null, 2), "utf8");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name}_MISSING`);
  return value;
}

function fail(code: string): never { throw new Error(code); }
