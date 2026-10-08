/** Public installer transport. PAT is sent once to the configured HTTPS server,
 * never persisted here, and never returned by the backend. */

export type InstallerPublicTarget = {
  environment?: "TEST";
  projectRef: string;
  projectUrl: string;
  publishableKey?: string;
  release: string;
};

export type InstallerRemoteStatus =
  | "DRIFT_REQUIRES_REVIEW"
  | "NEW"
  | "PARTIAL"
  | "INSTALLED"
  | "UPDATE_REQUIRED"
  | "BROKEN"
  | "UNKNOWN";

export interface InstallerDataEvidenceReview {
  classification: 'SAFE_NO_CHANGE' | 'SAFE_ADDITIVE' | 'REVIEW_REQUIRED' | 'UNSAFE';
  counts: Partial<Record<'seedMissing' | 'seedOutdated' | 'storageMissing' | 'progressMissing' | 'dataConflict' | 'duplicateSeedCount' | 'storageBucketConflictCount' | 'storagePolicyConflictCount' | 'customizedSeedCount' | 'classProblemCount' | 'duplicateSeedReferencedCount' | 'seedIdentityConflictCount', number>>;
  triggers: string[];
  readOnly: true;
}

export interface InstallerRecoveryPlan {
  id: string;
  expiresAt: string;
  projectRef: string;
  profile: string;
  changes: Array<{ object: string; kind: 'table' | 'function'; action: 'GRANT' | 'REVOKE'; role: string; privileges: string[] }>;
  preservesStudentData: true;
}

export interface InstallerRecoveryPlanResponse {
  recoverable: boolean;
  reason: string;
  plan?: InstallerRecoveryPlan;
}

export interface InstallerStatusResponse {
  project?: { ref: string };
  legacyRecovery?: 'LEGACY_RESUME_CANDIDATE';
  matchedProfile?: string;
  databaseReview?: { dataEvidence?: InstallerDataEvidenceReview; reason: string; baseline: string; comparisonBaseline: string; objects: Array<{key: string; change: string; attributes?: Array<{name: string; state: string}>}> };
  status: InstallerRemoteStatus;
  appliedMigrationCount?: number;
  satisfiedMigrationCount?: number;
  requiredMigrationCount?: number;
  completedStages?: string[];
  missingMigrations?: string[];
  functions?: Array<{ slug: string; status?: string; version?: number }>;
  appVersion?: string;
  schemaVersion?: string;
  error?: { code?: string };
}

export interface InstallerPlanResponse {
  migrations: Array<{ name: string; status: "APPLIED" | "APPLIED_BY_HISTORY" | "SATISFIED_BY_STATE" | "PENDING" | "DRIFT_REQUIRES_REVIEW" }>;
  functions: Array<{ slug: string; status: "INSTALLED" | "MISSING" | "UPDATE_REQUIRED" }>;
  secretConfigured: boolean;
}

export interface InstallerJobResponse {
  jobId: string;
  status: "CREATED" | "RUNNING" | "PARTIAL" | "COMPLETE" | "FAILED";
  action?: "INSTALL" | "NO_CHANGES" | "UP_TO_DATE";
}

export interface InstallerSessionResponse {
  sessionId?: string;
  status: "CREATED" | "AUTHORIZED";
  publicKeyError?: { code: string; stage: string; upstreamStatus?: number };
  /** Present after a successful OAuth bind or same-project retry: the project's own
   * public key, fetched server-side so the teacher never has to copy it. */
  publishableKey?: string;
}

export interface InstallerAccessibleProject {
  ref: string;
  name?: string;
  region?: string;
}

export interface InstallerTeacherAccountResult {
  created: boolean;
  alreadyExists: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class InstallerClientError extends Error {
  readonly code: string;
  readonly status: number;
  /** Which stage (target/migrations/secret/functions) failed, and the real
   * upstream (Supabase Management API) HTTP status behind a 502, when the
   * server's error body carried them. Lets the UI show enough to diagnose a
   * failure without anyone needing to open the browser's Network tab. */
  readonly stage?: string;
  readonly upstreamStatus?: number;

  constructor(code: string, status: number, message: string, stage?: string, upstreamStatus?: number) {
    super(message);
    this.name = "InstallerClientError";
    this.code = code;
    this.status = status;
    this.stage = stage;
    this.upstreamStatus = upstreamStatus;
  }
}

export class InstallerClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #timeouts: { requestTimeoutMs: number; actionTimeoutMs: number };

  constructor(endpoint: string, fetchImpl: FetchLike = (input, init) => fetch(input, init), timeouts: Partial<{ requestTimeoutMs: number; actionTimeoutMs: number }> = {}) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new InstallerClientError("INSTALLER_ENDPOINT_INVALID", 0, "설치 실행부 주소가 올바르지 않습니다.");
    }
    if (parsed.protocol !== "https:" && !(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      throw new InstallerClientError("INSTALLER_ENDPOINT_INVALID", 0, "설치 실행부 주소가 안전한 HTTPS가 아닙니다.");
    }
    this.#baseUrl = endpoint.replace(/\/$/, "");
    this.#fetch = fetchImpl;
    this.#timeouts = { requestTimeoutMs: 60_000, actionTimeoutMs: 10 * 60_000, ...timeouts };
  }

  get endpoint(): string {
    return this.#baseUrl;
  }

  createSession(target: InstallerPublicTarget): Promise<InstallerSessionResponse> {
    return this.request<InstallerSessionResponse>("POST", "/api/installer/session", { ...target, environment: "TEST" });
  }

  /** Starts the server-side OAuth flow; the browser receives only a redirect URL.
   * No project is known yet at this point -- OAuth authorization comes before
   * project selection, not after. */
  beginAuthorization(): Promise<{ authorizeUrl: string }> {
    return this.request<{ authorizeUrl: string }>("POST", "/api/installer/authorize");
  }

  /** Projects the teacher's own OAuth authorization actually grants access to,
   * for a picker -- never a client-typed project ref. Requires having just
   * completed the OAuth redirect (the server reads its own grant cookie). */
  listAccessibleProjects(existingTarget?: InstallerPublicTarget): Promise<{ projects: InstallerAccessibleProject[] }> {
    return this.request<{ projects: InstallerAccessibleProject[] }>("GET", "/api/installer/projects", existingTarget);
  }

  /** Creates the teacher's Supabase Auth account on the installed project so
   * they never have to open the Supabase Dashboard by hand. */
  createTeacherAccount(email: string, password: string): Promise<InstallerTeacherAccountResult> {
    return this.request<InstallerTeacherAccountResult>("POST", "/api/installer/teacher-account", { email, password });
  }

  /** PAT fallback for the dev/regression path. The value is sent once and is never stored by this client. */
  provideTemporaryCredential(pat: string): Promise<InstallerSessionResponse> {
    return this.request<InstallerSessionResponse>("POST", "/api/installer/credential", { pat });
  }

  getStatus(target: InstallerPublicTarget): Promise<InstallerStatusResponse> {
    return this.request<InstallerStatusResponse>("GET", "/api/installer/status", target);
  }

  getPlan(target: InstallerPublicTarget): Promise<InstallerPlanResponse> {
    return this.request<InstallerPlanResponse>("POST", "/api/installer/plan", target);
  }

  startInstall(target: InstallerPublicTarget): Promise<InstallerJobResponse> {
    return this.request<InstallerJobResponse>("POST", "/api/installer/install", target);
  }

  repair(target: InstallerPublicTarget): Promise<InstallerJobResponse> {
    return this.request<InstallerJobResponse>("POST", "/api/installer/repair", target);
  }

  update(target: InstallerPublicTarget): Promise<InstallerJobResponse> {
    return this.request<InstallerJobResponse>("POST", "/api/installer/update", target);
  }

  getRecoveryPlan(target: InstallerPublicTarget): Promise<InstallerRecoveryPlanResponse> {
    return this.request<InstallerRecoveryPlanResponse>("POST", "/api/installer/recovery-plan", target);
  }

  executeRecovery(planId: string): Promise<{ status: "COMPLETE" }> {
    return this.request<{ status: "COMPLETE" }>("POST", "/api/installer/recovery-execute", { planId, approved: true });
  }

  revoke(): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>("DELETE", "/api/installer/session");
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: InstallerPublicTarget | { pat: string } | { email: string; password: string } | { planId: string; approved: true }): Promise<T> {
    const target = body && "projectRef" in body ? body : undefined;
    const query = method === "GET" && target
      ? `?${new URLSearchParams({ projectRef: target.projectRef, projectUrl: target.projectUrl, ...(target.publishableKey ? { publishableKey: target.publishableKey } : {}), release: target.release }).toString()}`
      : "";
    const controller = new AbortController();
    const action = /^\/api\/installer\/(install|repair|update|recovery-execute)$/.test(path);
    const timeoutMs = action ? this.#timeouts.actionTimeoutMs : this.#timeouts.requestTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new InstallerClientError("INSTALLER_REQUEST_TIMEOUT", 0, "설치 서버의 응답을 기다리는 시간이 길어졌어요. 실행이 끝났을 수 있으므로 ‘설치 확인’으로 상태를 먼저 확인해 주세요."));
      }, timeoutMs);
    });
    let response: Response;
    let raw: string;
    try {
      // Bound both headers and body. Never replay a mutation after an unknown
      // outcome: the next explicit status query recovers the server state.
      const result = await Promise.race([deadline, (async () => {
        const response = await this.#fetch(`${this.#baseUrl}${path}${query}`, {
          method,
          credentials: "include",
          signal: controller.signal,
          headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
          ...(method === "POST" && body ? { body: JSON.stringify(body) } : {}),
        });
        return { response, raw: await response.text() };
      })()]);
      response = result.response; raw = result.raw;
    } catch (reason) {
      if (reason instanceof InstallerClientError) throw reason;
      throw new InstallerClientError("INSTALLER_NETWORK", 0, "설치 실행부에 연결하지 못했습니다.");
    } finally { clearTimeout(timer); }
    const contentType = response.headers.get("content-type") ?? "";
    let payload: unknown;
    if (raw && contentType.includes("json")) {
      try { payload = JSON.parse(raw); } catch { payload = undefined; }
    }
    if (!response.ok) {
      const body = payload && typeof payload === "object" ? payload as { code?: unknown; stage?: unknown; upstreamStatus?: unknown } : undefined;
      const code = typeof body?.code === "string" ? body.code : `HTTP_${response.status}`;
      const stage = typeof body?.stage === "string" ? body.stage : undefined;
      const upstreamStatus = typeof body?.upstreamStatus === "number" ? body.upstreamStatus : undefined;
      throw new InstallerClientError(code, response.status, "설치 실행부 요청을 처리하지 못했습니다.", stage, upstreamStatus);
    }
    if (!payload || typeof payload !== "object") throw new InstallerClientError("INSTALLER_RESPONSE_INVALID", response.status, "설치 실행부 응답을 해석하지 못했습니다.");
    return payload as T;
  }
}

/** The endpoint is public configuration only; no credential is read here.
 * Defaults to this page's own origin: the installer session cookie only
 * survives as a first-party cookie when /api/installer/* is reached through
 * the frontend's own host (proxied by a same-origin static-site rewrite to
 * the real backend), not by calling a different onrender.com host directly,
 * which browsers may treat as third-party and refuse to store or send.
 * VITE_INSTALLER_API_URL remains as a dev/special-case override only. */
export function getConfiguredInstallerClient(): InstallerClient | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const configured = env.VITE_INSTALLER_API_URL?.trim();
  const endpoint = configured || (typeof window !== "undefined" ? window.location.origin : "");
  if (!endpoint) return null;
  try { return new InstallerClient(endpoint); } catch { return null; }
}
