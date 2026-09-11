import { serviceClient } from "../_shared/db.ts";
import { fail, handlePreflight, ok, readJson, text } from "../_shared/http.ts";
import {
  hashPin,
  isValidPinFormat,
  issueSessionToken,
  PIN_LOCK_MINUTES,
  PIN_MAX_FAILED_ATTEMPTS,
} from "../_shared/security.ts";

/**
 * 학생 로그인 (명세 5, 8).
 *
 * 학생은 Supabase Auth 회원이 아니다.
 * 접속 링크(?class=XXXX)로 학급이 정해지고, 이름 + 4자리 PIN 으로만 들어온다.
 * 학생에게 Supabase URL 이나 키를 입력시키지 않는다.
 */

interface StudentRow {
  id: string;
  class_id: string;
  name: string;
  student_no: number | null;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  status: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST 로만 호출할 수 있습니다.");

  let db;
  try {
    db = serviceClient();
  } catch (error) {
    return fail(500, "CONFIG", error instanceof Error ? error.message : "설정 오류");
  }

  const body = await readJson(req);
  const action = text(body.action, 30) || "login";
  const classCode = text(body.classCode, 12).toUpperCase();

  if (!classCode) return fail(400, "CLASS_REQUIRED", "반 접속 코드가 없습니다. 선생님이 주신 링크로 들어와 주세요.");

  const { data: klass } = await db
    .from("sb_classes")
    .select("id, name")
    .eq("class_code", classCode)
    .maybeSingle();

  if (!klass) {
    return fail(404, "CLASS_NOT_FOUND", "반을 찾지 못했어요. 선생님이 주신 링크가 맞는지 확인해 주세요.");
  }

  // --- 반 정보만 확인 (로그인 화면 제목 표시용) ---
  if (action === "class") {
    return ok({ classId: klass.id, className: klass.name });
  }

  if (action !== "login") return fail(400, "BAD_ACTION", "알 수 없는 요청입니다.");

  const name = text(body.name, 30);
  const pin = text(body.pin, 8);
  const studentNo = Number.isFinite(Number(body.studentNo)) ? Number(body.studentNo) : null;

  if (!name) return fail(400, "NAME_REQUIRED", "이름을 입력해 주세요.");
  if (!isValidPinFormat(pin)) return fail(400, "PIN_FORMAT", "PIN 은 숫자 4자리예요.");

  // 동명이인이 있을 수 있으므로 같은 이름을 모두 찾는다 (명세 5).
  let query = db
    .from("sb_students")
    .select("id, class_id, name, student_no, pin_hash, failed_attempts, locked_until, status")
    .eq("class_id", klass.id)
    .eq("name", name);
  if (studentNo !== null) query = query.eq("student_no", studentNo);

  const { data: rows } = await query;
  const candidates = (rows ?? []) as StudentRow[];

  if (candidates.length === 0) {
    return fail(404, "STUDENT_NOT_FOUND", "이름을 찾지 못했어요. 선생님께 확인해 주세요.");
  }

  if (candidates.length > 1) {
    // 번호를 함께 물어본다. 이름 외의 개인정보는 돌려주지 않는다.
    return ok({
      needStudentNo: true,
      className: klass.name,
      options: candidates
        .map((c) => c.student_no)
        .filter((n): n is number => typeof n === "number")
        .sort((a, b) => a - b),
    });
  }

  const student = candidates[0];

  if (student.status !== "active") {
    return fail(403, "STUDENT_DISABLED", "지금은 이 계정을 쓸 수 없어요. 선생님께 말씀해 주세요.");
  }

  if (student.locked_until && new Date(student.locked_until).getTime() > Date.now()) {
    return fail(
      423,
      "LOCKED",
      `PIN 을 여러 번 틀려서 잠시 잠겼어요. ${PIN_LOCK_MINUTES}분 뒤에 다시 해 보세요.`,
    );
  }

  const expected = await hashPin(student.id, pin);
  if (expected !== student.pin_hash) {
    const failedAttempts = student.failed_attempts + 1;
    const locked = failedAttempts >= PIN_MAX_FAILED_ATTEMPTS;

    await db
      .from("sb_students")
      .update({
        failed_attempts: locked ? PIN_MAX_FAILED_ATTEMPTS : failedAttempts,
        locked_until: locked
          ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString()
          : null,
      })
      .eq("id", student.id);

    if (locked) {
      return fail(
        423,
        "LOCKED",
        `PIN 을 ${PIN_MAX_FAILED_ATTEMPTS}번 틀려서 잠시 잠겼어요. ${PIN_LOCK_MINUTES}분 뒤에 다시 해 보세요.`,
      );
    }
    return fail(
      401,
      "PIN_MISMATCH",
      `PIN 이 맞지 않아요. (${PIN_MAX_FAILED_ATTEMPTS - failedAttempts}번 더 틀리면 잠깁니다)`,
    );
  }

  // 성공 - 실패 기록을 지우고 세션을 발급한다.
  await db
    .from("sb_students")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", student.id);

  const { token, tokenHash, payload } = await issueSessionToken(student.id, student.class_id);

  await db.from("sb_student_sessions").insert({
    student_id: student.id,
    class_id: student.class_id,
    token_hash: tokenHash,
    expires_at: payload.exp,
  });

  // 만료된 세션은 여기서 조금씩 정리한다.
  await db
    .from("sb_student_sessions")
    .delete()
    .lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // 보상 행이 없으면 만들어 둔다.
  await db
    .from("sb_student_rewards")
    .upsert({ student_id: student.id }, { onConflict: "student_id", ignoreDuplicates: true });

  return ok({
    token,
    expiresAt: payload.exp,
    student: {
      id: student.id,
      name: student.name,
      studentNo: student.student_no,
      classId: student.class_id,
      className: klass.name,
    },
  });
});
