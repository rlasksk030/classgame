import test from "node:test";
import assert from "node:assert/strict";

import { classifyClassCreateError } from "../src/lib/classCreateErrors.ts";

const apiError = (code: string, status: number) => ({ code, status, message: "server response" });

test("학급 생성 실패를 인증·권한·검증·서버 코드로 분류한다", () => {
  assert.equal(classifyClassCreateError(apiError("TEACHER_AUTH", 401)).code, "CLASS_CREATE_AUTH");
  assert.equal(classifyClassCreateError(apiError("FORBIDDEN_CLASS", 403)).code, "CLASS_CREATE_PERMISSION");
  assert.equal(classifyClassCreateError(apiError("BAD_PARAM", 400)).code, "CLASS_CREATE_VALIDATION");
  assert.equal(classifyClassCreateError(apiError("CLASS_CREATE_FAIL", 500)).code, "CLASS_CREATE_SERVER");
  assert.equal(classifyClassCreateError(new Error("Supabase 설정이 없습니다.")).code, "CLASS_CREATE_NETWORK");
});
