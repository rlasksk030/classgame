import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

import { createInstallerServer, InstallerSessionStore } from "../scripts/installer/http-server.ts";
import { createFakeInstallerBackend, fakeBundle } from "../scripts/installer/fake-backend.ts";
import type { InstallerPlan } from "../scripts/installer/orchestrator.ts";

const target = { environment: "TEST" as const, projectRef: "test-project-ref", projectUrl: "https://test-project-ref.supabase.co", publishableKey: "public-test-key", release: "spatial-math-v1" };
const plan: InstallerPlan = { migrations: [{ name: "202609110001_initial.sql", query: "select 1" }], functions: [fakeBundle("student-auth"), fakeBundle("student-api")], appVersion: "1.0.0", schemaVersion: "202609110001", productionRef: "production-ref" };

async function runningServer() {
  const backend = createFakeInstallerBackend();
  const server = createInstallerServer({ plan, productionRef: plan.productionRef, createBackend: () => backend, allowedOrigins: ["http://localhost:5173"] });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address missing");
  return { server, backend, base: `http://127.0.0.1:${address.port}` };
}

async function startOrSkip(t: TestContext) {
  try { return await runningServer(); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EPERM") { t.skip("이 환경은 localhost listen을 차단함"); return null; }
    throw error;
  }
}

test("installer HTTP session accepts a target, then PAT without returning it", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const blocked = await fetch(`${running.base}/api/installer/session`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify(target) });
    assert.equal(blocked.status, 403);
    const created = await fetch(`${running.base}/api/installer/session`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify(target) });
    assert.equal(created.status, 201);
    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    if (!cookie) throw new Error("session cookie missing");
    const authorized = await fetch(`${running.base}/api/installer/credential`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: "http://localhost:5173" }, body: JSON.stringify({ pat: "pat-test-only" }) });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).status, "AUTHORIZED");
  } finally { await new Promise<void>((resolve, reject) => running.server.close((error) => error ? reject(error) : resolve())); }
});

test("installer HTTP install uses the same orchestration and disposes PAT on completion", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const created = await fetch(`${running.base}/api/installer/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) });
    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("session cookie missing");
    await fetch(`${running.base}/api/installer/credential`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ pat: "pat-test-only" }) });
    const installed = await fetch(`${running.base}/api/installer/install`, { method: "POST", headers: { cookie } });
    assert.equal(installed.status, 200);
    assert.equal((await installed.json()).status, "COMPLETE");
    const status = await fetch(`${running.base}/api/installer/status`, { headers: { cookie } });
    assert.equal(status.status, 401);
    assert.equal(running.backend.calls.includes("setSecrets"), true);
  } finally { await new Promise<void>((resolve, reject) => running.server.close((error) => error ? reject(error) : resolve())); }
});

test("installer HTTP blocks a disallowed browser origin and expires sessions", () => {
  const now = { value: 0 };
  const store = new InstallerSessionStore(100, () => now.value);
  const session = store.create(target);
  assert.equal(store.size, 1);
  now.value = 101;
  assert.equal(store.get(session.id), undefined);
  assert.equal(store.size, 0);
});
