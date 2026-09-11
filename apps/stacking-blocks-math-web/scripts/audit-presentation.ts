import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { generatePracticeProblems } from "../shared/practiceGenerator.ts";
import { validateProblemPresentation } from "../shared/problemPresentation.ts";

const problems = [
  ...SEED_PROBLEMS.map(problem => ({ ...problem })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 12].flatMap(lesson => Array.from({ length: 100 }, (_, seed) => generatePracticeProblems(lesson, lesson === 12 ? 20 : 15, seed + 1)).flat()),
];
const failures: string[] = [];
for (const problem of problems) {
  const errors = validateProblemPresentation(problem);
  if (errors.length) failures.push(`${problem.code}: ${errors.join(", ")}`);
}

if (failures.length) {
  console.error(`문제 presentation 감사 실패: ${failures.length}건`);
  failures.slice(0, 30).forEach(error => console.error(`  ✗ ${error}`));
  process.exit(1);
}
console.log(`문제 presentation 감사 통과: ${problems.length}개 (기본 ${SEED_PROBLEMS.length} + 생성 ${problems.length - SEED_PROBLEMS.length})`);
