import { InstallerError, type FunctionBundle, type FunctionDeployment, type InstallerBackend, type InstallerTarget, type MigrationInput, type RemoteProject } from "./contract.ts";
import { EphemeralCredential, redactInstallerObject } from "./security.ts";

const MANAGEMENT_API = "https://api.supabase.com";

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface ManagementApiOptions {
  accessToken: EphemeralCredential;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

/**
 * Server/CLI-only Management API adapter. This module is intentionally outside
 * src/ so Vite cannot include a management credential in the public bundle.
 */
export class SupabaseManagementBackend implements InstallerBackend {
  readonly #credential: EphemeralCredential;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(options: ManagementApiOptions) {
    this.#credential = options.accessToken;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#baseUrl = (options.baseUrl ?? MANAGEMENT_API).replace(/\/$/, "");
  }

  dispose(): void {
    this.#credential.dispose();
  }

  async inspectProject(target: InstallerTarget): Promise<RemoteProject> {
    return this.request<RemoteProject>("target", `/v1/projects/${encodeURIComponent(target.projectRef)}`);
  }

  /** Lists every project this OAuth/PAT credential can see, for teacher-facing project pickers. */
  async listAccessibleProjects(): Promise<RemoteProject[]> {
    const response = await this.request<unknown>("target", "/v1/projects");
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_PROJECT_LIST_INVALID", "target", "Supabase 프로젝트 목록 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const ref = (item as { id?: unknown }).id;
      if (typeof ref !== "string") return [];
      const name = typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : undefined;
      const region = typeof (item as { region?: unknown }).region === "string" ? (item as { region: string }).region : undefined;
      const status = typeof (item as { status?: unknown }).status === "string" ? (item as { status: string }).status : undefined;
      return [{ ref, name, region, status }];
    });
  }

  /** Public anon/publishable key only; never touches service_role. Safe to send to the browser. */
  async getPublishableKey(target: InstallerTarget): Promise<string | undefined> {
    const keys = await this.#listApiKeys(target);
    const match = keys.find((key) => key.name === "publishable" || key.name === "anon");
    return match?.apiKey;
  }

  /**
   * Wraps the service_role/secret key in an EphemeralCredential the instant it
   * is read so the raw value never lives in a plain variable longer than this
   * call. The caller must use().dispose() it and must never log/return it.
   */
  async getServiceRoleCredential(target: InstallerTarget): Promise<EphemeralCredential | undefined> {
    const keys = await this.#listApiKeys(target);
    const match = keys.find((key) => key.name === "secret" || key.name === "service_role");
    return match ? new EphemeralCredential(match.apiKey) : undefined;
  }

  async #listApiKeys(target: InstallerTarget): Promise<Array<{ name: string; apiKey: string }>> {
    const response = await this.request<unknown>("target", `/v1/projects/${encodeURIComponent(target.projectRef)}/api-keys?reveal=true`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_KEY_RESPONSE_INVALID", "target", "Supabase API 키 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const name = (item as { name?: unknown }).name;
      const apiKey = (item as { api_key?: unknown }).api_key;
      return typeof name === "string" && typeof apiKey === "string" ? [{ name, apiKey }] : [];
    });
  }

  async listAppliedMigrations(target: InstallerTarget): Promise<string[]> {
    const response = await this.request<unknown>("migrations", `/v1/projects/${encodeURIComponent(target.projectRef)}/database/migrations`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_MIGRATION_RESPONSE_INVALID", "migrations", "원격 migration 상태 응답을 해석할 수 없습니다.");
    // The Management API returns {version, name} with name stripped of its
    // leading timestamp (e.g. version "202609110001", name "initial"), not the
    // "<version>_<name>.sql" filename our local migration plan uses. Rebuild
    // the filename so it matches plan.migrations[].name.
    return response.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object") {
        const version = typeof (item as { version?: unknown }).version === "string" ? (item as { version: string }).version : undefined;
        const name = typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : undefined;
        // Our Management API apply request stores the complete source filename.
        // Its server-assigned version differs; CLI-created rows use a short name.
        if (name && /^202\d+_.+\.sql$/.test(name)) return [name];
        if (version && name) return [`${version}_${name}.sql`];
        if (name) return [name];
      }
      return [];
    });
  }

  async applyMigration(target: InstallerTarget, migration: MigrationInput): Promise<void> {
    await this.request("migrations", `/v1/projects/${encodeURIComponent(target.projectRef)}/database/migrations`, {
      method: "POST",
      body: JSON.stringify({ name: migration.name, query: migration.query }),
    });
  }

  async listSecrets(target: InstallerTarget): Promise<string[]> {
    const response = await this.request<unknown>("secret", `/v1/projects/${encodeURIComponent(target.projectRef)}/secrets`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_SECRET_RESPONSE_INVALID", "secret", "원격 Secret 상태 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" ? [(item as { name: string }).name] : []);
  }

  async setSecrets(target: InstallerTarget, values: Record<string, string>): Promise<void> {
    await this.request("secret", `/v1/projects/${encodeURIComponent(target.projectRef)}/secrets`, {
      method: "POST",
      body: JSON.stringify(Object.entries(values).map(([name, value]) => ({ name, value }))),
    });
  }

  async listFunctions(target: InstallerTarget): Promise<FunctionDeployment[]> {
    const response = await this.request<unknown>("functions", `/v1/projects/${encodeURIComponent(target.projectRef)}/functions`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_FUNCTION_RESPONSE_INVALID", "functions", "원격 함수 상태 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const slug = (item as { slug?: unknown }).slug;
      if (slug !== "student-auth" && slug !== "student-api") return [];
      // Supabase's own ezbr_sha256 is computed by its remote bundler and
      // can't be reproduced locally, so deployFunction stores our own content
      // hash in "name" and this reads it back for an exact, self-consistent
      // up-to-date check instead of comparing against an unreplicable value.
      return [{ slug, version: typeof (item as { version?: unknown }).version === "number" ? (item as { version: number }).version : undefined, hash: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : undefined, status: typeof (item as { status?: unknown }).status === "string" ? (item as { status: string }).status : undefined }];
    });
  }

  async deployFunction(target: InstallerTarget, bundle: FunctionBundle): Promise<FunctionDeployment> {
    // The real deploy endpoint takes multipart/form-data (FunctionDeployBody),
    // not a JSON body: one "file" part per source file (named by its real
    // relative path, so Deno's resolver can follow the function's relative
    // imports) plus a "metadata" part.
    const form = new FormData();
    for (const file of bundle.files) form.append("file", new Blob([file.content], { type: "text/typescript" }), file.path);
    form.append("metadata", JSON.stringify(bundle.metadata));
    const response = await this.request<{ version?: number; status?: string }>("functions", `/v1/projects/${encodeURIComponent(target.projectRef)}/functions/deploy?slug=${encodeURIComponent(bundle.slug)}`, {
      method: "POST",
      body: form,
    });
    return { slug: bundle.slug, version: response.version, hash: bundle.hash, status: response.status };
  }

  async probeFunction(target: InstallerTarget, slug: FunctionDeployment["slug"]): Promise<void> {
    if (!target.publishableKey) throw new InstallerError("INSTALLER_PUBLIC_CONFIG_MISSING", "probe", "함수 확인에 필요한 공개 연결 설정이 없습니다.");
    const response = await this.#fetch(`${target.projectUrl.replace(/\/$/, "")}/functions/v1/${slug}`, { method: "OPTIONS", headers: { apikey: target.publishableKey } });
    if (!response.ok) throw new InstallerError("INSTALLER_FUNCTION_PROBE_FAILED", "probe", `${slug} 함수 확인에 실패했습니다.`);
  }

  async request<T>(stage: "target" | "migrations" | "secret" | "functions", path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    // FormData bodies (multipart function deploys) need fetch to set their
    // own boundary-bearing content-type; only force JSON for string bodies.
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await this.#credential.use((token) => this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers: new Headers([...headers, ["authorization", `Bearer ${token}`]]) }));
    } catch {
      throw new InstallerError("INSTALLER_MANAGEMENT_NETWORK", stage, "Supabase 관리 API에 연결하지 못했습니다.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    let parsed: unknown = undefined;
    if (raw && contentType.includes("json")) {
      try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    }
    if (!response.ok) {
      const safe = redactInstallerObject(parsed);
      const code = safe && typeof safe === "object" && typeof (safe as { code?: unknown }).code === "string" ? (safe as { code: string }).code : `HTTP_${response.status}`;
      throw new InstallerError(`INSTALLER_MANAGEMENT_${code}`, stage, `관리 API 요청이 거부되었습니다 (${response.status}).`);
    }
    if (!raw) return undefined as T;
    if (parsed !== undefined) return parsed as T;
    try { return JSON.parse(raw) as T; } catch { throw new InstallerError("INSTALLER_RESPONSE_INVALID", stage, "관리 API 응답 형식이 올바르지 않습니다."); }
  }
}
