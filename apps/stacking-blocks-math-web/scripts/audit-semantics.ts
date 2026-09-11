/** 문제 문구·제공 자료·답안 형식의 의미 계약을 빠르게 전수 점검한다. */
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { generatePracticeProblems } from "../shared/practiceGenerator.ts";
import { validateProblemPresentation } from "../shared/problemPresentation.ts";

const problems = [
  ...SEED_PROBLEMS,
  ...[1, 2, 3, 4, 5, 6, 7, 8, 12].flatMap(lesson =>
    Array.from({ length: 20 }, (_, seed) => generatePracticeProblems(lesson, lesson === 12 ? 20 : 15, seed + 1)).flat(),
  ),
];
const failures: string[] = [];
for (const problem of problems) {
  const text = `${problem.title} ${problem.prompt}`;
  const answer = problem.answer.kind;
  const presentationErrors = validateProblemPresentation(problem);
  if (presentationErrors.length) failures.push(`${problem.code}: ${presentationErrors.join(", ")}`);
  if (/(격자에 .*그려|모양을 .*그려|표현을 .*그려|나타내 보세요)/.test(text) && !["projections", "heightMap", "layers"].includes(answer)) {
    failures.push(`${problem.code}: 그리기 문구와 답안 형식 불일치`);
  }
  if (/(몇 개|개수|몇개)/.test(text) && !["count", "blocks", "choice"].includes(answer)) {
    failures.push(`${problem.code}: 개수 문구와 답안 형식 불일치`);
  }
  if (/어느 방향/.test(text) && answer !== "direction") failures.push(`${problem.code}: 방향 문구와 선택 답안 불일치`);
  if (/층별 표현을 .*그려|층별 모양을 .*그려/.test(text) && answer !== "layers") failures.push(`${problem.code}: 층별 문구와 층별 답안 불일치`);
}
if (failures.length) {
  console.error(`semantic QA 실패: ${failures.length}건`);
  failures.slice(0, 40).forEach(item => console.error(`  ✗ ${item}`));
  process.exit(1);
}
console.log(`semantic QA 통과: ${problems.length}개 (문구·자료·답안 계약)`);
