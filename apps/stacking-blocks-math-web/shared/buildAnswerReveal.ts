/**
 * Global 3D answer reveal: for BUILD_FROM_VIEWS ("세 방향 보고 쌓기"),
 * the curriculum answer is stored as the three given projections
 * (constraint-graded -- many shapes satisfy the same silhouettes, so
 * there is no single canonical block answer). To still show a 3D ghost
 * on reveal, this synthesizes ONE witness structure that satisfies the
 * given projections, reusing the existing constraint solver the
 * curriculum itself is validated with (oracle/dfs.ts) rather than
 * duplicating that search.
 *
 * Kept dependency-free (only imports oracle/*, which never imports
 * shared/) so it's usable from the edge function and unit-testable
 * directly with node:test, same pattern as shared/teacherProgress.ts.
 */

import { solveViewConstraint } from "../oracle/dfs.ts";
import type { OracleBlock, OracleGrid, OracleGrid2D } from "../oracle/geometry.ts";

export interface PartialProjectionTarget {
  top?: OracleGrid2D;
  front?: OracleGrid2D;
  side?: OracleGrid2D;
}

/** Returns one valid block arrangement satisfying the given projections, or null if none exists (should not happen for real curriculum data, but never throws either way). */
export function synthesizeBuildFromViewsGhost(projections: PartialProjectionTarget, grid: OracleGrid): OracleBlock[] | null {
  try {
    const solved = solveViewConstraint(projections, grid);
    return solved.sampleSolutions[0] ?? null;
  } catch {
    return null;
  }
}
