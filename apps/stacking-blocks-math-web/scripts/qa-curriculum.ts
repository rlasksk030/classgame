import { LESSONS } from "../shared/lessons.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { generatePracticeProblems, getProblemTemplates } from "../shared/practiceGenerator.ts";
import { deriveProblemPresentation, validateProblemPresentation } from "../shared/problemPresentation.ts";
import { answerRendererFor } from "../shared/answerUi.ts";

const failures: string[] = [];
const fail = (message: string) => failures.push(message);
const routes = new Set([
  "/", "/world", "/world/rewards", "/lesson/:lesson", "/lesson/:lesson/project", "/lesson/9",
  "/teacher", "/teacher/worksheet-import", "/teacher/problems/new", "/teacher/problem-preview",
]);

for (const lesson of LESSONS) {
  const route = lesson.lesson === 9 ? "/lesson/9" : lesson.mode === "project" ? "/lesson/:lesson/project" : "/lesson/:lesson";
  if (!routes.has(route)) fail(`L${lesson.lesson}: route 누락`);
  if (lesson.mode === "problems") {
    const builtIns = SEED_PROBLEMS.filter(problem => problem.lesson === lesson.lesson);
    const templates = getProblemTemplates(lesson.lesson);
    if (!builtIns.length) fail(`L${lesson.lesson}: 기본 문제 없음`);
    const stages = new Set(builtIns.map(problem => problem.orderIndex <= 1 ? "concept" : problem.orderIndex === 2 ? "check" : "more"));
    for (const stage of ["concept", "check", "more"]) if (!stages.has(stage)) fail(`L${lesson.lesson}: ${stage} 단계 문제 없음`);
    if (!templates.length) fail(`L${lesson.lesson}: practice template 없음`);
    const generated = generatePracticeProblems(lesson.lesson, Math.max(15, templates.length), 17);
    if (!generated.length) fail(`L${lesson.lesson}: practice 생성 실패`);
    for (const problem of [...builtIns, ...generated]) {
      const errors = validateProblemPresentation(problem);
      if (errors.length) fail(`${problem.code}: ${errors.join(", ")}`);
      const presentation = deriveProblemPresentation(problem);
      if (!answerRendererFor(presentation.answerInput)) fail(`${problem.code}: 답안 Renderer 없음`);
    }
  }
}

if (!routes.has("/teacher/problem-preview")) fail("교사용 문제 미리보기 route 누락");
if (SEED_PROBLEMS.filter(problem => problem.lesson === 12).length === 0) fail("L12: 종합 문제 없음");

if (failures.length) {
  console.error(`curriculum QA 실패: ${failures.length}건`);
  failures.slice(0, 30).forEach(message => console.error(`  ✗ ${message}`));
  process.exit(1);
}
console.log(`curriculum QA 통과: ${LESSONS.length}차시 route, 문제 단계, Renderer 계약 확인`);
