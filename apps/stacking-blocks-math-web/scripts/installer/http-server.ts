import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { runInstaller, type InstallerPlan } from "./orchestrator.ts";
import { InstallerError, type InstallState, type InstallerBackend, type InstallerTarget } from "./contract.ts";
import { assertSafeTarget, assertTargetBinding, EphemeralCredential } from "./security.ts";

interface InstallerSession {
  id: string;
  target: InstallerTarget;
  credential?: EphemeralCredential;
  state?: InstallState;
  expiresAt: number;
}

export interface InstallerHttpOptions {
  plan: InstallerPlan;
  productionRef: string;
  createBackend: (credential: EphemeralCredential) => InstallerBackend;
  allowedOrigins?: string[];
  /** In TEST mode only these project refs may ever be bound. */
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
    const session: InstallerSession = { id: randomBytes(24).toString("base64url"), target, expiresAt: this.#now() + this.#ttlMs };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): InstallerSession | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= this.#now()) { this.delete(id); return undefined; }
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
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, store, allowedOrigins, allowedProjectRefs);
  });
  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: InstallerHttpOptions, store: InstallerSessionStore, allowedOrigins: Set<string>, allowedProjectRefs: Set<string>): Promise<void> {
  applyCors(request, response, allowedOrigins);
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (!originAllowed(request, allowedOrigins)) { sendError(response, 403, "INSTALLER_ORIGIN_BLOCKED", "설치 요청 출처를 확인할 수 없습니다."); return; }
  const url = new URL(request.url ?? "/", "http://installer.local");
  try {
    if (url.pathname === "/health" && request.method === "GET") { sendJson(response, 200, { ok: true, service: "stacking-blocks-installer", status: "ok", release: options.plan.appVersion, mode: options.mode ?? "TEST" }); return; }
    if (url.pathname === "/api/installer/session" && request.method === "POST") {
      const body = await readJson(request);
      const target = parseTarget(body);
      assertSafeTarget(target, options.productionRef);
      assertTargetBinding(target);
      if (options.mode === "TEST" && target.environment !== "TEST") throw new InstallerError("INSTALLER_TEST_TARGET_REQUIRED", "target", "TEST 프로젝트만 연결할 수 있습니다.");
      if (allowedProjectRefs.size > 0 && !allowedProjectRefs.has(target.projectRef)) throw new InstallerError("INSTALLER_PROJECT_NOT_ALLOWED", "target", "허용된 TEST 프로젝트가 아닙니다.");
      const session = store.create(target);
      const cookieValue = options.sessionSecret ? `${session.id}.${signSession(session.id, options.sessionSecret)}` : session.id;
      const sameSite = resolveSessionCookieSameSite(options.sessionCookieSecure, options.sessionCookieSameSite);
      response.setHeader("set-cookie", `installer_session=${cookieValue}; HttpOnly; SameSite=${sameSite}; Path=/api/installer${options.sessionCookieSecure ? "; Secure" : ""}`);
      sendJson(response, 201, { status: "CREATED" });
      return;
    }
    if (url.pathname === "/api/installer/authorize" && request.method === "POST") {
      sendError(response, 501, "INSTALLER_OAUTH_NOT_CONFIGURED", "이 TEST 실행부에는 OAuth 연결이 설정되지 않았습니다.");
      return;
    }
    const session = getSession(request, store, options.sessionSecret);
    if (url.pathname === "/api/installer/session" && request.method === "DELETE") {
      if (session) store.delete(session.id);
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
    if (url.pathname === "/api/installer/install" || url.pathname === "/api/installer/repair" || url.pathname === "/api/installer/update") {
      if (request.method !== "POST") { sendError(response, 405, "METHOD_NOT_ALLOWED", "지원하지 않는 요청입니다."); return; }
      if (url.pathname === "/api/installer/repair" || url.pathname === "/api/installer/update") {
        const current = await statusFor(session, backend, options.plan);
        const action = maintenanceAction(url.pathname, String(current.status));
        if (action) { sendJson(response, 200, { jobId: session.id, status: "COMPLETE", action }); return; }
      }
      const state = await runInstaller({ target: session.target, plan: options.plan, backend, previous: session.state, onState: (next) => { session.state = next; } });
      session.state = state;
      if (state.status === "COMPLETE") credential.dispose();
      sendJson(response, 200, { jobId: session.id, status: state.status === "COMPLETE" ? "COMPLETE" : "PARTIAL", action: "INSTALL" });
      return;
    }
    sendError(response, 404, "INSTALLER_ROUTE_NOT_FOUND", "설치 경로를 찾을 수 없습니다.");
  } catch (error) {
    const detail = error instanceof InstallerError ? error : new InstallerError("INSTALLER_SERVER_ERROR", "target", "설치 실행부에서 오류가 발생했습니다.");
    const status = detail.code.includes("SESSION") || detail.code.includes("AUTH") ? 401 : detail.code === "PRODUCTION_TARGET_BLOCKED" || detail.code === "INSTALLER_TARGET_MISMATCH" ? 403 : 502;
    sendError(response, status, detail.code, detail.message);
  }
}

async function statusFor(session: InstallerSession, backend: InstallerBackend, plan: InstallerPlan): Promise<Record<string, unknown>> {
  const project = await backend.inspectProject(session.target);
  if (project.ref !== session.target.projectRef) throw new InstallerError("INSTALLER_TARGET_MISMATCH", "target", "설치 대상 프로젝트가 일치하지 않습니다.");
  const [migrations, secrets, functions] = await Promise.all([backend.listAppliedMigrations(session.target), backend.listSecrets(session.target), backend.listFunctions(session.target)]);
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
  return { migrations: plan.migrations.map((item) => ({ name: item.name, status: migrations.includes(item.name) ? "APPLIED" : "PENDING" })), functions: plan.functions.map((bundle) => ({ slug: bundle.slug, status: functions.some((item) => item.slug === bundle.slug && item.hash === bundle.hash) ? "INSTALLED" : functions.some((item) => item.slug === bundle.slug) ? "UPDATE_REQUIRED" : "MISSING" })), secretConfigured: secrets.includes("APP_SESSION_SECRET") };
}

function parseTarget(value: unknown): InstallerTarget {
  if (!value || typeof value !== "object") throw new InstallerError("INSTALLER_TARGET_INVALID", "target", "설치 대상 정보가 올바르지 않습니다.");
  const candidate = value as Partial<InstallerTarget>;
  if ((candidate.environment !== "TEST" && candidate.environment !== "STAGING" && candidate.environment !== "PRODUCTION") || typeof candidate.projectRef !== "string" || typeof candidate.projectUrl !== "string" || typeof candidate.release !== "string") throw new InstallerError("INSTALLER_TARGET_INVALID", "target", "설치 대상 정보가 올바르지 않습니다.");
  return { environment: candidate.environment, projectRef: candidate.projectRef, projectUrl: candidate.projectUrl, publishableKey: typeof candidate.publishableKey === "string" ? candidate.publishableKey : undefined, release: candidate.release };
}

function getSession(request: IncomingMessage, store: InstallerSessionStore, sessionSecret?: string): InstallerSession | undefined {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("installer_session="));
  if (!cookie) return undefined;
  const raw = cookie.slice("installer_session=".length);
  const [id, signature] = raw.split(".");
  if (sessionSecret && (!id || !signature || !safeEqual(signature, signSession(id, sessionSecret)))) return undefined;
  return id ? store.get(id) : undefined;
}

function signSession(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
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

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { code, message });
}
