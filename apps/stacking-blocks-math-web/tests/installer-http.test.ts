import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

import { createInstallerServer, InstallerSessionStore } from "../scripts/installer/http-server.ts";
import { createFakeInstallerBackend, createFakeManagementExtras, fakeBundle } from "../scripts/installer/fake-backend.ts";
import { EphemeralCredential } from "../scripts/installer/security.ts";
import type { InstallerPlan } from "../scripts/installer/orchestrator.ts";

const target = { environment: "TEST" as const, projectRef: "test-project-ref", projectUrl: "https://test-project-ref.supabase.co", publishableKey: "public-test-key", release: "spatial-math-v1" };
const plan: InstallerPlan = { migrations: [{ name: "202609110001_initial.sql", query: "select 1" }], functions: [fakeBundle("student-auth"), fakeBundle("student-api")], appVersion: "1.0.0", schemaVersion: "202609110001", productionRef: "production-ref" };

function findCookie(headers: Headers, name: string): string | undefined {
  return headers.getSetCookie().find((part) => part.startsWith(`${name}=`))?.split(";")[0];
}

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

test("OAuth authorize is a clean 501 (not a crash) when no OAuth App is configured", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const response = await fetch(`${running.base}/api/installer/authorize`, { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 501);
    assert.equal((await response.json()).code, "INSTALLER_OAUTH_NOT_CONFIGURED");
  } finally { await new Promise<void>(resolve => running.server.close(() => resolve())); }
});

async function runningOAuthServer(seedProjects: Array<{ ref: string; name?: string }>, publishableKeys: Record<string, string> = {}) {
  const backend = createFakeInstallerBackend();
  const extras = createFakeManagementExtras({ accessibleProjects: seedProjects, publishableKeys });
  let tokenRequests = 0;
  const server = createInstallerServer({
    plan,
    productionRef: plan.productionRef,
    createBackend: () => backend,
    createManagementExtras: () => extras,
    allowedOrigins: ["http://localhost:5173"],
    oauth: {
      clientId: "test-client-id",
      clientSecret: new EphemeralCredential("test-client-secret"),
      redirectUri: "http://127.0.0.1:0/api/installer/oauth/callback",
      fetchImpl: async () => { tokenRequests += 1; return new Response(JSON.stringify({ access_token: "oauth-access-token", refresh_token: "oauth-refresh-token", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }); },
    },
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address missing");
  return { server, backend, extras, base: `http://127.0.0.1:${address.port}`, tokenRequests: () => tokenRequests };
}

test("OAuth authorize -> callback -> project list -> session binds the OAuth credential and every maintenance route works without ever posting a PAT", async (t) => {
  const oauthTarget = { ...target, projectRef: "oauth-project", projectUrl: "https://oauth-project.supabase.co" };
  let running2: Awaited<ReturnType<typeof runningOAuthServer>>;
  try { running2 = await runningOAuthServer([{ ref: oauthTarget.projectRef, name: "Teacher's project" }, { ref: "production-ref", name: "prod" }], { [oauthTarget.projectRef]: "sb_publishable_auto_fetched" }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EPERM") { t.skip("이 환경은 localhost listen을 차단함"); return; }
    throw error;
  }
  try {
    const authorize = await fetch(`${running2.base}/api/installer/authorize`, { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: "{}" });
    assert.equal(authorize.status, 200);
    const { authorizeUrl } = await authorize.json();
    const state = new URL(authorizeUrl).searchParams.get("state");
    assert.ok(state);

    const callback = await fetch(`${running2.base}/api/installer/oauth/callback?code=fake-code&state=${state}`, { redirect: "manual" });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "http://localhost:5173/setup?oauth=granted");
    assert.equal(running2.tokenRequests(), 1);
    const grantCookie = findCookie(callback.headers, "installer_oauth_grant");
    assert.ok(grantCookie);

    // Replaying the same state must fail: OAuth state is one-time.
    const replay = await fetch(`${running2.base}/api/installer/oauth/callback?code=fake-code&state=${state}`, { redirect: "manual" });
    assert.equal(replay.status, 502);

    const projects = await fetch(`${running2.base}/api/installer/projects`, { headers: { cookie: grantCookie!, origin: "http://localhost:5173" } });
    assert.equal(projects.status, 200);
    const { projects: list } = await projects.json();
    // The production ref is filtered out server-side even though it was in the raw OAuth-scoped list.
    assert.deepEqual(list.map((p: { ref: string }) => p.ref), [oauthTarget.projectRef]);

    // Picking a project the grant never listed must be rejected, not silently accepted.
    const unauthorized = await fetch(`${running2.base}/api/installer/session`, { method: "POST", headers: { cookie: grantCookie!, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ ...target, projectRef: "someone-elses-project", projectUrl: "https://someone-elses-project.supabase.co" }) });
    assert.notEqual(unauthorized.status, 201);

    const created = await fetch(`${running2.base}/api/installer/session`, { method: "POST", headers: { cookie: grantCookie!, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify(oauthTarget) });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.status, "AUTHORIZED"); // Already authorized from the OAuth grant -- no /credential call needed.
    assert.equal(createdBody.publishableKey, "sb_publishable_auto_fetched"); // Teacher never has to copy this by hand.
    const sessionCookie = findCookie(created.headers, "installer_session");
    assert.ok(sessionCookie);
    // The one-time OAuth grant cookie is cleared once it has been bound to a session.
    const clearedGrantCookie = created.headers.getSetCookie().find((part) => part.startsWith("installer_oauth_grant="));
    assert.match(clearedGrantCookie ?? "", /Max-Age=0/);

    const status = await fetch(`${running2.base}/api/installer/status`, { headers: { cookie: sessionCookie!, origin: "http://localhost:5173" } });
    assert.equal(status.status, 200);

    // The zero-support promise: once OAuth bound this session's credential,
    // every maintenance route works from that same cookie -- no /credential
    // (PAT) call ever happens for plan, install, repair or update either.
    const planHeaders = { cookie: sessionCookie!, origin: "http://localhost:5173" };
    assert.equal((await fetch(`${running2.base}/api/installer/plan`, { method: "POST", headers: planHeaders })).status, 200);
    assert.equal((await fetch(`${running2.base}/api/installer/install`, { method: "POST", headers: planHeaders })).status, 200);
    assert.equal((await fetch(`${running2.base}/api/installer/repair`, { method: "POST", headers: planHeaders })).status, 200);
    assert.equal((await fetch(`${running2.base}/api/installer/update`, { method: "POST", headers: planHeaders })).status, 200);

    // Revoking the OAuth-bound session shuts every route back down, same as a PAT one.
    await fetch(`${running2.base}/api/installer/session`, { method: "DELETE", headers: planHeaders });
    assert.equal((await fetch(`${running2.base}/api/installer/status`, { headers: planHeaders })).status, 401);
    assert.equal((await fetch(`${running2.base}/api/installer/install`, { method: "POST", headers: planHeaders })).status, 401);
  } finally { await new Promise<void>(resolve => running2.server.close(() => resolve())); }
});

test("teacher account creation uses the session credential, never a client-supplied key, and handles a duplicate email", async () => {
  const backend = createFakeInstallerBackend();
  const extras = createFakeManagementExtras({ accessibleProjects: [{ ref: target.projectRef }], existingTeacherEmails: ["taken@school.example"] });
  const server = createInstallerServer({ plan, productionRef: plan.productionRef, createBackend: () => backend, createManagementExtras: () => extras, allowedOrigins: ["http://localhost:5173"] });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/installer`;
  try {
    const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:5173" };
    const created = await fetch(base + "/session", { method: "POST", headers, body: JSON.stringify(target) });
    headers.cookie = created.headers.get("set-cookie")!.split(";")[0];
    await fetch(base + "/credential", { method: "POST", headers, body: JSON.stringify({ pat: "synthetic-only" }) });

    const first = await fetch(base + "/teacher-account", { method: "POST", headers, body: JSON.stringify({ email: "teacher@school.example", password: "correct-horse-battery" }) });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.alreadyExists, false);
    assert.deepEqual(Object.keys(firstBody).sort(), ["alreadyExists", "created"]); // never echoes email/password/keys

    const duplicate = await fetch(base + "/teacher-account", { method: "POST", headers, body: JSON.stringify({ email: "taken@school.example", password: "correct-horse-battery" }) });
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.created, false);
    assert.equal(duplicateBody.alreadyExists, true);

    assert.deepEqual(extras.calls, ["createTeacherAccount:teacher@school.example", "createTeacherAccount:taken@school.example"]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("teacher-account route is a clean 501 when management extras are not configured", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const created = await fetch(`${running.base}/api/installer/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) });
    const cookie = created.headers.get("set-cookie")!.split(";")[0];
    await fetch(`${running.base}/api/installer/credential`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ pat: "pat-test-only" }) });
    const response = await fetch(`${running.base}/api/installer/teacher-account`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ email: "teacher@school.example", password: "correct-horse-battery" }) });
    assert.equal(response.status, 501);
  } finally { await new Promise<void>(resolve => running.server.close(() => resolve())); }
});

test("/api/installer/projects requires an OAuth grant, not a plain session", async (t) => {
  const running = await startOrSkip(t); if (!running) return;
  try {
    const response = await fetch(`${running.base}/api/installer/projects`, { headers: { origin: "http://localhost:5173" } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "INSTALLER_OAUTH_GRANT_REQUIRED");
  } finally { await new Promise<void>(resolve => running.server.close(() => resolve())); }
});
