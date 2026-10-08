import { parseDataEvidence } from './data-evidence.ts';
import { readFile } from "node:fs/promises";
import type { Catalog } from "./database-state.ts";
import { InstallerError, type FunctionBundle, type FunctionDeployment, type InstallerBackend, type InstallerTarget, type MigrationInput, type RemoteProject } from "./contract.ts";
import { EphemeralCredential } from "./security.ts";

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
  /** Shorter injectable deadlines for deterministic transport regression tests. */
  requestTimeoutMs?: number;
  mutationTimeoutMs?: number;
  waitForRetry?: (ms: number) => Promise<void>;
}

/**
 * Server/CLI-only Management API adapter. This module is intentionally outside
 * src/ so Vite cannot include a management credential in the public bundle.
 */
export class SupabaseManagementBackend implements InstallerBackend {
  readonly #credential: EphemeralCredential;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;
  readonly #readTimeout: number;
  readonly #writeTimeout: number;
  readonly #wait: (ms: number) => Promise<void>;

  constructor(options: ManagementApiOptions) {
    this.#credential = options.accessToken;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#baseUrl = (options.baseUrl ?? MANAGEMENT_API).replace(/\/$/, "");
    this.#readTimeout = Math.min(15000, Math.max(1, options.requestTimeoutMs ?? 15000));
    this.#writeTimeout = Math.min(120000, Math.max(1, options.mutationTimeoutMs ?? 120000));
    this.#wait = options.waitForRetry ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
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
    let response: Response; let raw: string;
    try {
      // Derive from the validated ref, not a caller-supplied path or redirect.
      ({response, raw} = await this.#fetchText(`https://${target.projectRef}.supabase.co/auth/v1/settings`, { method: 'GET', headers: { apikey: key } }, this.#readTimeout));
    } catch { throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_UNREACHABLE','target','선택한 프로젝트의 공개 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_FAILED','target','공개 키를 받았지만 선택한 프로젝트가 연결 확인을 거부했습니다. 다시 시도해 주세요.',response.status);
    // Success must be Auth settings, not an HTML proxy/error page.
    let settings: unknown; try { settings = JSON.parse(raw); } catch { /* Invalid public response, never echo body. */ }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !('external' in settings)) throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_INVALID','target','프로젝트의 인증 설정 응답을 확인하지 못했습니다.');
  }

  /**
   * Wraps the service_role/secret key in an EphemeralCredential the instant it
   * is read so the raw value never lives in a plain variable longer than this
   * call. The caller must use().dispose() it and must never log/return it.
   */
  async getServiceRoleCredential(target: InstallerTarget): Promise<EphemeralCredential | undefined> {
    assertTargetBinding(target);
    const keys = await this.#listApiKeys(target);
    const match = keys.find(key => key.type === 'secret' && /^sb_secret_[A-Za-z0-9_-]+$/.test(key.apiKey)) ?? keys.find(key => (key.type === 'legacy' || key.type === undefined) && key.name === 'service_role' && isServiceRoleJwt(key.apiKey,target.projectRef));
    return match ? new EphemeralCredential(match.apiKey) : undefined;
  }

  async #listApiKeys(target: InstallerTarget): Promise<Array<{ name: string; type?: string; apiKey: string }>> {
    const response = await this.request<unknown>("target", `/v1/projects/${encodeURIComponent(target.projectRef)}/api-keys?reveal=true`);
    if (!Array.isArray(response)) throw new InstallerError("INSTALLER_KEY_RESPONSE_INVALID", "target", "Supabase API 키 응답을 해석할 수 없습니다.");
    return response.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || !activeApiKey(item as Record<string,unknown>)) return [];
      const name = (item as { name?: unknown }).name;
      const type = (item as { type?: unknown }).type;
      const apiKey = (item as { api_key?: unknown }).api_key;
      if (type !== null && type !== undefined && !['legacy','secret','publishable'].includes(String(type))) return [];
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

  async inspectDatabasePermissions(target: InstallerTarget): Promise<unknown> {
    const query = await readFile(new URL('./permission-audit.sql', import.meta.url), 'utf8');
    const rows = await this.request<Array<{snapshot:unknown}>>('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, { method:'POST', body:JSON.stringify({query,read_only:true}) });
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.snapshot) throw new InstallerError('INSTALLER_PERMISSION_REVIEW_UNAVAILABLE','migrations','권한 진단을 확인하지 못했습니다. 기존 안전 차단을 유지합니다.');
    return rows[0].snapshot;
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
    // SET LOCAL only affects this Management API read-only transaction. Policy
    // deparsing must use the same canonical namespaces as our captured baseline.
    // It does not alter any role, function, policy, or persistent configuration.
    const rows = await this.request<Array<{evidence: unknown}>>('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, { method: 'POST', body: JSON.stringify({ query: `set local search_path=pg_catalog,public;\n${query}`, read_only: true }) });
    const result = Array.isArray(rows) && rows.length === 1 ? parseDataEvidence(rows[0]?.evidence) : undefined;
    if (!result) throw new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', '데이터 보존 조건을 확인하지 못했습니다.');
    return result;
  }

  async applyLegacyTransition(target: InstallerTarget, query: string): Promise<void> {
    // A real new transaction, not fabricated historical migration entries.
    await this.request('migrations', `/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, { method: 'POST', body: JSON.stringify({ query, read_only: false }) });
  }

  async applyPermissionRecovery(target: InstallerTarget, query: string): Promise<void> {
    // Supabase authorizes this exact project-bound database:write endpoint.
    // HTTP layer owns approval; the generated transaction rechecks ownership,
    // catalog, effective rights and all app rows. Uncertain writes never retry.
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
    assertTargetBinding(target);
    let response: Response;
    try { ({response} = await this.#fetchText(`https://${target.projectRef}.supabase.co/functions/v1/${slug}`, { method: "OPTIONS", headers: { apikey: target.publishableKey } }, this.#readTimeout)); }
    catch { throw new InstallerError('INSTALLER_FUNCTION_PROBE_UNREACHABLE','probe',`${slug} 함수 응답을 확인하지 못했습니다. 설치 상태를 다시 확인해 주세요.`); }
    if (!response.ok) throw new InstallerError("INSTALLER_FUNCTION_PROBE_FAILED", "probe", `${slug} 함수 확인에 실패했습니다.`);
  }

  async request<T>(stage: "target" | "migrations" | "secret" | "functions", path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    // FormData bodies (multipart function deploys) need fetch to set their
    // own boundary-bearing content-type; only force JSON for string bodies.
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    // Only GETs may be replayed automatically. A lost mutation response does
    // not prove failure; the caller must re-inspect remote state before repair.
    const read = !init.method || init.method.toUpperCase() === 'GET';
    const attempts = read ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response; let raw: string;
      try {
        ({response, raw} = await this.#credential.use(token => this.#fetchText(`${this.#baseUrl}${path}`, { ...init, headers: new Headers([...headers, ['authorization', `Bearer ${token}`]]) }, read ? this.#readTimeout : this.#writeTimeout)));
      } catch (error) {
        if (error instanceof InstallerError && error.code === 'INSTALLER_CREDENTIAL_DISPOSED') throw error;
        if (attempt + 1 < attempts) { await this.#wait(250 * 2 ** attempt); continue; }
        throw new InstallerError(error instanceof DOMException && error.name === 'TimeoutError' ? 'INSTALLER_MANAGEMENT_TIMEOUT' : 'INSTALLER_MANAGEMENT_NETWORK', stage, read ? 'Supabase 응답을 확인하지 못했습니다. 같은 프로젝트에서 다시 시도해 주세요.' : '요청 결과를 확인하지 못했습니다. 설치 상태를 먼저 확인한 뒤 이어서 복구해 주세요.');
      }
      if (!response.ok) {
        const delay = retryDelay(response, attempt);
        if (attempt + 1 < attempts && delay !== undefined) { await this.#wait(delay); continue; }
        // Upstream code/message is untrusted and can contain credentials or SQL.
        throw new InstallerError(`INSTALLER_MANAGEMENT_HTTP_${response.status}`, stage, `관리 API 요청이 거부되었습니다 (${response.status}).`, response.status);
      }
      if (!raw) return undefined as T;
      try { return JSON.parse(raw) as T; } catch { throw new InstallerError('INSTALLER_RESPONSE_INVALID', stage, '관리 API 응답 형식이 올바르지 않습니다.'); }
    }
    throw new InstallerError('INSTALLER_MANAGEMENT_NETWORK', stage, 'Supabase 응답을 확인하지 못했습니다.');
  }

  async #fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<{response: Response; raw: string}> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const error = new DOMException('Request timed out', 'TimeoutError'); reject(error); controller.abort(error); }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async()=>{
        const response = await this.#fetch(url, { ...init, redirect:'error', signal:controller.signal });
        return { response, raw:await response.text() };
      })()]);
    } finally { clearTimeout(timer); }
  }
}

function isServiceRoleJwt(value: string, projectRef: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(part=>!/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    return payload?.role === 'service_role' && (payload.ref === undefined || payload.ref === projectRef);
  } catch { return false; }
}

function retryDelay(response: Response, attempt: number): number | undefined {
  if (![429,500,502,503,504].includes(response.status)) return undefined;
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const ms = /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter)*1000 : Date.parse(retryAfter)-Date.now();
    // A long server cooldown is surfaced to the teacher, not retried early.
    if (Number.isFinite(ms)) return ms > 5000 ? undefined : Math.max(0, ms);
  }
  return 250 * 2 ** attempt;
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
