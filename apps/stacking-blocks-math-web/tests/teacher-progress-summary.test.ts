import test from "node:test";
import assert from "node:assert/strict";
import { summarizeStudentProgress, overallProgressStatus } from "../shared/teacherProgress.ts";

// Teacher Page Expansion Phase 2A: this is the exact function
// teacher:progress:summary calls per student (imported directly from
// shared/, not reimplemented here), so these tests exercise the real
// aggregation code path, not a copy of it.

test("A. a student with zero rows is fully not_started, currentLesson defaults to 1", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], [], []);
  assert.deepEqual(summary.lessonStates, Array(12).fill("not_started"));
  assert.equal(summary.currentLesson, 1);
  assert.equal(summary.requiredProgress.completedLessons, 0);
  assert.equal(summary.wrongCount, 0);
  assert.equal(summary.optionalPracticeCount, 0);
  assert.equal(summary.lastActivityAt, null);
});

test("lesson classification: completed required attempt -> complete, unfinished attempt -> in_progress, neither -> not_started", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [completedAttempt("required-1", 1, 2), { problem_id: "required-2", lesson: 2, wrong_count: 1, completed: false, updated_at: "2026-01-02T00:00:00Z" }],
    requiredProblems,
  );
  assert.equal(summary.lessonStates[0], "complete"); // lesson 1
  assert.equal(summary.lessonStates[1], "in_progress"); // lesson 2
  assert.equal(summary.lessonStates[2], "not_started"); // lesson 3
});

test("a lesson with an incomplete sb_student_progress row but attempts recorded is in_progress, not complete", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 5, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
    [{ problem_id: "required-5", lesson: 5, wrong_count: 2, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
    [],
  );
  assert.equal(summary.lessonStates[4], "in_progress");
});

test("requiredProgress.completedLessons counts completed required lessons, out of a fixed totalLessons=12", () => {
  const progress = [1, 2, 3].map((lesson) => ({ lesson, completed: true, updated_at: "2026-01-01T00:00:00Z" }));
  const summary = summarizeStudentProgress("s1", "학생1", 1, progress,
    [1, 2, 3].map(lesson => completedAttempt(`required-${lesson}`, lesson, 2)),
    [1, 2, 3].map(lesson => ({ id: `required-${lesson}`, lesson, order_index: 2 })));
  assert.equal(summary.requiredProgress.completedLessons, 3);
  assert.equal(summary.requiredProgress.totalLessons, 12);
});

test("wrongCount sums wrong_count across every attempt row, regardless of lesson", () => {
  const attempts = [
    { problem_id: "required-1", lesson: 1, wrong_count: 2, completed: true, updated_at: "2026-01-01T00:00:00Z" },
    { problem_id: "required-2", lesson: 2, wrong_count: 3, completed: false, updated_at: "2026-01-01T00:00:00Z" },
    { problem_id: "required-3", lesson: 3, wrong_count: 0, completed: true, updated_at: "2026-01-01T00:00:00Z" },
  ];
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], attempts, requiredProblems);
  assert.equal(summary.wrongCount, 5);
});

test("optionalPracticeCount counts actual optional problems, never subtracts activity completions", () => {
  const progress = [1, 2].map((lesson) => ({ lesson, completed: true, updated_at: "2026-01-01T00:00:00Z" }));
  const attempts = [completedAttempt("required-1", 1, 2), completedAttempt("required-2", 2, 2),
    ...Array.from({ length: 3 }, (_, index) => completedAttempt(`optional-${index}`, 1, 3))];
  const summary = summarizeStudentProgress("s1", "학생1", 1, progress, attempts, requiredProblems);
  assert.equal(summary.optionalPracticeCount, 3);

  // More completed lessons than completed attempts (shouldn't happen in
  // practice, but must never go negative).
  const oddSummary = summarizeStudentProgress("s2", "학생2", 2, progress, [], requiredProblems);
  assert.equal(oddSummary.optionalPracticeCount, 0);
});

test("lastActivityAt is the max updated_at across both progress and attempt rows", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [{ problem_id: "required-2", lesson: 2, wrong_count: 0, completed: false, updated_at: "2026-03-01T00:00:00Z" }],
    requiredProblems,
  );
  assert.equal(summary.lastActivityAt, "2026-03-01T00:00:00Z");
});

test("currentLesson is the highest lesson number touched by either progress or attempts", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 3, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [{ problem_id: "required-7", lesson: 7, wrong_count: 1, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
    requiredProblems,
  );
  assert.equal(summary.currentLesson, 7);
});

test("overallProgressStatus: no progress at all -> not_started", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], [], []);
  assert.equal(overallProgressStatus(summary), "not_started");
});

test("overallProgressStatus: some progress but lesson 12 not complete -> in_progress", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [completedAttempt("required-1", 1, 2)], requiredProblems,
  );
  assert.equal(overallProgressStatus(summary), "in_progress");
});

test("overallProgressStatus: lesson 12 complete -> complete (whole-course proxy)", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 12, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [completedAttempt("required-12", 12, 2)], [{ id: "required-12", lesson: 12, order_index: 2 }],
  );
  assert.equal(overallProgressStatus(summary), "complete");
});

test("studentNo/name/studentId pass through unchanged", () => {
  const summary = summarizeStudentProgress("sid-123", "김민수", 7, [], [], []);
  assert.equal(summary.studentId, "sid-123");
  assert.equal(summary.name, "김민수");
  assert.equal(summary.studentNo, 7);
});

const progressTime = "2026-10-02T00:00:00Z";
const requiredProblems = [
  { id: "required-1", lesson: 1, order_index: 2 },
  { id: "required-2", lesson: 2, order_index: 2 },
];
const completedAttempt = (problem_id: string, lesson: number, order_index: number) => ({
  problem_id, lesson, order_index, completed: true, wrong_count: 0, updated_at: progressTime,
});

test("required completion uses saved attempt IDs even when legacy lesson completion is false", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1,
    [{ lesson: 1, completed: false, updated_at: progressTime }],
    [completedAttempt("required-1", 1, 2)], requiredProblems);
  assert.equal(summary.requiredProgress.completedLessons, 1);
  assert.equal(summary.requiredProgress.totalLessons, 12);
  assert.equal(summary.lessonStates[0], "complete");
  assert.equal(summary.optionalPracticeCount, 0);
});

test("concept and optional completions cannot satisfy required work", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], [
    completedAttempt("concept-1", 1, 1), completedAttempt("optional-1", 1, 3),
  ], requiredProblems);
  assert.equal(summary.requiredProgress.completedLessons, 0);
  assert.equal(summary.optionalPracticeCount, 1);
});

test("wrong or repeated submissions do not inflate required or optional progress", () => {
  const correct = completedAttempt("required-1", 1, 2);
  const optional = completedAttempt("optional-1", 1, 3);
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], [
    correct, correct, optional, optional,
    { ...completedAttempt("required-2", 2, 2), completed: false, wrong_count: 3 },
  ], requiredProblems);
  assert.equal(summary.requiredProgress.completedLessons, 1);
  assert.equal(summary.lessonStates[1], "in_progress");
  assert.equal(summary.optionalPracticeCount, 1);
});

test("all assigned required IDs are needed; an empty required set is not complete", () => {
  const problems = [...requiredProblems, { id: "teacher-required-1", lesson: 1, order_index: 2 }];
  const attempts = [completedAttempt("required-1", 1, 2)];
  assert.equal(summarizeStudentProgress("s1", "학생1", 1, [], attempts, problems).requiredProgress.completedLessons, 0);
  attempts.push(completedAttempt("teacher-required-1", 1, 2));
  assert.equal(summarizeStudentProgress("s1", "학생1", 1, [], attempts, problems).requiredProgress.completedLessons, 1);
  assert.equal(summarizeStudentProgress("s1", "학생1", 1,
    [{ lesson: 3, completed: true, updated_at: progressTime }], [], []).lessonStates[2], "not_started");
});

test("read-time completion preserves the existing activity rules for lessons 9–11", () => {
  const progress = [9, 10, 11].map(lesson => ({ lesson, completed: true, updated_at: progressTime }));
  const summary = summarizeStudentProgress("s1", "학생1", 1, progress,
    [completedAttempt("required-1", 1, 2)], requiredProblems);
  assert.equal(summary.requiredProgress.completedLessons, 4);
  assert.deepEqual(summary.lessonStates.slice(8, 11), ["complete", "complete", "complete"]);
  assert.equal(summary.optionalPracticeCount, 0);
});
