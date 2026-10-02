import { lessonCompleted, type ProgressProblemRow } from './lessonProgression.ts';
import { practiceDisplaySeed, selectPracticeRows } from './practiceSet.ts';

export interface HomeProblemRow extends ProgressProblemRow { code?: string | null; active?: boolean }

/** Home and lessonProblems use the same selected set, including legacy-seed recovery. */
export function homeLessonProgress(
  lesson: number, problems: ReadonlyArray<HomeProblemRow>,
  attempts: ReadonlyArray<{ problem_id: string; completed: boolean }>,
  activityCompleted: boolean, savedSeed: number, originalSeed: number,
) {
  const rows = problems.filter(p => p.lesson === lesson && p.active !== false);
  const displayedSeed = practiceDisplaySeed(rows, lesson, savedSeed, originalSeed);
  const visible = selectPracticeRows(rows, lesson, displayedSeed);
  const done = new Set(attempts.filter(a => a.completed).map(a => a.problem_id));
  const completed = lessonCompleted(lesson, activityCompleted, visible, done);
  const required = visible.filter(p => p.order_index === 2);
  const optional = visible.filter(p => p.order_index > 2);
  const activity = lesson >= 9 && lesson <= 11;
  return {
    completed,
    // Preserve the old DTO meaning for older clients: actual visible questions.
    totalProblems: activity ? 1 : visible.length,
    completedProblems: activity ? Number(completed) : visible.filter(p => done.has(p.id)).length,
    requiredTotal: activity ? 1 : required.length,
    requiredCompleted: activity ? Number(completed) : required.filter(p => done.has(p.id)).length,
    optionalTotal: activity ? 0 : optional.length,
    optionalCompleted: activity ? 0 : optional.filter(p => done.has(p.id)).length,
    displayedSeed,
  };
}

export function practiceSeedForStudent(studentId:string, lesson:number):number {
  let hash=lesson;
  for(const char of studentId) hash=((hash*31)+char.charCodeAt(0))|0;
  return Math.abs(hash)%1000000;
}
