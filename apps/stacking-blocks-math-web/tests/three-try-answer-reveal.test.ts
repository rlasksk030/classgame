import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyAttempt, INITIAL_ATTEMPT, type AttemptState } from "../shared/attempts.ts";

async function readLessonPageSource(): Promise<string> {
  return readFile(new URL("../src/pages/LessonPage.tsx", import.meta.url), "utf8");
}

// Live bug: "학생이 5번 이상 틀려도 정답이 나오지 않는 경우가 있다." Root-cause
// investigation (see the fix's commit message for the full trail): the OLD
// reveal condition was `if (prev.hintShown) { ...reveal... }`, a CHAIN that
// depended on hintShown having been set correctly on a prior call. The new
// condition computes reveal directly from wrongCount ("wrongCount >= 3"),
// so it can never get stuck regardless of what hintShown/answerRevealed were
// before -- this is the structural fix, verified exhaustively below across
// every wrongCount from 1 through 8 and both requiresRebuild branches (which
// is the only axis that changes applyAttempt's behavior across problem
// types: build types -- FREE_BUILD/BUILD_FROM_VIEWS/BUILD_FROM_HEIGHTMAP/
// BUILD_FROM_LAYERS -- pass true; every other type in the user's list --
// CHOICE/CAMERA_DIRECTION/PROJECTION_DRAW/HEIGHTMAP_FROM_BUILD/LAYER_DRAW/
// COUNT/BLOCK_POSITION/COUNT_AMBIGUOUS -- passes false).

function wrongNTimes(n: number, requiresRebuild: boolean): AttemptState {
  let state: AttemptState = INITIAL_ATTEMPT;
  for (let i = 0; i < n; i++) state = applyAttempt(state, false, requiresRebuild).state;
  return state;
}

for (const requiresRebuild of [false, true]) {
  const label = requiresRebuild ? "build types (FREE_BUILD/BUILD_FROM_VIEWS/BUILD_FROM_HEIGHTMAP/BUILD_FROM_LAYERS)" : "non-build types (CHOICE/CAMERA_DIRECTION/PROJECTION_DRAW/HEIGHTMAP_FROM_BUILD/LAYER_DRAW/COUNT/BLOCK_POSITION/COUNT_AMBIGUOUS)";

  test(`A. [${label}] 1st wrong: no hint, no answer`, () => {
    const out = applyAttempt(INITIAL_ATTEMPT, false, requiresRebuild);
    assert.equal(out.state.wrongCount, 1);
    assert.equal(out.sendHint, false, "no hint on the 1st wrong");
    assert.equal(out.sendAnswer, false, "no answer on the 1st wrong");
    assert.equal(out.state.answerRevealed, false);
  });

  test(`B. [${label}] 2nd wrong: hint shown, still no answer`, () => {
    const prev = wrongNTimes(1, requiresRebuild);
    const out = applyAttempt(prev, false, requiresRebuild);
    assert.equal(out.state.wrongCount, 2);
    assert.equal(out.sendHint, true, "hint must appear on the 2nd wrong (not the 3rd)");
    assert.equal(out.sendAnswer, false, "answer must NOT appear yet on the 2nd wrong");
    assert.equal(out.state.answerRevealed, false);
  });

  test(`C. [${label}] 3rd wrong: answer revealed`, () => {
    const prev = wrongNTimes(2, requiresRebuild);
    const out = applyAttempt(prev, false, requiresRebuild);
    assert.equal(out.state.wrongCount, 3);
    assert.equal(out.sendAnswer, true, "answer must appear on the 3rd wrong");
    assert.equal(out.state.answerRevealed, true);
  });

  test(`E/F/G. [${label}] 4th through 8th wrong: answer keeps reappearing every time, never regresses to hint-only or no-answer`, () => {
    let state = wrongNTimes(3, requiresRebuild);
    for (let wrongCount = 4; wrongCount <= 8; wrongCount++) {
      const out = applyAttempt(state, false, requiresRebuild);
      assert.equal(out.state.wrongCount, wrongCount);
      assert.equal(out.sendAnswer, true, `wrong #${wrongCount} must still send the answer`);
      assert.equal(out.state.answerRevealed, true, `wrong #${wrongCount} must keep answerRevealed=true`);
      // The bug class this fix removes: hintShown must never fall back to
      // false while wrongCount keeps climbing past 3.
      assert.equal(out.state.hintShown, true, `wrong #${wrongCount} must keep hintShown=true`);
      state = out.state;
    }
  });

  test(`H. [${label}] submitting the correct answer completes the problem, from any prior wrong-count depth`, () => {
    for (const priorWrongs of [0, 1, 2, 3, 5, 8]) {
      const prev = wrongNTimes(priorWrongs, requiresRebuild);
      const out = applyAttempt(prev, true, requiresRebuild);
      assert.equal(out.state.completed, true, `correct after ${priorWrongs} prior wrongs must complete`);
      assert.equal(out.action, "complete");
    }
  });

  test(`[${label}] once answerRevealed, submitting correct still requires the student's own correct submission -- viewing the answer alone never sets completed`, () => {
    const revealed = wrongNTimes(4, requiresRebuild);
    assert.equal(revealed.completed, false, "revealing the answer must not itself complete the problem");
  });
}

test("wrongCount never resets except via a fresh INITIAL_ATTEMPT (a new problem) -- applyAttempt itself never decreases or zeroes it", () => {
  let state: AttemptState = INITIAL_ATTEMPT;
  for (let i = 0; i < 10; i++) {
    const before = state.wrongCount;
    state = applyAttempt(state, false, i % 2 === 0).state;
    assert.ok(state.wrongCount > before, "wrongCount must strictly increase on every wrong submission");
  }
});

test("the reveal decision is computed directly from wrongCount, not from a hintShown/answerRevealed chain -- an artificially desynced state (hintShown=false but wrongCount already 3) still reveals immediately, which is exactly the structural bug class this fix removes", () => {
  const desynced: AttemptState = { wrongCount: 2, hintShown: false, answerRevealed: false, completed: false };
  const out = applyAttempt(desynced, false, false);
  assert.equal(out.state.wrongCount, 3);
  assert.equal(out.sendAnswer, true, "must reveal on this very call, not need one more wrong to 'catch up' the chain");
  assert.equal(out.state.answerRevealed, true);
});

// D, I, J are client-side (LessonPage.tsx) state-separation requirements --
// asserted via source inspection, same pattern as the rest of this suite.

test("D. [다시 풀어 보기] (retryAfterReveal) hides the panel and resets the student's input, but never touches attempt/wrongCount/hintShown/answerRevealed", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const retryAfterReveal = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "retryAfterReveal must exist");
  assert.match(fnBody!, /setAnswerVisible\(false\)/, "must hide the reveal panel");
  assert.doesNotMatch(fnBody!, /setAttempt\(/, "must never touch attempt state (wrongCount/hintShown/answerRevealed stay exactly as-is)");
  // Resets input for every problem-type family the user's checklist named.
  assert.match(fnBody!, /setBlocksWithHistory\(problem\.startBlocks\)/, "build types: blocks reset");
  assert.match(fnBody!, /setChoiceIndex\(null\)/, "CHOICE/BLOCK_POSITION: choice reset");
  assert.match(fnBody!, /setDirectionValue\(null\)/, "CAMERA_DIRECTION: direction reset");
  assert.match(fnBody!, /setCountInput\(""\)/, "COUNT/COUNT_AMBIGUOUS: numeric input reset");
  assert.match(fnBody!, /setTopMap\(emptyGridFor\(problem, "top"\)\)/, "PROJECTION_DRAW: grid reset");
  assert.match(fnBody!, /setHeightMap\(emptyGridFor\(problem, "heightMap"\)/, "HEIGHTMAP_FROM_BUILD: grid reset");
  assert.match(fnBody!, /setLayerMaps\(\(prev\) => prev\.map/, "LAYER_DRAW: grid reset");
});

test("D2. the reveal panel and the 3D answer-ghost overlay both respect answerVisible (hidden by 다시 풀어 보기, not just attempt.answerRevealed)", async () => {
  const source = await readLessonPageSource();
  assert.match(source, /\{attempt\.answerRevealed && answerVisible && <div className="panel">/, "the panel must require both eligibility AND local visibility");
  assert.match(source, /answerGhost=\{answerVisible \? \(attempt\.revealedAnswer\?\.blocks \?\? result\?\.revealedAnswer\?\.blocks\) : undefined\}/, "the 3D ghost must hide along with the panel, not just the text");
});

test("E-continued. any wrong submission that re-sends revealedAnswer (wrongCount>=3, every time per shared/attempts.ts) flips answerVisible back to true, so a hidden panel reappears on the very next wrong try", async () => {
  const source = await readLessonPageSource();
  const submitBody = source.match(/const submit = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(submitBody, "submit must exist");
  assert.match(submitBody!, /if \(response\.grade\.revealedAnswer != null\) setAnswerVisible\(true\);/);
});

test("I. a NEW problem (applyProblem) fully resets attempt to DEFAULT_ATTEMPT_STATE (wrongCount=0) and answerVisible=true -- this is the ONLY place wrongCount may reset", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const applyProblem = \(next: StudentProblem\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "applyProblem must exist");
  assert.match(fnBody!, /setAttempt\(DEFAULT_ATTEMPT_STATE\);/);
  assert.match(fnBody!, /setAnswerVisible\(true\);/);
});

test("J. reloading/relogging into the SAME problem restores wrongCount/hintShown/answerRevealed from the server response (restoreProblemState), never from DEFAULT_ATTEMPT_STATE -- accumulated wrong-answer state survives a refresh", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const restoreProblemState = useCallback\(\s*async \(next: StudentProblem\) => \{[\s\S]*?\n {4}\},/)?.[0];
  assert.ok(fnBody, "restoreProblemState must exist");
  assert.match(fnBody!, /wrongCount: envelope\.attempt\.wrongCount,/);
  assert.match(fnBody!, /answerRevealed: envelope\.attempt\.answerRevealed,/);
  assert.doesNotMatch(fnBody!, /setAttempt\(DEFAULT_ATTEMPT_STATE\)/, "must restore from the server, not reset to default, on a reload of the same problem");
});
