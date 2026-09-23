import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Phase 3A-3C of the student UX audit: the "선택 연습" (stage 'more') pool can
// hold 15-24 problems depending on teacher settings, but the UI used to show
// that raw pool size as if it were a required n/n target ("③ 더 풀어보기
// 1 / 21"), and the button/label vocabulary for the same "extra practice"
// concept had drifted across three near-synonyms ("더 풀어보기", "새 문제 더
// 풀기", "추가활동"). These assert the structural fix via source inspection --
// same pattern as the rest of this suite (no jsdom/RTL harness in this repo).

async function readLessonPageSource(): Promise<string> {
  return readFile(new URL("../src/pages/LessonPage.tsx", import.meta.url), "utf8");
}

test("stage 'more' progress is chunked into groups of 5, not the raw pool size (which can be 15-24)", async () => {
  const source = await readLessonPageSource();
  assert.match(source, /const PRACTICE_BATCH_SIZE = 5;/);
  assert.match(
    source,
    /currentStage === "more" \? `\$\{\(Math\.max\(0, stageIndex\) % PRACTICE_BATCH_SIZE\) \+ 1\} \/ \$\{PRACTICE_BATCH_SIZE\}` : `\$\{Math\.max\(1, stageIndex \+ 1\)\} \/ \$\{Math\.max\(1, stageProblems\.length\)\}`/,
    "stage 'more' must show a 1-5 chunk; concept/check must keep their real n/n (required progress)",
  );
});

test("the '① N문제 · ② N문제 · ③ N문제' summary line no longer exposes ③'s raw pool size", async () => {
  const source = await readLessonPageSource();
  assert.doesNotMatch(source, /③ \{problems\.filter\(item=>item\.stage==='more'\)\.length\}문제/, "the raw 선택 연습 pool count must not be shown to students");
  assert.match(source, /③ 선택 연습\{requiredComplete\?' · 이용 가능':''\}/);
});

test("no raw practiceSet bank-size breakdown (기본 추가활동/배정 연습/현재 연습 counts) is shown to students", async () => {
  const source = await readLessonPageSource();
  assert.doesNotMatch(source, /기본 추가활동 \{practiceSet\.supplementalCount\}개/, "supplementalCount/targetCount/generatedCount must not be rendered as student-visible numbers");
});

test("extra-practice button labels are unified: 틀린 문제 다시 풀기 / 유사 문제 풀기 / 5문제 더 풀기 -- no lingering 더 풀어보기/새 문제 더 풀기 synonyms", async () => {
  const source = await readLessonPageSource();
  assert.match(source, /틀린 문제 다시 풀기\{wrongProblemIds\.length/);
  assert.match(source, />유사 문제 풀기<\/button>/);
  assert.match(source, />5문제 더 풀기<\/button>/);
  assert.doesNotMatch(source, /새 문제 더 풀기/);
  assert.doesNotMatch(source, /③ 더 풀어보기/, "the stage-3 tab must use the unified 선택 연습 label");
});

test("the evidence card is titled '제시된 정보' (not '함께 제시된 정보'), and the height-map reference caption is '숫자 지도' (not '표시된 숫자 지도')", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const renderEvidence = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "renderEvidence must exist");
  assert.match(fnBody!, /<strong>제시된 정보<\/strong>/);
  assert.doesNotMatch(fnBody!, /함께 제시된 정보/);
  assert.match(fnBody!, /title="숫자 지도"/);
  assert.doesNotMatch(fnBody!, /표시된 숫자 지도/);
});
