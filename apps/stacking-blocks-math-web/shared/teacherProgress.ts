/**
 * Pure aggregation for the teacher "학생 진도" table (Teacher Page Expansion
 * Phase 2A). Kept dependency-free so it can be imported both by the
 * student-api Edge Function (Deno) and by plain node:test unit tests --
 * the edge function itself can't be imported directly (it calls
 * Deno.serve() at module scope), so logic that needs real test coverage
 * lives here instead of inline in index.ts.
 */

export type LessonProgressState = "not_started" | "in_progress" | "complete";

export interface ProgressSourceRow {
  lesson: number;
  completed: boolean;
  updated_at: string;
}

export interface AttemptSourceRow {
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
): StudentProgressSummary {
  const progressByLesson = new Map(progress.map((row) => [row.lesson, row]));

  const lessonStates: LessonProgressState[] = Array.from({ length: 12 }, (_, index) => {
    const lesson = index + 1;
    if (progressByLesson.get(lesson)?.completed) return "complete";
    if (attempts.some((a) => a.lesson === lesson)) return "in_progress";
    return "not_started";
  });

  const completedLessons = lessonStates.filter((s) => s === "complete").length;
  const wrongCount = attempts.reduce((sum, a) => sum + a.wrong_count, 0);
  const completedAttempts = attempts.filter((a) => a.completed).length;
  // "선택 연습" = 각 차시를 완료시킨 최소 1건을 넘어서는 완료 시도 수 --
  // 정확한 필수/선택 문제 분류(학생별 생성 연습문제 뱅크 조회)는 N+1을
  // 유발하므로, 이미 가진 데이터로 계산 가능한 근사값을 쓴다.
  const optionalPracticeCount = Math.max(0, completedAttempts - completedLessons);

  const activityTimestamps = [
    ...attempts.map((a) => a.updated_at),
    ...progress.map((p) => p.updated_at),
  ].filter(Boolean);
  const lastActivityAt = activityTimestamps.length
    ? activityTimestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
    : null;

  const touchedLessons = [...attempts.map((a) => a.lesson), ...progress.map((p) => p.lesson)];
  const currentLesson = touchedLessons.length ? Math.max(...touchedLessons) : 1;

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

/** 학생 1명의 전체 진행 상태를 3단계로 요약한다 (12차시 완료 = 전체 과정 완료로 간주). */
export function overallProgressStatus(summary: Pick<StudentProgressSummary, "lessonStates">): LessonProgressState {
  const anyProgress = summary.lessonStates.some((s) => s !== "not_started");
  if (!anyProgress) return "not_started";
  if (summary.lessonStates[11] === "complete") return "complete";
  return "in_progress";
}
