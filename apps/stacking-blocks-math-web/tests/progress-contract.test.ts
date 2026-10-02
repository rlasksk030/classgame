import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStudentProgress, overallProgressStatus } from '../shared/teacherProgress.ts';
import { summarizeLessonResults } from '../shared/teacherResults.ts';

test('current lesson follows the latest learning event, not the highest lesson visited', () => {
  const summary = summarizeStudentProgress('s', '합성', 1, [
    { lesson: 8, completed: false, updated_at: '2026-09-01T00:00:00Z' },
    { lesson: 3, completed: false, updated_at: '2026-10-01T00:00:00Z' },
  ], [], []);
  assert.equal(summary.currentLesson, 3);
  assert.equal(summary.lastActivityAt, '2026-10-01T00:00:00Z');
  assert.equal(summary.lessonStates[2], 'in_progress');
});

test('finishing lesson 12 alone cannot label the whole course complete', () => {
  const states = Array.from({ length: 12 }, () => 'not_started' as 'not_started' | 'complete');
  states[11] = 'complete';
  assert.equal(overallProgressStatus({ lessonStates: states }), 'in_progress');
  assert.equal(overallProgressStatus({ lessonStates: Array(12).fill('complete') }), 'complete');
});

test('results count built-in optional work using the same stage metadata as teacher progress', () => {
  const summary = summarizeLessonResults(1, 4, [
    { student_id: 'a', problem_id: 'check', wrong_count: 0 },
    { student_id: 'b', problem_id: 'check', wrong_count: 0 },
    { student_id: 'c', problem_id: 'more', wrong_count: 1 },
  ], [{ student_id: 'a', completed: true }, { student_id: 'b', completed: true }], [
    { id: 'check', problem_type: 'COUNT', code: 'L1-02', order_index: 2, lesson: 1 },
    { id: 'more', problem_type: 'COUNT', code: 'L1-03', order_index: 3, lesson: 1 },
  ]);
  assert.equal(summary.participatedStudents, 3);
  assert.equal(summary.completedStudents, 2);
  assert.equal(summary.completionRate, 50);
  assert.equal(summary.optionalPracticeParticipants, 1);
  assert.equal(summary.optionalPracticeAttempts, 1);
});

test('activity participation and completion are visible even without ordinary question attempts', () => {
  const summary = summarizeLessonResults(10, 4, [], [
    { student_id: 'a', completed: true }, { student_id: 'b', completed: true },
    { student_id: 'c', completed: false, participated: true },
    { student_id: 'd', completed: false, participated: false },
  ], []);
  assert.equal(summary.participatedStudents, 3);
  assert.equal(summary.completedStudents, 2);
  assert.equal(summary.completionRate, 50);
});
