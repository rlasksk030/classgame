import { createHash, randomBytes } from "node:crypto";
import { EphemeralCredential } from "./security.ts";

const AUTHORIZE_ENDPOINT = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.supabase.com/v1/oauth/token";

interface PendingOAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
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

  create(clientId: string, redirectUri: string, organizationSlug?: string): OAuthAuthorization {
    const now = Date.now();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = now + this.#ttlMs;
    this.#sessions.set(state, { state, codeVerifier, redirectUri, expiresAt });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" });
    if (organizationSlug) params.set("organization_slug", organizationSlug);
    return { url: `${AUTHORIZE_ENDPOINT}?${params.toString()}`, state, expiresAt };
  }

  consume(state: string, redirectUri: string): { codeVerifier: string; redirectUri: string } {
    const pending = this.#sessions.get(state);
    this.#sessions.delete(state);
    if (!pending || pending.expiresAt < Date.now() || pending.redirectUri !== redirectUri) throw new Error("OAUTH_STATE_INVALID");
    return { codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri };
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
