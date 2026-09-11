/** 브라우저에 노출되어도 되는 설정값만 모아 둔다. */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/** 학생 접속 링크의 ?class=XXXX 값. */
export function classCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get("class") ?? "").trim().toUpperCase();
}

export const STUDENT_TOKEN_KEY = "sb.student.token";
