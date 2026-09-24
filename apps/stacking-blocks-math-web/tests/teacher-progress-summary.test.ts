import test from "node:test";
import assert from "node:assert/strict";
import { summarizeStudentProgress, overallProgressStatus } from "../shared/teacherProgress.ts";

// Teacher Page Expansion Phase 2A: this is the exact function
// teacher:progress:summary calls per student (imported directly from
// shared/, not reimplemented here), so these tests exercise the real
// aggregation code path, not a copy of it.

test("A. a student with zero rows is fully not_started, currentLesson defaults to 1", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], []);
  assert.deepEqual(summary.lessonStates, Array(12).fill("not_started"));
  assert.equal(summary.currentLesson, 1);
  assert.equal(summary.requiredProgress.completedLessons, 0);
  assert.equal(summary.wrongCount, 0);
  assert.equal(summary.optionalPracticeCount, 0);
  assert.equal(summary.lastActivityAt, null);
});

test("lesson classification: completed progress row -> complete, attempt-only -> in_progress, neither -> not_started", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [{ lesson: 2, wrong_count: 1, completed: false, updated_at: "2026-01-02T00:00:00Z" }],
  );
  assert.equal(summary.lessonStates[0], "complete"); // lesson 1
  assert.equal(summary.lessonStates[1], "in_progress"); // lesson 2
  assert.equal(summary.lessonStates[2], "not_started"); // lesson 3
});

test("a lesson with an incomplete sb_student_progress row but attempts recorded is in_progress, not complete", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 5, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
    [{ lesson: 5, wrong_count: 2, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
  );
  assert.equal(summary.lessonStates[4], "in_progress");
});

test("requiredProgress.completedLessons counts only lessons marked complete, out of a fixed totalLessons=12", () => {
  const progress = [1, 2, 3].map((lesson) => ({ lesson, completed: true, updated_at: "2026-01-01T00:00:00Z" }));
  const summary = summarizeStudentProgress("s1", "학생1", 1, progress, []);
  assert.equal(summary.requiredProgress.completedLessons, 3);
  assert.equal(summary.requiredProgress.totalLessons, 12);
});

test("wrongCount sums wrong_count across every attempt row, regardless of lesson", () => {
  const attempts = [
    { lesson: 1, wrong_count: 2, completed: true, updated_at: "2026-01-01T00:00:00Z" },
    { lesson: 2, wrong_count: 3, completed: false, updated_at: "2026-01-01T00:00:00Z" },
    { lesson: 3, wrong_count: 0, completed: true, updated_at: "2026-01-01T00:00:00Z" },
  ];
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], attempts);
  assert.equal(summary.wrongCount, 5);
});

test("optionalPracticeCount = completed attempts beyond the one-per-completed-lesson minimum, never negative", () => {
  // 2 completed lessons, but 5 completed attempts total -> 3 "extra".
  const progress = [1, 2].map((lesson) => ({ lesson, completed: true, updated_at: "2026-01-01T00:00:00Z" }));
  const attempts = Array.from({ length: 5 }, () => ({ lesson: 1, wrong_count: 0, completed: true, updated_at: "2026-01-01T00:00:00Z" }));
  const summary = summarizeStudentProgress("s1", "학생1", 1, progress, attempts);
  assert.equal(summary.optionalPracticeCount, 3);

  // More completed lessons than completed attempts (shouldn't happen in
  // practice, but must never go negative).
  const oddSummary = summarizeStudentProgress("s2", "학생2", 2, progress, []);
  assert.equal(oddSummary.optionalPracticeCount, 0);
});

test("lastActivityAt is the max updated_at across both progress and attempt rows", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [{ lesson: 2, wrong_count: 0, completed: false, updated_at: "2026-03-01T00:00:00Z" }],
  );
  assert.equal(summary.lastActivityAt, "2026-03-01T00:00:00Z");
});

test("currentLesson is the highest lesson number touched by either progress or attempts", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 3, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [{ lesson: 7, wrong_count: 1, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
  );
  assert.equal(summary.currentLesson, 7);
});

test("overallProgressStatus: no progress at all -> not_started", () => {
  const summary = summarizeStudentProgress("s1", "학생1", 1, [], []);
  assert.equal(overallProgressStatus(summary), "not_started");
});

test("overallProgressStatus: some progress but lesson 12 not complete -> in_progress", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 1, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [],
  );
  assert.equal(overallProgressStatus(summary), "in_progress");
});

test("overallProgressStatus: lesson 12 complete -> complete (whole-course proxy)", () => {
  const summary = summarizeStudentProgress(
    "s1", "학생1", 1,
    [{ lesson: 12, completed: true, updated_at: "2026-01-01T00:00:00Z" }],
    [],
  );
  assert.equal(overallProgressStatus(summary), "complete");
});

test("studentNo/name/studentId pass through unchanged", () => {
  const summary = summarizeStudentProgress("sid-123", "김민수", 7, [], []);
  assert.equal(summary.studentId, "sid-123");
  assert.equal(summary.name, "김민수");
  assert.equal(summary.studentNo, 7);
});
