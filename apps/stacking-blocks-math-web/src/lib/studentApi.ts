import { STUDENT_TOKEN_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * 학생용 API 호출기.
 *
 * 학생은 Supabase 표를 직접 읽지 않는다. 반드시 Edge Function 을 지나며,
 * 정답 원본은 서버 밖으로 나오지 않는다 (명세 8).
 */

export class StudentApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StudentApiError";
  }
}

function functionUrl(name: string): string {
  if (!SUPABASE_URL) throw new Error("Supabase 설정이 없습니다.");
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${name}`;
}

export function getStudentToken(): string | null {
  try {
    return localStorage.getItem(STUDENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStudentToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STUDENT_TOKEN_KEY, token);
    else localStorage.removeItem(STUDENT_TOKEN_KEY);
  } catch {
    // 사생활 보호 모드 등에서 저장이 막혀도 앱은 계속 동작해야 한다.
  }
}

async function callFunction<T>(
  name: string,
  body: Record<string, unknown>,
  withToken: boolean,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (SUPABASE_ANON_KEY) {
    headers.apikey = SUPABASE_ANON_KEY;
    headers.authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  if (withToken) {
    const token = getStudentToken();
    if (token) headers["x-student-token"] = token;
  }

  const response = await fetch(functionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code: string; message: string } }
    | T
    | null;

  if (!response.ok) {
    const err = (payload as { error?: { code: string; message: string } })?.error;
    throw new StudentApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? "요청을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.",
      response.status,
    );
  }

  return payload as T;
}

/** 반 접속 코드로 반 이름만 확인한다. */
export function fetchClassInfo(classCode: string) {
  return callFunction<{ classId: string; className: string }>(
    "student-auth",
    { action: "class", classCode },
    false,
  );
}

export interface LoginSuccess {
  token: string;
  expiresAt: string;
  student: {
    id: string;
    name: string;
    studentNo: number | null;
    classId: string;
    className: string;
  };
}

export interface LoginNeedsStudentNo {
  needStudentNo: true;
  className: string;
  options: number[];
}

export function loginStudent(params: {
  classCode: string;
  name: string;
  pin: string;
  studentNo?: number | null;
}) {
  return callFunction<LoginSuccess | LoginNeedsStudentNo>(
    "student-auth",
    { action: "login", ...params },
    false,
  );
}

/** 로그인 뒤의 모든 학생 요청은 이 함수를 지난다. */
export function studentRequest<T>(action: string, params: Record<string, unknown> = {}) {
  return callFunction<T>("student-api", { action, ...params }, true);
}
