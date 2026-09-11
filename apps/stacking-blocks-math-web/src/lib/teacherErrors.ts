export type TeacherErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_EMAIL_UNCONFIRMED"
  | "SUPABASE_CONFIG_ERROR"
  | "TEACHER_PROFILE_MISSING"
  | "TEACHER_BOOTSTRAP_ERROR"
  | "TEACHER_AUTH"
  | "SUPABASE_NETWORK_ERROR";

export interface TeacherErrorInfo {
  code: TeacherErrorCode;
  message: string;
}

/** Supabase Auth/Edge 오류를 화면에서 원인을 구분할 수 있는 코드로 바꾼다. */
export function classifyTeacherError(error: unknown): TeacherErrorInfo {
  const value = error as { code?: string; status?: number; message?: string } | null;
  const code = value?.code?.toLowerCase() ?? "";
  const message = value?.message?.toLowerCase() ?? "";
  if (code === "invalid_credentials" || value?.status === 400 && message.includes("invalid login")) {
    return { code: "AUTH_INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 맞지 않습니다." };
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed") || message.includes("이메일 확인")) {
    return { code: "AUTH_EMAIL_UNCONFIRMED", message: "이메일 확인이 끝나지 않은 계정입니다. Supabase Auth에서 이메일을 확인 처리해 주세요." };
  }
  if (code === "supabase_config_error" || message.includes("/setup") || message.includes("supabase 설정")) {
    return { code: "SUPABASE_CONFIG_ERROR", message: "Supabase 런타임 연결 설정이 없습니다. /setup에서 공개 URL과 Publishable Key를 등록해 주세요." };
  }
  if (code === "teacher_profile_missing") {
    return { code: "TEACHER_PROFILE_MISSING", message: "로그인은 성공했지만 교사 초기 설정이 없습니다. 먼저 학급을 만들어 주세요." };
  }
  if (code === "teacher_auth") {
    return { code: "TEACHER_AUTH", message: "교사 인증 세션이 없습니다. 다시 로그인해 주세요." };
  }
  if (code.startsWith("teacher:") || code.startsWith("class_") || code.startsWith("bootstrap")) {
    return { code: "TEACHER_BOOTSTRAP_ERROR", message: "교사 로그인은 되었지만 학급 초기 정보를 불러오지 못했습니다." };
  }
  if (error instanceof TypeError || message.includes("failed to fetch") || message.includes("network")) {
    return { code: "SUPABASE_NETWORK_ERROR", message: "Supabase 서버에 연결하지 못했습니다. 연결 주소와 네트워크를 확인해 주세요." };
  }
  return { code: "TEACHER_BOOTSTRAP_ERROR", message: "교사 초기 정보를 불러오지 못했습니다." };
}
