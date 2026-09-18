/**
 * Public, credential-free client for the optional installer backend.
 *
 * Management credentials are held by the backend in an HttpOnly session. This
 * client deliberately sends no bearer token, Secret, password, or PIN and is
 * safe to include in the static SPA bundle.
 */

export type InstallerPublicTarget = {
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

  constructor(endpoint: string, fetchImpl: FetchLike = fetch) {
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
    return this.request<InstallerSessionResponse>("POST", "/api/installer/session", target);
  }

  /** Starts the server-side OAuth flow; the browser receives only a redirect URL. */
  beginAuthorization(target: InstallerPublicTarget): Promise<{ authorizeUrl: string }> {
    return this.request<{ authorizeUrl: string }>("POST", "/api/installer/authorize", target);
  }

  /** PAT fallback. The value is sent once and is never stored by this client. */
  provideTemporaryCredential(pat: string): Promise<InstallerSessionResponse> {
    return this.request<InstallerSessionResponse>("POST", "/api/installer/credential", { pat } as unknown as InstallerPublicTarget);
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

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: InstallerPublicTarget | { pat: string }): Promise<T> {
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

/** The endpoint is public configuration only; no credential is read here. */
export function getConfiguredInstallerClient(): InstallerClient | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const endpoint = env.VITE_INSTALLER_API_URL?.trim();
  if (!endpoint) return null;
  try { return new InstallerClient(endpoint); } catch { return null; }
}
