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

test("installer HTTP install uses the same orchestration and supports status until explicit revoke or TTL", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const created = await fetch(`${running.base}/api/installer/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) });
    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("session cookie missing");
    await fetch(`${running.base}/api/installer/credential`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ pat: "pat-test-only" }) });
    const installed = await fetch(`${running.base}/api/installer/install`, { method: "POST", headers: { cookie } });
    assert.equal(installed.status, 200);
    const result = await installed.json();
    assert.equal(result.status, "COMPLETE");
    assert.notEqual(result.jobId, cookie.split("=")[1]);
    const status = await fetch(`${running.base}/api/installer/status`, { headers: { cookie } });
    assert.equal(status.status, 200);
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

test('HTTPS session reconnect, concurrent installs and repair preserve the secret', async () => {
 const backend=createFakeInstallerBackend();
 const server=createInstallerServer({plan,productionRef:plan.productionRef,createBackend:()=>backend,allowedOrigins:['https://math-test.example'],allowedProjectRefs:[target.projectRef],mode:'TEST',sessionCookieSecure:true,sessionSecret:'synthetic-session-signing-value-32-characters'});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 try {
 const headers:Record<string,string>={origin:'https://math-test.example','content-type':'application/json'};
 const created=await fetch(base+'/api/installer/session',{method:'POST',headers,body:JSON.stringify(target)});const cookie=created.headers.get('set-cookie')!;
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=None/);headers.cookie=cookie.split(';')[0];
 await fetch(base+'/api/installer/credential',{method:'POST',headers,body:JSON.stringify({pat:'synthetic-pat-only'})});
 const responses=await Promise.all([1,2].map(()=>fetch(base+'/api/installer/install',{method:'POST',headers})));
 assert(responses.every(r=>[200,409].includes(r.status)));assert.equal(backend.calls.filter(c=>c==='setSecrets').length,1);
 const status=await fetch(base+'/api/installer/status',{headers});assert.equal(status.status,200);assert.equal((await status.json()).status,'INSTALLED');
 for(const action of ['install','repair','update']){const r=await fetch(base+'/api/installer/'+action,{method:'POST',headers});assert.equal(r.status,200);assert.equal((await r.json()).status,'COMPLETE');}
 assert.equal(backend.calls.filter(c=>c==='setSecrets').length,1);
 await fetch(base+'/api/installer/session',{method:'DELETE',headers});assert.equal((await fetch(base+'/api/installer/status',{headers})).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("separate sessions serialize one project and reject stale target and attacker preflight", async () => {
  const backend = createFakeInstallerBackend();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  const apply = backend.applyMigration;
  backend.applyMigration = async (...args) => { entered(); await paused; return apply(...args); };
  const server = createInstallerServer({ plan, productionRef: plan.productionRef, createBackend: () => backend, mode: "TEST", allowedProjectRefs: [target.projectRef], allowedOrigins: ["https://math-test.example"] });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/installer`;
  try {
    const sessions = await Promise.all([1, 2].map(async () => {
      const headers: Record<string, string> = { "content-type": "application/json", origin: "https://math-test.example" };
      const created = await fetch(base + "/session", { method: "POST", headers, body: JSON.stringify(target) });
      headers.cookie = created.headers.get("set-cookie")!.split(";")[0];
      await fetch(base + "/credential", { method: "POST", headers, body: JSON.stringify({ pat: "synthetic-only" }) });
      return headers;
    }));
    const first = fetch(base + "/install", { method: "POST", headers: sessions[0] });
    await started;
    const second = await fetch(base + "/install", { method: "POST", headers: sessions[1] });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).code, "INSTALLER_BUSY");
    release(); assert.equal((await first).status, 200);
    assert.equal(backend.calls.filter(item => item === "setSecrets").length, 1);
    const wrongTarget = await fetch(base + "/install", { method: "POST", headers: sessions[0], body: JSON.stringify({ ...target, projectRef: "another-test-project" }) });
    assert.equal(wrongTarget.status, 403);
    const preflight = await fetch(base + "/install", { method: "OPTIONS", headers: { origin: "https://attacker.example" } });
    assert.equal(preflight.status, 403);
    const reconnected = await fetch(base + "/session", { method: "POST", headers: sessions[0], body: JSON.stringify(target) });
    assert.equal((await reconnected.json()).status, "AUTHORIZED");
    assert.equal(reconnected.headers.get("set-cookie")!.split(";")[0], sessions[0].cookie);
  } finally { release(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
