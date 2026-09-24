import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLessonResults } from "../shared/teacherResults.ts";
import { PROBLEM_TYPE_LABELS } from "../shared/types.ts";

// Teacher Page Expansion Phase 3C: exact function teacher:results:summary
// calls for one class + one lesson.

test("I/J. participation and completion counts, and completionRate = completed/totalStudents", () => {
  const attempts = [
    { student_id: "s1", problem_id: "p1", wrong_count: 1 },
    { student_id: "s2", problem_id: "p1", wrong_count: 0 },
  ];
  const progress = [
    { student_id: "s1", completed: true },
    { student_id: "s2", completed: false },
  ];
  const problems = [{ id: "p1", problem_type: "COUNT" as const, code: "L1-01" }];
  const summary = summarizeLessonResults(1, 4, attempts, progress, problems);
  assert.equal(summary.totalStudents, 4);
  assert.equal(summary.participatedStudents, 2, "s1 and s2 both attempted");
  assert.equal(summary.completedStudents, 1, "only s1 is complete");
  assert.equal(summary.completionRate, 25, "1/4 = 25%, not 1/participated");
});

test("K. averageWrongCount = mean of per-student total wrong_count, only over participating students, rounded to 1 decimal", () => {
  const attempts = [
    { student_id: "s1", problem_id: "p1", wrong_count: 2 },
    { student_id: "s1", problem_id: "p2", wrong_count: 1 }, // s1 total = 3
    { student_id: "s2", problem_id: "p1", wrong_count: 0 }, // s2 total = 0
  ];
  const summary = summarizeLessonResults(1, 5, attempts, [], [{ id: "p1", problem_type: "COUNT", code: null }, { id: "p2", problem_type: "COUNT", code: null }]);
  assert.equal(summary.participatedStudents, 2);
  assert.equal(summary.averageWrongCount, 1.5, "(3+0)/2 participating students");
});

test("no attempts at all -> zeroed summary, no division by zero", () => {
  const summary = summarizeLessonResults(3, 10, [], [], []);
  assert.equal(summary.participatedStudents, 0);
  assert.equal(summary.completedStudents, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.averageWrongCount, 0);
  assert.deepEqual(summary.problemTypeStats, []);
});

test("L. optionalPracticeParticipants/Attempts only count problems whose code is GEN-L<lesson>-... for the SAME lesson", () => {
  const attempts = [
    { student_id: "s1", problem_id: "required", wrong_count: 0 },
    { student_id: "s1", problem_id: "extra1", wrong_count: 0 },
    { student_id: "s2", problem_id: "extra2", wrong_count: 1 },
    { student_id: "s3", problem_id: "otherLessonExtra", wrong_count: 0 },
  ];
  const problems = [
    { id: "required", problem_type: "COUNT" as const, code: "L5-01" },
    { id: "extra1", problem_type: "COUNT" as const, code: "GEN-L5-S1-01-V1" },
    { id: "extra2", problem_type: "COUNT" as const, code: "GEN-L5-S2-01-V1" },
    { id: "otherLessonExtra", problem_type: "COUNT" as const, code: "GEN-L6-S1-01-V1" }, // different lesson, must not count
  ];
  const summary = summarizeLessonResults(5, 10, attempts, [], problems);
  assert.equal(summary.optionalPracticeParticipants, 2, "s1 and s2, not s3 (different lesson's generated problem)");
  assert.equal(summary.optionalPracticeAttempts, 2);
});

test("M. problem-type attempts/wrongAttempts/wrongRate aggregate correctly and sort by wrongRate descending", () => {
  const attempts = [
    { student_id: "s1", problem_id: "count1", wrong_count: 1 },
    { student_id: "s2", problem_id: "count2", wrong_count: 0 },
    { student_id: "s1", problem_id: "cam1", wrong_count: 2 },
    { student_id: "s2", problem_id: "cam2", wrong_count: 3 },
  ];
  const problems = [
    { id: "count1", problem_type: "COUNT" as const, code: null },
    { id: "count2", problem_type: "COUNT" as const, code: null },
    { id: "cam1", problem_type: "CAMERA_DIRECTION" as const, code: null },
    { id: "cam2", problem_type: "CAMERA_DIRECTION" as const, code: null },
  ];
  const summary = summarizeLessonResults(2, 10, attempts, [], problems);
  const byType = new Map(summary.problemTypeStats.map((s) => [s.problemType, s]));
  assert.deepEqual(byType.get("COUNT"), { problemType: "COUNT", label: PROBLEM_TYPE_LABELS.COUNT, attempts: 2, wrongAttempts: 1, wrongRate: 50 });
  assert.deepEqual(byType.get("CAMERA_DIRECTION"), { problemType: "CAMERA_DIRECTION", label: PROBLEM_TYPE_LABELS.CAMERA_DIRECTION, attempts: 2, wrongAttempts: 2, wrongRate: 100 });
  assert.equal(summary.problemTypeStats[0].problemType, "CAMERA_DIRECTION", "100% wrongRate sorts first");
});

test("N. every problemTypeStats label comes from the existing student-facing PROBLEM_TYPE_LABELS map -- no raw enum leak, no second label list", () => {
  const attempts = [{ student_id: "s1", problem_id: "p1", wrong_count: 0 }];
  const problems = [{ id: "p1", problem_type: "HEIGHTMAP_FROM_BUILD" as const, code: null }];
  const summary = summarizeLessonResults(7, 5, attempts, [], problems);
  assert.equal(summary.problemTypeStats[0].label, PROBLEM_TYPE_LABELS.HEIGHTMAP_FROM_BUILD);
  assert.notEqual(summary.problemTypeStats[0].label, "HEIGHTMAP_FROM_BUILD", "must not be the raw enum value");
});

test("attempts referencing a problem_id with no matching problem row are silently excluded from type stats (never crash)", () => {
  const attempts = [{ student_id: "s1", problem_id: "missing", wrong_count: 1 }];
  const summary = summarizeLessonResults(1, 5, attempts, [], []);
  assert.equal(summary.totalAttempts, 1, "still counted toward totalAttempts/participation");
  assert.deepEqual(summary.problemTypeStats, [], "but excluded from per-type breakdown since its type is unknown");
});
