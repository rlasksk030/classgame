import test from 'node:test';
import assert from 'node:assert/strict';
import {
  oracleBlockCount,
  oracleCountTrueCells,
  oracleDedupe,
  oracleDirectionView,
  oracleEquivalentDirections,
  oracleGrid2DEqual,
  oracleHeightMap,
  oracleIsValidStructure,
  oracleLayers,
  oracleMaxBlocksForFrontSilhouette,
  oracleProject,
  type OracleBlock,
} from '../oracle/geometry.ts';

// Same fixture as tests/blocks.test.ts's `fromHeightMap([[2,1,0],[0,1,0]])`,
// written out by hand so this test never imports shared/blocks.ts.
const grid = { gridWidth: 3, gridDepth: 2, maxHeight: 3 };
const blocks: OracleBlock[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 0, z: 1 },
];

test('oracle projections match hand-derived expectations for a known asymmetric shape', () => {
  assert.deepEqual(oracleProject(blocks, grid), {
    top: [[true, true, false], [false, true, false]],
    front: [[true, true, false], [true, false, false], [false, false, false]],
    side: [[true, true], [false, true], [false, false]],
  });
});

test('oracle height map matches hand-derived expectation', () => {
  assert.deepEqual(oracleHeightMap(blocks, grid), [[2, 1, 0], [0, 1, 0]]);
});

test('oracle layer map matches hand-derived expectation for the second floor', () => {
  assert.deepEqual(oracleLayers(blocks, grid)[1], [[true, false, false], [false, false, false]]);
});

test('oracle block count dedupes repeated coordinates', () => {
  assert.equal(oracleBlockCount(blocks), 4);
  assert.equal(oracleBlockCount([...blocks, blocks[0]]), 4);
  assert.equal(oracleDedupe([...blocks, blocks[0]]).length, 4);
});

test('oracle structure validity rejects floating, out-of-bounds, duplicate and non-integer blocks', () => {
  assert.equal(oracleIsValidStructure(blocks, grid), true);
  assert.equal(oracleIsValidStructure([{ x: 2, y: 1, z: 0 }], grid), false); // floating: no support at y=0
  assert.equal(oracleIsValidStructure([{ x: -1, y: 0, z: 0 }], grid), false); // out of bounds
  assert.equal(oracleIsValidStructure([{ x: 3, y: 0, z: 0 }], grid), false); // out of bounds
  assert.equal(oracleIsValidStructure([{ x: 0.5, y: 0, z: 0 }], grid), false); // non-integer
  assert.equal(oracleIsValidStructure([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], grid), false); // duplicate
  assert.equal(oracleIsValidStructure([{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }], grid), false); // gap at y=1
});

test('back/left mirror front/right for a single corner block, verified by hand', () => {
  const cornerGrid = { gridWidth: 2, gridDepth: 2, maxHeight: 2 };
  const corner: OracleBlock[] = [{ x: 0, y: 0, z: 0 }];
  assert.deepEqual(oracleDirectionView(corner, cornerGrid, 'front'), [[true, false], [false, false]]);
  assert.deepEqual(oracleDirectionView(corner, cornerGrid, 'back'), [[false, true], [false, false]]);
  assert.deepEqual(oracleDirectionView(corner, cornerGrid, 'right'), [[false, true], [false, false]]);
  assert.deepEqual(oracleDirectionView(corner, cornerGrid, 'left'), [[true, false], [false, false]]);
  assert.deepEqual(oracleDirectionView(corner, cornerGrid, 'top'), [[true, false], [false, false]]);
});

test('a single corner block is ambiguous between top, front and left views', () => {
  const cornerGrid = { gridWidth: 2, gridDepth: 2, maxHeight: 2 };
  const corner: OracleBlock[] = [{ x: 0, y: 0, z: 0 }];
  const matches = oracleEquivalentDirections(corner, cornerGrid, 'front').sort();
  assert.deepEqual(matches, ['front', 'left', 'top'].sort());
});

test('grid2D equality is a plain structural comparison', () => {
  assert.equal(oracleGrid2DEqual([[true, false]], [[true, false]]), true);
  assert.equal(oracleGrid2DEqual([[true, false]], [[false, false]]), false);
  assert.equal(oracleGrid2DEqual(undefined, [[true]]), false);
});

test('max blocks consistent with a front silhouette scales by grid depth', () => {
  // front silhouette: column 0 has height 2, column 1 has height 1, column 2 empty.
  const front = [[true, true, false], [true, false, false]];
  assert.equal(oracleMaxBlocksForFrontSilhouette(front, 3), (2 + 1 + 0) * 3);
  assert.equal(oracleCountTrueCells(front), 3);
});
