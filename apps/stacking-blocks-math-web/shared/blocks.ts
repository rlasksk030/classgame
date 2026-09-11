import type { BlockCoord, Grid2D, GridConfig, HeightMap, Projections } from "./types.ts";

/**
 * 쌓기나무 좌표를 다루는 핵심 모듈.
 *
 * 여기서 정한 규칙을 학생 화면, 교사 제작기, 채점이 모두 똑같이 쓴다.
 * 화면 픽셀을 비교하는 곳은 어디에도 없다 (명세 16).
 */

export function keyOf(c: BlockCoord): string {
  return `${c.x},${c.y},${c.z}`;
}

/**
 * 저장·비교 전에 항상 같은 규칙으로 정렬한다 (명세 7).
 * 중복 좌표도 함께 걸러낸다.
 */
export function canonicalize(blocks: BlockCoord[]): BlockCoord[] {
  const seen = new Set<string>();
  const unique: BlockCoord[] = [];

  for (const b of blocks) {
    const c = { x: Math.trunc(b.x), y: Math.trunc(b.y), z: Math.trunc(b.z) };
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  return unique.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
}

export function blocksEqual(a: BlockCoord[], b: BlockCoord[]): boolean {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) {
    if (ca[i].x !== cb[i].x || ca[i].y !== cb[i].y || ca[i].z !== cb[i].z) return false;
  }
  return true;
}

export function hasBlockAt(blocks: BlockCoord[], x: number, y: number, z: number): boolean {
  return blocks.some((b) => b.x === x && b.y === y && b.z === z);
}

export function inBounds(c: BlockCoord, grid: GridConfig): boolean {
  return (
    c.x >= 0 &&
    c.x < grid.gridWidth &&
    c.z >= 0 &&
    c.z < grid.gridDepth &&
    c.y >= 0 &&
    c.y < grid.maxHeight
  );
}

/** (x,z) 자리에 쌓인 높이. 곧 그 자리에 새로 놓을 y 값이기도 하다. */
export function columnHeight(blocks: BlockCoord[], x: number, z: number): number {
  let height = 0;
  for (const b of blocks) {
    if (b.x === x && b.z === z && b.y + 1 > height) height = b.y + 1;
  }
  return height;
}

// ---------------------------------------------------------------------------
// 물리 규칙 (명세 11)
// ---------------------------------------------------------------------------

export type PlaceRejection = "out_of_bounds" | "occupied" | "floating" | "too_high";

export interface PlaceCheck {
  ok: boolean;
  reason?: PlaceRejection;
  message?: string;
}

const REJECTION_MESSAGES: Record<PlaceRejection, string> = {
  out_of_bounds: "작업판 밖에는 놓을 수 없어요.",
  occupied: "그 자리에는 이미 쌓기나무가 있어요.",
  floating: "쌓기나무는 공중에 뜰 수 없어요. 아래를 먼저 채워 주세요.",
  too_high: "더 높이 쌓을 수 없어요.",
};

/** 공중에 뜬 블록을 막는다. y>0 이면 바로 아래 칸에 블록이 있어야 한다. */
export function canPlace(blocks: BlockCoord[], target: BlockCoord, grid: GridConfig): PlaceCheck {
  if (target.y >= grid.maxHeight) {
    return { ok: false, reason: "too_high", message: REJECTION_MESSAGES.too_high };
  }
  if (!inBounds(target, grid)) {
    return { ok: false, reason: "out_of_bounds", message: REJECTION_MESSAGES.out_of_bounds };
  }
  if (hasBlockAt(blocks, target.x, target.y, target.z)) {
    return { ok: false, reason: "occupied", message: REJECTION_MESSAGES.occupied };
  }
  if (target.y > 0 && !hasBlockAt(blocks, target.x, target.y - 1, target.z)) {
    return { ok: false, reason: "floating", message: REJECTION_MESSAGES.floating };
  }
  return { ok: true };
}

/** (x,z) 기둥 맨 위에 한 칸 올린다. 드래그해서 놓을 때 쓰는 기본 동작. */
export function placeOnColumn(
  blocks: BlockCoord[],
  x: number,
  z: number,
  grid: GridConfig,
): { blocks: BlockCoord[]; check: PlaceCheck } {
  const target = { x, y: columnHeight(blocks, x, z), z };
  const check = canPlace(blocks, target, grid);
  if (!check.ok) return { blocks, check };
  return { blocks: canonicalize([...blocks, target]), check };
}

/**
 * 삭제 정책 A (명세 11): 위에 블록이 있으면 아래 블록은 지울 수 없다.
 * 교육용으로는 이 쪽이 안전하다 - 지웠더니 위 블록이 내려앉는 혼란이 없다.
 */
export function canRemove(blocks: BlockCoord[], target: BlockCoord): PlaceCheck {
  if (!hasBlockAt(blocks, target.x, target.y, target.z)) {
    return { ok: false, message: "그 자리에는 쌓기나무가 없어요." };
  }
  if (hasBlockAt(blocks, target.x, target.y + 1, target.z)) {
    return {
      ok: false,
      message: "위에 쌓인 쌓기나무를 먼저 빼 주세요.",
    };
  }
  return { ok: true };
}

export function removeBlock(
  blocks: BlockCoord[],
  target: BlockCoord,
): { blocks: BlockCoord[]; check: PlaceCheck } {
  const check = canRemove(blocks, target);
  if (!check.ok) return { blocks, check };
  return {
    blocks: blocks.filter((b) => !(b.x === target.x && b.y === target.y && b.z === target.z)),
    check,
  };
}

/** 기둥 맨 위 한 칸을 뺀다. 터치 환경에서 누르기 쉬운 삭제 방식. */
export function removeTopOfColumn(
  blocks: BlockCoord[],
  x: number,
  z: number,
): { blocks: BlockCoord[]; check: PlaceCheck } {
  const height = columnHeight(blocks, x, z);
  if (height === 0) return { blocks, check: { ok: false, message: "그 자리에는 쌓기나무가 없어요." } };
  return removeBlock(blocks, { x, y: height - 1, z });
}

/** 블록 하나를 다른 기둥으로 옮긴다. 옮길 수 없으면 원래대로 둔다. */
export function moveBlock(
  blocks: BlockCoord[],
  from: BlockCoord,
  toX: number,
  toZ: number,
  grid: GridConfig,
): { blocks: BlockCoord[]; check: PlaceCheck } {
  const removal = removeBlock(blocks, from);
  if (!removal.check.ok) return { blocks, check: removal.check };

  const placement = placeOnColumn(removal.blocks, toX, toZ, grid);
  if (!placement.check.ok) return { blocks, check: placement.check };

  return { blocks: placement.blocks, check: { ok: true } };
}

// ---------------------------------------------------------------------------
// 표현 변환
// ---------------------------------------------------------------------------

export function countBlocks(blocks: BlockCoord[]): number {
  return canonicalize(blocks).length;
}

export function emptyGrid2D(rows: number, cols: number): Grid2D {
  return Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
}

export function emptyHeightMap(grid: GridConfig): HeightMap {
  return Array.from({ length: grid.gridDepth }, () => Array<number>(grid.gridWidth).fill(0));
}

export function toHeightMap(blocks: BlockCoord[], grid: GridConfig): HeightMap {
  const map = emptyHeightMap(grid);
  for (const b of blocks) {
    if (b.x < 0 || b.x >= grid.gridWidth || b.z < 0 || b.z >= grid.gridDepth) continue;
    map[b.z][b.x] = Math.max(map[b.z][b.x], Math.min(b.y + 1, grid.maxHeight));
  }
  return map;
}

export function fromHeightMap(map: HeightMap): BlockCoord[] {
  const blocks: BlockCoord[] = [];
  for (let z = 0; z < map.length; z++) {
    for (let x = 0; x < map[z].length; x++) {
      for (let y = 0; y < map[z][x]; y++) blocks.push({ x, y, z });
    }
  }
  return canonicalize(blocks);
}

/** 공중에 뜬 블록을 아래로 내려 항상 유효한 모양으로 만든다. */
export function settle(blocks: BlockCoord[], grid: GridConfig): BlockCoord[] {
  return fromHeightMap(toHeightMap(blocks, grid));
}

/**
 * 위·앞·옆에서 본 모양을 계산한다 (명세 24).
 *
 * 화면에 보이는 그대로의 순서로 만든다. 즉 격자를 그대로 출력하면
 * 3D 화면에서 해당 시점 버튼을 눌렀을 때와 좌우가 일치한다.
 *   위  : 카메라 +y, 화면 오른쪽 = +x, 화면 아래 = +z  → top[z][x]
 *   앞  : 카메라 -z, 화면 오른쪽 = +x, 화면 위 = +y    → front[y][x]
 *   옆  : 카메라 +x(오른쪽 옆), 화면 오른쪽 = -z       → side[y][depth-1-z]
 */
export function project(blocks: BlockCoord[], grid: GridConfig): Projections {
  const top = emptyGrid2D(grid.gridDepth, grid.gridWidth);
  const front = emptyGrid2D(grid.maxHeight, grid.gridWidth);
  const side = emptyGrid2D(grid.maxHeight, grid.gridDepth);

  for (const b of blocks) {
    if (b.z >= 0 && b.z < grid.gridDepth && b.x >= 0 && b.x < grid.gridWidth) top[b.z][b.x] = true;
    if (b.y >= 0 && b.y < grid.maxHeight) {
      if (b.x >= 0 && b.x < grid.gridWidth) front[b.y][b.x] = true;
      if (b.z >= 0 && b.z < grid.gridDepth) side[b.y][grid.gridDepth - 1 - b.z] = true;
    }
  }

  return { top, front, side };
}

/** 층별 격자 (명세 29). layers[0] 이 1층. */
export function toLayers(blocks: BlockCoord[], grid: GridConfig): Grid2D[] {
  const layers: Grid2D[] = Array.from({ length: grid.maxHeight }, () =>
    emptyGrid2D(grid.gridDepth, grid.gridWidth),
  );
  for (const b of blocks) {
    if (b.y < 0 || b.y >= grid.maxHeight) continue;
    if (b.z < 0 || b.z >= grid.gridDepth) continue;
    if (b.x < 0 || b.x >= grid.gridWidth) continue;
    layers[b.y][b.z][b.x] = true;
  }
  return layers;
}

export function fromLayers(layers: Grid2D[]): BlockCoord[] {
  const blocks: BlockCoord[] = [];
  layers.forEach((layer, y) => {
    layer.forEach((row, z) => {
      row.forEach((filled, x) => {
        if (filled) blocks.push({ x, y, z });
      });
    });
  });
  return canonicalize(blocks);
}

export function grid2DEqual(a: Grid2D | undefined, b: Grid2D | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] !== b[i][j]) return false;
    }
  }
  return true;
}

export function heightMapEqual(a: HeightMap | undefined, b: HeightMap | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let z = 0; z < a.length; z++) {
    if (a[z].length !== b[z].length) return false;
    for (let x = 0; x < a[z].length; x++) {
      if (a[z][x] !== b[z][x]) return false;
    }
  }
  return true;
}

/** 몇 층까지 쌓였는지. 층별 보기 컨트롤의 최대값으로 쓴다. */
export function usedHeight(blocks: BlockCoord[]): number {
  return blocks.reduce((max, b) => Math.max(max, b.y + 1), 0);
}

/** 층별 개수. 4차시 '층별로 나누어 세기' 전략에 쓴다. */
export function countByLayer(blocks: BlockCoord[], grid: GridConfig): number[] {
  const counts = Array<number>(grid.maxHeight).fill(0);
  for (const b of blocks) {
    if (b.y >= 0 && b.y < grid.maxHeight) counts[b.y]++;
  }
  return counts;
}
