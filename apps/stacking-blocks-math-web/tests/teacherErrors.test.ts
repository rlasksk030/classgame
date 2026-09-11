import test from "node:test";
import assert from "node:assert/strict";

import { classifyTeacherError } from "../src/lib/teacherErrors.ts";

test("교사 Auth 오류를 원인별 코드로 분류한다", () => {
  assert.equal(classifyTeacherError({ code: "invalid_credentials", status: 400 }).code, "AUTH_INVALID_CREDENTIALS");
  assert.equal(classifyTeacherError({ code: "email_not_confirmed", status: 400 }).code, "AUTH_EMAIL_UNCONFIRMED");
  assert.equal(classifyTeacherError(new Error("Supabase 설정이 없습니다. /setup에서 설정해 주세요.")).code, "SUPABASE_CONFIG_ERROR");
  assert.equal(classifyTeacherError({ code: "teacher_profile_missing" }).code, "TEACHER_PROFILE_MISSING");
  assert.equal(classifyTeacherError({ code: "teacher_auth" }).code, "TEACHER_AUTH");
});
