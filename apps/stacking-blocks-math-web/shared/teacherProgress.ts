/**
 * Pure aggregation for the teacher "학생 진도" table (Teacher Page Expansion
 * Phase 2A). Kept dependency-free so it can be imported both by the
 * student-api Edge Function (Deno) and by plain node:test unit tests --
 * the edge function itself can't be imported directly (it calls
 * Deno.serve() at module scope), so logic that needs real test coverage
 * lives here instead of inline in index.ts.
 */

import { lessonCompleted, type ProgressProblemRow } from "./lessonProgression.ts";

export type LessonProgressState = "not_started" | "in_progress" | "complete";

export interface ProgressSourceRow {
  lesson: number;
  completed: boolean;
  updated_at: string;
}

export interface AttemptSourceRow {
  problem_id: string;
  /** Metadata of this attempted problem, joined in the same bulk query. */
  order_index?: number;
  lesson: number;
  wrong_count: number;
  completed: boolean;
  updated_at: string;
}

export interface StudentProgressSummary {
  studentId: string;
  name: string;
  studentNo: number | null;
  currentLesson: number;
  lessonStates: LessonProgressState[];
  requiredProgress: { completedLessons: number; totalLessons: 12 };
  wrongCount: number;
  optionalPracticeCount: number;
  lastActivityAt: string | null;
}

/** One student's rows (already bulk-fetched for the whole class -- never fetched per student). */
export function summarizeStudentProgress(
  studentId: string,
  name: string,
  studentNo: number | null,
  progress: ProgressSourceRow[],
  attempts: AttemptSourceRow[],
  problems: ReadonlyArray<ProgressProblemRow>,
): StudentProgressSummary {
  const progressByLesson = new Map(progress.map((row) => [row.lesson, row]));
  const completedIds = new Set(attempts.filter(row => row.completed && row.problem_id).map(row => row.problem_id!));

  const lessonStates: LessonProgressState[] = Array.from({ length: 12 }, (_, index) => {
    const lesson = index + 1;
    if (lessonCompleted(lesson, progressByLesson.get(lesson)?.completed ?? false, problems, completedIds)) return "complete";
    if (progressByLesson.has(lesson) || attempts.some((a) => a.lesson === lesson)) return "in_progress";
    return "not_started";
  });

  const completedLessons = lessonStates.filter((s) => s === "complete").length;
  const wrongCount = attempts.reduce((sum, a) => sum + a.wrong_count, 0);
  const orderByProblem = new Map(problems.map(problem => [problem.id, problem.order_index]));
  const optionalPracticeCount = new Set(attempts.filter(attempt =>
    attempt.completed && attempt.problem_id && (attempt.order_index ?? orderByProblem.get(attempt.problem_id) ?? 0) > 2,
  ).map(attempt => attempt.problem_id)).size;

  const latest = latestLearningEvent([...progress, ...attempts]);
  const lastActivityAt = latest?.updated_at ?? null;
  const currentLesson = latest?.lesson ?? 1;

  return {
    studentId,
    name,
    studentNo,
    currentLesson,
    lessonStates,
    requiredProgress: { completedLessons, totalLessons: 12 },
    wrongCount,
    optionalPracticeCount,
    lastActivityAt,
  };
}

/** The most recent persisted learning event; lesson number only breaks timestamp ties. */
export function latestLearningEvent<T extends { lesson: number; updated_at: string }>(rows: ReadonlyArray<T>): T | null {
  return rows.filter(row => row.lesson >= 1 && row.lesson <= 12 && Number.isFinite(Date.parse(row.updated_at)))
    .reduce<T | null>((latest, row) => !latest || Date.parse(row.updated_at) > Date.parse(latest.updated_at)
      || (Date.parse(row.updated_at) === Date.parse(latest.updated_at) && row.lesson > latest.lesson) ? row : latest, null);
}

/** All twelve lessons, including activities, must be complete. */
export function overallProgressStatus(summary: Pick<StudentProgressSummary, "lessonStates">): LessonProgressState {
  const anyProgress = summary.lessonStates.some((s) => s !== "not_started");
  if (!anyProgress) return "not_started";
  if (summary.lessonStates.length === 12 && summary.lessonStates.every(state => state === "complete")) return "complete";
  return "in_progress";
}
