/** Required graded work for the live learn → solve → practice route. */
export function requiredSolveIds(problems: ReadonlyArray<{id:string;stage?:string}>) {
  return problems.filter(p => p.stage === 'check').map(p => p.id);
}

export function requiredSolveComplete(
  problems: ReadonlyArray<{ id: string; stage?: string }>,
  completedIds: ReadonlySet<string>,
): boolean {
  const requiredIds = requiredSolveIds(problems);
  return requiredIds.length > 0 && requiredIds.every(id => completedIds.has(id));
}

/** The live database contract: guided/concept <= 1, required = 2, optional > 2. */
export function problemStage(orderIndex: number): "concept" | "check" | "more" {
  return orderIndex <= 1 ? "concept" : orderIndex === 2 ? "check" : "more";
}

export interface ProgressProblemRow { id: string; lesson: number; order_index: number }

/** Derive ordinary lessons from saved answers; activities keep their own completion contract. */
export function lessonCompleted(
  lesson: number,
  activityCompleted: boolean,
  problems: ReadonlyArray<ProgressProblemRow>,
  completedIds: ReadonlySet<string>,
): boolean {
  if (lesson >= 9 && lesson <= 11) return activityCompleted;
  return requiredSolveComplete(
    problems.filter(problem => problem.lesson === lesson).map(problem => ({ id: problem.id, stage: problemStage(problem.order_index) })),
    completedIds,
  );
}
