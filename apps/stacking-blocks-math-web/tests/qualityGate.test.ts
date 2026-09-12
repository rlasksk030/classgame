import test from "node:test";
import assert from "node:assert/strict";
import { grade } from "../shared/grading.ts";
import { SEED_PROBLEMS } from "../shared/seedProblems.ts";
import { validateProblemPresentation } from "../shared/problemPresentation.ts";

test("품질 게이트는 격자 자료와 정답이 함께 사라진 문항을 거부한다", () => {
  const source = SEED_PROBLEMS.find(problem => problem.code === "L3-01")!;
  const broken = { ...source, given: { ...source.given, projections: undefined }, answer: { kind: "projections" as const, projections: {} } };
  assert.ok(validateProblemPresentation(broken).includes("그릴 투영 누락"));
});

test("독립 고정값 3×3 앞면의 ‘숨은 블록 없음’ 정답은 9이며 변조된 20을 거부한다", () => {
  const front = [[true, true, true], [true, true, true], [true, true, true]];
  const input = {
    problemType: "COUNT" as const,
    gradingMode: "exact" as const,
    given: { projections: { front } },
    grid: { gridWidth: 3, gridDepth: 3, maxHeight: 3 },
  };
  assert.equal(grade({ ...input, answer: { kind: "count", value: 9 }, submission: { kind: "count", value: 9 } }).correct, true);
  assert.equal(grade({ ...input, answer: { kind: "count", value: 20 }, submission: { kind: "count", value: 9 } }).correct, false);
});

test("고정 비대칭 기준은 오른쪽 투영을 좌우 반전한 답으로 통과하지 않는다", () => {
  const source = SEED_PROBLEMS.find(problem => problem.code === "L3-03")!;
  const expected = source.answer.kind === "projections" ? source.answer.projections : {};
  const side = expected.side!;
  const reversed = side.map(row => [...row].reverse());
  const correctSubmission = { kind: "projections" as const, projections: { top: expected.top, front: expected.front, side } };
  const reversedSubmission = { kind: "projections" as const, projections: { top: expected.top, front: expected.front, side: reversed } };
  assert.equal(grade({ problemType: "PROJECTION_DRAW", gradingMode: "exact", given: source.given, grid: source.grid, answer: { kind: "projections", projections: expected }, submission: correctSubmission }).correct, true);
  assert.equal(grade({ problemType: "PROJECTION_DRAW", gradingMode: "exact", given: source.given, grid: source.grid, answer: { kind: "projections", projections: expected }, submission: reversedSubmission }).correct, false);
});
