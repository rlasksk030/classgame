import test from "node:test";
import assert from "node:assert/strict";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { deriveProblemPresentation, validateProblemPresentation } from "../shared/problemPresentation.ts";

test("3차시 격자는 실제 정답 투영의 행·열을 사용한다", () => {
  const problem = SEED_PROBLEMS.find(item => item.code === "L3-01")!;
  const presentation = deriveProblemPresentation(problem);
  assert.deepEqual(presentation.gridSpecs.top, { rows: 3, cols: 3 });
  assert.equal(presentation.answerInput, "GRID");
  assert.equal(validateProblemPresentation(problem).length, 0);
});

test("4차시 높이 지도 개수 문제는 학생에게 숫자 지도를 표시한다", () => {
  const problem = SEED_PROBLEMS.find(item => item.code === "L4-01")!;
  const presentation = deriveProblemPresentation(problem);
  assert.ok(presentation.visibleRepresentations.includes("HEIGHT_MAP"));
  assert.equal(validateProblemPresentation(problem).length, 0);
});

test("세 방향 쌓기 문제는 세 조건이 모두 없으면 출제할 수 없다", () => {
  const problem = SEED_PROBLEMS.find(item => item.code === "L6-01")!;
  const broken = { ...problem, given: { projections: { top: problem.given.projections!.top }, allowRotate: true } };
  assert.ok(validateProblemPresentation(broken).includes("세 방향 조건 누락"));
});
