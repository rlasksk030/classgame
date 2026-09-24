import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { synthesizeBuildFromViewsGhost } from "../shared/buildAnswerReveal.ts";
import { oracleProject, oracleIsValidStructure, type OracleBlock } from "../oracle/geometry.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";

// Global 3D answer reveal (all build types, not per-lesson).

function findSeed(code: string) {
  const row = SEED_PROBLEMS.find((p) => p.code === code);
  assert.ok(row, `seed problem ${code} must exist`);
  return row!;
}

for (const code of ["L6-01", "L6-02"]) {
  test(`A/C. synthesizeBuildFromViewsGhost finds a real witness for the actual shipped ${code} curriculum data, and it satisfies gravity + the exact given projections`, () => {
    const row = findSeed(code);
    const projections = (row.given as { projections: { top?: boolean[][]; front?: boolean[][]; side?: boolean[][] } }).projections;
    const ghost = synthesizeBuildFromViewsGhost(projections, row.grid);
    assert.ok(ghost, "a witness structure must be found for real curriculum data");
    assert.ok(ghost!.length > 0);
    assert.equal(oracleIsValidStructure(ghost as OracleBlock[], row.grid), true, "witness must respect gravity/grid bounds");
    const reprojected = oracleProject(ghost as OracleBlock[], row.grid);
    if (projections.top) assert.deepEqual(reprojected.top, projections.top, "witness top view must exactly match the given top projection");
    if (projections.front) assert.deepEqual(reprojected.front, projections.front, "witness front view must exactly match the given front projection");
    if (projections.side) assert.deepEqual(reprojected.side, projections.side, "witness side view must exactly match the given side projection");
  });
}

test("an unsatisfiable projection triple (contradiction) returns null instead of throwing", () => {
  const grid = { gridWidth: 2, gridDepth: 2, maxHeight: 2 };
  // top says column (0,0) is empty, front says every column in row 0 is filled -- contradiction.
  const ghost = synthesizeBuildFromViewsGhost(
    { top: [[false, false], [false, false]], front: [[true, true], [false, false]] },
    grid,
  );
  assert.equal(ghost, null);
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("edge: buildRevealedAnswer synthesizes a blocks ghost for BUILD_FROM_VIEWS specifically, and only that type -- PROJECTION_DRAW (same answer.kind) keeps its existing 2D-only reveal", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const branch = edge.match(/if \(row\.answer\.kind === "projections"\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(branch, "projections branch of buildRevealedAnswer must exist");
  assert.match(branch!, /if \(row\.problemType === "BUILD_FROM_VIEWS"\) \{/);
  assert.match(branch!, /synthesizeBuildFromViewsGhost\(/);
  assert.doesNotMatch(branch!, /row\.problemType === "PROJECTION_DRAW"/, "must not special-case PROJECTION_DRAW into getting a 3D ghost");
});

test("client: answerGhost is populated generically from revealedAnswer.blocks with no per-lesson/per-type branching -- BUILD_FROM_VIEWS gets the ghost automatically once the server sends blocks", async () => {
  const page = await readSource("../src/pages/LessonPage.tsx");
  assert.match(page, /answerGhost=\{answerVisible \? \(attempt\.revealedAnswer\?\.blocks \?\? result\?\.revealedAnswer\?\.blocks\) : undefined\}/);
});

test("D. editing (undo/redo/reset/save + BlockWorld's own edit toolbar via disabled) is locked while the answer ghost is visible for any build type, and unlocked otherwise -- generic on isBuildType + answerRevealed + answerVisible, no lesson number involved", async () => {
  const page = await readSource("../src/pages/LessonPage.tsx");
  assert.match(page, /const answerLocked = isBuildType\(problem\.problemType\) && attempt\.answerRevealed && answerVisible;/);
  assert.match(page, /onClick=\{doUndo\} disabled=\{!canUndo \|\| answerLocked\}/);
  assert.match(page, /onClick=\{doRedo\} disabled=\{!canRedo \|\| answerLocked\}/);
  assert.match(page, /onClick=\{doReset\} disabled=\{answerLocked\}/);
  assert.match(page, /onClick=\{\(\) => void flushSnapshot\(\)\} disabled=\{restoring \|\| answerLocked\}/);
  assert.match(page, /disabled=\{restoring \|\| attempt\.completed \|\| !isBuildType\(problem\.problemType\) \|\| answerLocked\}/, "BlockWorld's own disabled prop must also respect answerLocked");
});

test("camera rotation/view presets stay independent of answerLocked -- allowRotate is only driven by restrictedView, never touched by the reveal lock", async () => {
  const page = await readSource("../src/pages/LessonPage.tsx");
  const blockWorldProps = page.match(/<BlockWorld\b[\s\S]*?\/>/)?.[0];
  assert.ok(blockWorldProps);
  assert.match(blockWorldProps!, /allowRotate=\{!restrictedView\}/);
  assert.doesNotMatch(blockWorldProps!, /allowRotate=\{[^}]*answerLocked/, "camera must not be locked, only editing");
});

test("E/G. retryAfterReveal hides the panel (answerVisible=false, which alone clears answerLocked back to false) and resets to the problem's canonical start state -- never touches wrongCount/answerRevealed eligibility", async () => {
  const page = await readSource("../src/pages/LessonPage.tsx");
  const fnBody = page.match(/const retryAfterReveal = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody);
  assert.match(fnBody!, /setAnswerVisible\(false\)/);
  assert.match(fnBody!, /setBlocksWithHistory\(problem\.startBlocks\)/, "build types restore the problem's own canonical start_blocks, not an empty literal");
  assert.doesNotMatch(fnBody!, /setBlocksWithHistory\(\[\]\)/, "must never hardcode an empty reset -- must come from problem.startBlocks");
  assert.doesNotMatch(fnBody!, /setAttempt\(/, "must never touch server-tracked attempt state (wrongCount/answerRevealed)");
});

test("I. BLOCK_POSITION is confirmed NOT a blocks-answer build type (submission/answer kind is choice, per shared/grading.ts) -- it is correctly excluded from isBuildType and keeps its existing choice-based reveal; no reference-block handling was needed for this feature", async () => {
  const grading = await readSource("../shared/grading.ts");
  assert.match(grading, /BLOCK_POSITION[^\n]*choice/i);
  const page = await readSource("../src/pages/LessonPage.tsx");
  const isBuildTypeFn = page.match(/function isBuildType\(problemType: ProblemType\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(isBuildTypeFn);
  assert.doesNotMatch(isBuildTypeFn!, /BLOCK_POSITION/);
});

test("J. every other answer.kind branch in buildRevealedAnswer is untouched by this change (count/direction/choice/heightMap/layers regression guard)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const fnBody = edge.match(/function buildRevealedAnswer\([\s\S]*?\n\}/)?.[0];
  assert.ok(fnBody);
  assert.match(fnBody!, /if \(row\.answer\.kind === "count"\) \{/);
  assert.match(fnBody!, /if \(row\.answer\.kind === "direction"\) \{/);
  assert.match(fnBody!, /if \(row\.answer\.kind === "choice"\) \{/);
  assert.match(fnBody!, /if \(row\.answer\.kind === "heightMap"\) \{/);
  assert.match(fnBody!, /if \(row\.answer\.kind === "layers"\) \{/);
});
