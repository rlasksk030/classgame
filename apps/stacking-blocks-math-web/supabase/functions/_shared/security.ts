/**
 * 학생 세션 · PIN 보안.
 *
 * AI 면담실(GAS)의 방식을 그대로 옮겨 왔다.
 *   · PIN 은 서버 비밀키를 섞은 해시로만 대조한다.
 *   · 세션 토큰은 base64url(payload) + "." + 서명 형태다.
 *   · PIN 을 여러 번 틀리면 잠시 잠근다.
 *
 * 비밀키는 Supabase Secret 에만 있다:
 *   supabase secrets set APP_SESSION_SECRET=<충분히 긴 무작위 문자열>
 */

export const SESSION_HOURS = 12;
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 10;

export interface SessionPayload {
  /** student id */
  sid: string;
  /** class id */
  cid: string;
  /** 발급 시각 (ISO) */
  iat: string;
  /** 만료 시각 (ISO) */
  exp: string;
}

function requireSecret(): string {
  const secret = Deno.env.get("APP_SESSION_SECRET");
  if (!secret || secret.length < 16) {
    throw new Error(
      "APP_SESSION_SECRET 이 설정되지 않았습니다. supabase secrets set APP_SESSION_SECRET=... 을 실행하세요.",
    );
  }
  return secret;
}

const encoder = new TextEncoder();

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizePin(pin: unknown): string {
  const text = String(pin ?? "").replace(/\D/g, "");
  return text.slice(0, 4).padStart(4, "0");
}

/** 학생 이름은 저장·로그인 양쪽에서 같은 유니코드/공백 규칙을 사용한다. */
export function normalizeStudentName(name: unknown): string {
  return String(name ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/** URL·입력 방식에 관계없이 반 코드를 동일하게 비교한다. */
export function normalizeClassCode(classCode: unknown): string {
  return String(classCode ?? "").normalize("NFKC").trim().toUpperCase();
}

export function isValidPinFormat(pin: unknown): boolean {
  return /^\d{4}$/.test(String(pin ?? "").trim());
}

/** PIN 대조용 해시. 원문은 어디에도 남기지 않는다. */
export function hashPin(studentId: string, pin: string): Promise<string> {
  return hmacHex(`pin:v1:${studentId}:${normalizePin(pin)}`);
}

/** 4자리 PIN 을 만든다. 0000, 1234 같이 알아맞히기 쉬운 값은 피한다. */
export function generatePin(): string {
  const weak = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "0123"]);
  for (let i = 0; i < 50; i++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const pin = String(bytes[0] % 10000).padStart(4, "0");
    if (!weak.has(pin)) return pin;
  }
  return "8642";
}

function base64UrlEncode(text: string): string {
  return btoa(String.fromCharCode(...encoder.encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

export async function issueSessionToken(
  studentId: string,
  classId: string,
): Promise<{ token: string; tokenHash: string; payload: SessionPayload }> {
  const now = Date.now();
  const payload: SessionPayload = {
    sid: studentId,
    cid: classId,
    iat: new Date(now).toISOString(),
    exp: new Date(now + SESSION_HOURS * 60 * 60 * 1000).toISOString(),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacHex(`session:v1:${encoded}`);
  const token = `${encoded}.${signature}`;

  return { token, tokenHash: await hashToken(token), payload };
}

/** 표에는 토큰 원문이 아니라 해시를 저장한다. */
export function hashToken(token: string): Promise<string> {
  return hmacHex(`token:v1:${token}`);
}

/** 서명과 만료를 확인한다. 표에 남은 세션 확인은 호출하는 쪽에서 따로 한다. */
export async function verifySessionToken(token: unknown): Promise<SessionPayload | null> {
  const text = String(token ?? "").trim();
  const dot = text.indexOf(".");
  if (dot <= 0) return null;

  const encoded = text.slice(0, dot);
  const signature = text.slice(dot + 1);
  const expected = await hmacHex(`session:v1:${encoded}`);

  // 길이가 다르면 그대로 실패. 같으면 상수 시간 비교.
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;
    if (!payload.sid || !payload.cid || !payload.exp) return null;
    const expiry = new Date(payload.exp).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 학급 접속 코드. 헷갈리는 글자(O/0, I/1)를 뺐다. */
export function generateClassCode(length = 5): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/** 9차시 문제 공유 코드. */
export function generateShareCode(): string {
  return generateClassCode(6);
}
