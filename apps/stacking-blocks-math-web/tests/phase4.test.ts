import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPhase4Store, makeChallengeCard, validatePeerBlocks, gradePeer, reviewProblems, PEER_GRID, MemoryProgressRepository, type Lesson12ProgressRecord } from '../shared/phase4.ts';
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

test('phase4 public challenge DTO excludes private blocks and hint, while scoped operations remain isolated', () => {
  const store = createLocalPhase4Store();
  const challenge = { id: 'c-public', version: 1, classId: 'class-a', authorId: 'student-a', title: '위·앞·옆', blocks: grounded, card: makeChallengeCard(grounded, 'views'), hint: makeChallengeCard(grounded, 'heightMap'), published: false, hidden: false };
  assert.equal(store.publishProblem('install-a', challenge).ok, true);
  const publicProblem = store.listClassProblems('install-a', 'class-a', 'student-b')[0];
  assert.ok(publicProblem);
  assert.equal('blocks' in publicProblem, false);
  assert.equal('hint' in publicProblem, false);
  assert.equal(store.listClassProblems('install-b', 'class-a', 'student-b').length, 0);
  assert.equal(store.getHint('install-a', 'class-a', 'c-public', 1)?.type, 'heightMap');
  assert.equal(store.hideProblem('install-a', 'class-a', 'c-public', 1), true);
  assert.equal(store.listClassProblems('install-a', 'class-a', 'student-b').length, 0);
});

test('lesson 12 progress repository keeps first/final result and isolates students', async () => {
  const repo = new MemoryProgressRepository();
  const base: Lesson12ProgressRecord = { installationId: 'install-a', classId: 'class-a', studentId: 'student-a', lessonId: 12, stage: 'solve', setId: 'set-1', problemId: 'p-1', problemVersion: 1, questionIndex: 0, answer: 9, firstAttemptResult: 'incorrect', attemptCount: 4, hintLevel: 3, finalResult: 'correct', remediationStatus: 'complete', completedAt: '2026-09-13T00:00:00Z', selfEvaluation: { confidence: 4, favoriteConcept: 'height', selfPraise: '끝까지 다시 생각했어요.' } };
  await repo.save(base);
  const rows = await repo.load({ installationId: 'install-a', classId: 'class-a', studentId: 'student-a', lessonId: 12, setId: 'set-1' });
  assert.equal(rows[0].firstAttemptResult, 'incorrect');
  assert.equal(rows[0].finalResult, 'correct');
  assert.equal((await repo.load({ ...base, studentId: 'student-b' })).length, 0);
});
