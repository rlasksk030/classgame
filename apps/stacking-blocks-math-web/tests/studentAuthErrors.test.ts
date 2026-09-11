import test from "node:test";
import assert from "node:assert/strict";

import { studentAuthErrorMessage } from "../src/lib/studentAuthErrors.ts";

test("학생 로그인 오류를 단계별 한국어 메시지로 분류한다", () => {
  assert.match(studentAuthErrorMessage({ code: "CLASS_NOT_FOUND" }), /반을 찾지/);
  assert.match(studentAuthErrorMessage({ code: "STUDENT_NOT_FOUND" }), /학생 이름을 찾지/);
  assert.match(studentAuthErrorMessage({ code: "PIN_INVALID" }), /PIN/);
  assert.match(studentAuthErrorMessage({ code: "STUDENT_INACTIVE" }), /사용할 수 없/);
  assert.match(studentAuthErrorMessage({ code: "STUDENT_AUTH_SERVER" }), /처리하지 못했/);
});
