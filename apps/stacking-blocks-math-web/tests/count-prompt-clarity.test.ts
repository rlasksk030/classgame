import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generatePracticeProblems } from "../shared/practiceGenerator.ts";
import { generateValidatedPracticeSet } from "../shared/practiceSet.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";

// A COUNT/COUNT_AMBIGUOUS problem's answer UI is a single numeric input
// (src/pages/LessonPage.tsx). Its prompt must therefore clearly ask for a
// number -- a prompt ending in "확인해 보세요"/"비교해 보세요" with no
// numeric cue leaves the student unable to tell what to type. This was
// reported live for lesson 1's generated practice mode 5, and an audit
// (grepping for the same vague-phrasing class across every COUNT/
// COUNT_AMBIGUOUS prompt in both the seed curriculum and the generator)
// additionally found lesson 12 modes 2/4/6 falling through to base()'s
// generic non-numeric default prompt entirely.

const NUMERIC_CUE = /몇\s*개|개수를|개인가요|개일까요|얼마|구해 보세요|구하세요/;

test("A. lesson 1's generated mode-5 problem now asks clearly for a number, matching its COUNT answer type", () => {
  const problems = generatePracticeProblems(1, 6, 0, 2); // v2 so modes map 1:1 to i
  const modeFive = problems[5];
  assert.equal(modeFive.problemType, "COUNT");
  assert.match(modeFive.prompt, /몇\s*개인가요/);
  assert.match(modeFive.prompt, NUMERIC_CUE);
  assert.doesNotMatch(modeFive.prompt, /^자리별로 센 수와 층별로 센 수가 같은지 확인해 보세요\.$/, "the old ambiguous prompt must be gone");
});

test("A2. the shared COUNT/COUNT_AMBIGUOUS numeric input's placeholder is clearly numeric, not the generic '정답을 입력'", async () => {
  const page = await readFile(new URL("../src/pages/LessonPage.tsx", import.meta.url), "utf8");
  const countBlock = page.match(/if \(problem\.problemType === "COUNT" \|\| problem\.problemType === "COUNT_AMBIGUOUS"\) \{\s*\n\s*return \([\s\S]*?\n {4}\}/)?.[0];
  assert.ok(countBlock, "COUNT/COUNT_AMBIGUOUS answer block not found");
  assert.match(countBlock!, /placeholder="전체 개수"/);
  assert.doesNotMatch(countBlock!, /placeholder="정답을 입력"/);
});

test("B. every seed-curriculum COUNT problem's prompt already contains a clear numeric-question cue (audited, none needed changing)", () => {
  const countProblems = SEED_PROBLEMS.filter((p) => p.problemType === "COUNT" || p.problemType === "COUNT_AMBIGUOUS");
  assert.ok(countProblems.length > 0, "sanity: seed data has COUNT problems");
  for (const p of countProblems) {
    assert.match(p.prompt, NUMERIC_CUE, `L${p.lesson} "${p.title}" prompt lacks a numeric-question cue: "${p.prompt}"`);
  }
});

test("B2. every generated-practice COUNT/COUNT_AMBIGUOUS prompt a real student can actually receive contains a clear numeric-question cue", () => {
  // generateValidatedPracticeSet is the real, guarded entry point 선택 연습
  // actually calls (shared/practiceSet.ts); it explicitly rejects lessons
  // 9/10/11 (PRACTICE_SET_UNSUPPORTED -- they use a separate peer-challenge/
  // project content path, contentProblem(), never this generator's raw
  // fallback branch), so auditing through it -- rather than calling
  // generatePracticeProblems() directly with an arbitrary version -- matches
  // exactly what a student can be shown, and correctly excludes the raw
  // version=2 fallback branch for 9/10/11 that no real caller ever reaches.
  for (const lesson of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
    const problems = generateValidatedPracticeSet(lesson, 20, 17);
    for (const p of problems) {
      if (p.problemType !== "COUNT" && p.problemType !== "COUNT_AMBIGUOUS") continue;
      assert.match(p.prompt, NUMERIC_CUE, `L${lesson} ${p.code} (${p.problemType}) prompt lacks a numeric-question cue: "${p.prompt}"`);
    }
  }
});

test("B3. lesson 9/10/11's real content path (contentProblem, peer-challenge/project) never goes through this generator's generic COUNT fallback -- generateValidatedPracticeSet correctly rejects them instead of silently serving the vague default prompt", () => {
  for (const lesson of [9, 10, 11]) {
    assert.throws(() => generateValidatedPracticeSet(lesson, 5, 17), /PRACTICE_SET_UNSUPPORTED/);
  }
});

test("C. answer.kind and problem UI stay in the established grading contract -- COUNT/COUNT_AMBIGUOUS both map to submission.kind 'count' (shared/grading.ts), unchanged by this fix", async () => {
  const grading = await readFile(new URL("../shared/grading.ts", import.meta.url), "utf8");
  assert.match(grading, /COUNT:\s*"count"/);
  assert.match(grading, /COUNT_AMBIGUOUS:\s*"count"/);
});

test("D. the fixed problems' actual answer values are unchanged -- only prompt/placeholder wording changed, not grading", () => {
  const l1 = generatePracticeProblems(1, 6, 0, 2)[5];
  assert.equal(l1.answer.kind, "count");
  if (l1.answer.kind === "count") assert.equal(l1.answer.value, l1.givenBlocks.length, "mode 5's answer is still the total block count, untouched");

  const l12 = generatePracticeProblems(12, 8, 0, 2);
  const modeTwo = l12[2];
  const modeFour = l12[4];
  const modeSix = l12[6];
  assert.equal(modeTwo.problemType, "COUNT");
  assert.equal(modeFour.problemType, "COUNT");
  assert.equal(modeSix.problemType, "COUNT_AMBIGUOUS");
  for (const p of [modeTwo, modeFour, modeSix]) {
    assert.equal(p.answer.kind, "count");
    if (p.answer.kind === "count") assert.equal(p.answer.value, p.givenBlocks.length);
    assert.match(p.prompt, /전체 개수는 몇 개인지 구해 보세요\./);
  }
});
