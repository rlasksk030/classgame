import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeGiven, challengeScore, EMPTY_BUILDING, validBuilding, validChallenge } from '../shared/activities.ts';
import type { BlockCoord } from '../shared/types.ts';
import { generatePracticeProblems, recommendedPracticeCount } from '../shared/practiceGenerator.ts';

const ten: BlockCoord[] = Array.from({ length: 10 }, (_, x) => ({ x: x % 5, y: Math.floor(x / 5), z: 0 }));

test('lesson 9 challenge requires exactly ten physically valid blocks', () => {
  assert.equal(validChallenge(ten.slice(0, 9), 'views'), false);
  assert.equal(validChallenge(ten, 'views'), true);
  assert.equal(validChallenge(ten, 'heightMap'), true);
  assert.equal(validChallenge(ten, 'layers'), true);
  assert.equal(validChallenge(ten, 'other'), false);
});

test('lesson 9 challenge cards are generated from the same projections', () => {
  assert.ok(challengeGiven(ten, 'views').projections?.front);
  assert.ok(challengeGiven(ten, 'heightMap').heightMap);
  assert.ok(challengeGiven(ten, 'layers').layers);
});

test('lesson 9 score is two points without hint and one after hint', () => {
  assert.equal(challengeScore(false, false, true), 2);
  assert.equal(challengeScore(true, false, true), 1);
  assert.equal(challengeScore(false, true, true), 0);
  assert.equal(challengeScore(false, false, false), 0);
});

test('architecture project requires complete text, three floors and a third floor block', () => {
  const complete = { ...EMPTY_BUILDING, building_name: '과학관', reason: '만들고 싶어서', description: '세 층 건물', layer_notes: ['VR\n체험', '로봇\n전시', '드론\n교육'], blocks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }] };
  assert.equal(validBuilding(complete, true), true);
  assert.equal(validBuilding({ ...complete, description: '' }, true), false);
  assert.equal(validBuilding({ ...complete, blocks: complete.blocks.slice(0, 2) }, true), false);
});

test('practice generator is deterministic and scales by lesson', () => {
  assert.equal(recommendedPracticeCount(2), 15);
  assert.equal(recommendedPracticeCount(8), 20);
  const first = generatePracticeProblems(7, 20, 1234);
  const second = generatePracticeProblems(7, 20, 1234);
  assert.deepEqual(first.map(item => item.code), second.map(item => item.code));
  assert.deepEqual(first[0].answer, second[0].answer);
  assert.equal(new Set(first.map(item => item.code)).size, 20);
  assert.ok(first.every(item => item.stage === 'more'));
});
