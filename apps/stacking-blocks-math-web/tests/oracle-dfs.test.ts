import test from 'node:test';
import assert from 'node:assert/strict';
import { solveViewConstraint, distinctBlockCounts } from '../oracle/dfs.ts';

test('a fully pinned 1x1x1 view has exactly one solution', () => {
  const grid = { gridWidth: 1, gridDepth: 1, maxHeight: 1 };
  const result = solveViewConstraint({ top: [[true]], front: [[true]], side: [[true]] }, grid);
  assert.equal(result.exists, true);
  assert.equal(result.uniqueness, 'UNIQUE');
  assert.equal(result.solutionCount, 1);
  assert.equal(result.capped, false);
  assert.deepEqual(result.sampleSolutions[0], [{ x: 0, y: 0, z: 0 }]);
});

test('a contradictory view (top says empty, front demands a block) has no solution', () => {
  const grid = { gridWidth: 1, gridDepth: 1, maxHeight: 2 };
  const result = solveViewConstraint({ top: [[false]], front: [[true], [false]] }, grid);
  assert.equal(result.exists, false);
  assert.equal(result.uniqueness, 'NONE');
  assert.equal(result.solutionCount, 0);
});

test('a front-only view with unconstrained depth has multiple valid structures', () => {
  // gridWidth=2, gridDepth=2, maxHeight=1: each x needs at least one of its
  // two z-columns filled (front says height 1), but which one is free.
  // 3 choices per x ((1,0),(0,1),(1,1)) times 2 independent x columns = 9.
  const grid = { gridWidth: 2, gridDepth: 2, maxHeight: 1 };
  const result = solveViewConstraint({ front: [[true, true]] }, grid);
  assert.equal(result.exists, true);
  assert.equal(result.uniqueness, 'MULTIPLE');
  assert.equal(result.solutionCount, 9);
  assert.equal(result.capped, false);
  assert.ok(result.sampleSolutions.length <= 5);
});

test('distinctBlockCounts reports the range of totals seen among sampled solutions', () => {
  const grid = { gridWidth: 2, gridDepth: 2, maxHeight: 2 };
  // Only the top view is given: each of the 4 columns independently ranges
  // over height 1 or 2, so total block count varies between solutions.
  const result = solveViewConstraint({ top: [[true, true], [true, true]] }, grid);
  assert.equal(result.uniqueness, 'MULTIPLE');
  assert.ok(distinctBlockCounts(result).length > 1);
});
