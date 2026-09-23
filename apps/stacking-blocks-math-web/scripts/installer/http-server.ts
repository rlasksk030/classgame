import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { runInstaller, type InstallerPlan } from "./orchestrator.ts";
import { InstallerError, type FunctionDeployment, type InstallState, type InstallerBackend, type InstallerTarget, type RemoteProject } from "./contract.ts";
import { assertSafeTarget, assertTargetBinding, EphemeralCredential } from "./security.ts";
import { OAuthGrantStore, OAuthSessionStore, exchangeOAuthCode } from "./oauth.ts";
import type { TeacherAccountResult } from "./teacher-account.ts";

/** Identifies this process instance in logs only -- never sent to a client
 * and not a credential. Exists to prove or rule out "the session was created
 * on one instance/container and looked up on a different one" (e.g. a
 * rolling deploy or restart mid-flow) when a live OAuth-bound session goes
 * missing right after binding, which no local test can reproduce. */
const PROCESS_INSTANCE_ID = randomBytes(4).toString("hex");
const PROCESS_STARTED_AT = new Date().toISOString();

/** Non-secret diagnostic line for Render's log stream: never includes a
 * credential, access token, PAT, or full cookie value -- only this
 * process's instance id and a short prefix of an opaque session id. */
function logInstallerDiagnostic(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.error(JSON.stringify({ tag: "installer-diagnostic", event, instance: PROCESS_INSTANCE_ID, ...fields }));
}

interface InstallerSession {
  id: string;
  jobId: string;
  target: InstallerTarget;
  credential?: EphemeralCredential;
  state?: InstallState;
  expiresAt: number;
}

/** Operations that need an OAuth/PAT credential but no InstallerTarget yet
 * (listing a teacher's own projects), or that go beyond the migrate/deploy
 * InstallerBackend contract (creating the teacher's Auth account). Kept
 * separate from InstallerBackend so the fake backend used by existing tests
 * never has to implement them. */
export interface InstallerManagementExtras {
  listAccessibleProjects(): Promise<RemoteProject[]>;
  createTeacherAccount(target: InstallerTarget, email: string, password: string): Promise<TeacherAccountResult>;
  /** Public anon/publishable key only, so a teacher who connected via OAuth
   * never has to visit Project Settings -> API by hand. Never the secret key. */
  getPublishableKey(target: InstallerTarget): Promise<string | undefined>;
}

export interface InstallerOAuthConfig {
  clientId: string;
  clientSecret: EphemeralCredential;
  /** Must exactly match the redirect URI registered with the Supabase OAuth App. */
  redirectUri: string;
  /** Injectable for tests; defaults to the real Supabase OAuth token endpoint. */
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

export interface InstallerHttpOptions {
  plan: InstallerPlan;
  productionRef: string;
  createBackend: (credential: EphemeralCredential) => InstallerBackend;
  /** Enables the OAuth authorize/callback/project-list routes. Omit to keep
   * the PAT-only TEST/dev path (today's default; no config, no behavior change). */
  oauth?: InstallerOAuthConfig;
  createManagementExtras?: (credential: EphemeralCredential) => InstallerManagementExtras;
  allowedOrigins?: string[];
  /** In TEST mode only these project refs may ever be bound. Dynamic OAuth binding
   * (options.oauth) supersedes this for real teacher installs; this allowlist remains
   * for the PAT dev/regression path only. */
  allowedProjectRefs?: string[];
  mode?: "TEST" | "STAGING" | "PRODUCTION";
  sessionCookieSecure?: boolean;
  /** Cross-origin hosted installers need SameSite=None; local HTTP stays Strict. */
  sessionCookieSameSite?: "Strict" | "Lax" | "None";
  /** Signs the opaque session id when provided by a production runtime. */
  sessionSecret?: string;
  ttlMs?: number;
  now?: () => number;
}

export class InstallerSessionStore {
  readonly #sessions = new Map<string, InstallerSession>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlMs = 15 * 60 * 1000, now: () => number = Date.now) {
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  create(target: InstallerTarget): InstallerSession {
    this.clearExpired();
    const session: InstallerSession = { id: randomBytes(24).toString("base64url"), jobId: randomBytes(16).toString("hex"), target, expiresAt: this.#now() + this.#ttlMs };
    this.#sessions.set(session.id, session);
    return session;
  }

  /** Sliding TTL: any authenticated activity (status/plan/install/...) keeps
   * the session alive, not just the moment a credential was first set. Without
   * this, a zero-support teacher who takes longer than one ttlMs window to
   * click through steps -- perfectly normal -- gets silently logged out with
   * no way back except a fresh OAuth authorization. */
  get(id: string): InstallerSession | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= this.#now()) { this.delete(id); return undefined; }
    session.expiresAt = this.#now() + this.#ttlMs;
    return session;
  }

  setCredential(id: string, value: string): InstallerSession {
    const session = this.get(id);
    if (!session) throw new InstallerError("INSTALLER_SESSION_EXPIRED", "target", "설치 세션이 만료되었습니다.");
    session.credential?.dispose();
    session.credential = new EphemeralCredential(value);
    session.expiresAt = this.#now() + this.#ttlMs;
    return session;
  }

  /** Takes ownership of an already-created credential (e.g. an OAuth grant's
   * access token) instead of round-tripping it through a new plain string. */
  setCredentialFromEphemeral(id: string, credential: EphemeralCredential): InstallerSession {
    const session = this.get(id);
    if (!session) throw new InstallerError("INSTALLER_SESSION_EXPIRED", "target", "설치 세션이 만료되었습니다.");
    session.credential?.dispose();
    session.credential = credential;
    session.expiresAt = this.#now() + this.#ttlMs;
    return session;
  }

  delete(id: string): void {
    const session = this.#sessions.get(id);
    session?.credential?.dispose();
    this.#sessions.delete(id);
  }

  clearExpired(): void {
    for (const [id, session] of this.#sessions) if (session.expiresAt <= this.#now()) this.delete(id);
  }

  get size(): number { this.clearExpired(); return this.#sessions.size; }
}

export function maintenanceAction(pathname: string, status: string): "NO_CHANGES" | "UP_TO_DATE" | null {
  if (status !== "INSTALLED") return null;
  if (pathname === "/api/installer/repair") return "NO_CHANGES";
  if (pathname === "/api/installer/update") return "UP_TO_DATE";
  return null;
}

export function resolveSessionCookieSameSite(sessionCookieSecure = false, requested?: "Strict" | "Lax" | "None"): "Strict" | "Lax" | "None" {
  const sameSite = requested ?? (sessionCookieSecure ? "None" : "Strict");
  if (sameSite === "None" && !sessionCookieSecure) throw new InstallerError("INSTALLER_COOKIE_CONFIG_INVALID", "target", "설치 세션 보안 설정이 올바르지 않습니다.");
  return sameSite;
}

export function createInstallerServer(options: InstallerHttpOptions, store = new InstallerSessionStore(options.ttlMs, options.now)): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const allowedProjectRefs = new Set(options.allowedProjectRefs ?? []);
  // One TEST Node instance owns all sessions; the lock spans separate tabs/sessions.
  const activeProjects = new Set<string>();
  const oauthStore = new OAuthSessionStore(options.ttlMs);
  const grantStore = new OAuthGrantStore(options.ttlMs);
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, store, allowedOrigins, allowedProjectRefs, activeProjects, oauthStore, grantStore);
  });
  const expiry = setInterval(() => { store.clearExpired(); oauthStore.clearExpired(); grantStore.clearExpired(); }, 30_000);
  expiry.unref();
  server.once("close", () => clearInterval(expiry));
  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: InstallerHttpOptions, store: InstallerSessionStore, allowedOrigins: Set<string>, allowedProjectRefs: Set<string>, activeProjects: Set<string>, oauthStore: OAuthSessionStore, grantStore: OAuthGrantStore): Promise<void> {
  applyCors(request, response, allowedOrigins);
  if (!originAllowed(request, allowedOrigins)) { sendError(response, 403, "INSTALLER_ORIGIN_BLOCKED", "설치 요청 출처를 확인할 수 없습니다."); return; }
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const url = new URL(request.url ?? "/", "http://installer.local");
  try {
    if (url.pathname === "/health" && request.method === "GET") { sendJson(response, 200, { ok: true, service: "stacking-blocks-installer", status: "ok", release: options.plan.appVersion, mode: options.mode ?? "TEST", instance: PROCESS_INSTANCE_ID, startedAt: PROCESS_STARTED_AT }); return; }
    if (url.pathname === "/api/installer/session" && request.method === "POST") {
      const body = await readJson(request);
      const target = parseTarget(body);
      assertSafeTarget(target, options.productionRef);
      assertTargetBinding(target);
      if (options.mode === "TEST" && target.environment !== "TEST") throw new InstallerError("INSTALLER_TEST_TARGET_REQUIRED", "target", "TEST 프로젝트만 연결할 수 있습니다.");
      const grantId = getOAuthGrantId(request, options.sessionSecret);
      const grantCredential = grantId ? grantStore.peek(grantId) : undefined;
      if (grantCredential) {
        // OAuth-authorized teacher: verify the picked project is actually one
        // they granted access to, re-checked live (never trust the client echo).
        if (!options.createManagementExtras) throw new InstallerError("INSTALLER_OAUTH_NOT_CONFIGURED", "target", "OAuth 연결이 설정되지 않았습니다.");
        const accessible = await options.createManagementExtras(grantCredential).listAccessibleProjects();
        if (!accessible.some((project) => project.ref === target.projectRef)) throw new InstallerError("INSTALLER_PROJECT_NOT_ALLOWED", "target", "권한이 없는 프로젝트입니다.");
      } else if (allowedProjectRefs.size > 0 && !allowedProjectRefs.has(target.projectRef)) {
        throw new InstallerError("INSTALLER_PROJECT_NOT_ALLOWED", "target", "허용된 TEST 프로젝트가 아닙니다.");
      }
      const previous = getSession(request, store, options.sessionSecret);
      const sameTarget = previous?.target.projectRef === target.projectRef && previous.target.projectUrl === target.projectUrl;
      const session = sameTarget ? previous! : store.create(target);
      logInstallerDiagnostic("session_created_or_reused", { reused: sameTarget, idPrefix: session.id.slice(0, 8), viaOAuth: Boolean(grantId && grantCredential) });
      let publishableKey: string | undefined;
      if (grantId && grantCredential) {
        const bound = grantStore.consume(grantId);
        if (bound) store.setCredentialFromEphemeral(session.id, bound);
        response.setHeader("set-cookie", [cookieHeader("installer_session", options.sessionSecret ? `${session.id}.${signSession(session.id, options.sessionSecret)}` : session.id, session.expiresAt, options), clearedCookieHeader("installer_oauth_grant", options)]);
        if (bound && options.createManagementExtras) {
          logInstallerDiagnostic("PUBLIC_KEY_FETCH_START", { idPrefix: session.id.slice(0, 8) });
          try {
            publishableKey = await options.createManagementExtras(bound).getPublishableKey(target);
            if (publishableKey) {
              // Non-fatal even here, but this is the fix for the actual bug:
              // the fetched key was previously only ever put in the JSON
              // response, never written back onto session.target, so
              // probeFunction() (which reads session.target.publishableKey)
              // always saw it as missing regardless of whether this call
              // succeeded -- INSTALLER_PUBLIC_CONFIG_MISSING on every OAuth
              // bind, independent of the key-detection logic itself.
              session.target = { ...session.target, publishableKey };
              logInstallerDiagnostic("PUBLIC_KEY_FETCH_SUCCESS", { idPrefix: session.id.slice(0, 8) });
            } else {
              logInstallerDiagnostic("PUBLIC_KEY_FETCH_FAIL", { idPrefix: session.id.slice(0, 8), reason: "no_publishable_key_in_response" });
            }
          } catch (error) {
            // Non-fatal: the teacher can still enter it manually. Never log
            // the key itself -- only stage/code/upstream status.
            const fields: Record<string, string | number> = { idPrefix: session.id.slice(0, 8) };
            if (error instanceof InstallerError) {
              fields.code = error.code;
              if (error.upstreamStatus !== undefined) fields.upstreamStatus = error.upstreamStatus;
            }
            logInstallerDiagnostic("PUBLIC_KEY_FETCH_FAIL", fields);
          }
        }
      } else {
        response.setHeader("set-cookie", cookieHeader("installer_session", options.sessionSecret ? `${session.id}.${signSession(session.id, options.sessionSecret)}` : session.id, session.expiresAt, options));
      }
      sendJson(response, 201, { status: session.credential && !session.credential.disposed ? "AUTHORIZED" : "CREATED", ...(publishableKey ? { publishableKey } : {}) });
      return;
    }
    if (url.pathname === "/api/installer/authorize" && request.method === "POST") {
      if (!options.oauth) { sendError(response, 501, "INSTALLER_OAUTH_NOT_CONFIGURED", "이 TEST 실행부에는 OAuth 연결이 설정되지 않았습니다."); return; }
      const authorization = oauthStore.create(options.oauth.clientId, options.oauth.redirectUri);
      sendJson(response, 200, { authorizeUrl: authorization.url });
      return;
    }
    if (url.pathname === "/api/installer/oauth/callback" && request.method === "GET") {
      if (!options.oauth) { sendError(response, 501, "INSTALLER_OAUTH_NOT_CONFIGURED", "이 TEST 실행부에는 OAuth 연결이 설정되지 않았습니다."); return; }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const returnOrigin = [...allowedOrigins][0];
      if (!code || !state || !returnOrigin) { sendError(response, 400, "INSTALLER_OAUTH_CALLBACK_INVALID", "OAuth 콜백 요청이 올바르지 않습니다."); return; }
      const pending = oauthStore.consume(state, options.oauth.redirectUri);
      const tokens = await exchangeOAuthCode({ clientId: options.oauth.clientId, clientSecret: options.oauth.clientSecret, code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri, fetchImpl: options.oauth.fetchImpl });
      tokens.refreshToken?.dispose(); // Not persisted in this TEST-scope flow; each install re-authorizes.
      const grantId = grantStore.create(tokens.accessToken);
      response.setHeader("set-cookie", cookieHeader("installer_oauth_grant", options.sessionSecret ? `${grantId}.${signSession(grantId, options.sessionSecret)}` : grantId, Date.now() + 10 * 60 * 1000, options));
      response.writeHead(302, { location: `${returnOrigin}/setup?oauth=granted` });
      response.end();
      return;
    }
    if (url.pathname === "/api/installer/projects" && request.method === "GET") {
      const grantId = getOAuthGrantId(request, options.sessionSecret);
      const credential = grantId ? grantStore.peek(grantId) : undefined;
      if (!credential) { sendError(response, 401, "INSTALLER_OAUTH_GRANT_REQUIRED", "Supabase 연결을 먼저 완료해 주세요."); return; }
      if (!options.createManagementExtras) { sendError(response, 501, "INSTALLER_OAUTH_NOT_CONFIGURED", "이 TEST 실행부에는 OAuth 연결이 설정되지 않았습니다."); return; }
      const projects = await options.createManagementExtras(credential).listAccessibleProjects();
      const visible = projects.filter((project) => { try { assertSafeTarget({ environment: "TEST", projectRef: project.ref }, options.productionRef); return true; } catch { return false; } });
      sendJson(response, 200, { projects: visible });
      return;
    }
    const session = getSession(request, store, options.sessionSecret);
    if (url.pathname === "/api/installer/session" && request.method === "DELETE") {
      if (session) store.delete(session.id);
      response.setHeader("set-cookie", clearedCookieHeader("installer_session", options));
      sendJson(response, 200, { revoked: true });
      return;
    }
    if (!session) { sendError(response, 401, "INSTALLER_SESSION_REQUIRED", "설치 권한 연결이 필요합니다."); return; }
    if (url.pathname === "/api/installer/credential" && request.method === "POST") {
      const body = await readJson(request);
      const pat = body && typeof body === "object" && typeof (body as { pat?: unknown }).pat === "string" ? (body as { pat: string }).pat : "";
      store.setCredential(session.id, pat);
      sendJson(response, 200, { status: "AUTHORIZED" });
      return;
    }
    // A stale UI must never operate on a different project bound to this cookie.
    const requested = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request);
    if (requested && typeof requested === "object" && "projectRef" in requested) {
      const value = requested as { projectRef?: unknown; projectUrl?: unknown };
      if (value.projectRef !== session.target.projectRef || value.projectUrl !== session.target.projectUrl) throw new InstallerError("INSTALLER_TARGET_MISMATCH", "target", "현재 선택한 프로젝트의 설치 권한을 다시 연결해 주세요.");
    }
    const credential = session.credential;
    if (!credential || credential.disposed) { sendError(response, 401, "INSTALLER_AUTH_REQUIRED", "Supabase 설치 권한을 먼저 연결해 주세요."); return; }
    const backend = options.createBackend(credential);
    if (url.pathname === "/api/installer/status" && request.method === "GET") {
      sendJson(response, 200, await statusFor(session, backend, options.plan));
      return;
    }
    if (url.pathname === "/api/installer/plan" && request.method === "POST") {
      sendJson(response, 200, await planFor(session, backend, options.plan));
      return;
    }
    if (url.pathname === "/api/installer/teacher-account" && request.method === "POST") {
      if (!options.createManagementExtras) { sendError(response, 501, "INSTALLER_TEACHER_ACCOUNT_NOT_CONFIGURED", "교사 계정 자동 생성이 설정되지 않았습니다."); return; }
      // The body was already consumed above (readJson) for the target-mismatch check; reuse it.
      const email = requested && typeof requested === "object" && typeof (requested as { email?: unknown }).email === "string" ? (requested as { email: string }).email : "";
      const password = requested && typeof requested === "object" && typeof (requested as { password?: unknown }).password === "string" ? (requested as { password: string }).password : "";
      const result = await options.createManagementExtras(credential).createTeacherAccount(session.target, email, password);
      sendJson(response, 200, result);
      return;
    }
    if (url.pathname === "/api/installer/install" || url.pathname === "/api/installer/repair" || url.pathname === "/api/installer/update") {
      if (request.method !== "POST") { sendError(response, 405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청입니다."); return; }
      if (activeProjects.has(session.target.projectRef)) { sendError(response, 409, "INSTALLER_BUSY", "이 프로젝트의 설치가 진행 중입니다. 잠시 후 상태를 확인해 주세요."); return; }
      activeProjects.add(session.target.projectRef);
      try {
        if (url.pathname === "/api/installer/repair" || url.pathname === "/api/installer/update") {
          const current = await statusFor(session, backend, options.plan);
          const action = maintenanceAction(url.pathname, String(current.status));
          if (action) { sendJson(response, 200, { jobId: session.jobId, status: "COMPLETE", action }); return; }
        }
        const state = await runInstaller({ target: session.target, plan: options.plan, backend, previous: session.state, onState: (next) => { session.state = next; } });
        session.state = state;
        // Keep only in memory until the fixed session TTL or explicit revoke.
        // This permits status, refresh and repair without persisting PAT anywhere.
        sendJson(response, 200, { jobId: session.jobId, status: state.status === "COMPLETE" ? "COMPLETE" : "PARTIAL", action: "INSTALL" });
      } finally { activeProjects.delete(session.target.projectRef); }
      return;
    }
    sendError(response, 404, "INSTALLER_ROUTE_NOT_FOUND", "설치 경로를 찾을 수 없습니다.");
  } catch (error) {
    const detail = error instanceof InstallerError ? error : new InstallerError("INSTALLER_SERVER_ERROR", "target", "설치 실행부에서 오류가 발생했습니다.");
    const status = detail.code.includes("SESSION") || detail.code.includes("AUTH") ? 401 : detail.code === "PRODUCTION_TARGET_BLOCKED" || detail.code === "INSTALLER_TARGET_MISMATCH" ? 403 : 502;
    sendError(response, status, detail.code, detail.message, detail.stage, detail.upstreamStatus);
  }
}

/** Non-secret: only the stage name, safe error code, and the real upstream
 * HTTP status (never a token/cookie/key/secret value or body). Lets a live
 * 502 be root-caused from Render's log stream alone, without needing
 * anyone to find the response body in a browser's Network tab. */
function logStatusStage(event: string, session: InstallerSession, error?: unknown): void {
  const fields: Record<string, string | number | boolean> = { projectRefPrefix: session.target.projectRef.slice(0, 6) };
  if (error instanceof InstallerError) {
    fields.code = error.code;
    fields.stage = error.stage;
    if (error.upstreamStatus !== undefined) fields.upstreamStatus = error.upstreamStatus;
  }
  logInstallerDiagnostic(event, fields);
}

async function statusFor(session: InstallerSession, backend: InstallerBackend, plan: InstallerPlan): Promise<Record<string, unknown>> {
  logStatusStage("STATUS_INSPECT_PROJECT_START", session);
  let project: RemoteProject;
  try {
    project = await backend.inspectProject(session.target);
    logStatusStage("STATUS_INSPECT_PROJECT_OK", session);
  } catch (error) {
    logStatusStage("STATUS_INSPECT_PROJECT_FAIL", session, error);
    throw error;
  }
  if (project.ref !== session.target.projectRef) throw new InstallerError("INSTALLER_TARGET_MISMATCH", "target", "설치 대상 프로젝트가 일치하지 않습니다.");
  logStatusStage("STATUS_MIGRATIONS_START", session);
  logStatusStage("STATUS_SECRETS_START", session);
  logStatusStage("STATUS_FUNCTIONS_START", session);
  const [migrationsResult, secretsResult, functionsResult] = await Promise.allSettled([
    backend.listAppliedMigrations(session.target),
    backend.listSecrets(session.target),
    backend.listFunctions(session.target),
  ]);
  logStatusStage(migrationsResult.status === "fulfilled" ? "STATUS_MIGRATIONS_OK" : "STATUS_MIGRATIONS_FAIL", session, migrationsResult.status === "rejected" ? migrationsResult.reason : undefined);
  logStatusStage(secretsResult.status === "fulfilled" ? "STATUS_SECRETS_OK" : "STATUS_SECRETS_FAIL", session, secretsResult.status === "rejected" ? secretsResult.reason : undefined);
  logStatusStage(functionsResult.status === "fulfilled" ? "STATUS_FUNCTIONS_OK" : "STATUS_FUNCTIONS_FAIL", session, functionsResult.status === "rejected" ? functionsResult.reason : undefined);
  // Promise.allSettled keeps the original three calls running in parallel
  // (same as the Promise.all this replaces) but lets every stage's outcome
  // be logged before failing -- Promise.all would only ever surface the
  // first rejection, hiding whether the other two also failed.
  const firstRejected = [migrationsResult, secretsResult, functionsResult].find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (firstRejected) throw firstRejected.reason;
  const migrations = (migrationsResult as PromiseFulfilledResult<string[]>).value;
  const secrets = (secretsResult as PromiseFulfilledResult<string[]>).value;
  const functions = (functionsResult as PromiseFulfilledResult<FunctionDeployment[]>).value;
  const missingMigrations = plan.migrations.filter((item) => !migrations.includes(item.name));
  const missingFunctions = plan.functions.filter((bundle) => !functions.some((item) => item.slug === bundle.slug && item.hash === bundle.hash));
  const probes = await Promise.all(plan.functions.map(async (bundle) => {
    if (!functions.some((item) => item.slug === bundle.slug)) return { slug: bundle.slug, status: "MISSING" };
    try { await backend.probeFunction(session.target, bundle.slug); return { slug: bundle.slug, status: "PASS" }; }
    catch { return { slug: bundle.slug, status: "FAIL" }; }
  }));
  const probeFailed = probes.some((probe) => probe.status === "FAIL");
  const status = missingMigrations.length || !secrets.includes("APP_SESSION_SECRET") ? (migrations.length ? "PARTIAL" : "NEW") : missingFunctions.length ? "UPDATE_REQUIRED" : probeFailed ? "BROKEN" : "INSTALLED";
  return { status, appVersion: plan.appVersion, schemaVersion: plan.schemaVersion, project: { ref: project.ref, name: project.name, region: project.region, status: project.status }, appliedMigrationCount: plan.migrations.length - missingMigrations.length, requiredMigrationCount: plan.migrations.length, missingMigrations: missingMigrations.map((item) => item.name), secretConfigured: secrets.includes("APP_SESSION_SECRET"), functions: functions.map(({ slug, version, status: functionStatus }) => ({ slug, version, status: functionStatus })), probes };
}

async function planFor(session: InstallerSession, backend: InstallerBackend, plan: InstallerPlan): Promise<Record<string, unknown>> {
  const [migrations, secrets, functions] = await Promise.all([backend.listAppliedMigrations(session.target), backend.listSecrets(session.target), backend.listFunctions(session.target)]);
  return { migrations: plan.migrations.map((item) => ({ name: item.name, status: migrations.includes(item.name) ? "APPLIED" : "PENDING" })), functions: plan.functions.map((bundle) => ({ slug: bundle.slug, status: functions.some((item) => item.slug === bundle.slug && item.hash === bundle.hash) ? "INSTALLED" : functions.some((item) => item.slug === bundle.slug) ? "UPDATE_REQUIRED" : "MISSING" })), secretConfigured: secrets.includes("APP_SESSION_SECRET"), action: plan.migrations.every(item => migrations.includes(item.name)) && secrets.includes("APP_SESSION_SECRET") && plan.functions.every(bundle => functions.some(item => item.slug === bundle.slug && item.hash === bundle.hash)) ? "NO_RUNTIME_CHANGES" : "CHANGES_REQUIRED" };
}

function parseTarget(value: unknown): InstallerTarget {
  if (!value || typeof value !== "object") throw new InstallerError("INSTALLER_TARGET_INVALID", "target", "설치 대상 정보가 올바르지 않습니다.");
  const candidate = value as Partial<InstallerTarget>;
  if ((candidate.environment !== "TEST" && candidate.environment !== "STAGING" && candidate.environment !== "PRODUCTION") || typeof candidate.projectRef !== "string" || typeof candidate.projectUrl !== "string" || typeof candidate.release !== "string") throw new InstallerError("INSTALLER_TARGET_INVALID", "target", "설치 대상 정보가 올바르지 않습니다.");
  return { environment: candidate.environment, projectRef: candidate.projectRef, projectUrl: candidate.projectUrl, publishableKey: typeof candidate.publishableKey === "string" ? candidate.publishableKey : undefined, release: candidate.release };
}

function readCookieId(request: IncomingMessage, name: string, sessionSecret?: string): string | undefined {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!cookie) return undefined;
  const raw = cookie.slice(name.length + 1);
  const [id, signature] = raw.split(".");
  if (sessionSecret && (!id || !signature || !safeEqual(signature, signSession(id, sessionSecret)))) return undefined;
  return id || undefined;
}

function getSession(request: IncomingMessage, store: InstallerSessionStore, sessionSecret?: string): InstallerSession | undefined {
  const id = readCookieId(request, "installer_session", sessionSecret);
  if (!id) {
    const cookieHeaderSent = Boolean(request.headers.cookie);
    const nameSent = Boolean(request.headers.cookie?.includes("installer_session="));
    logInstallerDiagnostic("session_lookup_no_usable_id", { cookieHeaderSent, installerSessionNamePresent: nameSent });
    return undefined;
  }
  const session = store.get(id);
  if (!session) logInstallerDiagnostic("session_lookup_unknown_or_expired", { idPrefix: id.slice(0, 8) });
  return session;
}

function getOAuthGrantId(request: IncomingMessage, sessionSecret?: string): string | undefined {
  return readCookieId(request, "installer_oauth_grant", sessionSecret);
}

function signSession(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieHeader(name: string, value: string, expiresAt: number, options: InstallerHttpOptions): string {
  const sameSite = resolveSessionCookieSameSite(options.sessionCookieSecure, options.sessionCookieSameSite);
  const maxAge = Math.max(0, Math.floor((expiresAt - (options.now ?? Date.now)()) / 1000));
  return `${name}=${value}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}; Path=/api/installer${options.sessionCookieSecure ? "; Secure" : ""}`;
}

function clearedCookieHeader(name: string, options: InstallerHttpOptions): string {
  const sameSite = resolveSessionCookieSameSite(options.sessionCookieSecure, options.sessionCookieSameSite);
  return `${name}=; Max-Age=0; HttpOnly; Path=/api/installer; SameSite=${sameSite}${options.sessionCookieSecure ? "; Secure" : ""}`;
}

function applyCors(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): void {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) { response.setHeader("access-control-allow-origin", origin); response.setHeader("vary", "Origin"); response.setHeader("access-control-allow-credentials", "true"); }
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function originAllowed(request: IncomingMessage, allowedOrigins: Set<string>): boolean {
  const origin = request.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); if (raw.length > 1_000_000) reject(new InstallerError("INSTALLER_BODY_TOO_LARGE", "target", "요청이 너무 큽니다.")); });
    request.on("end", () => { if (!raw.trim()) resolve({}); else { try { resolve(JSON.parse(raw)); } catch { reject(new InstallerError("INSTALLER_JSON_INVALID", "target", "요청 형식이 올바르지 않습니다.")); } } });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status; response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, code: string, message: string, stage?: string, upstreamStatus?: number): void {
  sendJson(response, status, { code, message, ...(stage ? { stage } : {}), ...(upstreamStatus !== undefined ? { upstreamStatus } : {}) });
}
