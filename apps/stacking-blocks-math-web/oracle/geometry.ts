/**
 * Independent math oracle for the stacking-blocks curriculum.
 *
 * Contract: this file (and every other file under oracle/) must NEVER import
 * shared/blocks.ts or shared/grading.ts. It reimplements the same physical
 * rules (gravity, projections, height maps, layer maps, viewing directions)
 * from scratch, using a different internal algorithm (occupancy-set lookups
 * instead of single-pass array mutation) so that a bug shared between the
 * app's geometry and its own audits cannot hide from cross-checking.
 *
 * The viewing convention encoded here (front = -z, "옆" = observed from +x /
 * the right, "뒤"/"왼쪽" mirror front/side horizontally) is the documented
 * spec convention (see shared/spatialConventions.ts comments, QUALITY_GATE.md
 * DIR-01), not a copy of any implementation.
 */

export interface OracleBlock {
  x: number;
  y: number;
  z: number;
}

export interface OracleGrid {
  gridWidth: number;
  gridDepth: number;
  maxHeight: number;
}

export type OracleGrid2D = boolean[][];
export type OracleHeightMap = number[][];
export type OracleDirection = "top" | "front" | "back" | "left" | "right";

export interface OracleProjections {
  top: OracleGrid2D;
  front: OracleGrid2D;
  side: OracleGrid2D;
}

function key(x: number, y: number, z: number): string {
  return `${x}|${y}|${z}`;
}

/** Builds a set of occupied cells. Every other function reads from this set only. */
function occupancyOf(blocks: OracleBlock[]): Set<string> {
  const occupied = new Set<string>();
  for (const b of blocks) {
    occupied.add(key(Math.trunc(b.x), Math.trunc(b.y), Math.trunc(b.z)));
  }
  return occupied;
}

function emptyGrid2D(rows: number, cols: number): OracleGrid2D {
  return Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
}

function emptyHeightMap(rows: number, cols: number): OracleHeightMap {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(0));
}

/** Removes duplicate coordinates. Does not sort or otherwise "settle" the shape. */
export function oracleDedupe(blocks: OracleBlock[]): OracleBlock[] {
  const seen = new Set<string>();
  const result: OracleBlock[] = [];
  for (const b of blocks) {
    const x = Math.trunc(b.x);
    const y = Math.trunc(b.y);
    const z = Math.trunc(b.z);
    const k = key(x, y, z);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push({ x, y, z });
  }
  return result;
}

export function oracleBlockCount(blocks: OracleBlock[]): number {
  return oracleDedupe(blocks).length;
}

/**
 * Independent physical-validity check: every occupied column (x,z) must be
 * filled contiguously from y=0 upward with no gaps (no floating blocks), all
 * coordinates must be in-bounds integers, and no coordinate may repeat.
 *
 * This is logically equivalent to "a block at y>0 needs a block at y-1 in the
 * same column" but is computed by collecting each column's height set and
 * checking it equals exactly {0,...,h-1}, a different algorithm from a
 * per-block neighbor lookup.
 */
export function oracleIsValidStructure(blocks: OracleBlock[], grid: OracleGrid): boolean {
  if (!Array.isArray(blocks)) return false;
  if (blocks.length > grid.gridWidth * grid.gridDepth * grid.maxHeight) return false;

  const seen = new Set<string>();
  const columnHeights = new Map<string, number[]>();

  for (const b of blocks) {
    if (!b || !Number.isInteger(b.x) || !Number.isInteger(b.y) || !Number.isInteger(b.z)) return false;
    if (b.x < 0 || b.x >= grid.gridWidth) return false;
    if (b.z < 0 || b.z >= grid.gridDepth) return false;
    if (b.y < 0 || b.y >= grid.maxHeight) return false;

    const cellKey = key(b.x, b.y, b.z);
    if (seen.has(cellKey)) return false;
    seen.add(cellKey);

    const columnKey = `${b.x}|${b.z}`;
    const heights = columnHeights.get(columnKey) ?? [];
    heights.push(b.y);
    columnHeights.set(columnKey, heights);
  }

  for (const heights of columnHeights.values()) {
    const sorted = [...heights].sort((a, c) => a - c);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i) return false;
    }
  }
  return true;
}

/** Independent top/front/right-side projection, derived by scanning the grid against an occupancy set. */
export function oracleProject(blocks: OracleBlock[], grid: OracleGrid): OracleProjections {
  const occupied = occupancyOf(blocks);
  const top = emptyGrid2D(grid.gridDepth, grid.gridWidth);
  const front = emptyGrid2D(grid.maxHeight, grid.gridWidth);
  const side = emptyGrid2D(grid.maxHeight, grid.gridDepth);

  for (let z = 0; z < grid.gridDepth; z++) {
    for (let x = 0; x < grid.gridWidth; x++) {
      let any = false;
      for (let y = 0; y < grid.maxHeight; y++) {
        if (occupied.has(key(x, y, z))) { any = true; break; }
      }
      top[z][x] = any;
    }
  }

  for (let y = 0; y < grid.maxHeight; y++) {
    for (let x = 0; x < grid.gridWidth; x++) {
      let any = false;
      for (let z = 0; z < grid.gridDepth; z++) {
        if (occupied.has(key(x, y, z))) { any = true; break; }
      }
      front[y][x] = any;
    }
  }

  // "옆"에서 본 모습은 오른쪽(+x)에서 바라본 모습이며, 화면 오른쪽은 -z 방향이다.
  for (let y = 0; y < grid.maxHeight; y++) {
    for (let z = 0; z < grid.gridDepth; z++) {
      let any = false;
      for (let x = 0; x < grid.gridWidth; x++) {
        if (occupied.has(key(x, y, z))) { any = true; break; }
      }
      side[y][grid.gridDepth - 1 - z] = any;
    }
  }

  return { top, front, side };
}

/**
 * Independent view for any of the five directions taught in this unit.
 * back/left mirror front/side horizontally because walking around to the
 * opposite side of the model swaps the observer's sense of left and right.
 */
export function oracleDirectionView(blocks: OracleBlock[], grid: OracleGrid, direction: OracleDirection): OracleGrid2D {
  const occupied = occupancyOf(blocks);

  if (direction === "top") {
    const g = emptyGrid2D(grid.gridDepth, grid.gridWidth);
    for (let z = 0; z < grid.gridDepth; z++) {
      for (let x = 0; x < grid.gridWidth; x++) {
        let any = false;
        for (let y = 0; y < grid.maxHeight; y++) if (occupied.has(key(x, y, z))) { any = true; break; }
        g[z][x] = any;
      }
    }
    return g;
  }

  if (direction === "front" || direction === "back") {
    const g = emptyGrid2D(grid.maxHeight, grid.gridWidth);
    for (let y = 0; y < grid.maxHeight; y++) {
      for (let screenX = 0; screenX < grid.gridWidth; screenX++) {
        const x = direction === "front" ? screenX : grid.gridWidth - 1 - screenX;
        let any = false;
        for (let z = 0; z < grid.gridDepth; z++) if (occupied.has(key(x, y, z))) { any = true; break; }
        g[y][screenX] = any;
      }
    }
    return g;
  }

  // left/right
  const g = emptyGrid2D(grid.maxHeight, grid.gridDepth);
  for (let y = 0; y < grid.maxHeight; y++) {
    for (let screenZ = 0; screenZ < grid.gridDepth; screenZ++) {
      const z = direction === "right" ? grid.gridDepth - 1 - screenZ : screenZ;
      let any = false;
      for (let x = 0; x < grid.gridWidth; x++) if (occupied.has(key(x, y, z))) { any = true; break; }
      g[y][screenZ] = any;
    }
  }
  return g;
}

/** How many of the five directions produce the exact same 2D image as `direction`. Length 1 means unambiguous. */
export function oracleEquivalentDirections(blocks: OracleBlock[], grid: OracleGrid, direction: OracleDirection): OracleDirection[] {
  const target = oracleDirectionView(blocks, grid, direction);
  const all: OracleDirection[] = ["top", "front", "back", "left", "right"];
  return all.filter((candidate) => oracleGrid2DEqual(oracleDirectionView(blocks, grid, candidate), target));
}

/** Independent height map: scanned top-down per column, stopping at the first occupied cell. */
export function oracleHeightMap(blocks: OracleBlock[], grid: OracleGrid): OracleHeightMap {
  const occupied = occupancyOf(blocks);
  const map = emptyHeightMap(grid.gridDepth, grid.gridWidth);
  for (let z = 0; z < grid.gridDepth; z++) {
    for (let x = 0; x < grid.gridWidth; x++) {
      let height = 0;
      for (let y = grid.maxHeight - 1; y >= 0; y--) {
        if (occupied.has(key(x, y, z))) { height = y + 1; break; }
      }
      map[z][x] = height;
    }
  }
  return map;
}

/** Independent per-layer grids. layers[0] is the first (bottom) floor. */
export function oracleLayers(blocks: OracleBlock[], grid: OracleGrid): OracleGrid2D[] {
  const occupied = occupancyOf(blocks);
  const layers: OracleGrid2D[] = [];
  for (let y = 0; y < grid.maxHeight; y++) {
    const layer = emptyGrid2D(grid.gridDepth, grid.gridWidth);
    for (let z = 0; z < grid.gridDepth; z++) {
      for (let x = 0; x < grid.gridWidth; x++) layer[z][x] = occupied.has(key(x, y, z));
    }
    layers.push(layer);
  }
  return layers;
}

/** Number of `true` cells in a 2D grid. Used to check "no hidden blocks" style counting claims. */
export function oracleCountTrueCells(grid: OracleGrid2D | undefined): number {
  if (!grid) return 0;
  let count = 0;
  for (const row of grid) for (const cell of row) if (cell) count++;
  return count;
}

/**
 * Maximum total block count consistent with a given front silhouette in a box
 * of the given depth, assuming no other constraint (no top/side view given).
 * For each x, let h(x) be the front silhouette's height (front is physically
 * contiguous from y=0). Every one of the gridDepth columns behind that x can
 * independently be filled up to h(x) without changing the front silhouette,
 * so the maximum is sum(h(x)) * gridDepth.
 */
export function oracleMaxBlocksForFrontSilhouette(front: OracleGrid2D, gridDepth: number): number {
  if (front.length === 0) return 0;
  const width = front[0]?.length ?? 0;
  let total = 0;
  for (let x = 0; x < width; x++) {
    let height = 0;
    for (let y = 0; y < front.length; y++) if (front[y][x]) height = y + 1;
    total += height;
  }
  return total * gridDepth;
}

export function oracleGrid2DEqual(a?: OracleGrid2D, b?: OracleGrid2D): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
  }
  return true;
}

export function oracleHeightMapEqual(a?: OracleHeightMap, b?: OracleHeightMap): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
  }
  return true;
}

export function oracleLayersEqual(a?: OracleGrid2D[], b?: OracleGrid2D[]): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((layer, index) => oracleGrid2DEqual(layer, b[index]));
}

export function oracleBlocksEqual(a: OracleBlock[], b: OracleBlock[]): boolean {
  const sortKey = (blocks: OracleBlock[]) =>
    oracleDedupe(blocks)
      .slice()
      .sort((p, q) => p.y - q.y || p.z - q.z || p.x - q.x);
  const sa = sortKey(a);
  const sb = sortKey(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].x !== sb[i].x || sa[i].y !== sb[i].y || sa[i].z !== sb[i].z) return false;
  }
  return true;
}
