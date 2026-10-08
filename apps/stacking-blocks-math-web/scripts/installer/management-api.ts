import { readFile } from "node:fs/promises";
import type { Catalog } from "./database-state.ts";
import { InstallerError, type FunctionBundle, type FunctionDeployment, type InstallerBackend, type InstallerTarget, type MigrationInput, type RemoteProject } from "./contract.ts";
import { EphemeralCredential, redactInstallerObject } from "./security.ts";

import { activeApiKey, publicKeyKind } from "./public-key.ts";
import { assertTargetBinding } from "./security.ts";

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
    const response = await this.request<unknown>("target", `/v1/projects/${encodeURIComponent(target.projectRef)}`);
    const project = parseRemoteProject(response);
    if (!project) throw new InstallerError('INSTALLER_PROJECT_RESPONSE_INVALID', 'target', 'Supabase 프로젝트 응답을 해석할 수 없습니다.');
    return project;
  }

  /** Lists every project this OAuth/PAT credential can see, for teacher-facing project pickers. */
  async listAccessibleProjects(): Promise<RemoteProject[]> {
    const response = await this.request<unknown>("target", "/v1/projects");
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_PROJECT_LIST_INVALID", "target", "Supabase 프로젝트 목록 응답을 해석할 수 없습니다.");
    return response.flatMap(item => { const project = parseRemoteProject(item); return project ? [project] : []; });
  }

  /** Public anon/publishable key only; never touches service_role. Safe to send to the browser.
   *
   * The Management API's own OpenAPI spec (ApiKeyResponse.type) is the real
   * discriminator: "legacy" | "publishable" | "secret" | null. `name` is a
   * free-text label (required, but not constrained) -- for a legacy key it
   * happens to be "anon"/"service_role", but for a new-style key it can be
   * anything (commonly "default"), so name === "publishable" never matches
   * anything real. Try the new type first, then the legacy name, so a
   * project that has migrated to the new key system is still detected. */
  async getPublishableKey(target: InstallerTarget): Promise<string | undefined> {
    // Only fixed metadata reaches the log; never upstream messages or values.
    const diagnostic = { event: 'public_key_lookup', projectRef: /^[a-z0-9-]{8,64}$/.test(target.projectRef) ? target.projectRef : '[invalid]', stage: 'management-api', httpStatus: 0, oauthPermissionError: false, responseArray: false, metadataCount: 0, publishableCount: 0, legacyAnonCount: 0, disabledCount: 0, valueFieldCount: 0, selectable: false, code: 'INSTALLER_PUBLIC_KEY_UNAVAILABLE' };
    try {
      const raw = await this.request<unknown>('target', `/v1/projects/${encodeURIComponent(target.projectRef)}/api-keys?reveal=true`);
      diagnostic.httpStatus = 200; diagnostic.responseArray = Array.isArray(raw);
      if (!Array.isArray(raw)) throw new InstallerError('INSTALLER_KEY_RESPONSE_INVALID', 'target', '프로젝트는 연결되었지만 공개 키 응답 형식을 확인하지 못했습니다. 다시 시도해 주세요.');
      diagnostic.metadataCount = raw.length;
      const keys = raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
      const isAnon = (key: Record<string, unknown>) => (key.type === 'legacy' || key.type == null) && key.name === 'anon';
      diagnostic.publishableCount = keys.filter(k => k.type === 'publishable').length;
      diagnostic.legacyAnonCount = keys.filter(isAnon).length;
      diagnostic.disabledCount = keys.filter(k => !activeApiKey(k)).length;
      diagnostic.valueFieldCount = keys.filter(k => typeof k.api_key === 'string' && k.api_key.trim().length > 0).length;
      const eligible = keys.filter(k => typeof k.name === 'string' && activeApiKey(k));
      const match = eligible.find(k => k.type === 'publishable' && publicKeyKind(k.api_key,target.projectRef) === 'publishable') ?? eligible.find(k => isAnon(k) && publicKeyKind(k.api_key,target.projectRef) === 'anon');
      diagnostic.selectable = Boolean(match); diagnostic.code = match ? 'PUBLIC_KEY_SELECTED' : diagnostic.code;
      return match?.api_key as string | undefined;
    } catch (error) {
      const status = error instanceof InstallerError ? error.upstreamStatus : undefined;
      diagnostic.httpStatus = status ?? diagnostic.httpStatus;
      diagnostic.oauthPermissionError = status === 401 || status === 403;
      const code = status === 403 ? 'INSTALLER_PUBLIC_KEY_FORBIDDEN' : status === 401 ? 'INSTALLER_PUBLIC_KEY_UNAUTHORIZED' : status === 404 ? 'INSTALLER_PUBLIC_KEY_NOT_FOUND' : status === 429 ? 'INSTALLER_PUBLIC_KEY_RATE_LIMITED' : status ? 'INSTALLER_PUBLIC_KEY_UPSTREAM_FAILED' : error instanceof InstallerError && ['INSTALLER_KEY_RESPONSE_INVALID','INSTALLER_RESPONSE_INVALID'].includes(error.code) ? 'INSTALLER_KEY_RESPONSE_INVALID' : 'INSTALLER_PUBLIC_KEY_NETWORK';
      diagnostic.code = code;
      throw new InstallerError(code, 'target', status === 403 ? '프로젝트는 연결되었지만 Supabase 계정의 API 키 조회 권한이 없습니다. API 키 조회 권한을 확인한 뒤 다시 시도해 주세요.' : status === 429 ? '공개 키 조회 요청이 잠시 제한되었습니다. 잠시 후 선택한 프로젝트에서 다시 시도해 주세요.' : '프로젝트는 연결되었지만 공개 키를 가져오지 못했습니다. 선택한 프로젝트에서 다시 시도해 주세요.', status);
    } finally { console.error(JSON.stringify(diagnostic)); }
  }

  async verifyPublishableKey(target: InstallerTarget, key: string): Promise<void> {
    assertTargetBinding(target);
    if (!publicKeyKind(key,target.projectRef)) throw new InstallerError('INSTALLER_PUBLIC_KEY_INVALID', 'target', '공개 연결 키 형식을 확인하지 못했습니다.');
    let response: Response;
    try {
      // Derive from the validated ref, not a caller-supplied path or redirect.
      response = await this.#fetch(`https://${target.projectRef}.supabase.co/auth/v1/settings`, { method: 'GET', headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_UNREACHABLE','target','선택한 프로젝트의 공개 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_FAILED','target','공개 키를 받았지만 선택한 프로젝트가 연결 확인을 거부했습니다. 다시 시도해 주세요.',response.status);
    // Success must be Auth settings, not an HTML proxy/error page.
    const settings: unknown = await response.json().catch(() => undefined);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !('external' in settings)) throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_INVALID','target','프로젝트의 인증 설정 응답을 확인하지 못했습니다.');
  }

  /**
   * Wraps the service_role/secret key in an EphemeralCredential the instant it
   * is read so the raw value never lives in a plain variable longer than this
   * call. The caller must use().dispose() it and must never log/return it.
   */
  async getServiceRoleCredential(target: InstallerTarget): Promise<EphemeralCredential | undefined> {
    const keys = await this.#listApiKeys(target);
    const match = keys.find((key) => key.type === "secret") ?? keys.find((key) => key.type === "legacy" && key.name === "service_role") ?? keys.find((key) => key.type === undefined && key.name === "service_role");
    return match ? new EphemeralCredential(match.apiKey) : undefined;
  }

  async #listApiKeys(target: InstallerTarget): Promise<Array<{ name: string; type?: string; apiKey: string }>> {
    const response = await this.request<unknown>("target", `/v1/projects/${encodeURIComponent(target.projectRef)}/api-keys?reveal=true`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_KEY_RESPONSE_INVALID", "target", "Supabase API 키 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const name = (item as { name?: unknown }).name;
      const type = (item as { type?: unknown }).type;
      const apiKey = (item as { api_key?: unknown }).api_key;
      return typeof name === "string" && typeof apiKey === "string" ? [{ name, type: typeof type === "string" ? type : undefined, apiKey }] : [];
    });
  }

  async inspectDatabaseCatalog(target: InstallerTarget): Promise<Catalog> {
    const query = await readFile(new URL('./catalog.sql', import.meta.url), 'utf8');
    const response = await this.request<Array<{ snapshot: Catalog }>>('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, {
      method: 'POST', body: JSON.stringify({ query, read_only: true }),
    });
    if (!Array.isArray(response) || response.length !== 1 || !response[0]?.snapshot) {
      throw new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', 'DB 정의를 확인하지 못했습니다. 자동 업데이트 전에 확인이 필요합니다.');
    }
    return response[0].snapshot;
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

  async inspectDataEvidence(target: InstallerTarget, query: string): Promise<import('./database-state.ts').DataEvidence> {
    const rows = await this.request<Array<{evidence: import('./database-state.ts').DataEvidence}>>('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, { method: 'POST', body: JSON.stringify({ query, read_only: true }) });
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.evidence) throw new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', '데이터 보존 조건을 확인하지 못했습니다.');
    const result = rows[0].evidence;
    const fields = ['seedMissing','seedOutdated','storageMissing','progressMissing','dataConflict'] as const;
    if (fields.some(k => !Number.isSafeInteger(result[k]) || result[k] < 0)) throw new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', '데이터 보존 조건을 확인하지 못했습니다.');
    return Object.fromEntries(fields.map(k => [k, result[k]])) as unknown as import('./database-state.ts').DataEvidence;
  }

  async applyLegacyTransition(target: InstallerTarget, query: string): Promise<void> {
    // A real new transaction, not fabricated historical migration entries.
    await this.request('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, { method: 'POST', body: JSON.stringify({ query, read_only: false }) });
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
      return [{ slug, verifyJwt: typeof (item as { verify_jwt?: unknown }).verify_jwt === "boolean" ? (item as { verify_jwt: boolean }).verify_jwt : undefined, version: typeof (item as { version?: unknown }).version === "number" ? (item as { version: number }).version : undefined, hash: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : undefined, status: typeof (item as { status?: unknown }).status === "string" ? (item as { status: string }).status : undefined }];
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
    return { slug: bundle.slug, version: response.version, hash: bundle.hash, verifyJwt: bundle.metadata.verify_jwt as boolean, status: response.status };
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
      throw new InstallerError(`INSTALLER_MANAGEMENT_${code}`, stage, `관리 API 요청이 거부되었습니다 (${response.status}).`, response.status);
    }
    if (!raw) return undefined as T;
    if (parsed !== undefined) return parsed as T;
    try { return JSON.parse(raw) as T; } catch { throw new InstallerError("INSTALLER_RESPONSE_INVALID", stage, "관리 API 응답 형식이 올바르지 않습니다."); }
  }
}

/** Current API has ref; older responses used id as the project ref. Never
 * substitute the requested ref for an absent or mismatching upstream value. */
function parseRemoteProject(value: unknown): RemoteProject | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const ref = item.ref === undefined ? item.id : item.ref;
  if (typeof ref !== 'string' || !/^[a-z0-9-]{1,64}$/.test(ref)) return undefined;
  return { ref, name: typeof item.name === 'string' ? item.name : undefined, region: typeof item.region === 'string' ? item.region : undefined, status: typeof item.status === 'string' ? item.status : undefined };
}
