import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submittedAnswerDraft } from '../shared/submittedAnswer.ts';

test('submitted count/choice zero and every non-block input restore without solution data', () => {
  assert.deepEqual(submittedAnswerDraft({kind:'count',value:0}),{countInput:'0'});
  assert.deepEqual(submittedAnswerDraft({kind:'choice',index:0}),{choiceIndex:0});
  assert.deepEqual(submittedAnswerDraft({kind:'direction',direction:'right'}),{directionValue:'right'});
  assert.deepEqual(submittedAnswerDraft({kind:'projections',projections:{top:[[true,false]]}}),{topMap:[[true,false]]});
  assert.deepEqual(submittedAnswerDraft({kind:'heightMap',heightMap:[[0,2]]}),{heightMap:[[0,2]]});
  assert.deepEqual(submittedAnswerDraft({kind:'layers',layers:[[[false,true]]]}),{layerMaps:[[[false,true]]]});
});
test('missing, malformed or out-of-domain answers cannot turn into a selected answer', () => {
  for(const answer of [null,{}, {kind:'count'}, {kind:'count',value:null},{kind:'count',value:NaN},{kind:'choice',index:-1},{kind:'direction',direction:'invalid'},{kind:'projections',projections:{top:[[1]]}},{kind:'heightMap',heightMap:[[-1]]},{kind:'layers',layers:[[null]]}]) assert.equal(submittedAnswerDraft(answer),null);
});
