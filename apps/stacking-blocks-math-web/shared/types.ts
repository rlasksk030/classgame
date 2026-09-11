/**
 * 앱 전체가 공유하는 기본 타입.
 *
 * 좌표 규칙 (명세 7):
 *   x = 좌우
 *   y = 높이 (0 이 1층)
 *   z = 앞뒤
 */

export interface BlockCoord {
  x: number;
  y: number;
  z: number;
}

export interface GridConfig {
  gridWidth: number;
  gridDepth: number;
  maxHeight: number;
}

export const DEFAULT_GRID: GridConfig = { gridWidth: 4, gridDepth: 4, maxHeight: 4 };

/** 카메라 시점 버튼 (명세 13). */
export const VIEW_PRESETS = ["free", "top", "front", "side", "home"] as const;
export type ViewPreset = (typeof VIEW_PRESETS)[number];

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
  free: "자유 보기",
  top: "위에서 보기",
  front: "앞에서 보기",
  side: "옆에서 보기",
  home: "원래 위치",
};

/** 2·23차시에서 쓰는 관찰 방향. */
export const DIRECTIONS = ["front", "back", "left", "right", "top"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  front: "앞",
  back: "뒤",
  left: "왼쪽",
  right: "오른쪽",
  top: "위",
};

/**
 * 문제 유형.
 * 각 차시가 어떤 유형을 쓰는지는 lessons.ts 에 적어 두었다.
 */
export const PROBLEM_TYPES = [
  "FREE_BUILD",          // 자유 쌓기 (1, 10~11차시)
  "BLOCK_POSITION",      // 위치/개수 묻기 (1차시)
  "CAMERA_DIRECTION",    // 어느 방향에서 본 모양인가 (2차시)
  "PROJECTION_DRAW",     // 위/앞/옆 격자 그리기 (3차시)
  "COUNT",               // 개수 세기 (4차시)
  "COUNT_AMBIGUOUS",     // 한 방향만으로는 알 수 없음 (5차시)
  "BUILD_FROM_VIEWS",    // 세 방향 보고 쌓기 (6차시)
  "BUILD_FROM_HEIGHTMAP",// 숫자 지도 보고 쌓기 (7차시)
  "HEIGHTMAP_FROM_BUILD",// 쌓은 모양 → 숫자 지도 (7차시)
  "BUILD_FROM_LAYERS",   // 층별 그림 보고 쌓기 (8차시)
  "LAYER_DRAW",          // 쌓은 모양 → 층별 격자 (8차시)
  "PATTERN_NEXT",        // 규칙 찾아 다음 층 (8차시)
  "CHOICE",              // 보기 고르기 (여러 차시 공용)
] as const;

export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const PROBLEM_TYPE_LABELS: Record<ProblemType, string> = {
  FREE_BUILD: "자유롭게 쌓기",
  BLOCK_POSITION: "위치 알아보기",
  CAMERA_DIRECTION: "어느 방향에서 본 모양",
  PROJECTION_DRAW: "위·앞·옆에서 본 모양 그리기",
  COUNT: "쌓기나무 개수",
  COUNT_AMBIGUOUS: "보이지 않는 쌓기나무",
  BUILD_FROM_VIEWS: "세 방향 보고 쌓기",
  BUILD_FROM_HEIGHTMAP: "숫자 지도 보고 쌓기",
  HEIGHTMAP_FROM_BUILD: "숫자 지도 만들기",
  BUILD_FROM_LAYERS: "층별 그림 보고 쌓기",
  LAYER_DRAW: "층별 모양 그리기",
  PATTERN_NEXT: "규칙 찾기",
  CHOICE: "알맞은 것 고르기",
};

/** 학생이 3D 로 직접 쌓아야 하는 유형. */
export const BUILD_TYPES: readonly ProblemType[] = [
  "FREE_BUILD",
  "BUILD_FROM_VIEWS",
  "BUILD_FROM_HEIGHTMAP",
  "BUILD_FROM_LAYERS",
];

/**
 * 채점 방식 (명세 27).
 *   exact      - 정답 좌표와 정확히 같아야 한다.
 *   constraint - 주어진 조건(세 방향 모양 등)을 만족하면 모두 정답.
 */
export type GradingMode = "exact" | "constraint";

/** 문제집 생성·교사 통계에서 사용하는 공통 분류. */
export type DifficultyTier = "BASIC" | "PRACTICE" | "APPLICATION" | "CHALLENGE";
export type ProblemSourceType =
  | "BUILT_IN_CONCEPT"
  | "BUILT_IN_WORKBOOK_STYLE"
  | "GENERATED_PRACTICE"
  | "WORKSHEET_IMPORT"
  | "TEACHER_CREATED"
  | "PEER_CREATED";

/** 2D 격자 답안. true = 칸이 채워짐. */
export type Grid2D = boolean[][];

/** 위에서 본 각 자리의 층수. [z][x] */
export type HeightMap = number[][];

export interface Projections {
  /** 위에서 본 모양 [z][x] */
  top: Grid2D;
  /** 앞에서 본 모양 [y][x] (배열 0 번이 1층) */
  front: Grid2D;
  /** 오른쪽 옆에서 본 모양 [y][z] (배열 0 번이 1층) */
  side: Grid2D;
}

/** 문제별 정답 데이터. 학생 화면으로는 절대 내려보내지 않는다 (명세 8). */
export type ProblemAnswer =
  | { kind: "blocks"; blocks: BlockCoord[] }
  | { kind: "count"; value: number }
  | { kind: "direction"; value: Direction }
  | { kind: "choice"; index: number }
  | { kind: "projections"; projections: Partial<Projections> }
  | { kind: "heightMap"; heightMap: HeightMap }
  | { kind: "layers"; layers: Grid2D[] };

/** 학생이 제출하는 답. */
export type StudentSubmission =
  | { kind: "blocks"; blocks: BlockCoord[] }
  | { kind: "count"; value: number }
  | { kind: "direction"; value: Direction }
  | { kind: "choice"; index: number }
  | { kind: "projections"; projections: Partial<Projections> }
  | { kind: "heightMap"; heightMap: HeightMap }
  | { kind: "layers"; layers: Grid2D[] };

/** 학생에게 내려보내는 문제 (정답 제거됨). */
export interface StudentProblem {
  stage?: "concept" | "check" | "more";
  hasImage?: boolean;
  templateId?: string;
  seed?: number;
  generatorVersion?: number;
  difficultyTier?: DifficultyTier;
  conceptTags?: string[];
  sourceType?: ProblemSourceType;
  id: string;
  lesson: number;
  orderIndex: number;
  problemType: ProblemType;
  title: string;
  prompt: string;
  /** 문제에서 미리 보여 주는 모양 (있을 수 있음). */
  givenBlocks: BlockCoord[];
  /** 학생 작업판에 미리 놓아 두는 블록. */
  startBlocks: BlockCoord[];
  grid: GridConfig;
  choices: string[];
  /** 문제 유형별 추가 정보 (보여 줄 투영, 숫자 지도, 층 그림 등). */
  given: ProblemGiven;
  difficulty: 1 | 2 | 3;
  xp: number;
  /** 3번 틀린 뒤에만 서버가 채워 준다 (명세 17). */
  hint: string | null;
}

/** 문제가 학생에게 "보여 주는" 조건. 정답 그 자체는 아니다. */
export interface ProblemGiven {
  projections?: Partial<Projections>;
  heightMap?: HeightMap;
  layers?: Grid2D[];
  /** CAMERA_DIRECTION 에서 "이 그림은 어느 방향?" 질문에 쓸 방향. */
  shownFrom?: Direction;
  /** 학생이 자유롭게 회전할 수 있는지. 5차시에서 일부러 막기도 한다. */
  allowRotate?: boolean;
  /** 층별 보기 컨트롤을 띄울지 (명세 14). */
  allowLayerView?: boolean;
  /** 자유 쌓기에서 완료로 인정할 최소 개수. */
  minBlocks?: number;
  /** 개수 문제에서 "적어도 몇 개"를 묻는지 (5차시). */
  askMinimum?: boolean;
  /**
   * 개수 문제가 무엇을 묻는지.
   *   total   - 전체 개수 (기본값)
   *   layer   - 특정 층의 개수. countLayer 와 함께 쓴다.
   *   pattern - 규칙을 보고 추론하는 값이라 모양에서 계산되지 않는다.
   */
  countOf?: "total" | "layer" | "pattern";
  /** countOf 가 "layer" 일 때 몇 층인지 (1 부터). */
  countLayer?: number;
  note?: string;
}

/** 채점 결과. */
export interface GradeResult {
  correct: boolean;
  /** 이번 시도까지 포함한 총 오답 수. */
  wrongCount: number;
  /** 명세 17 단계별 안내 문구. */
  message: string;
  /** 3회 오답부터 내려온다. */
  hint: string | null;
  /** 힌트 뒤에도 틀렸을 때만 내려온다. */
  revealedAnswer: RevealedAnswer | null;
  /** 정답을 보고 다시 쌓아야 완료되는 단계인지 (명세 18). */
  needsRebuild: boolean;
  completed: boolean;
  xpEarned: number;
  stars: number;
}

/** 공개된 정답. 3D 로 보여 주기 위한 최소 정보만 담는다. */
export interface RevealedAnswer {
  blocks?: BlockCoord[];
  count?: number;
  direction?: Direction;
  choiceIndex?: number;
  projections?: Partial<Projections>;
  heightMap?: HeightMap;
  layers?: Grid2D[];
  explanation: string | null;
}

export interface StudentSession {
  token: string;
  studentId: string;
  name: string;
  classId: string;
  className: string;
  expiresAt: string;
}

export interface LessonState {
  lesson: number;
  locked: boolean;
  totalProblems: number;
  completedProblems: number;
  stars: number;
  completed: boolean;
}
