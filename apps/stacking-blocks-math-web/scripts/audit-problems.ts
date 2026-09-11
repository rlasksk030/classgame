/**
 * 기본 문제와 결정적 연습 문제를 좌표 데이터 기준으로 전수 감사한다.
 *   npm run audit:problems
 */
import { grid2DEqual, heightMapEqual, project, toHeightMap, toLayers, validStructure } from "../shared/blocks.ts";
import { grade } from "../shared/grading.ts";
import { SEED_PROBLEMS, type SeedProblem } from "../shared/seedProblems.ts";
import { generatePracticeProblems, getProblemTemplates, validateGeneratedProblem } from "../shared/practiceGenerator.ts";
import { equivalentDirections, projectionForDirection } from "../shared/spatialConventions.ts";
import type { Grid2D } from "../shared/types.ts";

const AUDIT_SEEDS = 100;
const AUDIT_LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 12];
let failures = 0;
let ambiguous = 0;
const fail = (label: string, detail: string) => { failures += 1; console.error(`  ✗ ${label}: ${detail}`); };

function sameLayers(a: Grid2D[], b: Grid2D[]) {
  return a.length === b.length && a.every((layer, index) => grid2DEqual(layer, b[index]));
}

function answerSubmission(problem: SeedProblem) {
  const answer = problem.answer;
  if (answer.kind === "blocks") return { kind: "blocks", blocks: answer.blocks } as const;
  if (answer.kind === "count") return { kind: "count", value: answer.value } as const;
  if (answer.kind === "direction") return { kind: "direction", value: answer.value } as const;
  if (answer.kind === "choice") return { kind: "choice", index: answer.index } as const;
  if (answer.kind === "projections") return { kind: "projections", projections: answer.projections } as const;
  if (answer.kind === "heightMap") return { kind: "heightMap", heightMap: answer.heightMap } as const;
  return { kind: "layers", layers: answer.layers } as const;
}

function auditProblem(problem: SeedProblem, label: string) {
  const { grid, givenBlocks, answer, given } = problem;
  if (!validStructure(givenBlocks, grid) || !validStructure(problem.startBlocks, grid)) fail(label, "블록이 작업판 범위를 벗어나거나 공중에 떠 있습니다.");
  if (!validateGeneratedProblem({ grid, givenBlocks, startBlocks: problem.startBlocks, answer, gradingMode: problem.gradingMode, problemType: problem.problemType, given })) fail(label, "문제 유형과 정답 자료의 구조가 맞지 않습니다.");

  const actual = project(givenBlocks, grid);
  if (givenBlocks.length > 0 && given.heightMap && !heightMapEqual(given.heightMap, toHeightMap(givenBlocks, grid))) fail(label, "제시된 숫자 지도가 모양과 다릅니다.");
  if (givenBlocks.length > 0 && given.layers && !sameLayers(given.layers, toLayers(givenBlocks, grid))) fail(label, "제시된 층별 표현이 모양과 다릅니다.");

  if (problem.problemType === "CAMERA_DIRECTION" && answer.kind === "direction") {
    const face = answer.value === "top" ? "top" : answer.value === "front" || answer.value === "back" ? "front" : "side";
    const shown = given.projections?.[face];
    const expected = projectionForDirection(givenBlocks, grid, answer.value);
    if (!shown || !grid2DEqual(shown, expected)) fail(label, `${answer.value} 방향 투영이 모양과 다릅니다.`);
    const matches = equivalentDirections(givenBlocks, grid, answer.value);
    if (matches.length !== 1) { ambiguous += 1; fail(label, `단일 정답 방향이 아닙니다 (${matches.join(", ")}).`); }
  }
  if (answer.kind === "projections" && givenBlocks.length > 0) {
    for (const face of ["top", "front", "side"] as const) if (answer.projections[face] && !grid2DEqual(answer.projections[face], actual[face])) fail(label, `${face} 투영 정답이 모양과 다릅니다.`);
  }
  if (answer.kind === "heightMap" && givenBlocks.length > 0 && !heightMapEqual(answer.heightMap, toHeightMap(givenBlocks, grid))) fail(label, "숫자 지도 정답이 모양과 다릅니다.");
  if (answer.kind === "layers" && givenBlocks.length > 0 && !sameLayers(answer.layers, toLayers(givenBlocks, grid))) fail(label, "층별 정답이 모양과 다릅니다.");

  // 자유 쌓기를 제외하고는 정답 데이터 자체가 채점에서 정답이어야 한다.
  if (problem.problemType !== "FREE_BUILD" && problem.gradingMode !== "constraint") {
    const verdict = grade({ problemType: problem.problemType, gradingMode: problem.gradingMode, answer, submission: answerSubmission(problem), given, grid });
    if (!verdict.correct) fail(label, `정답 자료를 제출해도 오답 처리됩니다 (${verdict.detail ?? "이유 없음"}).`);
  }
}

const builtInByLesson = new Map<number, number>();
for (const problem of SEED_PROBLEMS) {
  builtInByLesson.set(problem.lesson, (builtInByLesson.get(problem.lesson) ?? 0) + 1);
  auditProblem(problem, problem.code);
}
console.log(`기본 문제: ${SEED_PROBLEMS.length}개 검사`);

let generatedCount = 0;
for (const lesson of AUDIT_LESSONS) {
  const templates = getProblemTemplates(lesson);
  let lessonCount = 0;
  for (let seed = 0; seed < AUDIT_SEEDS; seed += 1) {
    const generated = generatePracticeProblems(lesson, templates.length, seed);
    if (generated.length !== templates.length) fail(`L${lesson}/seed-${seed}`, `템플릿 ${templates.length}개 중 ${generated.length}개만 생성되었습니다.`);
    for (const problem of generated) {
      lessonCount += 1;
      generatedCount += 1;
      auditProblem(problem, `${problem.code}/seed-${seed}`);
    }
  }
  console.log(`Lesson ${lesson}: ${templates.length} templates × ${AUDIT_SEEDS} seeds = ${lessonCount}개`);
}

console.log(`생성 문제: ${generatedCount}개 검사, 애매한 방향 문제 ${ambiguous}개`);
if (failures > 0) {
  console.error(`\n문제 감사 실패: ${failures}건`);
  process.exit(1);
}
console.log("\n문제 감사 통과: 좌표·투영·정답·채점 자료가 모두 일치합니다.");
