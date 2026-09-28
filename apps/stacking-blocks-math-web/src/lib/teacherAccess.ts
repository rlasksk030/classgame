import { encodeInstallationConfig, projectRefFromUrl, validateRuntimeSupabaseConfig, type RuntimeSupabaseConfig } from "./config.ts";

const RETURN_KEY = "stacking-teacher-return";

/** Exact allowlist: no external URLs, query strings, fragments or encoded paths. */
export function safeTeacherReturnPath(value: unknown): "/teacher" | null {
  return value === "/teacher" ? "/teacher" : null;
}

export function rememberTeacherReturn(search: string): "/teacher" | null {
  const path = safeTeacherReturnPath(new URLSearchParams(search).get("returnTo"));
  try {
    if (path) sessionStorage.setItem(RETURN_KEY, path);
    return path ?? safeTeacherReturnPath(sessionStorage.getItem(RETURN_KEY));
  } catch { return path; }
}

export function clearTeacherReturn(): void {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* Storage may be unavailable. */ }
}

export function teacherInstallationLink(config: RuntimeSupabaseConfig, origin: string): string {
  const key = config.supabasePublishableKey;
  const projectRef = projectRefFromUrl(config.supabaseUrl);
  // A share link never exports an arbitrary token or a caller-supplied installation ID.
  if (!projectRef || !validateRuntimeSupabaseConfig(config) ||
      (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !key.startsWith("eyJ"))) return "";
  return `${origin}/teacher#install=${encodeInstallationConfig({
    installationId: projectRef,
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: key,
  })}`;
}
