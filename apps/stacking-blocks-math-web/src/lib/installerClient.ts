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
  | "NEW"
  | "PARTIAL"
  | "INSTALLED"
  | "UPDATE_REQUIRED"
  | "BROKEN"
  | "UNKNOWN";

export interface InstallerStatusResponse {
  status: InstallerRemoteStatus;
  appliedMigrationCount?: number;
  requiredMigrationCount?: number;
  completedStages?: string[];
  missingMigrations?: string[];
  functions?: Array<{ slug: string; status?: string; version?: number }>;
  appVersion?: string;
  schemaVersion?: string;
  error?: { code?: string };
}

export interface InstallerPlanResponse {
  migrations: Array<{ name: string; status: "APPLIED" | "PENDING" }>;
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
  /** Present only when the session was just bound via OAuth: the project's own
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

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "InstallerClientError";
    this.code = code;
    this.status = status;
  }
}

export class InstallerClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(endpoint: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
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
  listAccessibleProjects(): Promise<{ projects: InstallerAccessibleProject[] }> {
    return this.request<{ projects: InstallerAccessibleProject[] }>("GET", "/api/installer/projects");
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

  revoke(): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>("DELETE", "/api/installer/session");
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: InstallerPublicTarget | { pat: string } | { email: string; password: string }): Promise<T> {
    const target = body && "projectRef" in body ? body : undefined;
    const query = method === "GET" && target
      ? `?${new URLSearchParams({ projectRef: target.projectRef, projectUrl: target.projectUrl, ...(target.publishableKey ? { publishableKey: target.publishableKey } : {}), release: target.release }).toString()}`
      : "";
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}${query}`, {
        method,
        credentials: "include",
        headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
        ...(method === "POST" && body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new InstallerClientError("INSTALLER_NETWORK", 0, "설치 실행부에 연결하지 못했습니다.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    let payload: unknown;
    if (raw && contentType.includes("json")) {
      try { payload = JSON.parse(raw); } catch { payload = undefined; }
    }
    if (!response.ok) {
      const code = payload && typeof payload === "object" && typeof (payload as { code?: unknown }).code === "string"
        ? (payload as { code: string }).code
        : `HTTP_${response.status}`;
      throw new InstallerClientError(code, response.status, "설치 실행부 요청을 처리하지 못했습니다.");
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
