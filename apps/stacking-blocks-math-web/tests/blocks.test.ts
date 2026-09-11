import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canPlace, removeBlock, moveBlock, project, toHeightMap, toLayers, fromHeightMap, validStructure } from '../shared/blocks.ts';
import { grade } from '../shared/grading.ts';
import { applyAttempt, INITIAL_ATTEMPT } from '../shared/attempts.ts';
const grid = { gridWidth: 3, gridDepth: 2, maxHeight: 3 };
const blocks = fromHeightMap([[2, 1, 0], [0, 1, 0]]);
test('canonical order is y/z/x, independent of insertion order', () => {
  assert.deepEqual(canonicalize([...blocks].reverse()), blocks);
  assert.deepEqual(canonicalize([...blocks, blocks[0]]), blocks);
});
test('asymmetric projections preserve front/right-side orientation', () => {
  assert.deepEqual(project(blocks, grid), {
    top: [[true,true,false],[false,true,false]],
    front: [[true,true,false],[true,false,false],[false,false,false]],
    side: [[true,true],[false,true],[false,false]],
  });
  assert.deepEqual(toHeightMap(blocks, grid), [[2,1,0],[0,1,0]]);
  assert.deepEqual(toLayers(blocks, grid)[1], [[true,false,false],[false,false,false]]);
});
test('physics reject floating, out-of-bounds, noninteger and occupied placements', () => {
  for (const b of [{x:2,y:1,z:0},{x:3,y:0,z:0},{x:.5,y:0,z:0},{x:0,y:0,z:0},{x:NaN,y:0,z:0}]) assert.equal(canPlace(blocks,b,grid).ok,false);
  assert.equal(removeBlock(blocks,{x:0,y:0,z:0}).check.ok,false);
  assert.equal(moveBlock(blocks,{x:0,y:0,z:0},2,0,grid).check.ok,false);
  const moved = moveBlock(blocks,{x:0,y:1,z:0},2,0,grid);
  assert.equal(moved.check.ok,true);
  assert.equal(validStructure(moved.blocks,grid),true);
});
test('grading exact coordinates cannot silently settle floating or malformed submissions', () => {
  const input = { problemType: 'BUILD_FROM_VIEWS' as const, gradingMode: 'exact' as const, answer: {kind:'blocks' as const,blocks}, given: {}, grid };
  assert.equal(grade({...input,submission:{kind:'blocks',blocks:[...blocks].reverse()}}).correct,true);
  assert.equal(grade({...input,submission:{kind:'blocks',blocks:[{x:0,y:1,z:0}]}}).correct,false);
  assert.equal(grade({...input,submission:{kind:'blocks',blocks:[...blocks,blocks[0]]}}).correct,false);
});
test('constraint accepts distinct physically valid models with same projections', () => {
  const a=fromHeightMap([[2,1],[1,2]]), b=fromHeightMap([[2,2],[1,2]]);
  const g={gridWidth:2,gridDepth:2,maxHeight:2};
  assert.notDeepEqual(a,b);
  assert.equal(grade({problemType:'BUILD_FROM_VIEWS',gradingMode:'constraint',answer:{kind:'blocks',blocks:a},given:{projections:project(a,g)},grid:g,submission:{kind:'blocks',blocks:b}}).correct,true);
});
test('third wrong answer reveals only hint; fourth reveals answer; reconstruction completes once', () => {
  let state={...INITIAL_ATTEMPT};
  for(let i=1;i<=4;i++) {
    const result=applyAttempt(state,false); state=result.state;
    assert.equal(result.sendHint,i>=3);
    assert.equal(result.sendAnswer,i>=4);
    assert.equal(state.completed,false);
  }
  const completed=applyAttempt(state,true);
  assert.equal(completed.state.answerRevealed,true);
  assert.equal(completed.state.completed,true);
  assert.equal(completed.xpEarned,10);
  assert.equal(applyAttempt(completed.state,true).xpEarned,0);
});
test('cannot bypass construction by submitting only a numeric block count', () => {
  assert.equal(grade({problemType:'BUILD_FROM_VIEWS',gradingMode:'exact',answer:{kind:'blocks',blocks},given:{},grid,submission:{kind:'count',value:blocks.length}}).correct,false);
});
