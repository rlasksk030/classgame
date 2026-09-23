import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// No React/DOM test harness exists in this repo (see tests/setup-page-*.test.ts:
// plain node:test, no jsdom/RTL). These assert the exact structural properties
// a live-reported answer leak depended on, via source inspection -- the same
// pattern already used elsewhere in this suite for React component logic.
//
// Live-reported bugs (both confirmed against practiceGenerator.ts/
// seedProblems.ts, where given.shownFrom and given.projections are always
// set from the exact same value as the correct answer):
// 1. CAMERA_DIRECTION ("이 그림은 어느 방향에서 본 모양?"): the reference
//    image's caption named the correct direction directly, and the
//    student's answer-selection state was seeded from the correct answer
//    on every problem load, pre-selecting the right choice.
// 2. PROJECTION_DRAW (lesson 3/12 "위·앞·옆에서 본 모양 그리기"): the
//    "함께 제시된 정보" evidence panel showed the exact correct grid for
//    every face the student was simultaneously asked to draw in an empty,
//    editable grid right next to it.

async function readLessonPageSource(): Promise<string> {
  return readFile(new URL("../src/pages/LessonPage.tsx", import.meta.url), "utf8");
}

test("CAMERA_DIRECTION reference caption never names the correct direction", async () => {
  const source = await readLessonPageSource();
  const block = source.match(/problem\.problemType === "CAMERA_DIRECTION" && problem\.given\.projections[\s\S]{0,900}/)?.[0];
  assert.ok(block, "the CAMERA_DIRECTION reference-image block must exist");
  assert.doesNotMatch(block!, /title=\{`\$\{DIRECTION_LABELS\[direction\]\}에서 본 모양`\}/, "the caption must not interpolate the answer direction's label");
  assert.match(block!, /title="제시된 모양"/);
});

test("directionValue starts unanswered (null), never seeded from the correct answer (given.shownFrom)", async () => {
  const source = await readLessonPageSource();
  assert.match(source, /useState<Direction \| null>\(null\)/, "directionValue must start as null, not a Direction default");
  const applyProblemBody = source.match(/const applyProblem = \(next: StudentProblem\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(applyProblemBody, "applyProblem must exist");
  assert.doesNotMatch(applyProblemBody!, /setDirectionValue\(\(next\.given\?\.shownFrom/, "must not seed the selection from the answer on problem load");
  assert.match(applyProblemBody!, /setDirectionValue\(null\);/);
});

test("CAMERA_DIRECTION submission is blocked (returns null, triggering the 답안을 완성해 주세요 message) until the student actually picks a direction", async () => {
  const source = await readLessonPageSource();
  const branch = source.match(/if \(current\.problemType === "CAMERA_DIRECTION"\) \{[\s\S]{0,150}/)?.[0];
  assert.ok(branch, "the CAMERA_DIRECTION submission branch must exist");
  assert.match(branch!, /if \(!directionValue\) return null;/);
});

test("renderEvidence never shows a PROJECTION_DRAW face the student is simultaneously asked to draw", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const renderEvidence = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "renderEvidence must exist");
  assert.match(fnBody!, /problem\.problemType === "PROJECTION_DRAW" \? new Set\(projectionFacesFor\(problem\)\) : new Set<string>\(\)/);
  assert.match(fnBody!, /evidence\.projections\?\.\[face\] && !drawnFaces\.has\(face\)/);
});

test("renderEvidence's '함께 제시된 정보' card never names the answer direction (CAMERA_DIRECTION uses the same shared card)", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const renderEvidence = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "renderEvidence must exist");
  assert.doesNotMatch(fnBody!, /위에서 본 조건|앞에서 본 조건|옆에서 본 조건|뒤에서 본 조건|왼쪽에서 본 조건|오른쪽에서 본 조건/, "no direction-named condition caption may leak the answer");
  assert.match(fnBody!, /faces\.map\(face => <ProjectionGrid key=\{face\} title="제시된 조건"/, "the per-face condition caption must be neutralized to 제시된 조건");
});

test("the legitimate post-attempt answer-reveal panel is untouched and still names the direction/faces", async () => {
  const source = await readLessonPageSource();
  const revealBlock = source.match(/\{attempt\.answerRevealed[\s\S]{0,1400}/)?.[0];
  assert.ok(revealBlock, "the answerRevealed reveal panel must still exist");
  assert.match(revealBlock!, /정답 방향: \{DIRECTION_LABELS\[/);
  assert.match(revealBlock!, /정답 · 위에서 본 모양/);
  assert.match(revealBlock!, /정답 · 앞에서 본 모양/);
  assert.match(revealBlock!, /정답 · 옆에서 본 모양/);
});

test("the answer-choice buttons render from the shared DIRECTIONS list and select only on the exact clicked value", async () => {
  const source = await readLessonPageSource();
  const buttonBlock = source.match(/DIRECTIONS\.map\(\(dir\) => \([\s\S]{0,300}/)?.[0];
  assert.ok(buttonBlock, "the CAMERA_DIRECTION answer buttons must exist");
  assert.match(buttonBlock!, /directionValue === dir \? "btn-primary" : ""/);
  assert.match(buttonBlock!, /onClick=\{\(\) => setDirectionValue\(normalizeDirection\(dir\)\)\}/);
});

// Full-audit finding (CHOICE type, used across many lessons): choiceIndex
// defaulted to 0, so option 1's button always rendered as btn-primary
// ("selected") on a fresh problem, and CHOICE's submission branch had no
// null-guard, so clicking 정답 확인 with nothing picked silently submitted
// index 0 instead of blocking with "답안을 완성해 주세요.". Same class of
// bug as the CAMERA_DIRECTION fix above, now fixed the same way.
test("choiceIndex starts unanswered (null), never defaults to option 0 as pre-selected", async () => {
  const source = await readLessonPageSource();
  assert.match(source, /const \[choiceIndex, setChoiceIndex\] = useState<number \| null>\(null\);/);
  const applyProblemBody = source.match(/const applyProblem = \(next: StudentProblem\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(applyProblemBody, "applyProblem must exist");
  assert.match(applyProblemBody!, /setChoiceIndex\(null\);/);
  assert.doesNotMatch(applyProblemBody!, /setChoiceIndex\(0\);/, "must not reset to a default selected option");
});

test("CHOICE submission is blocked until the student actually picks an option", async () => {
  const source = await readLessonPageSource();
  const branch = source.match(/if \(current\.problemType === "CHOICE"\) \{[\s\S]{0,150}/)?.[0];
  assert.ok(branch, "the CHOICE submission branch must exist");
  assert.match(branch!, /if \(choiceIndex === null\) return null;/);
});

test("BLOCK_POSITION submission still requires both a picked block and a resolved choice index", async () => {
  const source = await readLessonPageSource();
  const branch = source.match(/if \(current\.problemType === "BLOCK_POSITION"\) \{[\s\S]{0,150}/)?.[0];
  assert.ok(branch, "the BLOCK_POSITION submission branch must exist");
  assert.match(branch!, /if \(!blockPositionPicked \|\| choiceIndex === null\) return null;/);
});

test("the CHOICE answer buttons only highlight the exact clicked option, never a default", async () => {
  const source = await readLessonPageSource();
  const buttonBlock = source.match(/problem\.choices\.map\(\(choice, index\) => \([\s\S]{0,300}/)?.[0];
  assert.ok(buttonBlock, "the CHOICE answer buttons must exist");
  assert.match(buttonBlock!, /choiceIndex === index \? "btn-primary" : ""/);
  assert.match(buttonBlock!, /onClick=\{\(\) => setChoiceIndex\(index\)\}/);
});

// Information-overexposure audit finding: practiceGenerator.ts's lesson-4/8/12
// branches set given.heightMap/given.layers to the exact same value as
// answer.heightMap/answer.layers for HEIGHTMAP_FROM_BUILD/LAYER_DRAW problems
// (the generator's `given` object is shared across every mode in that
// lesson's branch, unconditionally). Same leak class as the CAMERA_DIRECTION/
// PROJECTION_DRAW bugs above, fixed the same way: never seed the editable
// grid, and never show it in the "함께 제시된 정보" evidence card, for the
// type the student is being asked to produce that exact data for.
test("HEIGHTMAP_FROM_BUILD never seeds the editable height map from given.heightMap (student must produce it, not read it off)", async () => {
  const source = await readLessonPageSource();
  const applyProblemBody = source.match(/const applyProblem = \(next: StudentProblem\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(applyProblemBody, "applyProblem must exist");
  assert.match(applyProblemBody!, /const clearHeightMapAnswer = next\.problemType === "HEIGHTMAP_FROM_BUILD";/);
  assert.match(applyProblemBody!, /setHeightMap\(!clearHeightMapAnswer && next\.given\?\.heightMap/);
});

test("renderEvidence hides the heightMap/layers reference card for HEIGHTMAP_FROM_BUILD/LAYER_DRAW -- showing it would display the exact answer next to the empty box asking the student to reproduce it", async () => {
  const source = await readLessonPageSource();
  const fnBody = source.match(/const renderEvidence = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "renderEvidence must exist");
  assert.match(fnBody!, /const hideHeightMap = problem\.problemType === "HEIGHTMAP_FROM_BUILD";/);
  assert.match(fnBody!, /const hideLayers = problem\.problemType === "LAYER_DRAW";/);
  assert.match(fnBody!, /evidence\.heightMap && !hideHeightMap &&/);
  assert.match(fnBody!, /!hideLayers && evidence\.layers\?\.map/);
});
