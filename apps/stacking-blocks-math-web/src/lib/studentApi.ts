import type {
  Grid2D,
  HeightMap,
  ProblemType,
  StudentProblem,
  RevealedAnswer,
  GradeResult as SharedGradeResult,
} from "@shared/types.ts";
import type { BlockCoord } from "@shared/types.ts";
import type { RewardDefinition, RewardMaterial, RewardTheme } from "@shared/rewards.ts";
import {
  STUDENT_TOKEN_KEY,
  getResolvedSupabaseConfig,
} from "./config";

/**
 * 학생용 API 호출기.
 * 학생은 Supabase 표를 직접 읽지 않고 Edge Function 을 통해 접근합니다.
 */

export class StudentApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StudentApiError";
  }
}

export type JsonPayload = Record<string, unknown>;

function functionUrl(name: string): string {
  const config = getResolvedSupabaseConfig();
  if (!config) {
    throw new Error("Supabase 설정이 없습니다.");
  }
  return `${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${name}`;
}

export function getStudentToken(): string | null {
  try {
    return localStorage.getItem(STUDENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStudentToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STUDENT_TOKEN_KEY, token);
    else localStorage.removeItem(STUDENT_TOKEN_KEY);
  } catch {
    // 사생활 보호 모드 등에서 저장이 막혀도 앱은 계속 동작해야 합니다.
  }
}

export function clearStudentToken(): void {
  setStudentToken(null);
}

export interface LoginSuccess {
  token: string;
  expiresAt: string;
  student: {
    id: string;
    name: string;
    studentNo: number | null;
    classId: string;
    className: string;
  };
}

export interface LoginNeedsStudentNo {
  needStudentNo: true;
  className: string;
  options: number[];
}

export interface StudentHomeLesson {
  lesson: number;
  locked: boolean;
  totalProblems: number;
  completedProblems: number;
  stars: number;
  completed: boolean;
}

export interface StudentHomeReward {
  totalXp: number;
  totalStars: number;
  badges: unknown[];
  streak: number;
  equippedMaterial?: RewardMaterial;
  introTheme?: RewardTheme;
  catalog?: Array<RewardDefinition & { unlocked: boolean }>;
}

export interface RewardWorkshopData {
  xp: number;
  equippedMaterial: RewardMaterial;
  introTheme: RewardTheme;
  catalog: Array<RewardDefinition & { unlocked: boolean }>;
}

export interface StudentHomeData {
  classId: string;
  className: string;
  rewards: StudentHomeReward;
  lessons: StudentHomeLesson[];
}

export interface LessonProblemListData {
  practiceSet?: ReturnType<typeof import('../../shared/practiceSet.ts').practiceSetStatus>;
  problems: StudentProblem[];
  seedFallback: boolean;
  requiredComplete?: boolean;
  currentProblemId?: string | null;
  stages?: { concept: number; check: number; more: number };
}

export interface AttemptState {
  wrongCount: number;
  hintShown: boolean;
  answerRevealed: boolean;
  completed: boolean;
}

export interface ProblemEnvelope {
  problem: StudentProblem;
  attempt: AttemptState;
  hint: string | null;
  revealedAnswer: RevealedAnswer | null;
}

export interface GradeFeedback extends SharedGradeResult {
  revealedAnswer: RevealedAnswer | null;
  detail: string | null;
}

export interface TeacherStudentRow {
  id: string;
  name: string;
  student_no: number | null;
  status: "active" | "disabled";
  pinPlain: string;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
}

export interface ClassData {
  id: string;
  name: string;
  class_code: string;
}

export interface LessonSettingRow {
  lesson: number;
  locked: boolean;
  practice_count?: 5 | 10 | 15 | 20 | null;
}

async function callFunction<T>(name: string, body: JsonPayload, withToken: boolean): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const config = getResolvedSupabaseConfig();
  if (config?.supabasePublishableKey) {
    headers.apikey = config.supabasePublishableKey;
  }

  const isTeacher = typeof body.action === "string" && body.action.startsWith("teacher:");
  if (isTeacher) {
    const { getSupabase } = await import("./supabase");
    const { data, error } = await getSupabase().auth.getSession();
    if (error || !data.session) throw new StudentApiError("TEACHER_AUTH", "교사 로그인이 필요합니다.", 401);
    headers.authorization = `Bearer ${data.session.access_token}`;
  }

  if (withToken && !isTeacher) {
    const token = getStudentToken();
    if (token) headers["x-student-token"] = token;
  }

  const response = await fetch(functionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    keepalive: body.action === "snapshot",
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code: string; message: string } }
    | T
    | null;

  if (!response.ok) {
    const err = (payload as { error?: { code: string; message: string } })?.error;
    throw new StudentApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      response.status,
    );
  }

  if (!payload) {
    throw new StudentApiError("EMPTY_RESPONSE", "빈 응답입니다.", response.status);
  }

  return payload as T;
}

/** 반 코드로 반 이름 조회 */
export function fetchClassInfo(classCode: string) {
  return callFunction<{ classId: string; className: string }>(
    "student-auth",
    { action: "class", classCode },
    false,
  );
}

export function loginStudent(params: {
  classCode: string;
  name: string;
  pin: string;
  studentNo?: number | null;
}) {
  return callFunction<LoginSuccess | LoginNeedsStudentNo>(
    "student-auth",
    { action: "login", ...params },
    false,
  );
}

export function getStudentHome() {
  return callFunction<{ student: StudentHomeData }>("student-api", { action: "home" }, true).then((res) => res.student);
}

export function getRewardWorkshop() {
  return callFunction<RewardWorkshopData>("student-api", { action: "rewards" }, true);
}

export function equipReward(material: RewardMaterial, theme: RewardTheme) {
  return callFunction<RewardWorkshopData>("student-api", { action: "rewards:equip", material, theme }, true);
}

export function getLessonProblems(lesson: number) {
  return callFunction<LessonProblemListData>("student-api", { action: "lessonProblems", lesson }, true);
}

export function startNewPracticeSet(lesson: number, expectedSeed: number) {
  return callFunction<{ seed: number }>("student-api", { action: "practice:new-set", lesson, expectedSeed }, true);
}

export function getProblem(problemId: string, lesson?: number) {
  return callFunction<ProblemEnvelope>(
    "student-api",
    { action: "problem", problemId, lesson },
    true,
  );
}

export interface StudentSubmissionPayload {
  kind: "blocks" | "count" | "direction" | "choice" | "projections" | "heightMap" | "layers";
  blocks?: BlockCoord[];
  value?: number;
  direction?: string;
  index?: number;
  projections?: { top?: Grid2D; front?: Grid2D; side?: Grid2D };
  heightMap?: HeightMap;
  layers?: Grid2D[];
}

export function submitAttempt(problemId: string, submission: StudentSubmissionPayload) {
  return callFunction<{ grade: GradeFeedback }>(
    "student-api",
    { action: "attempt", problemId, submission },
    true,
  );
}

export function saveSnapshot(
  problemId: string,
  lesson: number,
  blocks: BlockCoord[],
  gridWidth: number,
  gridDepth: number,
  maxHeight: number,
) {
  return callFunction<{ ok: boolean }>("student-api", {
    action: "snapshot",
    problemId,
    lesson,
    blocks,
    gridWidth,
    gridDepth,
    maxHeight,
  }, true);
}

export interface SnapshotData {
  snapshot: {
    blocks: BlockCoord[];
    grid_width: number;
    grid_depth: number;
    max_height: number;
  } | null;
}

export function getSnapshot(problemId: string) {
  return callFunction<SnapshotData>("student-api", { action: "snapshot:get", problemId }, true);
}

export function saveProblemPosition(problemId: string, lesson: number) {
  return callFunction<{ ok: boolean }>("student-api", { action: "position", problemId, lesson }, true);
}

export function teacherListClasses() {
  return callFunction<{ classes: ClassData[] }>("student-api", { action: "teacher:classes" }, true);
}

export function teacherUpsertClass(params: { classId?: string; name: string; classCode?: string }) {
  return callFunction<{ class?: ClassData }>("student-api", {
    action: "teacher:class-upsert",
    ...params,
  }, true);
}

export function teacherListStudents(classId: string) {
  return callFunction<{ students: TeacherStudentRow[] }>(
    "student-api",
    { action: "teacher:students:list", classId },
    true,
  );
}

export function teacherCreateStudent(classId: string, name: string, studentNo?: number | null) {
  return callFunction<{ student: { id: string; name: string; studentNo: number | null; status: string }; pinPlain: string }>(
    "student-api",
    { action: "teacher:students:create", classId, name, studentNo },
    true,
  );
}

export function teacherUpdateStudent(classId: string, studentId: string, payload: { name?: string; status?: "active" | "disabled" }) {
  return callFunction<{ ok: boolean }>("student-api", {
    action: "teacher:students:update",
    classId,
    studentId,
    ...payload,
  }, true);
}

export function teacherResetStudentPin(classId: string, studentId: string) {
  return callFunction<{ pinPlain: string }>(
    "student-api",
    {
      action: "teacher:students:pin-reset",
      classId,
      studentId,
    },
    true,
  );
}

export function teacherToggleStudent(classId: string, studentId: string, disabled: boolean) {
  return callFunction<{ ok: boolean }>(
    "student-api",
    { action: "teacher:students:toggle", classId, studentId, disabled },
    true,
  );
}

export function teacherListLessonSettings(classId: string) {
  return callFunction<{ lessons: LessonSettingRow[] }>(
    "student-api",
    { action: "teacher:lessons:list", classId },
    true,
  );
}

export function teacherSetLessonLock(classId: string, lesson: number, locked: boolean, practiceCount?: 5 | 10 | 15 | 20) {
  return callFunction<{ ok: boolean }>(
    "student-api",
    { action: "teacher:lessons:set-lock", classId, lesson, locked, practiceCount },
    true,
  );
}

export interface TeacherProblem {
  id: string;
  lesson: number;
  orderIndex: number;
  problemType: ProblemType;
  title: string;
  prompt: string;
  hint: string;
  xp: number;
  active: boolean;
}

export function teacherListProblems(classId: string) {
  return callFunction<{ customProblems: TeacherProblem[]; builtinCount: number }>(
    "student-api",
    { action: "teacher:problems:list", classId },
    true,
  );
}

export function teacherSetProblemActive(problemId: string, active: boolean) {
  return callFunction<{ ok: boolean }>("student-api", { action: "teacher:problems:set-active", problemId, active }, true);
}

export interface TeacherPeerProblemRow {
  problemId: string;
  version: number;
  classId: string;
  title: string;
  authorDisplayName: string;
  publicProblemData: { card?: unknown; grid?: unknown; totalBlocks?: unknown };
  publishedAt: string;
  solveCount: number;
  status: "draft" | "published" | "hidden";
  myAttempt: { completed: boolean; score: number; usedHint: boolean } | null;
}

export function teacherListPeerProblems(classId: string, installationId: string) {
  return callFunction<{ problems: TeacherPeerProblemRow[] }>(
    "student-api",
    { action: "teacher:peer-problem:list", classId, installationId },
    true,
  );
}

export function teacherHidePeerProblem(classId: string, installationId: string, problemId: string, version: number) {
  return callFunction<{ problem: { problem_id: string; version: number; status: string } }>(
    "student-api",
    { action: "teacher:peer-problem:hide", classId, installationId, problemId, version },
    true,
  );
}

export function activityApi<T>(action: string, payload: JsonPayload = {}) { return callFunction<T>("student-api", { ...payload, action: `activity:${action}` }, true); }

export function getProblemImage(problemId: string) { return callFunction<{url:string}>("student-api", {action:"asset",problemId}, true); }
