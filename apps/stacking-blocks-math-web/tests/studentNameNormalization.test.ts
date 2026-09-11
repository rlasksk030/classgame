import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClassCode, normalizeStudentName } from "../supabase/functions/_shared/security.ts";

test("학생 이름과 반 코드는 저장·로그인에 같은 정규화 규칙을 사용한다", () => {
  assert.equal(normalizeStudentName("  Ｋｉｍ　 나나  "), "Kim 나나");
  assert.equal(normalizeStudentName("김  나나"), "김 나나");
  assert.equal(normalizeClassCode("  k7p4qx "), "K7P4QX");
});
