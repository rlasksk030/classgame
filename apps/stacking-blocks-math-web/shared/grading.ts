import {
  blocksEqual,
  canonicalize,
  countBlocks,
  grid2DEqual,
  heightMapEqual,
  project,
  validStructure,
} from "./blocks.ts";
import type {
  GradingMode,
  GridConfig,
  ProblemAnswer,
  ProblemGiven,
  ProblemType,
  Projections,
  StudentSubmission,
} from "./types.ts";

/**
 * 자동채점 (명세 16).
 *
 * 절대 렌더링 화면 픽셀을 비교하지 않는다. 항상 좌표·격자 데이터를 비교한다.
 * 이 파일은 브라우저와 Edge Function 이 똑같이 쓴다.
 */

export interface GradeInput {
  problemType: ProblemType;
  gradingMode: GradingMode;
  answer: ProblemAnswer;
  submission: StudentSubmission;
  given: ProblemGiven;
  grid: GridConfig;
}

export interface GradeVerdict {
  correct: boolean;
  /** 왜 틀렸는지에 대한 짧은 단서. 정답 자체는 담지 않는다. */
  detail: string | null;
}

/** 학생이 쌓은 모양이 주어진 세 방향 조건을 모두 만족하는지 (명세 27 constraint). */
function satisfiesProjections(
  studentBlocks: { x: number; y: number; z: number }[],
  required: Partial<Projections>,
  grid: GridConfig,
): GradeVerdict {
  const actual = project(studentBlocks, grid);

  if (required.top && !grid2DEqual(actual.top, required.top)) {
    return { correct: false, detail: "위에서 본 모양이 조건과 달라요." };
  }
  if (required.front && !grid2DEqual(actual.front, required.front)) {
    return { correct: false, detail: "앞에서 본 모양이 조건과 달라요." };
  }
  if (required.side && !grid2DEqual(actual.side, required.side)) {
    return { correct: false, detail: "옆에서 본 모양이 조건과 달라요." };
  }
  return { correct: true, detail: null };
}

export function grade(input: GradeInput): GradeVerdict {
  const { answer, submission, gradingMode, given, grid, problemType } = input;

  const expectedKinds: Record<ProblemType, StudentSubmission["kind"]> = {
    FREE_BUILD: "blocks", BLOCK_POSITION: "choice", CAMERA_DIRECTION: "direction", PROJECTION_DRAW: "projections",
    COUNT: "count", COUNT_AMBIGUOUS: "count", BUILD_FROM_VIEWS: "blocks", BUILD_FROM_HEIGHTMAP: "blocks",
    HEIGHTMAP_FROM_BUILD: "heightMap", BUILD_FROM_LAYERS: "blocks", LAYER_DRAW: "layers", PATTERN_NEXT: "count", CHOICE: "choice",
  };
  if (submission.kind !== expectedKinds[problemType]) return { correct: false, detail: "문제에 맞는 방식으로 답해 주세요." };

  if (submission.kind === "blocks" && !validStructure(submission.blocks, grid)) {
    return { correct: false, detail: "작업판 안에서 아래부터 차례로 쌓아 주세요." };
  }

  // 자유 쌓기는 정해진 정답이 없다. 최소 개수만 채우면 완료로 본다.
  if (problemType === "FREE_BUILD") {
    if (submission.kind !== "blocks") return { correct: false, detail: null };
    const placed = countBlocks(submission.blocks);
    const need = given.minBlocks ?? 1;
    return placed >= need
      ? { correct: true, detail: null }
      : { correct: false, detail: `쌓기나무를 ${need}개 이상 쌓아 보세요. (지금 ${placed}개)` };
  }

  // --- 블록 쌓기 문제 ---
  if (submission.kind === "blocks") {
    const settled = canonicalize(submission.blocks);

    if (settled.length === 0) {
      return { correct: false, detail: "아직 쌓기나무를 놓지 않았어요." };
    }

    // 조건 만족형: 여러 모양이 모두 정답일 수 있다 (명세 27).
    if (gradingMode === "constraint") {
      const required = given.projections ?? (answer.kind === "projections" ? answer.projections : null);
      if (required) return satisfiesProjections(settled, required, grid);
      if (answer.kind === "heightMap") {
        return heightMapEqual(
          require_heightMap(settled, grid),
          answer.heightMap,
        )
          ? { correct: true, detail: null }
          : { correct: false, detail: "각 자리의 층수가 조건과 달라요." };
      }
    }

    if (answer.kind !== "blocks") {
      return { correct: false, detail: "이 문제는 쌓아서 답하는 문제가 아니에요." };
    }

    if (blocksEqual(settled, answer.blocks)) return { correct: true, detail: null };

    const mine = countBlocks(settled);
    const theirs = countBlocks(answer.blocks);
    if (mine !== theirs) {
      return {
        correct: false,
        detail: `쌓기나무 개수가 달라요. (내가 쌓은 개수: ${mine}개)`,
      };
    }
    return { correct: false, detail: "개수는 맞지만 놓인 자리가 달라요." };
  }

  // --- 개수 문제 ---
  if (submission.kind === "count") {
    if (answer.kind === "count") {
      return submission.value === answer.value
        ? { correct: true, detail: null }
        : { correct: false, detail: "개수를 다시 세어 볼까요?" };
    }
    if (answer.kind === "blocks") {
      return submission.value === countBlocks(answer.blocks)
        ? { correct: true, detail: null }
        : { correct: false, detail: "개수를 다시 세어 볼까요?" };
    }
    return { correct: false, detail: null };
  }

  // --- 방향 문제 ---
  if (submission.kind === "direction") {
    return answer.kind === "direction" && submission.value === answer.value
      ? { correct: true, detail: null }
      : { correct: false, detail: "다른 방향에서 본 모습과 견주어 보세요." };
  }

  // --- 보기 고르기 ---
  if (submission.kind === "choice") {
    return answer.kind === "choice" && submission.index === answer.index
      ? { correct: true, detail: null }
      : { correct: false, detail: null };
  }

  // --- 위/앞/옆 격자 그리기 ---
  if (submission.kind === "projections") {
    if (answer.kind !== "projections") return { correct: false, detail: null };
    const wanted = answer.projections;
    const mine = submission.projections;

    for (const face of ["top", "front", "side"] as const) {
      if (!wanted[face]) continue;
      if (!grid2DEqual(mine[face], wanted[face])) {
        const label = face === "top" ? "위" : face === "front" ? "앞" : "옆";
        return { correct: false, detail: `${label}에서 본 모양을 다시 살펴보세요.` };
      }
    }
    return { correct: true, detail: null };
  }

  // --- 위에서 본 모양에 수 쓰기 ---
  if (submission.kind === "heightMap") {
    const wanted =
      answer.kind === "heightMap"
        ? answer.heightMap
        : answer.kind === "blocks"
          ? require_heightMap(answer.blocks, grid)
          : null;
    if (!wanted) return { correct: false, detail: null };

    return heightMapEqual(submission.heightMap, wanted)
      ? { correct: true, detail: null }
      : { correct: false, detail: "숫자가 다른 자리가 있어요." };
  }

  // --- 층별 격자 ---
  if (submission.kind === "layers") {
    const wanted = answer.kind === "layers" ? answer.layers : null;
    if (!wanted) return { correct: false, detail: null };
    if (submission.layers.length !== wanted.length) {
      return { correct: false, detail: "층 수가 달라요." };
    }
    for (let i = 0; i < wanted.length; i++) {
      if (!grid2DEqual(submission.layers[i], wanted[i])) {
        return { correct: false, detail: `${i + 1}층 모양을 다시 살펴보세요.` };
      }
    }
    return { correct: true, detail: null };
  }

  return { correct: false, detail: null };
}

/** blocks.ts 의 toHeightMap 을 쓰되 canonicalize 를 먼저 태운다. */
function require_heightMap(
  blocks: { x: number; y: number; z: number }[],
  grid: GridConfig,
): number[][] {
  const map: number[][] = Array.from({ length: grid.gridDepth }, () =>
    Array<number>(grid.gridWidth).fill(0),
  );
  for (const b of canonicalize(blocks)) {
    if (b.x < 0 || b.x >= grid.gridWidth || b.z < 0 || b.z >= grid.gridDepth) continue;
    map[b.z][b.x] = Math.max(map[b.z][b.x], Math.min(b.y + 1, grid.maxHeight));
  }
  return map;
}
