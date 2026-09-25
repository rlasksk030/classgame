import { createInstallerServer, type InstallerHttpOptions, type InstallerManagementExtras, type InstallerOAuthConfig } from "./http-server.ts";
import { readMathInstallerPlan } from "./math-plan.ts";
import { SupabaseManagementBackend } from "./management-api.ts";
import { ManagementTeacherAccountProvisioner } from "./teacher-account.ts";
import { EphemeralCredential } from "./security.ts";

export interface InstallerRuntimeConfig {
  mode: "TEST" | "PRODUCTION";
  allowedOrigins: string[];
  allowedProjectRefs: string[];
  productionRef: string;
  sessionSecret: string;
  port: number;
  host: string;
  managementApiUrl?: string;
  /** Absent until a Supabase OAuth App is registered (org dashboard, one-time
   * human step) and its client id/secret/redirect URI are set as env vars.
   * The PAT/allowlist path above keeps working unchanged either way. */
  oauth?: { clientId: string; clientSecret: string; redirectUri: string };
}

/** Reads the deployment contract without ever printing secret values. */
export function readInstallerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): InstallerRuntimeConfig {
  const mode = env.INSTALLER_MODE?.trim();
  if (mode !== "TEST" && mode !== "PRODUCTION") throw new Error("INSTALLER_MODE_INVALID");
  const productionRef = env.INSTALLER_PRODUCTION_REF?.trim() || "stacking-blocks-math";
  const allowedProjectRefs = splitList(env.INSTALLER_ALLOWED_PROJECT_REFS);
  // TEST keeps its fixed allowlist mandatory (today's regression-tested contract:
  // a small, known set of TEST projects, no OAuth required to exercise it).
  // PRODUCTION has no such fixed set -- a teacher's own project ref can't be known
  // in advance -- so real installs there must go through the dynamic OAuth grant
  // path (options.oauth) instead. An empty allowlist is therefore only safe in
  // PRODUCTION when OAuth is actually configured; otherwise nothing could ever
  // be authorized and the deployment would be a silent dead end.
  if (mode === "TEST" && allowedProjectRefs.length === 0) throw new Error("INSTALLER_ALLOWED_PROJECT_REFS_MISSING");
  if (allowedProjectRefs.includes(productionRef)) throw new Error("INSTALLER_PRODUCTION_REF_IN_ALLOWLIST");
  const allowedOrigins = splitList(env.INSTALLER_ALLOWED_ORIGIN);
  if (allowedOrigins.length === 0) throw new Error("INSTALLER_ALLOWED_ORIGIN_MISSING");
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("INSTALLER_ORIGIN_MUST_BE_HTTPS");
  }
  const sessionSecret = env.INSTALLER_SESSION_SECRET?.trim() ?? "";
  if (sessionSecret.length < 32) throw new Error("INSTALLER_SESSION_SECRET_MISSING");
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INSTALLER_PORT_INVALID");
  const oauthClientId = env.INSTALLER_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = env.INSTALLER_OAUTH_CLIENT_SECRET?.trim();
  const oauthRedirectUri = env.INSTALLER_OAUTH_REDIRECT_URI?.trim();
  if ((oauthClientId || oauthClientSecret || oauthRedirectUri) && !(oauthClientId && oauthClientSecret && oauthRedirectUri)) {
    throw new Error("INSTALLER_OAUTH_CONFIG_INCOMPLETE");
  }
  const oauth = oauthClientId && oauthClientSecret && oauthRedirectUri ? { clientId: oauthClientId, clientSecret: oauthClientSecret, redirectUri: oauthRedirectUri } : undefined;
  if (mode === "PRODUCTION" && allowedProjectRefs.length === 0 && !oauth) throw new Error("INSTALLER_PRODUCTION_REQUIRES_OAUTH_OR_ALLOWLIST");
  // A hosted installer must be reachable through its platform proxy. Local
  // development can still opt into loopback explicitly with HOST=127.0.0.1.
  return { mode, allowedOrigins, allowedProjectRefs, productionRef, sessionSecret, port, host: env.HOST?.trim() || "0.0.0.0", managementApiUrl: env.SUPABASE_MANAGEMENT_API_URL?.trim() || undefined, oauth };
}

function managementExtrasFor(config: InstallerRuntimeConfig, credential: EphemeralCredential): InstallerManagementExtras {
  const backend = new SupabaseManagementBackend({ accessToken: credential, baseUrl: config.managementApiUrl });
  const provisioner = new ManagementTeacherAccountProvisioner(backend);
  return {
    listAccessibleProjects: () => backend.listAccessibleProjects(),
    createTeacherAccount: (target, email, password) => provisioner.createTeacherAccount(target, email, password),
    getPublishableKey: (target) => backend.getPublishableKey(target),
  };
}

export async function createConfiguredInstallerServer(root: string, env: NodeJS.ProcessEnv = process.env) {
  const config = readInstallerRuntimeConfig(env);
  const plan = await readMathInstallerPlan(root);
  const oauth: InstallerOAuthConfig | undefined = config.oauth ? { clientId: config.oauth.clientId, clientSecret: new EphemeralCredential(config.oauth.clientSecret), redirectUri: config.oauth.redirectUri } : undefined;
  const options: InstallerHttpOptions = {
    plan,
    productionRef: config.productionRef,
    mode: config.mode,
    allowedOrigins: config.allowedOrigins,
    allowedProjectRefs: config.allowedProjectRefs,
    sessionSecret: config.sessionSecret,
    sessionCookieSecure: config.allowedOrigins.every((origin) => origin.startsWith("https://")),
    // The installer API is only ever reached through the frontend's own
    // origin (a same-origin static-site rewrite proxies /api/installer/* to
    // this service) -- every real request is same-site, so Lax works and is
    // strictly safer than forcing None, which existed only for the
    // cross-origin browser calls this proxy eliminates.
    sessionCookieSameSite: "Lax",
    createBackend: (credential) => new SupabaseManagementBackend({ accessToken: credential, baseUrl: config.managementApiUrl }),
    createManagementExtras: (credential) => managementExtrasFor(config, credential),
    oauth,
  };
  return { server: createInstallerServer(options), config, plan };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
