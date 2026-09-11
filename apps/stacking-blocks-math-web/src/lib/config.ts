/** 브라우저에 노출되어도 되는 설정값과 설치별 런타임 연결 설정만 다룬다. */

// Vite에서는 import.meta.env가 주입되고, Node 단위 테스트에서는 비어 있을 수 있다.
const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/** 개발/테스트 fallback. production 공통 dist의 주 연결 방식은 런타임 설정이다. */
export const SUPABASE_URL = runtimeEnv.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

export const APP_VERSION = "1.0.0";
export const SCHEMA_VERSION = "202609110011";
export const INSTALLATION_CONFIG_KEY = "stacking-installation-config";

export type AppEnvironment = "development" | "staging" | "production";

export interface RuntimeSupabaseConfig {
  installationId: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface AppConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  installationId?: string;
  environment: AppEnvironment;
  configSource: "runtime" | "vite-fallback" | "none";
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:");
  } catch {
    return false;
  }
}

/** 공개 연결 설정만 허용한다. Secret/service_role 이름이 들어간 값은 거부한다. */
export function validateRuntimeSupabaseConfig(value: unknown): value is RuntimeSupabaseConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RuntimeSupabaseConfig>;
  if (typeof candidate.installationId !== "string" || !/^[\w-]{1,100}$/.test(candidate.installationId)) return false;
  if (typeof candidate.supabaseUrl !== "string" || !validUrl(candidate.supabaseUrl)) return false;
  if (typeof candidate.supabasePublishableKey !== "string" || candidate.supabasePublishableKey.length < 8) return false;
  const lowered = candidate.supabasePublishableKey.toLowerCase();
  return !lowered.includes("service_role") && !lowered.includes("secret") && !lowered.includes("password");
}

function parseStoredConfig(raw: string | null): RuntimeSupabaseConfig | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return validateRuntimeSupabaseConfig(value) ? value : null;
  } catch {
    return null;
  }
}

/** URL fragment에 포함된 공개 설치 설정을 읽고 로컬에 보관한다. */
export function readInstallationConfigFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): RuntimeSupabaseConfig | null {
  const match = hash.match(/^#install=([^&]+)$/);
  if (!match) return null;
  try {
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - match[1].length % 4) % 4);
    const decoded = typeof atob === "function" ? atob(encoded) : Buffer.from(encoded, "base64").toString("utf8");
    const config: unknown = JSON.parse(decoded);
    return validateRuntimeSupabaseConfig(config) ? config : null;
  } catch {
    return null;
  }
}

export function encodeInstallationConfig(config: RuntimeSupabaseConfig): string {
  if (!validateRuntimeSupabaseConfig(config)) throw new Error("공개 설치 설정이 올바르지 않습니다.");
  const json = JSON.stringify(config);
  const encoded = typeof btoa === "function" ? btoa(json) : Buffer.from(json, "utf8").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function installationLink(config: RuntimeSupabaseConfig, origin = typeof window === "undefined" ? "" : window.location.origin): string {
  return `${origin}/#install=${encodeInstallationConfig(config)}`;
}

export function getRuntimeSupabaseConfig(): RuntimeSupabaseConfig | null {
  if (!isBrowser()) return null;
  const fromHash = readInstallationConfigFromHash();
  if (fromHash) {
    try { localStorage.setItem(INSTALLATION_CONFIG_KEY, JSON.stringify(fromHash)); } catch { /* 저장 불가 환경은 메모리에서 계속 진행 */ }
    return fromHash;
  }
  try {
    return parseStoredConfig(localStorage.getItem(INSTALLATION_CONFIG_KEY));
  } catch {
    return null;
  }
}

export function saveRuntimeSupabaseConfig(config: RuntimeSupabaseConfig): void {
  if (!validateRuntimeSupabaseConfig(config)) throw new Error("공개 설치 설정이 올바르지 않습니다.");
  if (!isBrowser()) throw new Error("브라우저 저장소를 사용할 수 없습니다.");
  localStorage.setItem(INSTALLATION_CONFIG_KEY, JSON.stringify(config));
}

export function clearRuntimeSupabaseConfig(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(INSTALLATION_CONFIG_KEY);
}

export function getResolvedSupabaseConfig(): RuntimeSupabaseConfig | null {
  const runtime = getRuntimeSupabaseConfig();
  if (runtime) return runtime;
  // VITE 값은 개발/테스트 fallback으로만 사용한다. production 공통 dist는 setup이 필요하다.
  if (runtimeEnv.MODE === "production" || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  return {
    installationId: runtimeEnv.VITE_INSTALLATION_ID ?? "vite-development",
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getAppConfig(): AppConfig {
  const environment = (runtimeEnv.MODE ?? "development") as AppEnvironment;
  const resolved = getResolvedSupabaseConfig();
  const hasRuntime = Boolean(getRuntimeSupabaseConfig());
  return {
    supabaseUrl: resolved?.supabaseUrl,
    supabasePublishableKey: resolved?.supabasePublishableKey,
    installationId: resolved?.installationId,
    environment: ["development", "staging", "production"].includes(environment) ? environment : "development",
    configSource: hasRuntime ? "runtime" : resolved ? "vite-fallback" : "none",
  };
}

export function isConfigured(): boolean {
  return Boolean(getResolvedSupabaseConfig());
}

/** 학생 접속 링크의 ?class=XXXX 값. */
export function classCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get("class") ?? "").trim().toUpperCase();
}

export const STUDENT_TOKEN_KEY = "sb.student.token";
