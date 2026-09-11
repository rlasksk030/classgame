import { fromHeightMap, project, toHeightMap, toLayers } from "./blocks.ts";
import type {
  BlockCoord,
  GradingMode,
  Grid2D,
  GridConfig,
  ProblemAnswer,
  ProblemGiven,
  ProblemType,
} from "./types.ts";

/**
 * 기본 문제 데이터 (명세 21~32).
 *
 * 교과서 삽화를 복제하지 않고 새로 만든 모양이다.
 * 정답으로 쓰는 투영·층별 자료는 손으로 적지 않고 모양에서 계산해 낸다.
 * 그래야 값이 어긋날 일이 없다.
 */

export interface SeedProblem {
  stage?: "concept" | "check" | "more";
  code: string;
  lesson: number;
  orderIndex: number;
  problemType: ProblemType;
  title: string;
  prompt: string;
  grid: GridConfig;
  givenBlocks: BlockCoord[];
  startBlocks: BlockCoord[];
  given: ProblemGiven;
  choices: string[];
  answer: ProblemAnswer;
  gradingMode: GradingMode;
  hint: string;
  explanation: string;
  difficulty: 1 | 2 | 3;
  xp: number;
}

/** 높이 지도 문자열을 블록 좌표로. 윗줄이 z=0(뒤쪽 줄)이다. */
function shape(...rows: string[]): BlockCoord[] {
  return fromHeightMap(rows.map((row) => [...row.replace(/\s/g, "")].map(Number)));
}

/** 격자 문자열을 2D 격자로. '#' 이 채워진 칸. */
function grid2d(...rows: string[]): Grid2D {
  return rows.map((row) => [...row.replace(/\s/g, "")].map((ch) => ch === "#"));
}

const G3: GridConfig = { gridWidth: 3, gridDepth: 3, maxHeight: 3 };
const G4: GridConfig = { gridWidth: 4, gridDepth: 4, maxHeight: 4 };

// --- 이 단원에서 쓰는 모양들 ------------------------------------------------
const S1 = shape("221", "120", "000"); // 8개
const S2 = shape("120", "011", "000"); // 5개
const S3 = shape("221", "100", "000"); // 6개
const S4 = shape("2100", "3210", "1000", "0000"); // 10개
const S5 = shape("2200", "1210", "0100", "0000"); // 9개
const S6 = shape("221", "120", "100"); // 9개
const S7 = shape("2130", "1220", "0110", "0000"); // 13개
const S8 = shape("3310", "2210", "1100", "0000"); // 14개
// 층마다 삼각수(10, 6, 3, 1)로 줄어드는 모양. 8차시 규칙 찾기에 쓴다.
const S8P = shape("4321", "3210", "2100", "1000"); // 20개
const S12 = shape("2310", "1221", "0110", "0000"); // 14개

function countOf(blocks: BlockCoord[]): number {
  return blocks.length;
}

export const SEED_PROBLEMS: SeedProblem[] = [
  // =========================================================================
  // 1차시 - 쌓기나무와 친해지기 (명세 22)
  // =========================================================================
  {
    code: "L1-01",
    lesson: 1,
    orderIndex: 1,
    problemType: "COUNT",
    title: "2층에 있는 쌓기나무",
    prompt:
      "화면을 돌려 가며 살펴보세요.\n이 모양에서 2층에 놓인 쌓기나무는 모두 몇 개인가요?",
    grid: G3,
    givenBlocks: S1,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true, countOf: "layer", countLayer: 2 },
    choices: [],
    answer: { kind: "count", value: S1.filter((b) => b.y === 1).length },
    gradingMode: "exact",
    hint: "[층별 보기]에서 2층만 켜 두면 세기 쉬워요.",
    explanation:
      "2층은 바닥에서 두 번째 칸이에요. 1층 위에 올라간 쌓기나무만 세면 됩니다.",
    difficulty: 1,
    xp: 30,
  },
  {
    code: "L1-02",
    lesson: 1,
    orderIndex: 2,
    problemType: "COUNT",
    title: "모두 몇 개일까요",
    prompt: "이 모양을 만드는 데 쓰인 쌓기나무는 모두 몇 개인가요?",
    grid: G3,
    givenBlocks: S2,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "count", value: countOf(S2) },
    gradingMode: "exact",
    hint: "한 자리씩 짚어 가며 '이 자리는 몇 층'인지 세어 보세요.",
    explanation: "자리마다 쌓인 층수를 모두 더하면 전체 개수가 됩니다.",
    difficulty: 1,
    xp: 30,
  },
  {
    code: "L1-03",
    lesson: 1,
    orderIndex: 3,
    problemType: "FREE_BUILD",
    title: "내 마음대로 쌓아 보기",
    prompt:
      "쌓기나무를 6개 이상 자유롭게 쌓아 보세요.\n다 쌓았으면 화면을 돌려 여러 방향에서 살펴보세요.",
    grid: G3,
    givenBlocks: [],
    startBlocks: [],
    given: { minBlocks: 6, allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "count", value: 6 },
    gradingMode: "constraint",
    hint: "쌓기나무는 공중에 뜰 수 없어요. 아래부터 채워 가며 쌓아 보세요.",
    explanation: "같은 개수로도 아주 다양한 모양을 만들 수 있어요.",
    difficulty: 1,
    xp: 30,
  },

  // =========================================================================
  // 2차시 - 어느 방향에서 본 모양일까요 (1) (명세 23)
  // =========================================================================
  {
    code: "L2-01",
    lesson: 2,
    orderIndex: 1,
    problemType: "CAMERA_DIRECTION",
    title: "이 사진은 어디에서 찍었을까",
    prompt:
      "아래 격자는 이 모양을 어느 방향에서 본 모습입니다.\n어느 방향에서 본 것인지 고르세요.",
    grid: G3,
    givenBlocks: S2,
    startBlocks: [],
    given: {
      projections: { front: project(S2, G3).front },
      shownFrom: "front",
      allowRotate: true,
    },
    choices: [],
    answer: { kind: "direction", value: "front" },
    gradingMode: "exact",
    hint: "3D 화면에서 [앞에서 보기], [옆에서 보기]를 눌러 가며 격자와 견주어 보세요.",
    explanation:
      "같은 모양이라도 보는 방향이 달라지면 보이는 모습이 달라집니다.",
    difficulty: 1,
    xp: 30,
  },
  {
    code: "L2-02",
    lesson: 2,
    orderIndex: 2,
    problemType: "CAMERA_DIRECTION",
    title: "위에서 내려다본 모습",
    prompt: "아래 격자는 어느 방향에서 본 모습인가요?",
    grid: G3,
    givenBlocks: S3,
    startBlocks: [],
    given: {
      projections: { top: project(S3, G3).top },
      shownFrom: "top",
      allowRotate: true,
    },
    choices: [],
    answer: { kind: "direction", value: "top" },
    gradingMode: "exact",
    hint: "칸이 채워진 자리에 쌓기나무가 '있다'는 뜻이에요. 높이는 알 수 없어요.",
    explanation:
      "위에서 본 모양은 각 자리에 쌓기나무가 있는지만 알려 줍니다. 몇 층인지는 알 수 없어요.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L2-03",
    lesson: 2,
    orderIndex: 3,
    problemType: "CAMERA_DIRECTION",
    title: "옆에서 본 모습 찾기",
    prompt: "아래 격자는 어느 방향에서 본 모습인가요?",
    grid: G3,
    givenBlocks: S6,
    startBlocks: [],
    given: {
      projections: { side: project(S6, G3).side },
      shownFrom: "right",
      allowRotate: true,
    },
    choices: [],
    answer: { kind: "direction", value: "right" },
    gradingMode: "exact",
    hint: "[옆에서 보기] 버튼을 누른 화면과 격자를 나란히 두고 비교해 보세요.",
    explanation: "옆에서 보면 좌우 자리는 겹쳐 보이고, 앞뒤 자리가 좌우로 펼쳐집니다.",
    difficulty: 2,
    xp: 30,
  },

  // =========================================================================
  // 3차시 - 위·앞·옆에서 본 모양 그리기 (명세 24)
  // =========================================================================
  {
    code: "L3-01",
    lesson: 3,
    orderIndex: 1,
    problemType: "PROJECTION_DRAW",
    title: "위에서 본 모양 그리기",
    prompt: "이 모양을 위에서 본 모양을 오른쪽 격자에 그려 보세요.",
    grid: G3,
    givenBlocks: S3,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: { top: project(S3, G3).top } },
    gradingMode: "exact",
    hint: "[위에서 보기] 버튼을 누르면 확인하기 쉬워요. 높이는 신경 쓰지 않아요.",
    explanation:
      "위에서 본 모양은 쌓기나무가 놓인 '자리'만 나타냅니다.",
    difficulty: 1,
    xp: 30,
  },
  {
    code: "L3-02",
    lesson: 3,
    orderIndex: 2,
    problemType: "PROJECTION_DRAW",
    title: "앞에서 본 모양 그리기",
    prompt: "이 모양을 앞에서 본 모양을 격자에 그려 보세요.",
    grid: G3,
    givenBlocks: S6,
    startBlocks: [],
    given: { allowRotate: true },
    choices: [],
    answer: { kind: "projections", projections: { front: project(S6, G3).front } },
    gradingMode: "exact",
    hint: "앞에서 보면 뒤에 있는 쌓기나무는 앞의 것에 가려집니다. 가장 높은 층까지 칠해 보세요.",
    explanation:
      "앞에서 본 모양은 각 줄에서 '가장 높은 층'까지 칸이 채워집니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L3-03",
    lesson: 3,
    orderIndex: 3,
    problemType: "PROJECTION_DRAW",
    title: "위·앞·옆 모두 그리기",
    prompt: "이 모양의 위, 앞, 옆에서 본 모양을 모두 그려 보세요.",
    grid: G4,
    givenBlocks: S5,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: project(S5, G4) },
    gradingMode: "exact",
    hint: "한 방향씩 차례대로 하세요. 시점 버튼을 누르고 바로 그 격자를 채우면 헷갈리지 않아요.",
    explanation:
      "세 방향에서 본 모양을 모두 그리면 입체 모양을 훨씬 정확하게 설명할 수 있습니다.",
    difficulty: 3,
    xp: 30,
  },

  // =========================================================================
  // 4차시 - 쌓기나무의 개수 알아보기 (명세 25)
  // =========================================================================
  {
    code: "L4-01",
    lesson: 4,
    orderIndex: 1,
    problemType: "COUNT",
    title: "자리별 높이로 세기",
    prompt:
      "위에서 본 모양의 각 자리에 쌓인 층수가 오른쪽에 적혀 있습니다.\n쌓기나무는 모두 몇 개인가요?",
    grid: G4,
    givenBlocks: S4,
    startBlocks: [],
    given: { heightMap: toHeightMap(S4, G4), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "count", value: countOf(S4) },
    gradingMode: "exact",
    hint: "적힌 숫자를 모두 더하면 됩니다.",
    explanation:
      "자리별 높이를 모두 더하는 방법이에요. 숫자 지도만 있으면 개수를 바로 구할 수 있습니다.",
    difficulty: 1,
    xp: 30,
  },
  {
    code: "L4-02",
    lesson: 4,
    orderIndex: 2,
    problemType: "COUNT",
    title: "층별로 나누어 세기",
    prompt:
      "이번에는 층별로 나누어 세어 보세요.\n1층, 2층, 3층을 따로 센 다음 모두 더하면 몇 개인가요?",
    grid: G4,
    givenBlocks: S4,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "count", value: countOf(S4) },
    gradingMode: "exact",
    hint: "[층별 보기]로 한 층씩만 켜서 세어 보세요.",
    explanation:
      "자리별로 세든 층별로 세든 전체 개수는 같습니다. 편한 방법을 골라 쓰면 돼요.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L4-03",
    lesson: 4,
    orderIndex: 3,
    problemType: "HEIGHTMAP_FROM_BUILD",
    title: "숫자 지도로 나타내기",
    prompt: "이 모양을 위에서 본 모양의 각 자리에 쌓인 층수를 적어 보세요.",
    grid: G4,
    givenBlocks: S5,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "heightMap", heightMap: toHeightMap(S5, G4) },
    gradingMode: "exact",
    hint: "쌓기나무가 없는 자리에는 0 을 적어요.",
    explanation: "자리마다 층수를 적어 두면 다른 사람도 똑같은 모양을 만들 수 있습니다.",
    difficulty: 2,
    xp: 30,
  },

  // =========================================================================
  // 5차시 - 보이지 않는 쌓기나무 (명세 26)
  // =========================================================================
  {
    code: "L5-01",
    lesson: 5,
    orderIndex: 1,
    problemType: "CHOICE",
    title: "이 각도에서만 보고 맞혀 보기",
    prompt:
      "지금은 화면을 돌릴 수 없습니다.\n이 정보만으로 전체 개수를 정확히 알 수 있을까요?",
    grid: G4,
    givenBlocks: S7,
    startBlocks: [],
    given: { allowRotate: false, note: "이 문제에서는 화면을 돌릴 수 없어요." },
    choices: ["정확히 알 수 있어요", "가려진 곳의 정보가 더 필요해요"],
    answer: { kind: "choice", index: 1 },
    gradingMode: "exact",
    hint: "앞에 있는 쌓기나무 뒤에 가려진 자리가 있을 수 있어요. 보이는 것보다 많을 수 있습니다.",
    explanation:
      "한 방향에서만 보면 뒤에 가려진 쌓기나무를 알 수 없습니다. 그래서 정확한 개수를 구하려면 다른 정보가 더 필요해요.",
    difficulty: 3,
    xp: 30,
  },
  {
    code: "L5-02",
    lesson: 5,
    orderIndex: 2,
    problemType: "CHOICE",
    title: "왜 알 수 없었을까",
    prompt:
      "앞에서 본 모양만으로는 쌓기나무의 개수를 정확히 알 수 없습니다.\n그 까닭으로 알맞은 것을 고르세요.",
    grid: G4,
    givenBlocks: S7,
    startBlocks: [],
    given: { projections: { front: project(S7, G4).front }, allowRotate: true },
    choices: [
      "앞에서 보면 뒤쪽에 놓인 쌓기나무가 가려져 보이지 않기 때문",
      "앞에서 보면 쌓기나무가 실제보다 크게 보이기 때문",
      "앞에서 보면 쌓기나무의 색이 달라 보이기 때문",
      "앞에서 보면 1층이 보이지 않기 때문",
    ],
    answer: { kind: "choice", index: 0 },
    gradingMode: "exact",
    hint: "화면을 돌려서 뒤쪽을 보면 무엇이 새로 보이는지 확인해 보세요.",
    explanation:
      "앞에서 본 모양은 각 줄의 가장 높은 층만 알려 줍니다. 뒤쪽 자리에 쌓기나무가 더 있어도 앞 모양은 그대로예요.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L5-03",
    lesson: 5,
    orderIndex: 3,
    problemType: "COUNT",
    title: "정보를 더 받고 다시 구하기",
    prompt:
      "이번에는 위에서 본 모양의 숫자 지도를 함께 줍니다.\n쌓기나무는 모두 몇 개인가요?",
    grid: G4,
    givenBlocks: S7,
    startBlocks: [],
    given: {
      heightMap: toHeightMap(S7, G4),
      projections: { front: project(S7, G4).front },
      allowRotate: true,
      allowLayerView: true,
    },
    choices: [],
    answer: { kind: "count", value: countOf(S7) },
    gradingMode: "exact",
    hint: "숫자 지도의 수를 모두 더하면 가려진 쌓기나무까지 셀 수 있어요.",
    explanation:
      "정보가 충분하면 정확히 셀 수 있습니다. 숫자 지도는 가려진 자리까지 알려 주는 아주 좋은 방법이에요.",
    difficulty: 2,
    xp: 30,
  },

  // =========================================================================
  // 6차시 - 세 방향을 보고 쌓기 (명세 27)
  // =========================================================================
  {
    code: "L6-01",
    lesson: 6,
    orderIndex: 1,
    problemType: "BUILD_FROM_VIEWS",
    title: "세 방향을 보고 똑같이 쌓기",
    prompt:
      "위, 앞, 옆에서 본 모양이 아래와 같습니다.\n조건에 맞게 쌓기나무를 쌓아 보세요.",
    grid: G3,
    givenBlocks: [],
    startBlocks: [],
    given: { projections: project(S6, G3), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: project(S6, G3) },
    gradingMode: "constraint",
    hint: "먼저 '위에서 본 모양'대로 1층을 깔고, 그다음 앞·옆 모양에 맞게 높이를 올려 보세요.",
    explanation:
      "세 방향 모양을 모두 만족하면 정답입니다. 조건만 맞으면 서로 다른 모양도 모두 맞아요.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L6-02",
    lesson: 6,
    orderIndex: 2,
    problemType: "BUILD_FROM_VIEWS",
    title: "조건을 만족하는 모양 만들기",
    prompt:
      "아래 세 방향 조건을 모두 만족하도록 쌓아 보세요.\n조건만 맞으면 친구와 모양이 달라도 괜찮습니다.",
    grid: G4,
    givenBlocks: [],
    startBlocks: [],
    given: { projections: project(S5, G4), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: project(S5, G4) },
    gradingMode: "constraint",
    hint: "가려져서 보이지 않는 자리는 높이를 조금 다르게 해도 세 방향 모양이 그대로일 수 있어요.",
    explanation:
      "세 방향을 모두 보아도 가려진 자리 때문에 여러 모양이 가능할 때가 있습니다.",
    difficulty: 3,
    xp: 30,
  },

  // =========================================================================
  // 7차시 - 위에서 본 모양에 수 쓰기 (명세 28)
  // =========================================================================
  {
    code: "L7-01",
    lesson: 7,
    orderIndex: 1,
    problemType: "BUILD_FROM_HEIGHTMAP",
    title: "숫자 지도를 보고 쌓기",
    prompt:
      "위에서 본 모양의 각 자리에 쌓을 층수가 적혀 있습니다.\n적힌 대로 쌓아 보세요.",
    grid: G4,
    givenBlocks: [],
    startBlocks: [],
    given: { heightMap: toHeightMap(S8, G4), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "blocks", blocks: S8 },
    gradingMode: "exact",
    hint: "숫자가 3 이면 그 자리에 쌓기나무를 3층까지 쌓아요. 0 인 자리는 비워 둡니다.",
    explanation:
      "각 자리의 층수가 정해지면 쌓은 모양은 딱 한 가지로 정해집니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L7-02",
    lesson: 7,
    orderIndex: 2,
    problemType: "HEIGHTMAP_FROM_BUILD",
    title: "쌓은 모양을 숫자로 나타내기",
    prompt: "이 모양을 위에서 본 모양의 각 자리에 층수를 적어 보세요.",
    grid: G4,
    givenBlocks: S7,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "heightMap", heightMap: toHeightMap(S7, G4) },
    gradingMode: "exact",
    hint: "[위에서 보기]로 자리를 확인하고, 한 자리씩 몇 층인지 세어 적어 보세요.",
    explanation:
      "숫자 지도는 모양을 아주 간단하게 적는 방법이면서, 개수도 바로 구할 수 있습니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L7-03",
    lesson: 7,
    orderIndex: 3,
    problemType: "COUNT",
    title: "숫자 지도로 개수 구하기",
    prompt: "앞 문제에서 적은 숫자 지도를 보고, 쌓기나무가 모두 몇 개인지 구하세요.",
    grid: G4,
    givenBlocks: S7,
    startBlocks: [],
    given: { heightMap: toHeightMap(S7, G4), allowRotate: true },
    choices: [],
    answer: { kind: "count", value: countOf(S7) },
    gradingMode: "exact",
    hint: "숫자 지도에 적힌 수를 모두 더하세요.",
    explanation: "숫자 지도의 합이 곧 쌓기나무의 전체 개수입니다.",
    difficulty: 1,
    xp: 30,
  },

  // =========================================================================
  // 8차시 - 층별로 나타낸 모양 (명세 29)
  // =========================================================================
  {
    code: "L8-01",
    lesson: 8,
    orderIndex: 1,
    problemType: "BUILD_FROM_LAYERS",
    title: "층별 그림을 보고 쌓기",
    prompt: "1층, 2층, 3층 모양이 아래와 같습니다. 이 모양대로 쌓아 보세요.",
    grid: G4,
    givenBlocks: [],
    startBlocks: [],
    given: { layers: toLayers(S8, G4), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "blocks", blocks: S8 },
    gradingMode: "exact",
    hint: "1층 그림대로 먼저 깔고, 그 위에 2층 그림대로 올리세요.",
    explanation:
      "층별 그림은 각 층에 쌓기나무가 어느 자리에 있는지 알려 줍니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L8-02",
    lesson: 8,
    orderIndex: 2,
    problemType: "LAYER_DRAW",
    title: "층별 모양 그리기",
    prompt: "이 모양을 1층, 2층, 3층으로 나누어 그려 보세요.",
    grid: G4,
    givenBlocks: S5,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "layers", layers: toLayers(S5, G4) },
    gradingMode: "exact",
    hint: "[층별 보기]에서 한 층만 켜 두고 그 모양을 그대로 그리면 쉬워요.",
    explanation:
      "위층에 쌓기나무가 있으면 그 아래층에도 반드시 쌓기나무가 있어야 합니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L8-03",
    lesson: 8,
    orderIndex: 3,
    problemType: "COUNT",
    title: "규칙을 찾아 개수 구하기",
    prompt:
      "이 모양은 1층 10개, 2층 6개, 3층 3개입니다.\n같은 규칙으로 이어진다면 4층은 몇 개일까요?",
    grid: G4,
    givenBlocks: S8P,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true, countOf: "pattern" },
    choices: [],
    answer: { kind: "count", value: 1 },
    gradingMode: "exact",
    hint: "층이 올라갈 때 몇 개씩 줄어드는지 차례로 적어 보세요. 10, 6, 3, ...",
    explanation:
      "10 → 6 은 4 줄고, 6 → 3 은 3 줄었어요. 줄어드는 수가 1씩 작아지므로 다음은 2 줄어 1개가 됩니다.",
    difficulty: 3,
    xp: 30,
  },

  // =========================================================================
  // 12차시 - 단원 마무리 (명세 32)
  // =========================================================================
  {
    code: "L12-01",
    lesson: 12,
    orderIndex: 1,
    problemType: "COUNT",
    title: "종합 1 - 개수 구하기",
    prompt: "이 모양을 만드는 데 쓰인 쌓기나무는 모두 몇 개인가요?",
    grid: G4,
    givenBlocks: S12,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "count", value: countOf(S12) },
    gradingMode: "exact",
    hint: "자리별 높이를 더하거나 층별로 나누어 세어 보세요. 두 방법 모두 좋아요.",
    explanation: "자리별로 세기와 층별로 세기 중 편한 방법을 쓰면 됩니다.",
    difficulty: 2,
    xp: 30,
  },
  {
    code: "L12-02",
    lesson: 12,
    orderIndex: 2,
    problemType: "PROJECTION_DRAW",
    title: "종합 2 - 세 방향 모양 그리기",
    prompt: "이 모양의 위, 앞, 옆에서 본 모양을 모두 그려 보세요.",
    grid: G4,
    givenBlocks: S12,
    startBlocks: [],
    given: { allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: project(S12, G4) },
    gradingMode: "exact",
    hint: "시점 버튼을 눌러 한 방향씩 확인하며 그리세요.",
    explanation:
      "입체 모양을 세 방향에서 본 모양으로 나타내면 다른 사람에게 정확히 설명할 수 있습니다.",
    difficulty: 3,
    xp: 30,
  },
  {
    code: "L12-03",
    lesson: 12,
    orderIndex: 3,
    problemType: "BUILD_FROM_VIEWS",
    title: "종합 3 - 세 방향 보고 쌓기",
    prompt: "아래 세 방향 조건을 만족하는 모양을 쌓아 보세요.",
    grid: G4,
    givenBlocks: [],
    startBlocks: [],
    given: { projections: project(S12, G4), allowRotate: true, allowLayerView: true },
    choices: [],
    answer: { kind: "projections", projections: project(S12, G4) },
    gradingMode: "constraint",
    hint: "위에서 본 모양으로 놓을 자리를 먼저 정하고, 앞·옆 모양에 맞게 높이를 조절하세요.",
    explanation:
      "세 방향에서 본 모양을 모두 만족하면 정답입니다. 이 단원의 마지막 도전이었어요!",
    difficulty: 3,
    xp: 30,
  },
];

export function seedForLesson(lesson: number): SeedProblem[] {
  return SEED_PROBLEMS.filter((p) => p.lesson === lesson).sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
}

export { grid2d, shape };

const sixth = SEED_PROBLEMS.find(p => p.code === "L6-01")!;
SEED_PROBLEMS.push({ ...sixth, code:"L6-03", orderIndex:3, title:"조건을 만족하는 다른 모양", gradingMode:"constraint", prompt:"위·앞·옆의 조건을 모두 만족하도록 쌓아 보세요. 조건이 같으면 다른 모양도 정답이에요." });
for (const [source, code, order] of [["L2-01","L12-04",4],["L7-02","L12-05",5],["L8-02","L12-06",6]] as const) {
  const original = SEED_PROBLEMS.find(p => p.code === source)!;
  SEED_PROBLEMS.push({ ...original, code, lesson:12, orderIndex:order, title:`단원 마무리 · ${original.title}` });
}
