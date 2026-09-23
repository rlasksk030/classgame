import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generatePracticeProblems } from "../shared/practiceGenerator.ts";

// Grade-6 language audit: student-facing prompts and teacher-facing labels
// should read as plain Korean a 6th grader (or a non-technical teacher) can
// follow -- no leaked developer/math-competition jargon ("반례"/counterexample,
// "seed", etc.). Internal identifiers (variable names, the `seed` parameter
// itself, generation determinism) are explicitly allowed to keep their
// technical names; only the *visible label/prompt text* changes.

test("no lesson-5 generated prompt uses '반례' (counterexample) -- rewritten to plain Korean asking for the actual total", async () => {
  // mode===7 in shared/contentBank.ts's lesson-5 branch was the one flagged
  // live: "...이 높이 지도의 반례는 모두 몇 개인지 구하세요."
  for (let index = 0; index < 8; index++) {
    const [problem] = generatePracticeProblems(5, index + 1, 123456).filter(p => p.orderIndex === 100 + index);
    assert.ok(problem, `lesson 5 mode ${index} must generate a problem`);
    assert.doesNotMatch(problem.prompt, /반례/, `lesson 5 mode ${index} prompt must not use "반례": "${problem.prompt}"`);
  }
});

test("the same problem number (seed) still reproduces the exact same generated problem -- the language fix must not touch generation determinism", async () => {
  const a = generatePracticeProblems(5, 8, 555).find(p => p.orderIndex === 107);
  const b = generatePracticeProblems(5, 8, 555).find(p => p.orderIndex === 107);
  assert.ok(a && b);
  assert.deepEqual(a, b, "identical (lesson, count, seed) must still produce an identical problem");
});

test("teacher problem-preview shows '문제 번호', not the raw developer term 'seed', as the visible label (internal seed state/variable name is unchanged)", async () => {
  const source = await readFile(new URL("../src/pages/TeacherProblemPreview.tsx", import.meta.url), "utf8");
  assert.match(source, /<label>문제 번호<input/, "the visible label must be 문제 번호");
  assert.doesNotMatch(source, /<label>seed</, "the old raw 'seed' label must be gone");
  // The internal state/variable still uses `seed` -- this is intentionally
  // preserved (see the audit's "internal seed 기능은 그대로 동작" requirement).
  assert.match(source, /const \[seed, setSeed\] = useState\(1\);/);
});
