import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeGiven, challengeScore, validChallenge } from '../shared/activities.ts';
import type { BlockCoord } from '../shared/types.ts';

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
