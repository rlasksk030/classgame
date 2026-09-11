import type {
  Direction,
  Grid2D,
  GridConfig,
  HeightMap,
  ProblemAnswer,
  ProblemGiven,
  ProblemType,
} from "./types.ts";
import { answerRendererFor } from "./answerUi.ts";

export const VISIBLE_REPRESENTATIONS = [
  "MODEL_3D", "TOP_VIEW", "FRONT_VIEW", "SIDE_VIEW", "BACK_VIEW", "LEFT_VIEW", "RIGHT_VIEW",
  "HEIGHT_MAP", "LAYER_MAP", "BLOCK_COUNT", "TEXT_HINT",
] as const;
export type VisibleRepresentation = (typeof VISIBLE_REPRESENTATIONS)[number];
export type PresentationAnswerInput = "MULTIPLE_CHOICE" | "NUMBER" | "GRID" | "THREE_GRIDS" | "HEIGHT_MAP" | "LAYER_MAP" | "BLOCK_BUILD";
export type CameraPresentationPolicy = "FREE" | "FIXED" | "LIMITED";
export type PresentationGridKey = "top" | "front" | "side" | "heightMap" | "layerMap";

export interface ProblemPresentation {
  visibleRepresentations: VisibleRepresentation[];
  cameraPolicy: { mode: CameraPresentationPolicy; initialDirection?: Direction; allowedDirections?: Direction[] };
  answerInput: PresentationAnswerInput;
  gridSpecs: Partial<Record<PresentationGridKey, { rows: number; cols: number }>>;
  instructions: string[];
}

type PresentationInput = {
  problemType: ProblemType;
  grid: GridConfig;
  given: ProblemGiven;
  answer?: ProblemAnswer;
};

const spec = (rows: number, cols: number) => ({ rows, cols });
const specForGrid = (rows: Grid2D | HeightMap | undefined) => rows ? spec(rows.length, rows[0]?.length ?? 0) : undefined;
const camera = (given: ProblemGiven): ProblemPresentation["cameraPolicy"] => ({
  mode: given.allowRotate === false ? "FIXED" : "FREE",
  initialDirection: given.shownFrom,
  allowedDirections: given.allowRotate === false ? (given.shownFrom ? [given.shownFrom] : undefined) : undefined,
});

export function deriveProblemPresentation(input: PresentationInput): ProblemPresentation {
  const { problemType, grid, given, answer } = input;
  const visible: VisibleRepresentation[] = ["MODEL_3D"];
  let answerInput: PresentationAnswerInput;
  const gridSpecs: ProblemPresentation["gridSpecs"] = {};
  const instructions: string[] = [];
  const addProjection = (face: "top" | "front" | "side") => {
    const value = given.projections?.[face];
    if (!value) return;
    visible.push(face === "top" ? "TOP_VIEW" : face === "front" ? "FRONT_VIEW" : "SIDE_VIEW");
    gridSpecs[face] = specForGrid(value)!;
  };

  if (problemType === "CAMERA_DIRECTION") {
    addProjection(given.shownFrom === "top" ? "top" : given.shownFrom === "left" || given.shownFrom === "right" ? "side" : "front");
    answerInput = "MULTIPLE_CHOICE";
  } else if (problemType === "PROJECTION_DRAW") {
    const target = given.projections ?? (answer?.kind === "projections" ? answer.projections : undefined);
    const visibleTarget = given.projections ?? {};
    (Object.keys(visibleTarget) as ("top" | "front" | "side")[]).forEach(addProjection);
    (Object.keys(target ?? {}) as ("top" | "front" | "side")[]).forEach(face => {
      if (!gridSpecs[face]) gridSpecs[face] = specForGrid(target?.[face])!;
    });
    answerInput = Object.keys(target ?? {}).length === 3 ? "THREE_GRIDS" : "GRID";
  } else if (problemType === "BUILD_FROM_VIEWS") {
    addProjection("top"); addProjection("front"); addProjection("side");
    answerInput = "BLOCK_BUILD";
    instructions.push("표시된 위·앞·옆 조건을 모두 만족하도록 쌓아 보세요.");
  } else if (problemType === "BUILD_FROM_HEIGHTMAP") {
    if (given.heightMap) { visible.push("HEIGHT_MAP"); gridSpecs.heightMap = specForGrid(given.heightMap)!; }
    answerInput = "BLOCK_BUILD";
  } else if (problemType === "BUILD_FROM_LAYERS") {
    if (given.layers?.length) { visible.push("LAYER_MAP"); gridSpecs.layerMap = specForGrid(given.layers[0])!; }
    answerInput = "BLOCK_BUILD";
  } else if (problemType === "HEIGHTMAP_FROM_BUILD") {
    answerInput = "HEIGHT_MAP";
    gridSpecs.heightMap = spec(grid.gridDepth, grid.gridWidth);
  } else if (problemType === "LAYER_DRAW") {
    answerInput = "LAYER_MAP";
    gridSpecs.layerMap = spec(grid.gridDepth, grid.gridWidth);
  } else if (problemType === "COUNT" || problemType === "COUNT_AMBIGUOUS") {
    if (given.heightMap) { visible.push("HEIGHT_MAP"); gridSpecs.heightMap = specForGrid(given.heightMap)!; }
    if (given.layers?.length) { visible.push("LAYER_MAP"); gridSpecs.layerMap = specForGrid(given.layers[0])!; }
    answerInput = "NUMBER";
  } else if (problemType === "CHOICE") {
    addProjection("top"); addProjection("front"); addProjection("side");
    if (given.heightMap) { visible.push("HEIGHT_MAP"); gridSpecs.heightMap = specForGrid(given.heightMap)!; }
    if (given.layers?.length) { visible.push("LAYER_MAP"); gridSpecs.layerMap = specForGrid(given.layers[0])!; }
    answerInput = "MULTIPLE_CHOICE";
  } else if (problemType === "FREE_BUILD") {
    answerInput = "BLOCK_BUILD";
  } else {
    answerInput = answer?.kind === "count" ? "NUMBER" : "MULTIPLE_CHOICE";
  }

  if (given.allowRotate === false) instructions.push("지금은 지정된 방향에서만 살펴볼 수 있어요.");
  return { visibleRepresentations: [...new Set(visible)], cameraPolicy: camera(given), answerInput, gridSpecs, instructions };
}

function hasProjection(given: ProblemGiven, face: "top" | "front" | "side") {
  return Boolean(given.projections?.[face]?.length && given.projections?.[face]?.[0]?.length);
}

export function validateProblemPresentation(input: PresentationInput): string[] {
  const p = deriveProblemPresentation(input);
  const errors: string[] = [];
  const has = (value: VisibleRepresentation) => p.visibleRepresentations.includes(value);
  if (!has("MODEL_3D")) errors.push("MODEL_3D 누락");
  if (!answerRendererFor(p.answerInput)) errors.push("답안 Renderer 누락");
  if (input.problemType === "CAMERA_DIRECTION" && !hasProjection(input.given, input.given.shownFrom === "top" ? "top" : input.given.shownFrom === "left" || input.given.shownFrom === "right" ? "side" : "front")) errors.push("방향 비교 투영 누락");
  if (input.problemType === "PROJECTION_DRAW" && !(input.given.projections && Object.keys(input.given.projections).length || input.answer?.kind === "projections" && Object.keys(input.answer.projections).length)) errors.push("그릴 투영 누락");
  if (input.problemType === "BUILD_FROM_VIEWS" && !(["top", "front", "side"] as const).every(face => hasProjection(input.given, face))) errors.push("세 방향 조건 누락");
  if (input.problemType === "BUILD_FROM_HEIGHTMAP" && !has("HEIGHT_MAP")) errors.push("높이 지도 누락");
  if (input.problemType === "BUILD_FROM_LAYERS" && !has("LAYER_MAP")) errors.push("층별 지도 누락");
  if ((input.problemType === "COUNT" || input.problemType === "COUNT_AMBIGUOUS") && input.given.heightMap && !has("HEIGHT_MAP")) errors.push("개수 문제 높이 지도 누락");
  if ((input.problemType === "COUNT" || input.problemType === "COUNT_AMBIGUOUS") && input.given.layers?.length && !has("LAYER_MAP")) errors.push("개수 문제 층별 지도 누락");
  for (const [key, value] of Object.entries(p.gridSpecs)) if (!value.rows || !value.cols) errors.push(`${key} 격자 크기 누락`);
  if (input.problemType === "HEIGHTMAP_FROM_BUILD" && p.answerInput !== "HEIGHT_MAP") errors.push("높이 지도 입력 방식 불일치");
  if (input.problemType === "LAYER_DRAW" && p.answerInput !== "LAYER_MAP") errors.push("층별 지도 입력 방식 불일치");
  if (input.problemType === "BUILD_FROM_VIEWS" && p.answerInput !== "BLOCK_BUILD") errors.push("세 방향 쌓기 입력 방식 불일치");
  return errors;
}
