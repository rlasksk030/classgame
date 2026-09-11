/**
 * 시드 문제 점검 스크립트.
 * 문제에 적어 둔 정답이 실제 모양에서 계산한 값과 맞는지 확인한다.
 *   node --experimental-strip-types scripts/verify-seed.ts
 */
import { canonicalize, countBlocks, project, settle, toHeightMap, toLayers } from "../shared/blocks.ts";
import { grade } from "../shared/grading.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { LESSONS } from "../shared/lessons.ts";

let failures = 0;
const fail = (code: string, msg: string) => {
  failures++;
  console.error(`  ✗ ${code}: ${msg}`);
};

for (const p of SEED_PROBLEMS) {
  const { grid, givenBlocks, answer, code } = p;

  // 모든 모양은 물리 규칙(공중에 뜬 블록 없음)을 지켜야 한다.
  if (canonicalize(givenBlocks).length !== settle(givenBlocks, grid).length) {
    fail(code, "보여 주는 모양에 공중에 뜬 쌓기나무가 있습니다.");
  }
  for (const b of givenBlocks) {
    if (b.x >= grid.gridWidth || b.z >= grid.gridDepth || b.y >= grid.maxHeight) {
      fail(code, `블록 (${b.x},${b.y},${b.z}) 이 작업판 밖입니다.`);
    }
  }

  // 개수 정답은 실제 개수와 일치해야 한다 (규칙 찾기 문제는 예외).
  if (answer.kind === "count" && givenBlocks.length > 0 && p.problemType !== "FREE_BUILD") {
    const target = p.given.countOf ?? "total";
    if (target === "total") {
      const actual = countBlocks(givenBlocks);
      if (answer.value !== actual) fail(code, `전체 개수 정답 ${answer.value} ≠ 실제 ${actual}`);
    } else if (target === "layer") {
      const layer = p.given.countLayer ?? 1;
      const actual = givenBlocks.filter((b) => b.y === layer - 1).length;
      if (answer.value !== actual) fail(code, `${layer}층 개수 정답 ${answer.value} ≠ 실제 ${actual}`);
    }
    // pattern 은 규칙 추론 값이라 모양에서 계산하지 않는다.
  }

  // 투영·층별·숫자지도 정답은 모양에서 계산한 값과 같아야 한다.
  if (answer.kind === "projections" && givenBlocks.length > 0) {
    const actual = project(givenBlocks, grid);
    for (const face of ["top", "front", "side"] as const) {
      const want = answer.projections[face];
      if (!want) continue;
      if (JSON.stringify(want) !== JSON.stringify(actual[face])) {
        fail(code, `${face} 투영이 모양과 다릅니다.`);
      }
    }
  }
  if (answer.kind === "heightMap" && givenBlocks.length > 0) {
    if (JSON.stringify(answer.heightMap) !== JSON.stringify(toHeightMap(givenBlocks, grid))) {
      fail(code, "숫자 지도 정답이 모양과 다릅니다.");
    }
  }
  if (answer.kind === "layers" && givenBlocks.length > 0) {
    if (JSON.stringify(answer.layers) !== JSON.stringify(toLayers(givenBlocks, grid))) {
      fail(code, "층별 정답이 모양과 다릅니다.");
    }
  }

  // 정답을 그대로 제출하면 반드시 정답 처리되어야 한다.
  const submission =
    answer.kind === "count"
      ? ({ kind: "count", value: answer.value } as const)
      : answer.kind === "blocks"
        ? ({ kind: "blocks", blocks: answer.blocks } as const)
        : answer.kind === "direction"
          ? ({ kind: "direction", value: answer.value } as const)
          : answer.kind === "choice"
            ? ({ kind: "choice", index: answer.index } as const)
            : answer.kind === "heightMap"
              ? ({ kind: "heightMap", heightMap: answer.heightMap } as const)
              : answer.kind === "layers"
                ? ({ kind: "layers", layers: answer.layers } as const)
                : ({ kind: "projections", projections: answer.projections } as const);

  // 조건 만족형 문제는 '조건을 만족하는 한 모양'으로 확인한다.
  const effective =
    p.gradingMode === "constraint" && p.problemType === "BUILD_FROM_VIEWS"
      ? ({ kind: "blocks", blocks: referenceShapeFor(code) } as const)
      : p.problemType === "FREE_BUILD"
        ? ({ kind: "blocks", blocks: makeFreeBuild(p.given.minBlocks ?? 1) } as const)
        : submission;

  const verdict = grade({
    problemType: p.problemType,
    gradingMode: p.gradingMode,
    answer,
    submission: effective,
    given: p.given,
    grid,
  });
  if (!verdict.correct) fail(code, `정답을 제출했는데 오답 처리됨 (${verdict.detail ?? "이유 없음"})`);
}

/** BUILD_FROM_VIEWS 문제의 조건을 만족하는 기준 모양. */
function referenceShapeFor(code: string) {
  const problem = SEED_PROBLEMS.find((p) => p.code === code)!;
  const proj = problem.given.projections;
  if (!proj?.top) return [];
  // 위에서 본 모양 자리에 앞·옆 조건이 허용하는 최대 높이로 쌓으면 조건을 만족한다.
  const blocks = [];
  for (let z = 0; z < problem.grid.gridDepth; z++) {
    for (let x = 0; x < problem.grid.gridWidth; x++) {
      if (!proj.top[z]?.[x]) continue;
      const frontMax = maxHeightIn(proj.front, x);
      const sideMax = maxHeightIn(proj.side, problem.grid.gridDepth - 1 - z);
      const h = Math.min(frontMax, sideMax);
      for (let y = 0; y < h; y++) blocks.push({ x, y, z });
    }
  }
  return blocks;
}

function maxHeightIn(grid: boolean[][] | undefined, col: number): number {
  if (!grid) return 99;
  let h = 0;
  for (let y = 0; y < grid.length; y++) if (grid[y]?.[col]) h = y + 1;
  return h;
}

function makeFreeBuild(n: number) {
  const blocks = [];
  for (let i = 0; i < n; i++) blocks.push({ x: i % 3, y: 0, z: Math.floor(i / 3) });
  return blocks;
}

// 차시별 문제 수 요약
console.log("차시별 기본 문제 수:");
for (const lesson of LESSONS) {
  const n = SEED_PROBLEMS.filter((p) => p.lesson === lesson.lesson).length;
  console.log(`  ${String(lesson.lesson).padStart(2)}차시 ${lesson.title} — ${n}문제 (${lesson.mode})`);
}

if (failures > 0) {
  console.error(`\n점검 실패 ${failures}건`);
  process.exit(1);
}
console.log(`\n점검 통과: 문제 ${SEED_PROBLEMS.length}개 모두 정합합니다.`);
