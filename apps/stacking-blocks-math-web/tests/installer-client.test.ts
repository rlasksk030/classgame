import test from "node:test";
import assert from "node:assert/strict";

import { InstallerClient, InstallerClientError } from "../src/lib/installerClient.ts";

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

test("installer client supports OAuth authorization without receiving a management token", async () => {
  let requestBody = "";
  const client = new InstallerClient("https://installer.example", async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ authorizeUrl: "https://api.supabase.com/v1/oauth/authorize?state=opaque" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await client.beginAuthorization(target);
  assert.match(result.authorizeUrl, /^https:\/\/api\.supabase\.com/);
  assert.deepEqual(JSON.parse(requestBody), target);
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

test("default transport invokes browser fetch without an InstallerClient receiver", async (t) => {
  t.mock.method(globalThis, "fetch", async function (this: unknown) {
    assert.equal(this, undefined, "native browser fetch rejects an unrelated receiver");
    return new Response('{"status":"CREATED"}', { headers: { "content-type": "application/json" } });
  });
  assert.equal((await new InstallerClient("https://installer.example").createSession(target)).status, "CREATED");
});
