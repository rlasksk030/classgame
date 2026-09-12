import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LESSONS } from "../shared/lessons.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { generatePracticeProblems, getProblemTemplates } from "../shared/practiceGenerator.ts";
import { deriveProblemPresentation } from "../shared/problemPresentation.ts";

type InventoryEntry = {
  lessonId: number;
  stage: string;
  problemId: string;
  sourceType: string;
  templateId?: string;
  generatorVersion?: number;
  problemVersion: string;
  questionIntent: string;
  evidence: string[];
  answerInput: string;
  gradingMode: string;
  revealMode: string;
  completion: string;
  route: string;
  status: "IMPLEMENTED" | "NOT_STARTED";
};

const routeFor = (lesson: number) => lesson === 9 ? "/lesson/9" : lesson === 10 || lesson === 11 ? `/lesson/${lesson}/project` : `/lesson/${lesson}`;
const answerInputFor = (problem: typeof SEED_PROBLEMS[number]) => deriveProblemPresentation(problem).answerInput;
const intentFor = (problem: typeof SEED_PROBLEMS[number]) => {
  if (problem.problemType === "CHOICE") return "선택지로 공간 정보의 충분성·관계를 판단";
  if (problem.problemType === "CAMERA_DIRECTION") return "관찰 방향을 선택";
  if (problem.problemType === "PROJECTION_DRAW") return "3D 모양을 방향별 격자로 표현";
  if (problem.problemType === "HEIGHTMAP_FROM_BUILD") return "3D 모양을 높이 지도로 표현";
  if (problem.problemType === "LAYER_DRAW") return "층별 모양을 격자로 표현";
  if (problem.problemType === "BUILD_FROM_VIEWS") return "조건을 만족하는 입체를 쌓기";
  if (problem.problemType === "BUILD_FROM_HEIGHTMAP") return "높이 지도로 입체를 쌓기";
  if (problem.problemType === "BUILD_FROM_LAYERS") return "층별 지도로 입체를 쌓기";
  return "쌓기나무 개수 또는 수를 구하기";
};
const evidenceFor = (problem: typeof SEED_PROBLEMS[number]) => {
  const given = problem.given;
  const evidence: string[] = [];
  if (given.projections?.top) evidence.push("topProjection");
  if (given.projections?.front) evidence.push("frontProjection");
  if (given.projections?.side) evidence.push("sideProjection(right-view)");
  if (given.heightMap) evidence.push("heightMap");
  if (given.layers?.length) evidence.push("layerMaps");
  if (givenBlocksPresent(problem)) evidence.push("3D model");
  return evidence;
};
const givenBlocksPresent = (problem: typeof SEED_PROBLEMS[number]) => problem.givenBlocks.length > 0;
const revealModeFor = (problem: typeof SEED_PROBLEMS[number]) => problem.answer.kind === "blocks" ? "3D Ghost + rebuild" : "answer-specific material";
const completionFor = (problem: typeof SEED_PROBLEMS[number]) => problem.answer.kind === "blocks" ? "조건에 맞는 구조를 직접 완성" : "답안을 맞혀 완료";

const fixed: InventoryEntry[] = SEED_PROBLEMS.map(problem => ({
  lessonId: problem.lesson,
  stage: problem.stage ?? (problem.orderIndex <= 1 ? "concept" : problem.orderIndex === 2 ? "check" : "more"),
  problemId: `seed:${problem.code}`,
  sourceType: problem.sourceType ?? (problem.orderIndex <= 2 ? "BUILT_IN_CONCEPT" : "BUILT_IN_WORKBOOK_STYLE"),
  templateId: problem.templateId,
  generatorVersion: problem.generatorVersion,
  problemVersion: "seed-v1",
  questionIntent: intentFor(problem),
  evidence: evidenceFor(problem),
  answerInput: answerInputFor(problem),
  gradingMode: problem.gradingMode,
  revealMode: revealModeFor(problem),
  completion: completionFor(problem),
  route: routeFor(problem.lesson),
  status: "IMPLEMENTED",
}));

const generated: InventoryEntry[] = [1, 2, 3, 4, 5, 6, 7, 8, 12].flatMap(lesson =>
  getProblemTemplates(lesson).map(template => {
    const problem = generatePracticeProblems(lesson, 20, 17).find(item => item.templateId === template.templateId);
    if (!problem) return { lessonId: lesson, stage: "more", problemId: `template:${template.templateId}`, sourceType: "GENERATED_PRACTICE", templateId: template.templateId, problemVersion: "generator-v1", questionIntent: "template representative unavailable", evidence: [], answerInput: "unknown", gradingMode: "unknown", revealMode: "unknown", completion: "unknown", route: routeFor(lesson), status: "NOT_STARTED" as const };
    return { lessonId: lesson, stage: "more", problemId: `template:${template.templateId}:seed:${problem.seed ?? 17}`, sourceType: "GENERATED_PRACTICE", templateId: template.templateId, generatorVersion: problem.generatorVersion, problemVersion: "generator-v1", questionIntent: intentFor(problem), evidence: evidenceFor(problem), answerInput: answerInputFor(problem), gradingMode: problem.gradingMode, revealMode: revealModeFor(problem), completion: completionFor(problem), route: routeFor(lesson), status: "IMPLEMENTED" as const };
  }),
);

const activities: InventoryEntry[] = [
  { lessonId: 9, stage: "activity", problemId: "activity:peer-challenge", sourceType: "PEER_CHALLENGE", problemVersion: "activity-v1", questionIntent: "10개로 만든 친구 문제를 선택한 방식으로 풀이", evidence: ["3D model", "challenge card", "hint card"], answerInput: "BLOCK_BUILD", gradingMode: "constraint", revealMode: "3D answer", completion: "친구 문제 조건을 만족하고 점수 저장", route: "/lesson/9", status: "IMPLEMENTED" },
  { lessonId: 10, stage: "activity", problemId: "activity:architecture-design", sourceType: "PROJECT", problemVersion: "activity-v1", questionIntent: "건축물 이름·이유·설명과 3층 구조 설계", evidence: ["10×10×3 Builder", "floor notes"], answerInput: "BLOCK_BUILD", gradingMode: "structure validation", revealMode: "3D preview", completion: "설계 저장", route: "/lesson/10/project", status: "IMPLEMENTED" },
  { lessonId: 11, stage: "activity", problemId: "activity:architecture-introduction", sourceType: "PROJECT", problemVersion: "activity-v1", questionIntent: "10차시 건축물을 소개서로 완성", evidence: ["3D preview", "top/front/side", "layer maps"], answerInput: "TEXT_AND_PREVIEW", gradingMode: "building validation", revealMode: "introduction sheet", completion: "소개서 완성", route: "/lesson/11/project", status: "IMPLEMENTED" },
  { lessonId: 12, stage: "activity", problemId: "activity:unit-review", sourceType: "REVIEW", problemVersion: "activity-v1", questionIntent: "개수·방향·투영·높이 지도·층별 표현 종합", evidence: ["mixed problem set", "self assessment"], answerInput: "MIXED", gradingMode: "per-problem", revealMode: "answer-specific material", completion: "단원 완료·별·XP·배지·자기평가", route: "/lesson/12", status: "IMPLEMENTED" },
  { lessonId: 0, stage: "teacher", problemId: "activity:teacher-problem-editor", sourceType: "TEACHER_CREATED", problemVersion: "activity-v1", questionIntent: "교사가 문제·정답·힌트를 직접 작성하고 3D 구조를 확정", evidence: ["teacher form", "Babylon.js Builder"], answerInput: "MIXED", gradingMode: "teacher configured", revealMode: "answer-specific material", completion: "문제은행 등록", route: "/teacher/problems/new", status: "IMPLEMENTED" },
  { lessonId: 0, stage: "teacher", problemId: "activity:worksheet-import", sourceType: "WORKSHEET_IMPORT", problemVersion: "activity-v1", questionIntent: "학습지 문제를 교사가 검토·수정한 뒤 등록", evidence: ["PDF/image preview", "manual crop", "review form"], answerInput: "MANUAL_REVIEW", gradingMode: "teacher configured", revealMode: "answer-specific material", completion: "검토 후 문제은행 등록", route: "/teacher/worksheet-import", status: "IMPLEMENTED" },
];

const assignmentManifest = [1, 2, 3, 4, 5, 6, 7, 8, 12].flatMap(lesson => {
  const count = lesson === 12 ? 20 : 15;
  return generatePracticeProblems(lesson, count, 17).map((problem, index) => ({
    lessonId: lesson,
    stage: "more",
    problemId: problem.code,
    templateId: problem.templateId,
    seed: problem.seed,
    generatorVersion: problem.generatorVersion,
    problemVersion: "generator-v1",
    orderIndex: index + 1,
    route: routeFor(lesson),
    status: "IMPLEMENTED" as const,
  }));
});

const inventory = {
  generatedAt: "generated-from-current-source",
  source: { commit: "runtime", fixedProblems: SEED_PROBLEMS.length, lessons: LESSONS.length },
  counts: {
    fixed: fixed.length,
    templates: generated.length,
    activities: activities.length,
    assignedPractice: assignmentManifest.length,
    byLesson: Object.fromEntries(LESSONS.map(lesson => [lesson.lesson, { fixed: fixed.filter(item => item.lessonId === lesson.lesson).length, templates: generated.filter(item => item.lessonId === lesson.lesson).length, activities: activities.filter(item => item.lessonId === lesson.lesson).length }])),
  },
  entries: [...fixed, ...generated, ...activities],
  assignmentManifest,
};

writeFileSync(resolve(process.cwd(), "PROBLEM_INVENTORY.json"), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`문항 inventory 생성: 고정 ${fixed.length}개 · template ${generated.length}개 · 활동 ${activities.length}개`);
