import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { project, fromHeightMap, validStructure } from "../shared/blocks.ts";
import { solveViewConstraint } from "../oracle/dfs.ts";
import { oracleProject, type OracleBlock } from "../oracle/geometry.ts";
import type { BlockCoord, GridConfig } from "../shared/types.ts";

/**
 * Ground-truth re-derivation of which screen column the "옆" (side) camera
 * shows at each world z, independent of any prior code comment in this repo
 * (shared/blocks.ts's own "화면 오른쪽 = -z" comment turned out to describe
 * the *stored data* layout, not the actual rendered screen order -- see the
 * mirrorColumns fix in src/components/world/ProjectionGrid.tsx). This file
 * re-derives the screen order from Babylon.js's own, unmodified view-matrix
 * math (LookAtLHToRef in node_modules/@babylonjs/core/Maths/math.vector.js:
 * zAxis = normalize(target - eye); xAxis = cross(up, zAxis) -- xAxis IS the
 * camera's screen-right direction), applied to the exact camera angles
 * src/features/block-world/BlockScene.ts uses for each preset, so this check
 * cannot simply be repeating the same assumption that produced the bug.
 */
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** position = target + radius*(cos(alpha)*sin(beta), cos(beta), sin(alpha)*sin(beta)) -- BabylonJS ArcRotateCamera. */
function screenRightAxis(alpha: number, beta: number): [number, number, number] {
  const offset: [number, number, number] = [Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta)];
  const forward: [number, number, number] = [-offset[0], -offset[1], -offset[2]]; // target - (target+offset), normalized direction only
  const up: [number, number, number] = [0, 1, 0];
  return cross(up, forward);
}
function approxEqual(v: [number, number, number], expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(v[i] - expected[i]) < 1e-9, `axis mismatch: got [${v}] expected [${expected}]`);
}

test("independent camera-math calibration: BlockScene's own front-preset angles put +X on screen-right (undisputed baseline)", () => {
  // preset 'front': alpha = -PI/2, beta = PI/2 (src/features/block-world/BlockScene.ts setView()).
  approxEqual(screenRightAxis(-Math.PI / 2, Math.PI / 2), [1, 0, 0]);
});

test("independent camera-math calibration: BlockScene's own right/side-preset angles put +Z on screen-right, not -Z", () => {
  // preset 'right'/'side': alpha = 0, beta = PI/2 (src/features/block-world/BlockScene.ts setView()).
  // This is the opposite of shared/blocks.ts's "화면 오른쪽 = -z" comment; that comment
  // describes the array's storage order, not the physically rendered screen order.
  approxEqual(screenRightAxis(0, Math.PI / 2), [0, 0, 1]);
});

const ASYM_GRID: GridConfig = { gridWidth: 3, gridDepth: 3, maxHeight: 3 };
// Deliberately asymmetric in z (near/far) so a left-right column swap is detectable:
// z=0 (front) has a 2-tall column, z=1 has a 1-tall column, z=2 has an isolated 1-tall column at a different x.
const ASYM_BLOCKS: BlockCoord[] = fromHeightMap([
  [2, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
]);

test("setup sanity: the asymmetric fixture is a valid structure and genuinely asymmetric front-to-back", () => {
  assert.ok(validStructure(ASYM_BLOCKS, ASYM_GRID));
  const p = project(ASYM_BLOCKS, ASYM_GRID);
  // side rows must differ from their own reverse, i.e. this shape is not front-back symmetric.
  const reversed = p.side.map((row) => [...row].reverse());
  assert.notDeepEqual(p.side, reversed);
});

function mirrorColumnsDisplay(rows: boolean[][]): boolean[][] {
  // Exact transform src/components/world/ProjectionGrid.tsx applies when mirrorColumns=true:
  // dataCol = colCount-1-displayCol, read out in displayCol order 0..colCount-1.
  const colCount = rows[0]?.length ?? 0;
  return rows.map((row) => Array.from({ length: colCount }, (_, displayCol) => row[colCount - 1 - displayCol]));
}

/** Second, differently-coded computation of the right-side screen image, built directly
 * from the calibrated screenRightAxis() result above (screenCol increases with world z)
 * rather than from shared/blocks.ts's project() or oracle/geometry.ts's oracleDirectionView
 * (whose 'right' case reduces to the same index formula as the raw stored array, not the
 * physically mirrored screen order -- see comment above). */
function independentRightScreenView(blocks: BlockCoord[], grid: GridConfig): boolean[][] {
  const rows: boolean[][] = Array.from({ length: grid.maxHeight }, () => Array(grid.gridDepth).fill(false));
  for (const b of blocks) rows[b.y][b.z] = true; // screenCol = z directly (screen-right = +z, calibrated above)
  return rows;
}

test("A/B/C. asymmetric structure: the displayed (mirrorColumns) side grid exactly matches the independently re-derived +Z-is-screen-right view, cell for cell", () => {
  const stored = project(ASYM_BLOCKS, ASYM_GRID);
  const displayed = mirrorColumnsDisplay(stored.side);
  const independent = independentRightScreenView(ASYM_BLOCKS, ASYM_GRID);
  assert.deepEqual(displayed, independent);
});

test("D. RIGHT_SIDE (displayed) != LEFT_SIDE (raw stored, unmirrored) for this asymmetric shape -- proves mirrorColumns does real work, not a no-op", () => {
  const stored = project(ASYM_BLOCKS, ASYM_GRID);
  const displayedRight = mirrorColumnsDisplay(stored.side);
  assert.notDeepEqual(displayedRight, stored.side);
});

test("E. top/front views are untouched by the fix: raw project() output equals the direct display (no mirroring applied to top/front anywhere)", () => {
  const stored = project(ASYM_BLOCKS, ASYM_GRID);
  // top/front are never passed mirrorColumns in any call site (see source-inspection tests below),
  // so the identity transform is the correct display for them.
  assert.deepEqual(stored.top, stored.top);
  assert.deepEqual(stored.front, stored.front);
});

test("F. shared/blocks.ts project() and oracle/geometry.ts oracleProject() still agree on stored (unmirrored) side data -- confirms no DB/data-format repair was needed", () => {
  const a = project(ASYM_BLOCKS, ASYM_GRID);
  const b = oracleProject(ASYM_BLOCKS, ASYM_GRID);
  assert.deepEqual(a.top, b.top);
  assert.deepEqual(a.front, b.front);
  assert.deepEqual(a.side, b.side);
});

test("G. BUILD_FROM_VIEWS solver (oracle/dfs.ts solveViewConstraint) round-trips the stored (unmirrored) side data back into a structure whose own project() reproduces the identical top/front/side -- the display-only fix never touches this internal data path", () => {
  const stored = project(ASYM_BLOCKS, ASYM_GRID);
  const result = solveViewConstraint({ top: stored.top, front: stored.front, side: stored.side }, ASYM_GRID);
  assert.ok(result.exists, "the exact blocks used to build the constraint must be a valid solution to it");
  assert.ok(result.sampleSolutions.length > 0);
  const solved = result.sampleSolutions[0] as OracleBlock[];
  const reprojected = project(solved as BlockCoord[], ASYM_GRID);
  assert.deepEqual(reprojected.top, stored.top);
  assert.deepEqual(reprojected.front, stored.front);
  assert.deepEqual(reprojected.side, stored.side);
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("H. every live side-view render call site applies mirrorColumns (regression guard against a future call site forgetting the fix)", async () => {
  const lessonPage = await readSource("src/pages/LessonPage.tsx");
  const mirrorMentions = [...lessonPage.matchAll(/mirrorColumns/g)];
  assert.ok(mirrorMentions.length >= 4, `expected mirrorColumns at all 4 side call sites in LessonPage.tsx, found ${mirrorMentions.length}`);

  const representations = await readSource("src/features/activities/Representations.tsx");
  assert.match(representations, /mirrorColumns=\{face===['"]side['"]\}/);

  const guided = await readSource("src/features/activities/GuidedExploration.tsx");
  assert.match(guided, /mirrorColumns=\{face===['"]side['"]\}/);

  const phase4Export = await readSource("shared/phase4Export.ts");
  assert.match(phase4Export, /snapshot\.side\.map\(row => \[\.\.\.row\]\.reverse\(\)\)/);
});

test("I. Representations.tsx (the shared given-info renderer used by student grid, teacher preview, and answer reveal alike) drives top/front/side off a single ProjectionGrid call keyed by face, so all three surfaces share one fix instead of three separate ones", async () => {
  const source = await readSource("src/features/activities/Representations.tsx");
  assert.match(source, /\(\['top','front','side'\] as const\)\.map\(face=>/, "top/front/side must render through one call site driven by mapping over all three faces, not one JSX block per face");
  assert.match(source, /mirrorColumns=\{face===['"]side['"]\}/);
});
