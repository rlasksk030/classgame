import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPhase4Store, makeChallengeCard, validatePeerBlocks, gradePeer, reviewProblems, PEER_GRID } from '../shared/phase4.ts';
import { validStructure } from '../shared/blocks.ts';
import type { BlockCoord } from '../shared/types.ts';

// normalize to a supported grounded shape
const grounded: BlockCoord[] = [
  {x:0,y:0,z:0},{x:1,y:0,z:0},{x:2,y:0,z:0},{x:0,y:0,z:1},{x:1,y:0,z:1},
  {x:2,y:0,z:1},{x:0,y:1,z:0},{x:1,y:1,z:0},{x:0,y:1,z:1},{x:0,y:2,z:0},
];

test('phase4 peer challenge requires exactly ten grounded blocks', () => {
  assert.equal(validatePeerBlocks(grounded), null);
  assert.notEqual(validatePeerBlocks(grounded.slice(0, 9)), null);
  assert.equal(validStructure(grounded, PEER_GRID), true);
});

test('phase4 peer store scopes by class and prevents duplicate rewards', () => {
  const store = createLocalPhase4Store();
  const challenge = { id: 'c1', version: 1, classId: 'class-a', authorId: 'student-a', title: '위·앞·옆', blocks: grounded, card: makeChallengeCard(grounded, 'views'), hint: makeChallengeCard(grounded, 'heightMap'), published: true, hidden: false };
  store.publish(challenge);
  assert.equal(gradePeer(grounded, challenge, false), true);
  assert.equal(store.list('class-a', 'student-b').length, 1);
  assert.equal(store.list('class-b', 'student-b').length, 0);
  const first = store.attempt({ challengeId: 'c1', version: 1, studentId: 'student-b', hintShown: false, submission: grounded });
  const second = store.attempt({ challengeId: 'c1', version: 1, studentId: 'student-b', hintShown: false, submission: grounded });
  assert.equal(first.score, 2);
  assert.deepEqual(second, first);
});

test('phase4 review has six stable tagged common problems and seed changes ids', () => {
  const one = reviewProblems(1); const two = reviewProblems(2);
  assert.equal(one.length, 6);
  assert.deepEqual(one.map(p => p.conceptTag), ['direction','projection','count','height','layers','pattern']);
  assert.notEqual(one[0].id, two[0].id);
});
