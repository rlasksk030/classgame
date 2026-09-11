import { project } from "./blocks.ts";
import type { BlockCoord, Direction, Grid2D, GridConfig, Projections } from "./types.ts";

/** 입체 좌표와 화면 방향을 연결하는 단일 규칙입니다. */
export const AXIS_CONVENTIONS = {
  x: "좌우 (+x는 오른쪽)",
  y: "높이 (y=0은 1층)",
  z: "앞뒤 (+z는 뒤쪽)",
} as const;

export const DIRECTION_LABELS: Record<Direction, string> = {
  front: "앞",
  back: "뒤",
  left: "왼쪽",
  right: "오른쪽",
  top: "위",
};

/** 화면에서 보이는 가로 방향을 반전합니다. */
export function mirrorHorizontal(grid: Grid2D): Grid2D {
  return grid.map((row) => [...row].reverse());
}

/** 블록 좌표에서 특정 카메라 방향으로 본 2D 모양을 계산합니다. */
export function projectionForDirection(
  blocks: BlockCoord[],
  grid: GridConfig,
  direction: Direction,
): Grid2D {
  const projections: Projections = project(blocks, grid);
  switch (direction) {
    case "top":
      return projections.top;
    case "front":
      return projections.front;
    case "back":
      return mirrorHorizontal(projections.front);
    case "right":
      return projections.side;
    case "left":
      return mirrorHorizontal(projections.side);
  }
}

/** 단일 정답 방향 문제에서 같은 그림을 만드는 방향이 있는지 검사합니다. */
export function equivalentDirections(
  blocks: BlockCoord[],
  grid: GridConfig,
  direction: Direction,
): Direction[] {
  const wanted = JSON.stringify(projectionForDirection(blocks, grid, direction));
  return (["front", "back", "left", "right", "top"] as Direction[]).filter(
    (candidate) => JSON.stringify(projectionForDirection(blocks, grid, candidate)) === wanted,
  );
}

export function hasUniqueDirectionProjection(
  blocks: BlockCoord[],
  grid: GridConfig,
  direction: Direction,
): boolean {
  return equivalentDirections(blocks, grid, direction).length === 1;
}
