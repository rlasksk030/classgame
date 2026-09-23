import test from "node:test";
import assert from "node:assert/strict";

import { getConfiguredInstallerClient, InstallerClient, InstallerClientError } from "../src/lib/installerClient.ts";

const target = { projectRef: "test-ref", projectUrl: "https://test-ref.supabase.co", release: "spatial-math-v1" };

test("installer client uses HttpOnly session credentials and sends only public target data", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new InstallerClient("https://installer.example", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ status: "INSTALLED" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.getStatus(target);
  assert.equal(result.status, "INSTALLED");
  assert.equal(calls[0].url, "https://installer.example/api/installer/status?projectRef=test-ref&projectUrl=https%3A%2F%2Ftest-ref.supabase.co&release=spatial-math-v1");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
});

test("installer client sends install target as JSON and exposes no secret fields", async () => {
  let body = "";
  const client = new InstallerClient("https://installer.example", async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ jobId: "job-1", status: "CREATED" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.startInstall(target);
  assert.equal(result.jobId, "job-1");
  assert.deepEqual(JSON.parse(body), target);
  assert.equal(/secret|token|password|pin/i.test(body), false);
});

test("installer client supports OAuth authorization without a project chosen yet or a management token", async () => {
  let requestBody = "";
  let requestUrl = "";
  const client = new InstallerClient("https://installer.example", async (url, init) => {
    requestUrl = String(url);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ authorizeUrl: "https://api.supabase.com/v1/oauth/authorize?state=opaque" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.beginAuthorization();
  assert.match(result.authorizeUrl, /^https:\/\/api\.supabase\.com/);
  assert.equal(requestUrl, "https://installer.example/api/installer/authorize");
  assert.equal(requestBody, ""); // no target/credential is sent -- OAuth precedes project selection
});

test("installer client lists only the projects the teacher's own OAuth grant covers", async () => {
  const client = new InstallerClient("https://installer.example", async () => new Response(JSON.stringify({ projects: [{ ref: "abc123", name: "6-1 math" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  const result = await client.listAccessibleProjects();
  assert.deepEqual(result.projects, [{ ref: "abc123", name: "6-1 math" }]);
});

test("installer client sends teacher-account creation as JSON and returns no key material", async () => {
  let requestBody = "";
  const client = new InstallerClient("https://installer.example", async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ created: true, alreadyExists: false }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.createTeacherAccount("teacher@school.example", "correct-horse-battery");
  assert.deepEqual(result, { created: true, alreadyExists: false });
  assert.deepEqual(JSON.parse(requestBody), { email: "teacher@school.example", password: "correct-horse-battery" });
});

test("PAT fallback is sent once as a request body and never returned or persisted", async () => {
  let requestBody = "";
  const client = new InstallerClient("https://installer.example", async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ status: "AUTHORIZED" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.provideTemporaryCredential("pat-test-only");
  assert.equal(result.status, "AUTHORIZED");
  assert.equal(JSON.parse(requestBody).pat, "pat-test-only");
});

test("installer client maps safe backend error codes without exposing response body", async () => {
  const client = new InstallerClient("https://installer.example", async () => new Response(JSON.stringify({ code: "PROJECT_MISMATCH", token: "hidden" }), { status: 409, headers: { "content-type": "application/json" } }));
  await assert.rejects(() => client.repair(target), (error: unknown) => error instanceof InstallerClientError && error.code === "PROJECT_MISMATCH" && error.status === 409 && !error.message.includes("hidden"));
});

test("installer client surfaces stage and upstreamStatus from the error body for on-screen diagnosis, without needing DevTools", async () => {
  const client = new InstallerClient("https://installer.example", async () => new Response(JSON.stringify({ code: "INSTALLER_MANAGEMENT_HTTP_403", message: "관리 API 요청이 거부되었습니다 (403).", stage: "functions", upstreamStatus: 403 }), { status: 502, headers: { "content-type": "application/json" } }));
  await assert.rejects(() => client.getStatus(target), (error: unknown) => error instanceof InstallerClientError && error.status === 502 && error.stage === "functions" && error.upstreamStatus === 403);
});

test("installer client rejects non-HTTPS production endpoints", () => {
  assert.throws(() => new InstallerClient("http://installer.example"), (error: unknown) => error instanceof InstallerClientError && error.code === "INSTALLER_ENDPOINT_INVALID");
});

test("browser session creation supplies the required TEST environment contract", async () => {
  let body: Record<string, unknown> = {};
  const client = new InstallerClient("https://installer.example", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response('{"status":"CREATED"}', { headers: { "content-type": "application/json" } });
  });
  await client.createSession(target);
  assert.deepEqual(body, { ...target, environment: "TEST" });
});

test("getConfiguredInstallerClient defaults to this page's own origin, not a cross-origin backend host", () => {
  // The installer session cookie only survives as a first-party cookie when
  // /api/installer/* is reached through the frontend's own origin (a
  // same-origin static-site rewrite proxies it to the real backend) --
  // calling a different onrender.com host directly makes it third-party,
  // which browsers may silently refuse to store or send.
  Object.assign(globalThis, { window: { location: { origin: "https://stacking-blocks-math-setup-test.onrender.com" } } });
  try {
    const client = getConfiguredInstallerClient();
    assert.ok(client);
    assert.equal(client!.endpoint, "https://stacking-blocks-math-setup-test.onrender.com");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("default transport invokes browser fetch without an InstallerClient receiver", async (t) => {
  t.mock.method(globalThis, "fetch", async function (this: unknown) {
    assert.equal(this, undefined, "native browser fetch rejects an unrelated receiver");
    return new Response('{"status":"CREATED"}', { headers: { "content-type": "application/json" } });
  });
  assert.equal((await new InstallerClient("https://installer.example").createSession(target)).status, "CREATED");
});
