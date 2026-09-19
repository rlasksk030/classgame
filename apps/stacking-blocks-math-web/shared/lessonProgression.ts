/** Required graded work for the live learn → solve → practice route. */
export function requiredSolveIds(problems: ReadonlyArray<{id:string;stage?:string}>) {
  return problems.filter(p => p.stage === 'check').map(p => p.id);
}
