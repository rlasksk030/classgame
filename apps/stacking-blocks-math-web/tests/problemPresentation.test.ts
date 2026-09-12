import test from "node:test";
import assert from "node:assert/strict";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { deriveProblemPresentation, validateProblemPresentation } from "../shared/problemPresentation.ts";
import { answerRendererFor } from "../shared/answerUi.ts";

test("3차시 격자는 실제 정답 투영의 행·열을 사용한다", () => {
  const problem = SEED_PROBLEMS.find(item => item.code === "L3-01")!;
  const presentation = deriveProblemPresentation(problem);
  assert.deepEqual(presentation.gridSpecs.top, { rows: 3, cols: 3 });
  assert.equal(presentation.answerInput, "GRID");
  assert.equal(validateProblemPresentation(problem).length, 0);
});

test("구버전 문제 응답도 투영 정답에서 실제 입력 격자 계약을 복원한다", () => {
  const problem = SEED_PROBLEMS.find(item => item.code === "L3-01")!;
  const legacy = { ...problem, given: { ...problem.given, projections: undefined } };
  const presentation = deriveProblemPresentation(legacy);
  assert.equal(presentation.answerInput, "GRID");
  assert.deepEqual(presentation.gridSpecs.top, { rows: 3, cols: 3 });
  assert.equal(answerRendererFor(presentation.answerInput), "SingleGridRenderer");
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

test("세 방향 그리기와 층별 그리기는 전용 입력 Renderer 계약을 갖는다", () => {
  const triple = { ...SEED_PROBLEMS.find(item => item.code === "L12-02")! };
  const triplePresentation = deriveProblemPresentation(triple);
  assert.equal(triplePresentation.answerInput, "THREE_GRIDS");
  assert.equal(answerRendererFor(triplePresentation.answerInput), "TripleProjectionGridRenderer");

  const layer = SEED_PROBLEMS.find(item => item.problemType === "LAYER_DRAW")!;
  const layerPresentation = deriveProblemPresentation(layer);
  assert.equal(answerRendererFor(layerPresentation.answerInput), "LayerMapInputRenderer");
});
