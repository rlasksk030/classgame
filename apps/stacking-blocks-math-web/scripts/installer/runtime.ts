import { createInstallerServer, type InstallerHttpOptions } from "./http-server.ts";
import { readMathInstallerPlan } from "./math-plan.ts";
import { SupabaseManagementBackend } from "./management-api.ts";

export interface InstallerRuntimeConfig {
  mode: "TEST";
  allowedOrigins: string[];
  allowedProjectRefs: string[];
  productionRef: string;
  sessionSecret: string;
  port: number;
  host: string;
  managementApiUrl?: string;
}

/** Reads the deployment contract without ever printing secret values. */
export function readInstallerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): InstallerRuntimeConfig {
  const mode = env.INSTALLER_MODE?.trim();
  if (mode !== "TEST") throw new Error("INSTALLER_MODE_MUST_BE_TEST");
  const productionRef = env.INSTALLER_PRODUCTION_REF?.trim() || "stacking-blocks-math";
  const allowedProjectRefs = splitList(env.INSTALLER_ALLOWED_PROJECT_REFS);
  if (allowedProjectRefs.length === 0) throw new Error("INSTALLER_ALLOWED_PROJECT_REFS_MISSING");
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
  // A hosted installer must be reachable through its platform proxy. Local
  // development can still opt into loopback explicitly with HOST=127.0.0.1.
  return { mode: "TEST", allowedOrigins, allowedProjectRefs, productionRef, sessionSecret, port, host: env.HOST?.trim() || "0.0.0.0", managementApiUrl: env.SUPABASE_MANAGEMENT_API_URL?.trim() || undefined };
}

export async function createConfiguredInstallerServer(root: string, env: NodeJS.ProcessEnv = process.env) {
  const config = readInstallerRuntimeConfig(env);
  const plan = await readMathInstallerPlan(root);
  const options: InstallerHttpOptions = {
    plan,
    productionRef: config.productionRef,
    mode: config.mode,
    allowedOrigins: config.allowedOrigins,
    allowedProjectRefs: config.allowedProjectRefs,
    sessionSecret: config.sessionSecret,
    sessionCookieSecure: config.allowedOrigins.every((origin) => origin.startsWith("https://")),
    sessionCookieSameSite: config.allowedOrigins.every((origin) => origin.startsWith("https://")) ? "None" : "Strict",
    createBackend: (credential) => new SupabaseManagementBackend({ accessToken: credential, baseUrl: config.managementApiUrl }),
  };
  return { server: createInstallerServer(options), config, plan };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
