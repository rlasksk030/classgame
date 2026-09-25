import { createHash, randomBytes } from "node:crypto";
import { EphemeralCredential } from "./security.ts";

const AUTHORIZE_ENDPOINT = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.supabase.com/v1/oauth/token";

interface PendingOAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  /** The frontend origin that started this flow (one of the server's configured
   * allowedOrigins at creation time) -- bound to the state so the callback, which
   * arrives as a plain top-level GET navigation with no reliable Origin header of
   * its own, can still send the browser back to the SAME frontend it started from,
   * even when multiple distinct frontends share one installer backend. */
  origin: string;
  expiresAt: number;
}

export interface OAuthAuthorization {
  url: string;
  state: string;
  expiresAt: number;
}

export interface OAuthTokenPair {
  accessToken: EphemeralCredential;
  refreshToken?: EphemeralCredential;
  expiresIn?: number;
}

export class OAuthSessionStore {
  readonly #sessions = new Map<string, PendingOAuth>();
  readonly #ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.#ttlMs = ttlMs;
  }

  create(clientId: string, redirectUri: string, origin: string, organizationSlug?: string): OAuthAuthorization {
    const now = Date.now();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = now + this.#ttlMs;
    this.#sessions.set(state, { state, codeVerifier, redirectUri, origin, expiresAt });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" });
    if (organizationSlug) params.set("organization_slug", organizationSlug);
    return { url: `${AUTHORIZE_ENDPOINT}?${params.toString()}`, state, expiresAt };
  }

  /** Single-use: always deletes on lookup, valid or not, so a state can never be
   * replayed. No expected-redirectUri parameter to compare against -- the stored
   * value came from a request whose Origin was already checked against
   * allowedOrigins at create() time, so it's trusted directly rather than compared
   * against a second caller-supplied copy of itself. */
  consume(state: string): { codeVerifier: string; redirectUri: string; origin: string } {
    const pending = this.#sessions.get(state);
    this.#sessions.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error("OAUTH_STATE_INVALID");
    return { codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri, origin: pending.origin };
  }

  clearExpired(now = Date.now()): void {
    for (const [state, pending] of this.#sessions) if (pending.expiresAt < now) this.#sessions.delete(state);
  }

  get size(): number {
    return this.#sessions.size;
  }
}

export interface OAuthTokenExchangeOptions {
  clientId: string;
  clientSecret: EphemeralCredential;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

export async function exchangeOAuthCode(options: OAuthTokenExchangeOptions): Promise<OAuthTokenPair> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const basic = await options.clientSecret.use(async (secret) => Buffer.from(`${options.clientId}:${secret}`).toString("base64"));
  const response = await fetchImpl(TOKEN_ENDPOINT, { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", code: options.code, code_verifier: options.codeVerifier, redirect_uri: options.redirectUri }).toString() });
  if (!response.ok) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || typeof (body as { access_token?: unknown }).access_token !== "string") throw new Error("OAUTH_TOKEN_RESPONSE_INVALID");
  const refreshToken = typeof (body as { refresh_token?: unknown }).refresh_token === "string" ? new EphemeralCredential((body as { refresh_token: string }).refresh_token) : undefined;
  return { accessToken: new EphemeralCredential((body as { access_token: string }).access_token), refreshToken, expiresIn: typeof (body as { expires_in?: unknown }).expires_in === "number" ? (body as { expires_in: number }).expires_in : undefined };
}

interface PendingGrant {
  id: string;
  accessToken: EphemeralCredential;
  expiresAt: number;
}

/**
 * Holds a just-exchanged OAuth access token between the callback redirect and
 * the teacher's project pick, since at callback time no InstallerTarget (and
 * therefore no InstallerSession) exists yet. One-time use: consuming a grant
 * always removes it, whether the caller goes on to bind a session or not.
 */
export class OAuthGrantStore {
  readonly #grants = new Map<string, PendingGrant>();
  readonly #ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.#ttlMs = ttlMs;
  }

  create(accessToken: EphemeralCredential): string {
    this.clearExpired();
    const id = randomBytes(24).toString("base64url");
    this.#grants.set(id, { id, accessToken, expiresAt: Date.now() + this.#ttlMs });
    return id;
  }

  /** Returns the credential without consuming the grant (used to list projects). */
  peek(id: string): EphemeralCredential | undefined {
    const grant = this.#grants.get(id);
    if (!grant || grant.expiresAt < Date.now()) { this.delete(id); return undefined; }
    return grant.accessToken;
  }

  /** Removes and returns the credential (used once a project target is bound). */
  consume(id: string): EphemeralCredential | undefined {
    const credential = this.peek(id);
    if (credential) this.#grants.delete(id);
    return credential;
  }

  delete(id: string): void {
    const grant = this.#grants.get(id);
    grant?.accessToken.dispose();
    this.#grants.delete(id);
  }

  clearExpired(): void {
    for (const [id, grant] of this.#grants) if (grant.expiresAt < Date.now()) this.delete(id);
  }

  get size(): number { this.clearExpired(); return this.#grants.size; }
}
