import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeGiven, challengeScore, EMPTY_BUILDING, validBuilding, validChallenge } from '../shared/activities.ts';
import type { BlockCoord } from '../shared/types.ts';
import { generatePracticeProblems, getProblemTemplates, recommendedPracticeCount, validateGeneratedProblem } from '../shared/practiceGenerator.ts';
import { equivalentDirections, projectionForDirection } from '../shared/spatialConventions.ts';
import { clampProblemIndex, problemIndexForId } from '../shared/problemSession.ts';
import { REWARD_CATALOG, levelForXp, rewardUnlocked, sanitizeAppearance } from '../shared/rewards.ts';

const ten: BlockCoord[] = Array.from({ length: 10 }, (_, x) => ({ x: x % 5, y: Math.floor(x / 5), z: 0 }));

test('lesson 9 challenge requires exactly ten physically valid blocks', () => {
  assert.equal(validChallenge(ten.slice(0, 9), 'views'), false);
  assert.equal(validChallenge(ten, 'views'), true);
  assert.equal(validChallenge(ten, 'top'), true);
  assert.equal(validChallenge(ten, 'heightMap'), true);
  assert.equal(validChallenge(ten, 'layers'), true);
  assert.equal(validChallenge(ten, 'other'), false);
});

test('lesson 9 challenge cards are generated from the same projections', () => {
  assert.ok(challengeGiven(ten, 'views').projections?.front);
  assert.ok(challengeGiven(ten, 'top').projections?.top);
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
  assert.equal(first[0].generatorVersion, 1);
  assert.ok(first[0].templateId);
  assert.ok(first[0].conceptTags?.includes('HEIGHT_MAP'));
});

test('all practice lesson generators produce valid seeded problems', () => {
  for (const lesson of [1,2,3,4,5,6,7,8,12]) {
    assert.ok(getProblemTemplates(lesson).length > 0);
    for (let seed = 0; seed < 50; seed++) {
      const generated = generatePracticeProblems(lesson, 3, seed);
      assert.equal(generated.length, 3);
      for (const item of generated) {
        assert.ok(validateGeneratedProblem(item));
        assert.equal(item.sourceType, 'GENERATED_PRACTICE');
      }
    }
  }
});

test('practice sets mix templates and do not repeat one template three times', () => {
  for (const lesson of [1,2,3,4,5,6,7,8,12]) {
    const fifteen = generatePracticeProblems(lesson, 15, 42);
    const twenty = generatePracticeProblems(lesson, 20, 42);
    assert.ok(new Set(fifteen.map(item => item.templateId)).size >= 5, `lesson ${lesson} needs five templates`);
    assert.ok(new Set(twenty.map(item => item.templateId)).size >= 6, `lesson ${lesson} needs six templates`);
    for (let i = 2; i < twenty.length; i += 1) {
      assert.notEqual(twenty[i].templateId, twenty[i - 1].templateId);
      assert.notEqual(twenty[i].templateId, twenty[i - 2].templateId);
    }
  }
});

test('changing the student seed changes the generated practice content', () => {
  for (const lesson of [1,2,3,4,5,6,7,8,12]) {
    const first = generatePracticeProblems(lesson, 20, 1001).map(({ code: _code, ...problem }) => problem);
    const second = generatePracticeProblems(lesson, 20, 1002).map(({ code: _code, ...problem }) => problem);
    assert.notDeepEqual(first, second, `lesson ${lesson} should vary by seed`);
  }
});

test('direction practice uses the selected direction projection and avoids ambiguous views', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const problems = generatePracticeProblems(2, 5, seed);
    for (const problem of problems) {
      const direction = problem.answer.kind === 'direction' ? problem.answer.value : 'front';
      const face = direction === 'top' ? 'top' : direction === 'front' || direction === 'back' ? 'front' : 'side';
      assert.deepEqual(problem.given.projections?.[face], projectionForDirection(problem.givenBlocks, problem.grid, direction));
      assert.deepEqual(equivalentDirections(problem.givenBlocks, problem.grid, direction), [direction]);
    }
  }
});

test('practice position restores by problem id and clamps safely', () => {
  const problems = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
  assert.equal(problemIndexForId(problems, 'p2'), 1);
  assert.equal(problemIndexForId(problems, 'missing'), 0);
  assert.equal(problemIndexForId(problems, null), 0);
  assert.equal(clampProblemIndex(-2, problems.length), 0);
  assert.equal(clampProblemIndex(99, problems.length), 2);
  assert.equal(clampProblemIndex(0, 0), 0);
});

test('reward catalog unlocks usable materials and themes at deterministic XP thresholds', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(250), 3);
  assert.equal(rewardUnlocked(49, 'material:pastel'), false);
  assert.equal(rewardUnlocked(50, 'material:pastel'), true);
  assert.equal(rewardUnlocked(249, 'theme:museum'), false);
  assert.equal(rewardUnlocked(250, 'theme:museum'), true);
  assert.ok(REWARD_CATALOG.every(item => item.useIn.length > 0));
});

test('appearance metadata is sanitized independently from mathematical coordinates', () => {
  assert.deepEqual(sanitizeAppearance({ '0,0,0': 'brick', '1,0,0': 'unknown', bad: 'tile', '2,1,3': 'pastel' }), {
    '0,0,0': 'brick', '1,0,0': 'wood', '2,1,3': 'pastel',
  });
  assert.deepEqual(sanitizeAppearance(null), {});
});
