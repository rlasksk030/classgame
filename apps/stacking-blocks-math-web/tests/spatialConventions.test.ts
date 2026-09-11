import test from "node:test";
import assert from "node:assert/strict";
import { fromHeightMap } from "../shared/blocks.ts";
import { equivalentDirections, projectionForDirection } from "../shared/spatialConventions.ts";

test("방향별 투영은 뒤·왼쪽에서 본 화면의 좌우를 반전한다", () => {
  const grid = { gridWidth: 3, gridDepth: 3, maxHeight: 3 };
  const blocks = fromHeightMap([[1, 0, 0], [2, 1, 0], [0, 0, 0]]);
  assert.deepEqual(projectionForDirection(blocks, grid, "back"), projectionForDirection(blocks, grid, "front").map(row => [...row].reverse()));
  assert.deepEqual(projectionForDirection(blocks, grid, "left"), projectionForDirection(blocks, grid, "right").map(row => [...row].reverse()));
});

test("방향 문제가 하나의 정답을 만드는지 검사한다", () => {
  const grid = { gridWidth: 3, gridDepth: 3, maxHeight: 3 };
  const asymmetric = fromHeightMap([[2, 2, 1], [1, 0, 0], [0, 0, 0]]);
  assert.deepEqual(equivalentDirections(asymmetric, grid, "front"), ["front"]);
  const symmetric = fromHeightMap([[1, 2, 1], [0, 0, 0], [0, 0, 0]]);
  assert.ok(equivalentDirections(symmetric, grid, "front").length > 1);
});
