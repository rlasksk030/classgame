export type ClassCreateErrorCode =
  | "CLASS_CREATE_AUTH"
  | "CLASS_CREATE_PERMISSION"
  | "CLASS_CREATE_VALIDATION"
  | "CLASS_CREATE_NETWORK"
  | "CLASS_CREATE_SERVER";

export function classifyClassCreateError(error: unknown): { code: ClassCreateErrorCode; message: string } {
  const value = error as { code?: string; message?: string } | null;
  const code = value?.code?.toUpperCase() ?? "";
  const message = value?.message?.toLowerCase() ?? "";
  if (code === "TEACHER_AUTH" || code === "UNAUTHORIZED") return { code: "CLASS_CREATE_AUTH", message: "교사 인증 세션이 없습니다. 다시 로그인해 주세요." };
  if (code === "FORBIDDEN_CLASS" || code === "FORBIDDEN") return { code: "CLASS_CREATE_PERMISSION", message: "이 교사 계정으로 학급을 만들 권한이 없습니다." };
  if (code === "BAD_PARAM" || code === "VALIDATION") return { code: "CLASS_CREATE_VALIDATION", message: "학급 이름을 확인해 주세요." };
  if (code === "CLASS_CREATE_FAIL" || code === "DUPLICATE") return { code: "CLASS_CREATE_SERVER", message: "서버에서 학급 저장을 거부했습니다. 잠시 뒤 다시 시도해 주세요." };
  if (code === "SUPABASE_CONFIG_ERROR" || message.includes("supabase 설정") || error instanceof TypeError || code === "NETWORK") return { code: "CLASS_CREATE_NETWORK", message: "Supabase 서버에 연결하지 못했습니다. 연결 설정과 네트워크를 확인해 주세요." };
  return { code: "CLASS_CREATE_SERVER", message: "학급을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
}
