/**
 * Pure aggregation for the teacher "수업 결과" (lesson result summary)
 * feature (Teacher Page Expansion Phase 3C). Kept dependency-free, same
 * reason as shared/teacherProgress.ts.
 *
 * No new table: this aggregates the existing sb_problem_attempts /
 * sb_student_progress / sb_problems rows for one class + one lesson.
 * Problem-type labels reuse the existing PROBLEM_TYPE_LABELS map (no new
 * duplicate Korean-label list) so student-facing terminology stays
 * consistent everywhere.
 */

import { PROBLEM_TYPE_LABELS, type ProblemType } from "./types.ts";

export interface ResultAttemptRow {
  student_id: string;
  problem_id: string;
  wrong_count: number;
}

export interface ResultProgressRow {
  student_id: string;
  completed: boolean;
}

export interface ResultProblemRow {
  id: string;
  problem_type: ProblemType;
  code: string | null;
}

export interface ProblemTypeStat {
  problemType: ProblemType;
  label: string;
  attempts: number;
  wrongAttempts: number;
  /** % of attempts of this type that had at least one wrong submission. */
  wrongRate: number;
}

export interface LessonResultSummary {
  lesson: number;
  totalStudents: number;
  participatedStudents: number;
  completedStudents: number;
  /** % of totalStudents that completed the lesson. */
  completionRate: number;
  /** average total wrong_count per participating student, one decimal place. */
  averageWrongCount: number;
  totalAttempts: number;
  optionalPracticeParticipants: number;
  optionalPracticeAttempts: number;
  /** sorted by wrongRate descending -- the client shows the top few as "많이 어려워한 유형". */
  problemTypeStats: ProblemTypeStat[];
}

export function summarizeLessonResults(
  lesson: number,
  totalStudents: number,
  attempts: ResultAttemptRow[],
  progress: ResultProgressRow[],
  problems: ResultProblemRow[],
): LessonResultSummary {
  const problemById = new Map(problems.map((p) => [p.id, p]));
  const participatedStudentIds = new Set(attempts.map((a) => a.student_id));
  const completedStudentIds = new Set(progress.filter((p) => p.completed).map((p) => p.student_id));

  const wrongByStudent = new Map<string, number>();
  for (const a of attempts) wrongByStudent.set(a.student_id, (wrongByStudent.get(a.student_id) ?? 0) + a.wrong_count);
  const participatedCount = participatedStudentIds.size;
  const averageWrongCount = participatedCount
    ? Math.round(
        (Array.from(participatedStudentIds).reduce((sum, id) => sum + (wrongByStudent.get(id) ?? 0), 0) / participatedCount) * 10,
      ) / 10
    : 0;

  // 선택 연습(GENERATED_PRACTICE) 문제는 코드가 GEN-L<lesson>- 로 시작한다
  // (shared/practiceSet.ts의 generatedProblemId 규칙과 동일).
  const genPrefix = `GEN-L${lesson}-`;
  const optionalAttempts = attempts.filter((a) => problemById.get(a.problem_id)?.code?.startsWith(genPrefix));
  const optionalPracticeParticipants = new Set(optionalAttempts.map((a) => a.student_id)).size;

  const byType = new Map<ProblemType, { attempts: number; wrongAttempts: number }>();
  for (const a of attempts) {
    const type = problemById.get(a.problem_id)?.problem_type;
    if (!type) continue;
    const entry = byType.get(type) ?? { attempts: 0, wrongAttempts: 0 };
    entry.attempts += 1;
    if (a.wrong_count > 0) entry.wrongAttempts += 1;
    byType.set(type, entry);
  }
  const problemTypeStats: ProblemTypeStat[] = Array.from(byType.entries())
    .map(([problemType, stat]) => ({
      problemType,
      label: PROBLEM_TYPE_LABELS[problemType],
      attempts: stat.attempts,
      wrongAttempts: stat.wrongAttempts,
      wrongRate: stat.attempts ? Math.round((stat.wrongAttempts / stat.attempts) * 100) : 0,
    }))
    .sort((a, b) => b.wrongRate - a.wrongRate);

  return {
    lesson,
    totalStudents,
    participatedStudents: participatedCount,
    completedStudents: completedStudentIds.size,
    completionRate: totalStudents ? Math.round((completedStudentIds.size / totalStudents) * 100) : 0,
    averageWrongCount,
    totalAttempts: attempts.length,
    optionalPracticeParticipants,
    optionalPracticeAttempts: optionalAttempts.length,
    problemTypeStats,
  };
}
