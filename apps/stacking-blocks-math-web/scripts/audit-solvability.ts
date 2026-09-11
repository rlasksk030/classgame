/** 출제 전 실제 유효 구조와 정답 자료가 존재하는지 전수 점검한다. */
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { generatePracticeProblems, validateGeneratedProblem } from "../shared/practiceGenerator.ts";
import { validStructure } from "../shared/blocks.ts";
import type { SeedProblem } from "../shared/seedProblems.ts";

const problems: SeedProblem[] = [
  ...SEED_PROBLEMS,
  ...[1, 2, 3, 4, 5, 6, 7, 8, 12].flatMap(lesson =>
    Array.from({ length: 20 }, (_, seed) => generatePracticeProblems(lesson, lesson === 12 ? 20 : 15, seed + 1)).flat(),
  ),
];
const failures: string[] = [];
for (const problem of problems) {
  if (!validStructure(problem.givenBlocks, problem.grid) || !validStructure(problem.startBlocks, problem.grid)) failures.push(`${problem.code}: 주어진/시작 구조가 유효하지 않음`);
  if (!validateGeneratedProblem(problem)) failures.push(`${problem.code}: 생성 문제 계약 실패`);
  if (problem.answer.kind === "blocks" && !validStructure(problem.answer.blocks, problem.grid)) failures.push(`${problem.code}: 블록 정답 구조가 유효하지 않음`);
  if (problem.gradingMode === "constraint" && problem.answer.kind !== "blocks" && !(problem.answer.kind === "projections" && problem.given.projections)) failures.push(`${problem.code}: constraint 조건 자료가 없음`);
}
if (failures.length) {
  console.error(`solvability QA 실패: ${failures.length}건`);
  failures.slice(0, 40).forEach(item => console.error(`  ✗ ${item}`));
  process.exit(1);
}
console.log(`solvability QA 통과: ${problems.length}개 (유효 구조·정답 존재)`);
