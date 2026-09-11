/** 브라우저에 노출되어도 되는 설정값만 모아 둔다. */

// Vite에서는 import.meta.env가 주입되고, Node 단위 테스트에서는 비어 있을 수 있다.
const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
export const SUPABASE_URL = runtimeEnv.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY;

/** 배포판에서 표시·진단에 사용하는 앱 버전. package.json과 같은 SemVer를 유지한다. */
export const APP_VERSION = "1.0.0";
/** 마지막으로 저장소에 포함된 DB migration 버전. 원격 적용 여부와 별개로 앱 계약을 나타낸다. */
export const SCHEMA_VERSION = "202609110011";

export type AppEnvironment = "development" | "staging" | "production";

export interface AppConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  installationId?: string;
  environment: AppEnvironment;
}

export function getAppConfig(): AppConfig {
  const environment = (runtimeEnv.MODE ?? "development") as AppEnvironment;
  return {
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    installationId: runtimeEnv.VITE_INSTALLATION_ID,
    environment: ["development", "staging", "production"].includes(environment)
      ? environment
      : "development",
  };
}

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/** 학생 접속 링크의 ?class=XXXX 값. */
export function classCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get("class") ?? "").trim().toUpperCase();
}

export const STUDENT_TOKEN_KEY = "sb.student.token";
