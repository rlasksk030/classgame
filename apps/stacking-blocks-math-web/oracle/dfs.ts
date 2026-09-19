/**
 * Independent constraint solver for "given top/front/side, what structures fit"
 * problems (5th/6th lesson family). Does not import shared/blocks.ts or
 * shared/grading.ts — it works entirely in terms of per-column heights and
 * only re-enters the geometry oracle to turn a solution back into blocks.
 *
 * Any structure that respects gravity is exactly a height assignment
 * height(x,z) in [0, maxHeight] for every column. Given that:
 *   - top[z][x]  true  <=> height(x,z) > 0
 *   - front[y][x] true <=> max_z height(x,z) > y   (call this M(x))
 *   - side[y][z'] true <=> max_x height(x,z) > y   (call this N(z), z' is the
 *     mirrored screen index used by the app's "옆" convention)
 * so front/side each pin down a per-row/column maximum, and top pins down
 * which columns must be empty/non-empty. The search assigns each column a
 * height within [0, min(M(x), N(z))] (or exactly 0/>=1 when top constrains
 * it) and prunes as soon as a row's or column's required maximum can no
 * longer be met.
 */

import type { OracleBlock, OracleGrid, OracleGrid2D } from "./geometry.ts";

export interface ConstraintTarget {
  top?: OracleGrid2D;
  front?: OracleGrid2D;
  side?: OracleGrid2D;
}

export type Uniqueness = "NONE" | "UNIQUE" | "MULTIPLE";

export interface ConstraintSolveResult {
  exists: boolean;
  solutionCount: number;
  capped: boolean;
  uniqueness: Uniqueness;
  sampleSolutions: OracleBlock[][];
  nodesVisited: number;
  minCount: number | null;
  maxCount: number | null;
}

const SOLUTION_CAP = 500;
const SAMPLE_LIMIT = 5;
const NODE_BUDGET = 3_000_000;

function columnMaxFromFront(front: OracleGrid2D | undefined, x: number, maxHeight: number): number | undefined {
  if (!front) return undefined;
  let m = 0;
  for (let y = 0; y < maxHeight; y++) if (front[y]?.[x]) m = y + 1;
  return m;
}

function columnMaxFromSide(side: OracleGrid2D | undefined, z: number, gridDepth: number, maxHeight: number): number | undefined {
  if (!side) return undefined;
  const screenIndex = gridDepth - 1 - z;
  let m = 0;
  for (let y = 0; y < maxHeight; y++) if (side[y]?.[screenIndex]) m = y + 1;
  return m;
}

export function solveViewConstraint(target: ConstraintTarget, grid: OracleGrid, options: { solutionCap?: number; exactCount?: number } = {}): ConstraintSolveResult {
  const { gridWidth, gridDepth, maxHeight } = grid;

  const requiredNonEmpty: (boolean | undefined)[][] = Array.from({ length: gridDepth }, (_, z) =>
    Array.from({ length: gridWidth }, (_, x) => (target.top ? Boolean(target.top[z]?.[x]) : undefined)),
  );
  const M = Array.from({ length: gridWidth }, (_, x) => columnMaxFromFront(target.front, x, maxHeight));
  const N = Array.from({ length: gridDepth }, (_, z) => columnMaxFromSide(target.side, z, gridDepth, maxHeight));

  const columns: { x: number; z: number }[] = [];
  for (let z = 0; z < gridDepth; z++) for (let x = 0; x < gridWidth; x++) columns.push({ x, z });

  const heights: number[][] = Array.from({ length: gridDepth }, () => Array(gridWidth).fill(0));
  const colMaxByX = Array(gridWidth).fill(0);
  const colMaxByZ = Array(gridDepth).fill(0);

  let nodesVisited = 0;
  let solutionCount = 0;
  let minCount = Infinity, maxCount = -Infinity;
  let capped = false;
  const sampleSolutions: OracleBlock[][] = [];

  function heightsToBlocks(): OracleBlock[] {
    const blocks: OracleBlock[] = [];
    for (let z = 0; z < gridDepth; z++) {
      for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < heights[z][x]; y++) blocks.push({ x, y, z });
      }
    }
    return blocks;
  }

  function backtrack(index: number): boolean {
    nodesVisited++;
    if (nodesVisited > NODE_BUDGET) { capped = true; return true; }

    if (index === columns.length) {
      const total = heights.reduce((sum, row) => sum + row.reduce((a,b) => a+b, 0), 0);
      if (options.exactCount !== undefined && total !== options.exactCount) return false;
      minCount = Math.min(minCount, total); maxCount = Math.max(maxCount, total);
      solutionCount++;
      if (sampleSolutions.length < SAMPLE_LIMIT) sampleSolutions.push(heightsToBlocks());
      if (solutionCount >= (options.solutionCap ?? SOLUTION_CAP)) { capped = true; return true; }
      return false;
    }

    const { x, z } = columns[index];
    const required = requiredNonEmpty[z][x];
    let upperBound = maxHeight;
    if (M[x] !== undefined) upperBound = Math.min(upperBound, M[x]!);
    if (N[z] !== undefined) upperBound = Math.min(upperBound, N[z]!);

    const domainStart = required === true ? 1 : 0;
    const domainEnd = required === false ? 0 : upperBound;
    if (domainStart > domainEnd) return false;

    const isLastRowForX = z === gridDepth - 1;
    const isLastColumnForZ = x === gridWidth - 1;

    for (let h = domainStart; h <= domainEnd; h++) {
      heights[z][x] = h;
      const prevMaxX = colMaxByX[x];
      const prevMaxZ = colMaxByZ[z];
      colMaxByX[x] = Math.max(colMaxByX[x], h);
      colMaxByZ[z] = Math.max(colMaxByZ[z], h);

      const feasible =
        (!isLastRowForX || M[x] === undefined || colMaxByX[x] === M[x]) &&
        (!isLastColumnForZ || N[z] === undefined || colMaxByZ[z] === N[z]);

      if (feasible) {
        const stop = backtrack(index + 1);
        if (stop) {
          heights[z][x] = 0;
          colMaxByX[x] = prevMaxX;
          colMaxByZ[z] = prevMaxZ;
          return true;
        }
      }

      heights[z][x] = 0;
      colMaxByX[x] = prevMaxX;
      colMaxByZ[z] = prevMaxZ;
    }
    return false;
  }

  backtrack(0);

  const uniqueness: Uniqueness = solutionCount === 0 ? "NONE" : solutionCount === 1 ? "UNIQUE" : "MULTIPLE";
  return {
    exists: solutionCount > 0,
    solutionCount,
    capped,
    uniqueness,
    sampleSolutions,
    nodesVisited,
    minCount: solutionCount ? minCount : null, maxCount: solutionCount ? maxCount : null,
  };
}

/** Distinct total block counts among the sampled solutions (bounded by SAMPLE_LIMIT unless capped=false and solutionCount is small). */
export function distinctBlockCounts(result: ConstraintSolveResult): number[] {
  return [...new Set(result.sampleSolutions.map((blocks) => blocks.length))].sort((a, b) => a - b);
}
