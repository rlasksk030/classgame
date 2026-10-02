import test from 'node:test';
import assert from 'node:assert/strict';
import { homeLessonProgress } from '../shared/homeProgress.ts';

const row = (id: string, order_index: number, code = id) => ({ id, lesson: 1, order_index, code, active: true });
const rows = [row('concept', 1), row('check', 2), row('builtin-more', 3),
  ...Array.from({ length: 5 }, (_, i) => row(`old${i}`, 100 + i, `GEN-L1-S111-${i}-V2`)),
  ...Array.from({ length: 3 }, (_, i) => row(`new${i}`, 100 + i, `GEN-L1-S222-${i}-V2`))];
const done = (...ids: string[]) => ids.map(problem_id => ({ problem_id, completed: true }));

test('required progress and the current optional set have independent, exact denominators', () => {
  const attempts = done('check', 'concept', 'builtin-more', 'old0', 'old1', 'old2', 'old3', 'old4', 'new0');
  const old = homeLessonProgress(1, rows, attempts, false, 111, 111);
  assert.equal(old.completed, true);
  assert.deepEqual([old.requiredCompleted, old.requiredTotal, old.optionalCompleted, old.optionalTotal], [1, 1, 6, 6]);
  assert.deepEqual([old.completedProblems, old.totalProblems], [8, 8]);
  const next = homeLessonProgress(1, rows, attempts, false, 222, 111);
  assert.deepEqual([next.requiredCompleted, next.requiredTotal, next.optionalCompleted, next.optionalTotal], [1, 1, 2, 4]);
  assert.deepEqual([next.completedProblems, next.totalProblems], [4, 6]);
  assert.equal(attempts.length, 9, 'historical attempts are retained');
});

test('missing saved seed recovers exactly the same legacy set as lessonProblems', () => {
  const result = homeLessonProgress(1, rows, done('old0'), false, 333, 111);
  assert.equal(result.displayedSeed, 111);
  assert.deepEqual([result.optionalCompleted, result.optionalTotal], [1, 6]);
  assert.equal(result.completed, false);
});

test('five optional completions cannot advance required progress, including inactive required problems', () => {
  const result = homeLessonProgress(1, [...rows, { ...row('inactive', 2), active: false }], done('old0', 'old1', 'old2', 'old3', 'old4'), false, 111, 111);
  assert.deepEqual([result.requiredCompleted, result.requiredTotal, result.optionalCompleted], [0, 1, 5]);
  assert.equal(result.completed, false);
});

test('activity progress is one real completion unit, never a phantom practice allocation', () => {
  for (const lesson of [9, 10, 11]) {
    assert.deepEqual(homeLessonProgress(lesson, [], [], false, 0, 0), { completed: false, totalProblems: 1, completedProblems: 0, requiredTotal: 1, requiredCompleted: 0, optionalTotal: 0, optionalCompleted: 0, displayedSeed: 0 });
    assert.equal(homeLessonProgress(lesson, [], [], true, 0, 0).completedProblems, 1);
  }
});
