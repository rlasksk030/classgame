import { canonicalize, project } from './blocks.ts';
import type { SeedProblem } from './seedProblems.ts';
type Task = Pick<SeedProblem,'prompt'|'problemType'|'grid'|'given'|'givenBlocks'|'choices'> & Partial<Pick<SeedProblem,'generatorVersion'|'seed'|'code'>>;
/** 공개 과제만 비교한다. ID/seed/정답/비공개 모형은 중복 판단 근거가 아니다. */
export function taskFingerprint(p: Task): string {
  const { projections, heightMap, layers, allowRotate, allowLayerView, shownFrom, note } = p.given;
  const evidence = projections || heightMap || layers;
  const model = allowRotate === false ? (evidence ? undefined : project(p.givenBlocks,p.grid).front) : canonicalize(p.givenBlocks);
  return JSON.stringify({prompt:p.generatorVersion===3?undefined:p.prompt.normalize('NFKC').replace(/\s+/g,' ').trim(), reasoning:p.given.reasoning, type:p.problemType, grid:p.grid,
    projections, heightMap, layers, allowRotate, allowLayerView, shownFrom, note, model, choices:[...p.choices].sort()});
}
export function duplicateTaskCount(tasks: Task[]): number {
  return tasks.length-new Set(tasks.map(taskFingerprint)).size;
}
