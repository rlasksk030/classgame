import { requiredSolveIds } from '../../../shared/lessonProgression.ts';
import { activityRequest } from "../_shared/activities.ts";
import { canonicalize, validStructure, toHeightMap } from "../../../shared/blocks.ts";
import { makeChallengeCard, validatePeerBlocks, gradePeer, type ChallengeCard, type ChallengeCardType } from "../../../shared/phase4.ts";
import { applyAttempt, INITIAL_ATTEMPT } from "../../../shared/attempts.ts";
import {
  type ProblemGiven,
  type ProblemAnswer,
  type StudentSubmission,
  DIRECTIONS,
  type ProblemType,
  type RevealedAnswer,
} from "../../../shared/types.ts";
import { SEED_PROBLEMS } from "../../../shared/seedProblems.ts";
import { generatePracticeProblems, recommendedPracticeCount } from "../../../shared/practiceGenerator.ts";
import { generateValidatedPracticeSet, generatedProblemId, selectPracticeRows, practiceSetStatus, isAssignedPracticeCode, practiceDisplaySeed, canReadHistoricalPractice } from "../../../shared/practiceSet.ts";
import { conceptTagsForProblemType } from "../../../shared/problemMetadata.ts";
import { deriveProblemPresentation } from "../../../shared/problemPresentation.ts";
import { REWARD_CATALOG, rewardUnlocked, sanitizeMaterial, sanitizeTheme, type RewardMaterial, type RewardTheme } from "../../../shared/rewards.ts";
import { grade as gradeShared } from "../../../shared/grading.ts";
import { summarizeStudentProgress, type AttemptSourceRow, type ProgressSourceRow } from "../../../shared/teacherProgress.ts";
import { summarizeStudentLiveStatus, type SessionSourceRow } from "../../../shared/teacherSessions.ts";
import { synthesizeBuildFromViewsGhost } from "../../../shared/buildAnswerReveal.ts";
import { summarizeLessonResults, type ResultAttemptRow, type ResultProgressRow, type ResultProblemRow } from "../../../shared/teacherResults.ts";
import { serviceClient, requireTeacher, teacherOwnsClass } from "../_shared/db.ts";
import {
  fail,
  handlePreflight,
  json,
  ok,
  readJson,
  text,
} from "../_shared/http.ts";
import {
  generatePin,
  generateClassCode,
  generateShareCode,
  hashPin,
  hashToken,
  verifySessionToken,
} from "../_shared/security.ts";

type Action =
  | "asset"
  | "home"
  | "lessonProblems"
  | "position"
  | "rewards"
  | "rewards:equip"
  | "practice:new-set"
  | "problem"
  | "attempt"
  | "snapshot"
  | "snapshot:get"
  | "share:create"
  | "peer-problem:publish"
  | "peer-problem:list"
  | "peer-problem:get"
  | "peer-problem:hint"
  | "peer-problem:submit"
  | "peer-problem:attempts"
  | "project:save"
  | "project:load"
  | "progress:save"
  | "progress:get"
  | "attempt:save"
  | "reflection:save"
  | "reflection:get"
  | "practice-set:get-or-create"
  | "teacher:peer-problem:list"
  | "teacher:peer-problem:hide"
  | "teacher:classes"
  | "teacher:class-upsert"
  | "teacher:students:list"
  | "teacher:students:create"
  | "teacher:students:update"
  | "teacher:students:pin-reset"
  | "teacher:students:toggle"
  | "teacher:students:move-class"
  | "teacher:lessons:list"
  | "teacher:lessons:set-lock"
  | "teacher:problems:list"
  | "teacher:problems:set-active"
  | "teacher:progress:summary"
  | "teacher:progress:reset-class"
  | "teacher:sessions:list"
  | "teacher:results:summary";

interface BaseBody {
  action?: string;
}

interface DbProblemRow {
  image_path?: string | null;
  id: string;
  class_id: string | null;
  lesson: number;
  order_index: number;
  problem_type: ProblemType;
  title: string;
  prompt: string;
  grid_width: number;
  grid_depth: number;
  max_height: number;
  given_blocks: unknown;
  start_blocks: unknown;
  given: ProblemGiven;
  choices: unknown;
  answer: unknown;
  grading_mode: "exact" | "constraint";
  hint: string;
  explanation: string;
  difficulty: 1 | 2 | 3;
  xp: number;
  active: boolean;
  code: string | null;
}

interface ClassRow {
  id: string;
  name: string;
  class_code: string;
}

interface StudentRow {
  id: string;
  class_id: string;
  name: string;
  student_no: number | null;
  pin_hash: string;
  status: "active" | "disabled";
}

interface AttemptRow {
  id: string;
  wrong_count: number;
  hint_shown: boolean;
  answer_revealed: boolean;
  completed: boolean;
  attempt_count: number;
}

interface StudentCtx {
  studentId: string;
  classId: string;
}

const KNOWN_PROBLEM_TYPES: ProblemType[] = [
  "FREE_BUILD",
  "BLOCK_POSITION",
  "CAMERA_DIRECTION",
  "PROJECTION_DRAW",
  "COUNT",
  "COUNT_AMBIGUOUS",
  "BUILD_FROM_VIEWS",
  "BUILD_FROM_HEIGHTMAP",
  "HEIGHTMAP_FROM_BUILD",
  "BUILD_FROM_LAYERS",
  "LAYER_DRAW",
  "PATTERN_NEXT",
  "CHOICE",
];

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "object") return fallback;
  return value as T;
}

function parseProblemType(value: unknown): ProblemType {
  if (typeof value === "string" && KNOWN_PROBLEM_TYPES.includes(value as ProblemType)) {
    return value as ProblemType;
  }
  return "BLOCK_POSITION";
}

function canonicalizeProblemBlocks(value: unknown): { x: number; y: number; z: number }[] {
  if (!Array.isArray(value)) return [];
  return canonicalize(value.filter((item) => {
    return (
      item &&
      typeof item === "object" &&
      Number.isFinite(Number((item as { x?: unknown }).x)) &&
      Number.isFinite(Number((item as { y?: unknown }).y)) &&
      Number.isFinite(Number((item as { z?: unknown }).z))
    );
  }).map((item) => ({
    x: Number((item as { x: number }).x),
    y: Number((item as { y: number }).y),
    z: Number((item as { z: number }).z),
  })));
}

function parseProblemRow(row: DbProblemRow | null) {
  if (!row) return null;
  const grid = {
    gridWidth: Number(row.grid_width ?? 4),
    gridDepth: Number(row.grid_depth ?? 4),
    maxHeight: Number(row.max_height ?? 4),
  };

  const given = safeJson<ProblemGiven>(row.given, {});
  const generator = (given as ProblemGiven & { _generator?: Record<string, unknown> })._generator;
  const answer = safeJson(row.answer, { kind: "count", value: 0 }) as {
    kind: "blocks" | "count" | "direction" | "choice" | "projections" | "heightMap" | "layers";
    blocks?: unknown;
    value?: unknown;
    direction?: unknown;
    index?: unknown;
    projections?: unknown;
    heightMap?: unknown;
    layers?: unknown;
  };

  const prompt = text(row.prompt, 3000);
  const safeChoices = Array.isArray(row.choices) ? row.choices.map((choice) => String(choice ?? "")) : [];
  const answerMeta = normalizeSubmission(answer);
  if (!answerMeta) return null;
  const problemType = parseProblemType(row.problem_type);

  return {
    id: row.id,
    stage: Number(row.order_index ?? 0) <= 1 ? "concept" : Number(row.order_index ?? 0) === 2 ? "check" : "more",
    hasImage: Boolean(row.image_path),
    templateId: typeof generator?.templateId === "string" ? generator.templateId : undefined,
    seed: Number.isInteger(generator?.seed) ? Number(generator?.seed) : undefined,
    generatorVersion: Number.isInteger(generator?.generatorVersion) ? Number(generator?.generatorVersion) : undefined,
    difficultyTier: typeof generator?.difficultyTier === "string" ? generator.difficultyTier : undefined,
    conceptTags: Array.isArray(generator?.conceptTags) ? generator.conceptTags.map(String) : conceptTagsForProblemType(problemType),
    sourceType: typeof generator?.sourceType === "string" ? generator.sourceType : (String(row.code ?? '').startsWith('GEN-L') ? 'GENERATED_PRACTICE' : (row.class_id ? 'TEACHER_CREATED' : (Number(row.order_index ?? 0) <= 2 ? 'BUILT_IN_CONCEPT' : 'BUILT_IN_WORKBOOK_STYLE'))),
    lesson: Number(row.lesson),
    orderIndex: Number(row.order_index ?? 0),
    problemType,
    title: String(row.title ?? ""),
    prompt,
    grid,
    givenBlocks: canonicalizeProblemBlocks(row.given_blocks),
    startBlocks: canonicalizeProblemBlocks(row.start_blocks),
    given,
    presentation: deriveProblemPresentation({ problemType, grid, given, answer: answerMeta as ProblemAnswer }),
    choices: safeChoices,
    gradingMode: (row.grading_mode === "constraint" ? "constraint" : "exact") as "exact" | "constraint",
    hint: String(row.hint ?? ""),
    explanation: String(row.explanation ?? ""),
    difficulty: Number(row.difficulty ?? 2) as 1 | 2 | 3,
    xp: Number(row.xp ?? 30),
    answer: answerMeta,
    code: row.code,
    active: Boolean(row.active),
    _raw: row,
  };
}

function buildRevealedAnswer(row: ReturnType<typeof parseProblemRow>): RevealedAnswer | null {
  if (!row) return null;

  if (row.answer.kind === "blocks") {
    return {
      blocks: row.answer.blocks,
      explanation: row.explanation ?? null,
    };
  }

  if (row.answer.kind === "count") {
    return {
      count: Number(row.answer.value ?? 0),
      explanation: row.explanation ?? null,
    };
  }

  if (row.answer.kind === "direction") {
    return {
      direction: String(row.answer.value ?? "front") as RevealedAnswer["direction"],
      explanation: row.explanation ?? null,
    };
  }

  if (row.answer.kind === "choice") {
    return {
      choiceIndex: Number(row.answer.index ?? 0),
      explanation: row.explanation ?? null,
    };
  }

  if (row.answer.kind === "projections") {
    const projections = row.answer.projections ?? {};
    const revealed: RevealedAnswer = { projections, explanation: row.explanation ?? null };
    // BUILD_FROM_VIEWS ("세 방향 보고 쌓기") is a build type -- the student
    // is constructing in 3D, not drawing 2D grids -- but its curriculum
    // answer is stored as the three given projections (constraint-graded:
    // many shapes satisfy the same silhouettes, so there is no single
    // canonical block answer). To still show a 3D ghost on reveal, we
    // synthesize ONE witness structure that satisfies the given
    // projections, reusing the same constraint solver the curriculum
    // itself is validated with (oracle/dfs.ts -- never duplicate this
    // search here). PROJECTION_DRAW also has answer.kind==="projections"
    // but is not a build type, so it's deliberately excluded and keeps
    // showing only the 2D grids.
    if (row.problemType === "BUILD_FROM_VIEWS") {
      const ghost = synthesizeBuildFromViewsGhost(
        { top: projections.top, front: projections.front, side: projections.side },
        row.grid,
      );
      if (ghost) revealed.blocks = ghost;
    }
    return revealed;
  }

  if (row.answer.kind === "heightMap") {
    return {
      heightMap: row.answer.heightMap ?? [],
      explanation: row.explanation ?? null,
    };
  }

  if (row.answer.kind === "layers") {
    return {
      layers: row.answer.layers ?? [],
      explanation: row.explanation ?? null,
    };
  }

  return {
    explanation: row.explanation ?? null,
  };
}

function parseSeedProblem(raw: (typeof SEED_PROBLEMS)[number]) {
  return {
    id: `seed:${raw.code}`,
    stage: raw.stage ?? (raw.orderIndex <= 1 ? "concept" : raw.orderIndex === 2 ? "check" : "more"),
    hasImage: false,
    templateId: raw.templateId,
    seed: raw.seed,
    generatorVersion: raw.generatorVersion,
    difficultyTier: raw.difficultyTier,
    conceptTags: raw.conceptTags ?? conceptTagsForProblemType(raw.problemType),
    sourceType: raw.sourceType ?? (raw.orderIndex <= 2 ? 'BUILT_IN_CONCEPT' : 'BUILT_IN_WORKBOOK_STYLE'),
    lesson: raw.lesson,
    orderIndex: raw.orderIndex,
    problemType: raw.problemType,
    title: raw.title,
    prompt: raw.prompt,
    grid: raw.grid,
    givenBlocks: canonicalize(raw.givenBlocks),
    startBlocks: canonicalize(raw.startBlocks),
    given: raw.given,
    presentation: deriveProblemPresentation({ problemType: raw.problemType, grid: raw.grid, given: raw.given, answer: raw.answer }),
    choices: raw.choices,
    gradingMode: raw.gradingMode,
    hint: raw.hint,
    explanation: raw.explanation,
    difficulty: raw.difficulty,
    xp: raw.xp,
    answer: raw.answer,
    code: raw.code,
    active: true,
    _raw: null,
  };
}

function sanitizeToStudentProblem(row: ReturnType<typeof parseProblemRow> | ReturnType<typeof parseSeedProblem>) {
  if (!row) return null;
  return {
    id: row.id,
    stage: row.stage,
    hasImage: row.hasImage,
    templateId: row.templateId,
    seed: row.seed,
    generatorVersion: row.generatorVersion,
    difficultyTier: row.difficultyTier,
    conceptTags: row.conceptTags,
    sourceType: row.sourceType,
    lesson: row.lesson,
    orderIndex: row.orderIndex,
    problemType: row.problemType,
    title: row.title,
    prompt: row.prompt,
    givenBlocks: row.givenBlocks,
    startBlocks: row.startBlocks,
    grid: row.grid,
    choices: row.choices,
    given: row.given,
    presentation: row.presentation,
    difficulty: row.difficulty,
    xp: row.xp,
    hint: row.hint ? row.hint : null,
  };
}

function safeLessonRows(db: unknown[]): number[] {
  if (!Array.isArray(db)) return [];
  return db
    .map((row) => Number((row as { lesson?: unknown }).lesson))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12);
}

function makeDefaultLessonSettings(classId: string): Array<{ class_id: string; lesson: number; locked: boolean; practice_count: number | null }> {
  return Array.from({ length: 12 }, (_, index) => ({
    class_id: classId,
    lesson: index + 1,
    locked: index === 0 ? false : true,
    practice_count: null,
  }));
}

function countProblemsFromRows(rows: DbProblemRow[]): Record<number, number> {
  const counts: Record<number, number> = Object.fromEntries(Array.from({ length: 12 }, (_, idx) => [idx + 1, 0]));
  for (const row of rows) {
    if (row.lesson >= 1 && row.lesson <= 12 && row.active) {
      counts[row.lesson] = (counts[row.lesson] ?? 0) + 1;
    }
  }
  return counts;
}

function practiceSeedForStudent(studentId:string, lesson:number):number {
  let hash=lesson;
  for(const char of studentId) hash=((hash*31)+char.charCodeAt(0))|0;
  return Math.abs(hash)%1000000;
}
function belongsToStudentPractice(row:DbProblemRow,studentId:string,seeds:Map<number,number>=new Map()):boolean {
  const code=String(row.code??'');
  if(!code.startsWith('GEN-L'))return true;
  const match=/^GEN-L(\d+)-S(\d+)-/.exec(code);
  return Boolean(match&&Number(match[2])===(seeds.get(Number(match[1])) ?? practiceSeedForStudent(studentId,Number(match[1]))));
}

function generatedInsertRow(seed:(typeof SEED_PROBLEMS)[number]) {
  return { class_id:null, created_by:null, code:seed.code, lesson:seed.lesson, order_index:seed.orderIndex, problem_type:seed.problemType, title:seed.title, prompt:seed.prompt, grid_width:seed.grid.gridWidth, grid_depth:seed.grid.gridDepth, max_height:seed.grid.maxHeight, given_blocks:seed.givenBlocks, start_blocks:seed.startBlocks, given:{...seed.given,_generator:{templateId:seed.templateId,seed:seed.seed,generatorVersion:seed.generatorVersion,difficultyTier:seed.difficultyTier,conceptTags:seed.conceptTags,sourceType:seed.sourceType}}, choices:seed.choices, answer:seed.answer, grading_mode:seed.gradingMode, hint:seed.hint, explanation:seed.explanation, difficulty:seed.difficulty, xp:seed.xp, active:true };
}

function normalizeSubmission(raw: unknown): StudentSubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const isGrid = (g: unknown, numeric = false): boolean => Array.isArray(g) && g.length <= 8 && g.every(row => Array.isArray(row) && row.length <= 8 && row.every(cell => numeric ? Number.isInteger(cell) && Number(cell) >= 0 && Number(cell) <= 8 : typeof cell === "boolean"));
  switch (value.kind) {
    case "blocks":
      if (!Array.isArray(value.blocks) || value.blocks.length > 512 || !value.blocks.every(b => b && Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.z))) return null;
      return {kind:"blocks",blocks:value.blocks};
    case "count": return Number.isInteger(value.value) && Number(value.value) >= 0 ? {kind:"count",value:Number(value.value)} : null;
    case "direction": {
      const direction = value.direction ?? value.value;
      return DIRECTIONS.includes(direction as typeof DIRECTIONS[number]) ? {kind:"direction",value:direction as typeof DIRECTIONS[number]} : null;
    }
    case "choice": return Number.isInteger(value.index) && Number(value.index) >= 0 ? {kind:"choice",index:Number(value.index)} : null;
    case "heightMap": return isGrid(value.heightMap, true) ? {kind:"heightMap",heightMap:value.heightMap as number[][]} : null;
    case "layers": return Array.isArray(value.layers) && value.layers.length <= 8 && value.layers.every(layer => isGrid(layer)) ? {kind:"layers",layers:value.layers as boolean[][][]} : null;
    case "projections": {
      if (!value.projections || typeof value.projections !== "object") return null;
      const projections = value.projections as Record<string, unknown>;
      if (!Object.keys(projections).length || Object.entries(projections).some(([face, g]) => !["top","front","side"].includes(face) || !isGrid(g))) return null;
      return {kind:"projections",projections:projections as Partial<import("../../../shared/types.ts").Projections>};
    }
    default: return null;
  }
}

async function requireStudent(req: Request, db = serviceClient()): Promise<StudentCtx | Response> {
  const token = req.headers.get("x-student-token");
  if (!token) return fail(401, "SESSION_MISSING", "학생 세션 토큰이 없습니다.");

  const payload = await verifySessionToken(token);
  if (!payload) return fail(401, "SESSION_INVALID", "학생 세션이 만료되었거나 유효하지 않습니다.");

  const tokenHash = await hashToken(token);
  const { data: sessionRow, error } = await db
    .from("sb_student_sessions")
    .select("student_id, class_id, revoked")
    .eq("token_hash", tokenHash)
    .eq("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !sessionRow) {
    return fail(401, "SESSION_NOT_FOUND", "세션이 만료되었거나 유효하지 않습니다.");
  }

  if (sessionRow.student_id !== payload.sid || sessionRow.class_id !== payload.cid) {
    return fail(403, "SESSION_MISMATCH", "세션 정보가 일치하지 않습니다.");
  }

  const { data: student } = await db.from("sb_students").select("status").eq("id", sessionRow.student_id).eq("class_id", sessionRow.class_id).maybeSingle();
  if (!student || student.status !== "active") return fail(403, "STUDENT_DISABLED", "학생 계정을 확인해 주세요.");
  return { studentId: String(sessionRow.student_id), classId: String(sessionRow.class_id) };
}

function defaultHomePayload(): {
  className: string;
  classId: string;
  rewards: { totalXp: number; totalStars: number; badges: unknown[]; streak: number };
  lessons: Array<{ lesson: number; locked: boolean; totalProblems: number; completedProblems: number; stars: number; completed: boolean }>;
} {
  return {
    className: "",
    classId: "",
    rewards: { totalXp: 0, totalStars: 0, badges: [], streak: 0 },
    lessons: [],
  };
}

function normalizeAttemptState(row: AttemptRow | null) {
  return {
    wrongCount: row?.wrong_count ?? 0,
    hintShown: row?.hint_shown ?? false,
    answerRevealed: row?.answer_revealed ?? false,
    completed: row?.completed ?? false,
    attemptCount: row?.attempt_count ?? 0,
  };
}

function isPhase5StudentAction(action: string): boolean {
  return action.startsWith("peer-problem:") || action === "project:save" || action === "project:load" || action === "progress:save" || action === "progress:get" || action === "attempt:save" || action === "reflection:save" || action === "reflection:get" || action === "practice-set:get-or-create";
}

function publicPeerRow(row: Record<string, unknown>, attempt?: Record<string, unknown> | null) {
  const publicData = safeJson<{ card?: unknown; grid?: unknown; totalBlocks?: unknown }>(row.public_problem_json, {});
  return {
    problemId: String(row.problem_id), version: Number(row.version), classId: String(row.class_id),
    title: String(row.title ?? ""), authorDisplayName: String(row.author_display_name ?? "학생").slice(0, 40),
    publicProblemData: publicData, publishedAt: String(row.published_at ?? row.created_at ?? ""),
    solveCount: Number(row.solve_count ?? 0),
    // teacher:peer-problem:list is the only caller that needs this (to decide
    // 숨기기 vs 복원); the student-facing caller already filters to
    // status='published' so this is always "published" there -- harmless.
    status: String(row.status ?? "published"),
    myAttempt: attempt ? { completed: Boolean(attempt.completed_at), score: Number(attempt.score_awarded ?? 0), usedHint: Boolean(attempt.used_hint) } : null,
  };
}

async function phase5StudentAction(db: Awaited<ReturnType<typeof serviceClient>>, body: Record<string, unknown>, session: StudentCtx, action: string): Promise<Response> {
  const installationId = text(body.installationId, 120);
  if (!installationId) return fail(400, "INSTALLATION_REQUIRED", "설치 정보를 확인해 주세요.");
  if (action === "peer-problem:publish") {
    const blocks = canonicalizeProblemBlocks(body.blocks);
    const structure = validatePeerBlocks(blocks);
    const cardType = text(body.cardType, 20) as ChallengeCardType;
    const hintType = text(body.hintType, 20) as ChallengeCardType;
    if (structure || !["views", "top", "heightMap", "layers"].includes(cardType) || !["views", "top", "heightMap", "layers"].includes(hintType)) return fail(400, "PEER_VALIDATION", structure ?? "문제 카드와 힌트를 확인해 주세요.");
    const card = makeChallengeCard(blocks, cardType); const hint = makeChallengeCard(blocks, hintType);
    const title = text(body.title, 120) || "친구 문제";
    const problemId = crypto.randomUUID();
    const { error } = await db.from("sb_student_created_problems").insert({ problem_id: problemId, version: 1, installation_id: installationId, class_id: session.classId, author_student_id: session.studentId, title, public_problem_json: { card, grid: { gridWidth: 3, gridDepth: 3, maxHeight: 12 }, totalBlocks: 10 }, hidden_validation_json: { blocks, card, hint }, hint_type: hintType, status: "published", published_at: new Date().toISOString() });
    if (error) { console.error("[student-api] peer publish failed", { code: error.code }); return fail(500, "PEER_PUBLISH_FAILED", "문제를 게시하지 못했습니다."); }
    return ok({ problem: { problemId, version: 1, classId: session.classId, title, publicProblemData: { card, grid: { gridWidth: 3, gridDepth: 3, maxHeight: 12 }, totalBlocks: 10 } } });
  }
  if (action === "peer-problem:list" || action === "peer-problem:get") {
    let query = db.from("sb_student_created_problems").select("problem_id,version,class_id,author_student_id,title,public_problem_json,published_at,created_at,status").eq("installation_id", installationId).eq("class_id", session.classId).eq("status", "published");
    if (action === "peer-problem:get") query = query.eq("problem_id", text(body.problemId, 80)).eq("version", Number(body.version) || 1);
    const loaded = await query;
    if (loaded.error) return fail(500, "PEER_LOAD_FAILED", "친구 문제를 불러오지 못했습니다.");
    const rows = action === "peer-problem:list" ? (loaded.data ?? []).filter((row: Record<string, unknown>) => String(row.author_student_id) !== session.studentId) : (loaded.data ?? []);
    const attempts = rows.length ? await db.from("sb_peer_problem_attempts").select("problem_id,problem_version,completed_at,score_awarded,used_hint").eq("installation_id", installationId).eq("student_id", session.studentId).in("problem_id", rows.map((r: Record<string, unknown>) => String(r.problem_id))) : { data: [] };
    const problems = rows.map((row: Record<string, unknown>) => publicPeerRow(row, (attempts.data as Record<string, unknown>[] | undefined)?.find((a) => String(a.problem_id) === String(row.problem_id) && Number(a.problem_version) === Number(row.version)) ?? null));
    if (action === "peer-problem:get" && !problems[0]) return fail(404, "PEER_NOT_FOUND", "친구 문제를 찾을 수 없습니다.");
    return ok(action === "peer-problem:get" ? { problem: problems[0] } : { problems });
  }
  if (action === "peer-problem:hint") {
    const problemId = text(body.problemId, 80); const version = Number(body.version) || 1;
    const loaded = await db.from("sb_student_created_problems").select("problem_id,version,class_id,hidden_validation_json,status").eq("installation_id", installationId).eq("class_id", session.classId).eq("problem_id", problemId).eq("version", version).eq("status", "published").maybeSingle();
    if (loaded.error || !loaded.data) return fail(404, "PEER_NOT_FOUND", "친구 문제를 찾을 수 없습니다.");
    const privateData = safeJson<{ hint?: ChallengeCard }>(loaded.data.hidden_validation_json, {});
    const existing = await db.from("sb_peer_problem_attempts").select("id").eq("installation_id", installationId).eq("problem_id", problemId).eq("problem_version", version).eq("student_id", session.studentId).maybeSingle();
    if (!existing.data) await db.from("sb_peer_problem_attempts").insert({ installation_id: installationId, class_id: session.classId, problem_id: problemId, problem_version: version, student_id: session.studentId, used_hint: true, submitted_answer_json: {}, is_correct: false, score_awarded: 0 });
    return ok({ hint: privateData.hint ?? null });
  }
  if (action === "peer-problem:submit") {
    const problemId = text(body.problemId, 80); const version = Number(body.version) || 1; const blocks = canonicalizeProblemBlocks(body.blocks);
    const loaded = await db.from("sb_student_created_problems").select("problem_id,version,class_id,author_student_id,hidden_validation_json,status").eq("installation_id", installationId).eq("class_id", session.classId).eq("problem_id", problemId).eq("version", version).in("status", ["published", "hidden"]).maybeSingle();
    if (loaded.error || !loaded.data) return fail(404, "PEER_NOT_FOUND", "친구 문제를 찾을 수 없습니다.");
    const existing = await db.from("sb_peer_problem_attempts").select("*").eq("installation_id", installationId).eq("problem_id", problemId).eq("problem_version", version).eq("student_id", session.studentId).maybeSingle();
    if (existing.data?.completed_at) return ok({ attempt: existing.data });
    const privateData = safeJson<{ blocks?: { x: number; y: number; z: number }[]; card?: ChallengeCard; hint?: ChallengeCard }>(loaded.data.hidden_validation_json, {});
    const usedHint = Boolean(existing.data?.used_hint); const structure = validStructure(blocks, { gridWidth: 3, gridDepth: 3, maxHeight: 12 });
    const challenge = { id: problemId, version, classId: session.classId, authorId: String(loaded.data.author_student_id), title: "", blocks: privateData.blocks ?? [], card: privateData.card as ChallengeCard, hint: privateData.hint as ChallengeCard, published: true, hidden: false };
    const correct = structure && Boolean(privateData.card) && gradePeer(blocks, challenge, usedHint); const score = String(loaded.data.author_student_id) === session.studentId || !correct ? 0 : usedHint ? 1 : 2;
    const payload = { installation_id: installationId, class_id: session.classId, problem_id: problemId, problem_version: version, student_id: session.studentId, used_hint: usedHint, submitted_answer_json: { kind: "blocks", blocks }, is_correct: correct, score_awarded: score, completed_at: correct ? new Date().toISOString() : null };
    const saved = existing.data ? await db.from("sb_peer_problem_attempts").update(payload).eq("id", existing.data.id).select("*").single() : await db.from("sb_peer_problem_attempts").insert(payload).select("*").single();
    if (saved.error) { console.error("[student-api] peer submit failed", { code: saved.error.code }); return fail(500, "PEER_SUBMIT_FAILED", "풀이를 저장하지 못했습니다."); }
    return ok({ attempt: saved.data });
  }
  if (action === "peer-problem:attempts") {
    const loaded = await db.from("sb_peer_problem_attempts").select("problem_id,problem_version,used_hint,is_correct,score_awarded,completed_at,created_at").eq("installation_id", installationId).eq("student_id", session.studentId).eq("class_id", session.classId).order("created_at", { ascending: false });
    return loaded.error ? fail(500, "PEER_LOAD_FAILED", "풀이 기록을 불러오지 못했습니다.") : ok({ attempts: loaded.data ?? [] });
  }
  if (action === "project:load") {
    const loaded = await db.from("sb_projects").select("*").eq("student_id", session.studentId).eq("class_id", session.classId).maybeSingle();
    return loaded.error ? fail(500, "PROJECT_LOAD_FAILED", "작품을 불러오지 못했습니다.") : ok({ project: loaded.data ?? null });
  }
  if (action === "project:save") {
    const expectedVersion = Number(body.expectedVersion ?? body.version ?? 0);
    const projectData = { building_name: text(body.title, 120), reason: text(body.reason, 500), description: text(body.description, 1000), layer_notes: body.layerUsageNotes ?? body.layerNotes ?? [], blocks: body.blocks ?? [], block_appearance: body.materials ?? body.blockAppearance ?? {}, intro_theme: text(body.introTheme, 40) || "blueprint", grid_width: Number(body.gridWidth) || 10, grid_depth: Number(body.gridDepth) || 10, max_height: Number(body.maxHeight) || 3, submitted: Boolean(body.submitted) };
    const saved = await db.rpc("sb_save_building", { p_student: session.studentId, p_class: session.classId, p_version: expectedVersion, p_data: projectData });
    if (saved.error) return fail(saved.error.message === "VERSION_CONFLICT" ? 409 : 500, saved.error.message === "VERSION_CONFLICT" ? "PROJECT_VERSION_CONFLICT" : "PROJECT_SAVE_FAILED", saved.error.message === "VERSION_CONFLICT" ? "최신 작품을 먼저 불러와 주세요." : "작품을 저장하지 못했습니다.");
    return ok({ projectVersion: Number(saved.data ?? expectedVersion + 1), project: projectData });
  }
  if (action === "progress:save" || action === "attempt:save") {
    const lesson = Number(body.lesson); const setId = text(body.setId, 120); const problemId = text(body.problemId, 120); const problemVersion = Number(body.problemVersion) || 1;
    const prior = await db.from("sb_lesson_progress_records").select("first_attempt_result,attempt_count,hint_level").eq("installation_id", installationId).eq("class_id", session.classId).eq("student_id", session.studentId).eq("lesson", lesson).eq("set_id", setId).eq("problem_id", problemId).eq("problem_version", problemVersion).maybeSingle();
    const record = { installation_id: installationId, class_id: session.classId, student_id: session.studentId, curriculum_version: text(body.curriculumVersion, 40) || "v1", lesson, stage: text(body.stage, 12), set_id: setId, problem_id: problemId, problem_version: problemVersion, question_index: Number(body.questionIndex) || 0, answer: body.answer ?? {}, first_attempt_result: prior.data?.first_attempt_result ?? body.firstAttemptResult ?? null, attempt_count: Math.max(Number(prior.data?.attempt_count ?? 0), Number(body.attemptCount) || 0), hint_level: Math.max(Number(prior.data?.hint_level ?? 0), Number(body.hintLevel) || 0), final_result: body.finalResult ?? null, remediation_status: body.remediationStatus ?? "none", completed_at: body.completedAt ?? null };
    const saved = await db.from("sb_lesson_progress_records").upsert(record, { onConflict: "installation_id,class_id,student_id,lesson,set_id,problem_id,problem_version" }).select("*").single();
    return saved.error ? fail(500, "PROGRESS_SAVE_FAILED", "진도를 저장하지 못했습니다.") : ok({ progress: saved.data });
  }
  if (action === "progress:get") {
    const loaded = await db.from("sb_lesson_progress_records").select("*").eq("installation_id", installationId).eq("class_id", session.classId).eq("student_id", session.studentId).eq("lesson", Number(body.lesson)).eq("set_id", text(body.setId, 120));
    return loaded.error ? fail(500, "PROGRESS_LOAD_FAILED", "진도를 불러오지 못했습니다.") : ok({ progress: loaded.data ?? [] });
  }
  if (action === "reflection:save" || action === "reflection:get") {
    const lesson = Number(body.lesson); const curriculumVersion = text(body.curriculumVersion, 40) || "v1";
    if (action === "reflection:get") { const loaded = await db.from("sb_student_lesson_reflections").select("lesson,curriculum_version,confidence,favorite_concept,self_praise").eq("installation_id", installationId).eq("class_id", session.classId).eq("student_id", session.studentId).eq("lesson", lesson).eq("curriculum_version", curriculumVersion).maybeSingle(); return loaded.error ? fail(500, "REFLECTION_LOAD_FAILED", "자기평가를 불러오지 못했습니다.") : ok({ reflection: loaded.data ?? null }); }
    const saved = await db.from("sb_student_lesson_reflections").upsert({ installation_id: installationId, class_id: session.classId, student_id: session.studentId, lesson, curriculum_version: curriculumVersion, confidence: body.confidence ?? null, favorite_concept: text(body.favoriteConcept, 120) || null, self_praise: text(body.selfPraise, 240) || null }, { onConflict: "installation_id,student_id,lesson,curriculum_version" }).select("*").single(); return saved.error ? fail(500, "REFLECTION_SAVE_FAILED", "자기평가를 저장하지 못했습니다.") : ok({ reflection: saved.data });
  }
  if (action === "practice-set:get-or-create") {
    const lesson = Number(body.lesson); const curriculumVersion = text(body.curriculumVersion, 40) || "v1"; const targetTotal = [5, 10, 15, 20].includes(Number(body.targetTotal)) ? Number(body.targetTotal) : 5; const seed = Number(body.seed) || 0; const setId = text(body.setId, 120) || `practice-${lesson}-${seed}`; const existing = await db.from("sb_practice_assignments").select("*").eq("installation_id", installationId).eq("student_id", session.studentId).eq("lesson", lesson).eq("active", true).maybeSingle(); if (existing.data) return ok({ assignment: existing.data }); const saved = await db.from("sb_practice_assignments").insert({ installation_id: installationId, class_id: session.classId, student_id: session.studentId, lesson, curriculum_version: curriculumVersion, set_id: setId, seed, problem_ids: body.problemIds ?? [], target_total: targetTotal, active: true }).select("*").single(); return saved.error ? fail(500, "PRACTICE_SET_FAILED", "연습 문제 묶음을 준비하지 못했습니다.") : ok({ assignment: saved.data });
  }
  return fail(400, "BAD_ACTION", "지원되지 않는 Phase 5 action 입니다.");
}

Deno.serve(async (req: Request) => {
  const cors = handlePreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return fail(405, "METHOD_NOT_ALLOWED", "POST 로만 호출할 수 있습니다.");
  }

  let db: Awaited<ReturnType<typeof serviceClient>>;
  try {
    db = serviceClient();
  } catch (error) {
    return fail(500, "CONFIG", error instanceof Error ? error.message : "설정 오류");
  }

  const body = await readJson(req);
  const action = text(body.action, 40) as Action;

  // 학생 동작
  if (action === "asset" || action.startsWith("activity:") || action === "home" || action === "rewards" || action === "rewards:equip" || action === "lessonProblems" || action === "practice:new-set" || action === "problem" || action === "attempt" || action === "snapshot" || action === "snapshot:get" || action === "position" || isPhase5StudentAction(action)) {
    const studentSession = await requireStudent(req, db);
    if (studentSession instanceof Response) return studentSession;

    if (isPhase5StudentAction(action)) return phase5StudentAction(db, body, studentSession, action);

    if (action.startsWith("activity:")) return activityRequest(db, body, studentSession);

    if (action !== "home" && action !== "rewards" && action !== "rewards:equip") {
      let targetLesson = toInt(body.lesson);
      if (action !== "lessonProblems" && action !== "practice:new-set") {
        const targetId = text(body.problemId, 80);
        const { data: target } = await db.from("sb_problems").select("code,lesson,active,class_id,grid_width,grid_depth,max_height")
          .eq("id", targetId).or(`class_id.eq.${studentSession.classId},class_id.is.null`).maybeSingle();
        if (!target || !target.active) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");
        targetLesson = target.lesson;
        if(String(target.code??'').startsWith('GEN-L')) {
          const saved=await db.from("sb_student_progress").select("practice_seed").eq("student_id",studentSession.studentId).eq("lesson",target.lesson).maybeSingle();
          if(saved.error) return fail(500,"PRACTICE_LOAD_FAILED","배정된 문제 묶음을 확인하지 못했어요.");
          let assignedSeed=saved.data?.practice_seed??practiceSeedForStudent(studentSession.studentId,target.lesson);
          const originalSeed=practiceSeedForStudent(studentSession.studentId,target.lesson);
          if(assignedSeed!==originalSeed && isAssignedPracticeCode(target.code,target.lesson,originalSeed)) {
            const prepared=await db.from("sb_problems").select("id").like("code",`GEN-L${target.lesson}-S${assignedSeed}-%`).eq("active",true).or(`class_id.eq.${studentSession.classId},class_id.is.null`).limit(1);
            if(prepared.error) return fail(500,"PRACTICE_LOAD_FAILED","새 문제 묶음을 확인하지 못했어요.");
            if(!prepared.data?.length) assignedSeed=originalSeed;
          }
          if(!isAssignedPracticeCode(target.code,target.lesson,assignedSeed)) {
            // 이전 세트도 본인의 기존 풀이/작품 기록이 있을 때만 다시 접근한다.
            const [attempt,snapshot]=await Promise.all([
              db.from("sb_problem_attempts").select("problem_id").eq("student_id",studentSession.studentId).eq("problem_id",targetId).limit(1),
              db.from("sb_block_snapshots").select("problem_id").eq("student_id",studentSession.studentId).eq("problem_id",targetId).limit(1),
            ]);
            if(attempt.error||snapshot.error) return fail(500,"PRACTICE_LOAD_FAILED","기존 학습 기록을 확인하지 못했어요.");
            if(!attempt.data?.length&&!snapshot.data?.length) return fail(404,"PROBLEM_NOT_FOUND","현재 배정된 문제나 본인의 이전 학습 기록이 아닙니다.");
            if(!canReadHistoricalPractice(action)) return fail(409,"PRACTICE_HISTORY_READ_ONLY","이전 묶음의 기록은 보기만 가능해요. 현재 묶음에서 이어서 풀어 주세요.");
          }
        }
        if (action === "snapshot") {
          if (!validStructure(body.blocks as { x: number; y: number; z: number }[], { gridWidth: target.grid_width, gridDepth: target.grid_depth, maxHeight: target.max_height })) {
            return fail(400, "INVALID_BLOCKS", "올바른 블록 좌표가 아닙니다.");
          }
          body.lesson = target.lesson;
          body.gridWidth = target.grid_width; body.gridDepth = target.grid_depth; body.maxHeight = target.max_height;
        }
      }
      if (!Number.isInteger(targetLesson) || !targetLesson || targetLesson < 1 || targetLesson > 12) return fail(400, "BAD_LESSON", "차시를 확인해 주세요.");
        const { data: setting, error } = await db.from("sb_lesson_settings").select("locked,practice_count").eq("class_id", studentSession.classId).eq("lesson", targetLesson).maybeSingle();
      if (error || (setting?.locked ?? targetLesson !== 1)) return fail(403, "LESSON_LOCKED", "선생님이 아직 열지 않은 차시예요.");
    }

    if (action === "asset") {
      const {data:problem}=await db.from("sb_problems").select("image_path").eq("id",text(body.problemId,80)).eq("class_id",studentSession.classId).maybeSingle();
      if (!problem?.image_path?.startsWith(`${studentSession.classId}/`)) return fail(404,"ASSET_MISSING","문제 그림을 찾지 못했습니다.");
      const {data,error}=await db.storage.from("sb-problem-images").createSignedUrl(problem.image_path,300);
      return error?fail(500,"ASSET_FAILED","문제 그림을 불러오지 못했습니다."):ok({url:data.signedUrl});
    }

    if (action === "home") {
      const [classRowsRes, lessonSettingRes, progressRes, rewardRes, problemRowsRes] = await Promise.all([
        db
          .from("sb_classes")
          .select("id, name")
          .eq("id", studentSession.classId)
          .maybeSingle(),
        db.from("sb_lesson_settings").select("lesson, locked, practice_count").eq("class_id", studentSession.classId),
        db
          .from("sb_student_progress")
          .select("lesson, completed, stars, practice_seed")
          .eq("student_id", studentSession.studentId),
        db.from("sb_student_rewards").select("total_xp,total_stars,badges,streak,equipped_material,intro_theme").eq("student_id", studentSession.studentId).maybeSingle(),
        db
          .from("sb_problems")
          .select(
            "lesson,problem_type,title,prompt,grid_width,grid_depth,max_height,given_blocks,start_blocks,given,choices,answer,grading_mode,difficulty,xp,hint,explanation,order_index,active,id,class_id,code",
          )
          .or(`class_id.eq.${studentSession.classId},class_id.is.null`),
      ]);

      if (classRowsRes.error) return fail(500, "CLASS_ERROR", "반 정보를 읽지 못했습니다.");
      const baseClass = classRowsRes.data as ClassRow | null;
      if (!baseClass) return fail(404, "CLASS_NOT_FOUND", "반 정보를 못 찾았어요.");

      const lessonSettings = lessonSettingRes.error
        ? []
        : (lessonSettingRes.data as Array<{ lesson: number; locked: boolean; practice_count?: number | null }>) ?? [];

      if (!lessonSettingRes.error && lessonSettings.length === 0) {
        await db.from("sb_lesson_settings").upsert(makeDefaultLessonSettings(baseClass.id), {
          onConflict: "class_id,lesson",
        });
      }

      const finalLessonSettings =
        lessonSettingRes.error || lessonSettings.length === 0
          ? makeDefaultLessonSettings(baseClass.id)
          : lessonSettings;

      const progressRows = (progressRes.data as Array<{ lesson: number; completed: boolean; stars: number }>) ?? [];
      const reward = (rewardRes.data as { total_xp: number; total_stars: number; badges: unknown[]; streak: number; equipped_material?: RewardMaterial; intro_theme?: RewardTheme } | null) ?? {
        total_xp: 0,
        total_stars: 0,
        badges: [],
        streak: 0, equipped_material: 'wood' as RewardMaterial, intro_theme: 'blueprint' as RewardTheme,
      };

      const countByLesson = countProblemsFromRows(
        ((problemRowsRes.data as unknown[]) as DbProblemRow[])?.filter((row) => (row as DbProblemRow).active && belongsToStudentPractice(row as DbProblemRow,studentSession.studentId,new Map((progressRes.data??[]).filter(p=>p.practice_seed!==null).map(p=>[Number(p.lesson),Number(p.practice_seed)])))) ?? [],
      );

      const [attempts, challengeXp, projectState] = await Promise.all([
        db.from("sb_problem_attempts").select("lesson,completed").eq("student_id",studentSession.studentId),
        db.from("sb_challenge_solves").select("xp").eq("student_id",studentSession.studentId),
        db.from("sb_projects").select("submitted").eq("student_id",studentSession.studentId).maybeSingle(),
      ]);
      const activityXp=(challengeXp.data??[]).reduce((sum,row)=>sum+Number(row.xp),0)+(projectState.data?.submitted?30:0);
      const lessons = Array.from({ length: 12 }, (_, index) => {
        const lesson = index + 1;
        const setting =
          finalLessonSettings.find((item) => Number(item.lesson) === lesson) ??
          { lesson, locked: lesson === 1 ? false : true };
        const progress = progressRows.find((row) => row.lesson === lesson);

        const settingCount = Number(finalLessonSettings.find((item) => Number(item.lesson) === lesson)?.practice_count);
        const totalProblems = lesson>=9 && lesson<=11 ? 1 : Math.max(countByLesson[lesson] ?? 0, [5,10,15,20].includes(settingCount) ? settingCount : recommendedPracticeCount(lesson));
        const completedProblems = progress?.completed ? totalProblems : (attempts.data??[]).filter(a=>a.lesson===lesson&&a.completed).length;
        return {
          lesson,
          locked: Boolean(setting.locked),
          totalProblems,
          completedProblems,
          stars: Number(progress?.stars ?? 0),
          completed: Boolean(progress?.completed),
        };
      });

      return ok({
        student: {
          classId: baseClass.id,
          className: baseClass.name,
          rewards: {
            totalXp: Number(reward.total_xp ?? 0)+activityXp,
            totalStars: Number(reward.total_stars ?? 0),
            badges: progressRows.filter(p=>p.completed).map(p=>`${p.lesson}차시 완료`),
            streak: Number(reward.streak ?? 0),
            equippedMaterial: reward.equipped_material ?? 'wood',
            introTheme: reward.intro_theme ?? 'blueprint',
            catalog: REWARD_CATALOG.map(item => ({ ...item, unlocked: rewardUnlocked(Number(reward.total_xp ?? 0) + activityXp, item.id) })),
          },
          lessons,
        },
      });
    }

    if (action === "rewards" || action === "rewards:equip") {
      const rewardRes = await db.from("sb_student_rewards").select("total_xp,equipped_material,intro_theme").eq("student_id", studentSession.studentId).maybeSingle();
      if (rewardRes.error) return fail(500, "REWARDS_LOAD_FAILED", "보상을 불러오지 못했어요.");
      const xp = Number(rewardRes.data?.total_xp ?? 0);
      if (action === "rewards:equip") {
        const material = sanitizeMaterial(body.material) as RewardMaterial;
        const theme = sanitizeTheme(body.theme) as RewardTheme;
        const { data, error } = await db.rpc("sb_set_reward_loadout", { p_student: studentSession.studentId, p_material: material, p_theme: theme });
        if (error) return fail(403, error.message === "REWARD_LOCKED" ? "REWARD_LOCKED" : "REWARD_EQUIP_FAILED", "아직 잠겨 있거나 사용할 수 없는 보상이에요.");
        const row = Array.isArray(data) ? data[0] : data;
        return ok({ xp, equippedMaterial: row?.equipped_material ?? material, introTheme: row?.intro_theme ?? theme, catalog: REWARD_CATALOG.map(item => ({ ...item, unlocked: rewardUnlocked(xp, item.id) })) });
      }
      return ok({ xp, equippedMaterial: rewardRes.data?.equipped_material ?? 'wood', introTheme: rewardRes.data?.intro_theme ?? 'blueprint', catalog: REWARD_CATALOG.map(item => ({ ...item, unlocked: rewardUnlocked(xp, item.id) })) });
    }

    if (action === "lessonProblems") {
      const lesson = toInt(body.lesson);
      if (!lesson) return fail(400, "BAD_LESSON", "lesson 는 1~12 사이의 값이어야 합니다.");

      let { data: problemRows, error: problemLoadError } = await db
        .from("sb_problems")
        .select(
          "id,image_path, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, answer, grading_mode, hint, explanation, difficulty, xp, active, code",
        )
        .or(`class_id.eq.${studentSession.classId},class_id.is.null`)
        .eq("lesson", lesson)
        .eq("active", true)
        .order("order_index", { ascending: true });

      if(problemLoadError) return fail(500,"PRACTICE_LOAD_FAILED","기존 문제 묶음을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");

      const { data: lessonSetting, error: settingError } = await db.from("sb_lesson_settings").select("practice_count,allow_similar,allow_retry").eq("class_id", studentSession.classId).eq("lesson", lesson).maybeSingle();
      if(settingError) return fail(500,"PRACTICE_LOAD_FAILED","선생님의 문제 배정량을 확인하지 못했어요.");
      const targetCount = [5,10,15,20].includes(Number(lessonSetting?.practice_count)) ? Number(lessonSetting?.practice_count) : recommendedPracticeCount(lesson);
      const {data: savedPractice, error: seedError}=await db.from("sb_student_progress").select("practice_seed").eq("student_id",studentSession.studentId).eq("lesson",lesson).maybeSingle();
      if(seedError) return fail(500,"PRACTICE_LOAD_FAILED","문제 묶음을 불러오지 못했어요. 기존 기록은 보존돼요.");
      const seed=savedPractice?.practice_seed ?? practiceSeedForStudent(studentSession.studentId,lesson);
      const seeded=await db.from("sb_student_progress").upsert({student_id:studentSession.studentId,lesson,practice_seed:seed},{onConflict:"student_id,lesson",ignoreDuplicates:true});
      if(seeded.error) return fail(500,"PRACTICE_SAVE_FAILED","문제 묶음의 복원 정보를 저장하지 못했어요.");
      const allRows=(problemRows as DbProblemRow[]|null)??[];
      const displayedSeed=practiceDisplaySeed(allRows,lesson,seed,practiceSeedForStudent(studentSession.studentId,lesson));
      const generatedPrefix=`GEN-L${lesson}-S${seed}-`;
      const existingRows=selectPracticeRows(allRows,lesson,displayedSeed);
      // 삽입이 없는 재조회에서도 원래 allRows를 반환하지 않는다.
      problemRows=existingRows as typeof problemRows;
      // 기존 세트는 개수·ID·시도 기록 그대로 보존. 신규 세트만 추가 배정량을 적용.
      const hasSavedSet=existingRows.some(row=>String(row.code??'').startsWith(generatedPrefix));
      let generated: ReturnType<typeof generatePracticeProblems>=[];
      if(!hasSavedSet && displayedSeed===seed && [1,2,3,4,5,6,7,8,12].includes(lesson)) {
        try { generated=generateValidatedPracticeSet(lesson,targetCount,seed); }
        catch { return fail(409,"PRACTICE_SET_INSUFFICIENT","서로 다른 문제를 충분히 준비하지 못했어요. 기존 학습 기록은 보존돼요."); }
      }
      const existingCodes=new Set(existingRows.map(row=>row.code).filter(Boolean));
      const missing=generated.filter(item=>!existingCodes.has(item.code));
      if(missing.length){const inserts=await Promise.all(missing.map(async item=>({...generatedInsertRow(item),id:await generatedProblemId(item.code)})));
        const inserted=await db.from("sb_problems").upsert(inserts,{onConflict:"id",ignoreDuplicates:true});
        if(inserted.error) return fail(500,"PRACTICE_SAVE_FAILED","문제 묶음을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        const refreshed=await db.from("sb_problems").select("id,image_path, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, answer, grading_mode, hint, explanation, difficulty, xp, active, code, class_id").or(`class_id.eq.${studentSession.classId},class_id.is.null`).eq("lesson",lesson).eq("active",true).order("order_index",{ascending:true});
        if(refreshed.error) return fail(500,"PRACTICE_LOAD_FAILED","저장한 문제 묶음을 불러오지 못했어요. 다시 접속하면 이어서 확인할 수 있어요.");
        problemRows=(refreshed.data?.filter(row=>!String((row as DbProblemRow).code??'').startsWith('GEN-L')||String((row as DbProblemRow).code??'').startsWith(generatedPrefix))??null) as typeof problemRows;
      }
      const parsed=(problemRows as DbProblemRow[]|null)?.map(row=>parseProblemRow(row)).filter(Boolean)??[];
      const merged = [...parsed];
      const requiredIds=requiredSolveIds(parsed.filter((p): p is NonNullable<typeof p> => p !== null));
      const {data:requiredAttempts}=requiredIds.length?await db.from("sb_problem_attempts").select("problem_id,completed").eq("student_id",studentSession.studentId).in("problem_id",requiredIds):{data:[] as {problem_id:string;completed:boolean}[]};
      const requiredComplete=requiredIds.length>0&&requiredIds.every(id=>requiredAttempts?.some(row=>row.problem_id===id&&row.completed));
      const stages={concept:parsed.filter(p=>p?.stage==='concept').length,check:parsed.filter(p=>p?.stage==='check').length,more:parsed.filter(p=>p?.stage==='more').length};

      const problems = merged
        .filter((p) => p?.active)
        .map((problem) => sanitizeToStudentProblem(problem))
        .filter(Boolean);

      const { data: progressPosition } = await db
        .from("sb_student_progress")
        .select("last_problem_id")
        .eq("student_id", studentSession.studentId)
        .eq("lesson", lesson)
        .maybeSingle();

      return ok({
        problems,
        seedFallback: false,
        requiredComplete,
        currentProblemId: progressPosition?.last_problem_id ?? null,
        practiceSet: practiceSetStatus((problemRows as DbProblemRow[]|null)??[],lesson,seed,targetCount,displayedSeed),
        stages,
        allowSimilar: lessonSetting?.allow_similar ?? true,
        allowRetry: lessonSetting?.allow_retry ?? true,
      });
    }

    if (action === "position") {
      const problemId = text(body.problemId, 80);
      const lesson = toInt(body.lesson);
      if (!problemId || !lesson) return fail(400, "BAD_PARAM", "problemId 와 lesson 이 필요합니다.");
      // seed 문제는 DB 행이 없으므로 위치를 저장할 필요가 없습니다.
      if (problemId.startsWith("seed:")) return ok({ ok: true });

      const { data: target } = await db
        .from("sb_problems")
        .select("id")
        .or(`class_id.eq.${studentSession.classId},class_id.is.null`)
        .eq("id", problemId)
        .eq("lesson", lesson)
        .eq("active", true)
        .maybeSingle();
      if (!target) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");

      const { error } = await db.from("sb_student_progress").upsert(
        { student_id: studentSession.studentId, lesson, last_problem_id: problemId },
        { onConflict: "student_id,lesson" },
      );
      if (error) {
        console.error("[student-api] position save failed", { code: error.code, lesson });
        return fail(500, "POSITION_SAVE_FAILED", "현재 문제 위치를 저장하지 못했습니다.");
      }
      return ok({ ok: true });
    }

    if (action === "practice:new-set") {
      const lesson = toInt(body.lesson);
      if (!lesson || lesson < 1 || lesson > 12) return fail(400, "BAD_LESSON", "lesson 는 1~12 사이의 값이어야 합니다.");
      const { data: setting, error: settingError } = await db.from("sb_lesson_settings").select("locked,practice_count").eq("class_id", studentSession.classId).eq("lesson", lesson).maybeSingle();
      if(settingError) return fail(500,"PRACTICE_LOAD_FAILED","선생님의 문제 배정량을 확인하지 못했어요.");
      if (setting?.locked ?? lesson !== 1) return fail(403, "LESSON_LOCKED", "선생님이 아직 열지 않은 차시예요.");
      const { data: current, error: currentError } = await db.from("sb_student_progress").select("practice_seed").eq("student_id", studentSession.studentId).eq("lesson", lesson).maybeSingle();
      if(currentError) return fail(500,"PRACTICE_LOAD_FAILED","현재 묶음을 확인하지 못해 새 묶음 전환을 멈췄어요. 기존 기록은 유지됩니다.");
      const expectedSeed=Number(body.expectedSeed);
      if(typeof body.expectedSeed!=="number" || !Number.isInteger(expectedSeed) || expectedSeed<0 || expectedSeed>=1000000 || current?.practice_seed==null) return fail(409,"PRACTICE_SET_REFRESH_REQUIRED","현재 문제 묶음을 다시 불러온 뒤 시작해 주세요.");
      // 같은 화면에서 발생한 이중 클릭/응답 유실 재전송은 이미 시작한 세트로 연결한다.
      if(Number(current.practice_seed)!==expectedSeed) return ok({seed:Number(current.practice_seed),alreadyStarted:true});
      const nextSeed = (Number(current?.practice_seed ?? practiceSeedForStudent(studentSession.studentId, lesson)) + 7919) % 1000000;
      const count=[5,10,15,20].includes(Number(setting?.practice_count))?Number(setting?.practice_count):recommendedPracticeCount(lesson);
      let nextSet:ReturnType<typeof generatePracticeProblems>;
      try { nextSet=generateValidatedPracticeSet(lesson,count,nextSeed); }
      catch { return fail(409,"PRACTICE_SET_INSUFFICIENT","새 문제를 충분히 준비하지 못했어요. 현재 세트와 기록을 유지합니다."); }
      const preparedRows=await Promise.all(nextSet.map(async item=>({...generatedInsertRow(item),id:await generatedProblemId(item.code)})));
      const prepared=await db.from("sb_problems").upsert(preparedRows,{onConflict:"id",ignoreDuplicates:true});
      if(prepared.error) return fail(500,"PRACTICE_SAVE_FAILED","새 문제 저장에 실패했어요. 현재 세트는 그대로예요.");
      const { data: switched, error } = await db.from("sb_student_progress").update({practice_seed:nextSeed}).eq("student_id",studentSession.studentId).eq("lesson",lesson).eq("practice_seed",expectedSeed).select("practice_seed").maybeSingle();
      if (error) return fail(500, "PRACTICE_SAVE_FAILED", "새 문제 세트를 준비하지 못했습니다. 먼저 연습 설정 migration을 적용해 주세요.");
      if(!switched) {
        const latest=await db.from("sb_student_progress").select("practice_seed").eq("student_id",studentSession.studentId).eq("lesson",lesson).maybeSingle();
        if(latest.error||latest.data?.practice_seed==null) return fail(409,"PRACTICE_SET_REFRESH_REQUIRED","현재 문제 묶음을 다시 불러와 주세요. 기록은 보존돼요.");
        return ok({seed:Number(latest.data.practice_seed),alreadyStarted:true});
      }
      return ok({ seed: nextSeed });
    }

    if (action === "problem") {
      const problemId = text(body.problemId, 80);
      const lesson = toInt(body.lesson);
      if (!problemId && !lesson) return fail(400, "BAD_PARAM", "문제 id 또는 lesson 가 필요합니다.");

      let row: DbProblemRow | null = null;
      if (problemId && !problemId.startsWith("seed:")) {
        const { data } = await db
          .from("sb_problems")
          .select(
            "id,image_path, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, answer, grading_mode, hint, explanation, difficulty, xp, active, code",
          )
          .or(`class_id.eq.${studentSession.classId},class_id.is.null`)
          .eq("id", problemId)
          .maybeSingle();

        row = (data as DbProblemRow | null) ?? null;
      }

      if (!row && problemId.startsWith("seed:")) {
        const code = problemId.replace(/^seed:/, "");
        const seed = SEED_PROBLEMS.find((item) => item.code === code);
        if (!seed) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");
        const wrapped = parseSeedProblem(seed);
        return ok({ problem: sanitizeToStudentProblem(wrapped), source: "seed" });
      }

      if (!row) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");
      const parsed = parseProblemRow(row);
      if (!parsed) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");

      // 시도 상태를 가져와서 힌트 공개 여부를 반영한다.
      const { data: attemptRow } = await db
        .from("sb_problem_attempts")
        .select("wrong_count, hint_shown, answer_revealed, completed")
        .eq("student_id", studentSession.studentId)
        .eq("problem_id", row.id)
        .maybeSingle();

      const problem = sanitizeToStudentProblem(parsed);
      return ok({
        problem,
        attempt: {
          wrongCount: attemptRow?.wrong_count ?? 0,
          hintShown: attemptRow?.hint_shown ?? false,
          answerRevealed: attemptRow?.answer_revealed ?? false,
          completed: attemptRow?.completed ?? false,
        },
        hint: attemptRow?.hint_shown ? String(parsed.hint ?? "") : null,
        revealedAnswer: attemptRow?.answer_revealed ? buildRevealedAnswer(parsed) : null,
      });
    }

    if (action === "attempt") {
      const problemId = text(body.problemId, 80);
      const submission = normalizeSubmission(body.submission);
      if (!problemId || !submission) return fail(400, "BAD_PARAM", "problemId 와 submission 이 필요합니다.");

      const { data: problemRow } = await db
        .from("sb_problems")
        .select(
          "id,image_path, lesson, answer, grading_mode, problem_type, prompt, title, given_blocks, start_blocks, given, choices, hint, explanation, difficulty, xp, active, grid_width, grid_depth, max_height, order_index, code",
        )
        .or(`class_id.eq.${studentSession.classId},class_id.is.null`)
        .eq("id", problemId)
        .maybeSingle();

      if (!problemRow) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");
      const parsed = parseProblemRow(problemRow as DbProblemRow);
      if (!parsed) return fail(500, "PROBLEM_INVALID", "문제 데이터 오류");

      const { data: prevAttempt } = await db
        .from("sb_problem_attempts")
        .select("id, wrong_count, hint_shown, answer_revealed, completed, attempt_count")
        .eq("student_id", studentSession.studentId)
        .eq("problem_id", problemId)
        .maybeSingle();

      const prev = normalizeAttemptState(prevAttempt as AttemptRow | null);
      const gradeInput = {
        problemType: parsed.problemType,
        gradingMode: parsed.gradingMode,
        answer: parsed.answer,
        submission,
        given: parsed.given,
        grid: {
          gridWidth: parsed.grid.gridWidth,
          gridDepth: parsed.grid.gridDepth,
          maxHeight: parsed.grid.maxHeight,
        },
      };
      const verdict = gradeShared(gradeInput);

      const nextAttempt = applyAttempt(
        {
          wrongCount: prev.wrongCount,
          hintShown: prev.hintShown,
          answerRevealed: prev.answerRevealed,
          completed: prev.completed,
        },
        verdict.correct,
        ["FREE_BUILD", "BUILD_FROM_VIEWS", "BUILD_FROM_HEIGHTMAP", "BUILD_FROM_LAYERS"].includes(parsed.problemType),
      );
      const state = nextAttempt.state;

      const { error: saveError } = await db.rpc("sb_record_attempt", {
        p_student: studentSession.studentId,
        p_problem: problemId,
        p_expected: prev.attemptCount,
        p_next: { ...state, stars: nextAttempt.stars, xp: nextAttempt.xpEarned },
        p_blocks: submission.kind === "blocks" ? canonicalize(submission.blocks) : null,
      });
      if (saveError) return fail(saveError.message.includes("ATTEMPT_CONFLICT") ? 409 : 500, "ATTEMPT_SAVE_FAILED", "시도를 저장하지 못했습니다. 진행 상태를 다시 불러온 뒤 확인해 주세요.");

      return ok({
        grade: {
          correct: verdict.correct,
          wrongCount: state.wrongCount,
          message: nextAttempt.message,
          hint: nextAttempt.sendHint ? (parsed.hint ?? "") : null,
          // Reuse buildRevealedAnswer() rather than hand-duplicating this
          // per-kind construction a second time -- the two implementations
          // had already drifted (this inline copy's BUILD_FROM_VIEWS branch
          // checked parsed.givenBlocks.length, which is always 0 for that
          // type, so it never actually populated a 3D ghost here even after
          // buildRevealedAnswer() was fixed to synthesize one).
          revealedAnswer: nextAttempt.sendAnswer ? buildRevealedAnswer(parsed) : null,
          needsRebuild: nextAttempt.needsRebuild,
          completed: state.completed,
          xpEarned: nextAttempt.xpEarned,
          stars: nextAttempt.stars,
          detail: verdict.detail,
          canRetry: !nextAttempt.state.completed,
        },
      });
    }

    if (action === "snapshot" || action === "snapshot:get") {
      if (action === "snapshot") {
        const problemId = text(body.problemId, 80);
        const blocks = canonicalizeProblemBlocks((body as { blocks?: unknown }).blocks);
        const lesson = toInt(body.lesson);
        const gridWidth = toInt((body as { gridWidth?: unknown }).gridWidth) ?? 4;
        const gridDepth = toInt((body as { gridDepth?: unknown }).gridDepth) ?? 4;
        const maxHeight = toInt((body as { maxHeight?: unknown }).maxHeight) ?? 4;

        if (!problemId || !lesson) return fail(400, "BAD_PARAM", "problemId, lesson 이 필요합니다.");
        if (!problemId.startsWith("seed:")) {
          const { error } = await db.from("sb_block_snapshots").upsert(
            {
              student_id: studentSession.studentId,
              problem_id: problemId,
              lesson,
              blocks,
              grid_width: gridWidth,
              grid_depth: gridDepth,
              max_height: maxHeight,
            },
            { onConflict: "student_id,problem_id" },
          );
          if (error) return fail(500, "SAVE_FAILED", "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        }
        return ok({ ok: true, savedBlocks: blocks.length, preview: toHeightMap(blocks, { gridWidth, gridDepth, maxHeight }) });
      }

      const problemId = text(body.problemId, 80);
      if (!problemId) return fail(400, "BAD_PARAM", "problemId 가 필요합니다.");
      if (!problemId.startsWith("seed:")) {
        const { data } = await db
          .from("sb_block_snapshots")
          .select("blocks, grid_width, grid_depth, max_height")
          .eq("student_id", studentSession.studentId)
          .eq("problem_id", problemId)
          .maybeSingle();
        return ok({ snapshot: data ?? null });
      }
      return ok({ snapshot: null });
    }
  }

  // 교사용 동작
  if (action.startsWith("teacher:")) {
    const teacherId = await requireTeacher(req);
    if (!teacherId) return fail(401, "TEACHER_AUTH", "교사 인증이 필요합니다.");

    if (action === "teacher:peer-problem:list" || action === "teacher:peer-problem:hide") {
      const classId = text(body.classId, 80); const installationId = text(body.installationId, 120);
      if (!classId || !(await teacherOwnsClass(db, teacherId, classId))) return fail(403, "FORBIDDEN_CLASS", "담당 학급만 확인할 수 있습니다.");
      const problemId = text(body.problemId, 80); const version = Number(body.version) || 1;
      if (action === "teacher:peer-problem:hide") {
        if (!problemId || !installationId) return fail(400, "BAD_PARAM", "문제 정보가 필요합니다.");
        const updated = await db.from("sb_student_created_problems").update({ status: "hidden", hidden_at: new Date().toISOString() }).eq("installation_id", installationId).eq("class_id", classId).eq("problem_id", problemId).eq("version", version).select("problem_id,version,status").maybeSingle();
        if (updated.error || !updated.data) return fail(404, "PEER_NOT_FOUND", "문제를 찾을 수 없습니다.");
        return ok({ problem: updated.data });
      }
      if (!installationId) return fail(400, "INSTALLATION_REQUIRED", "설치 정보를 확인해 주세요.");
      const loaded = await db.from("sb_student_created_problems").select("problem_id,version,class_id,title,public_problem_json,published_at,created_at,status").eq("class_id", classId).eq("installation_id", installationId).order("created_at", { ascending: false });
      if (loaded.error) return fail(500, "PEER_LOAD_FAILED", "친구 문제를 불러오지 못했습니다.");
      return ok({ problems: (loaded.data ?? []).map((row: Record<string, unknown>) => publicPeerRow(row)) });
    }

    if (action === "teacher:classes") {
      const { data } = await db
        .from("sb_classes")
        .select("id, name, class_code")
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: true });
      return ok({ classes: data ?? [] });
    }

    if (action === "teacher:class-upsert") {
      try {
        const classId = text(body.classId, 80);
        const name = text(body.name, 80);
        if (!name) return fail(400, "BAD_PARAM", "반 이름이 필요합니다.");

        if (classId) {
          const has = await teacherOwnsClass(db, teacherId, classId);
          if (!has) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
          await db.from("sb_classes").update({ name }).eq("id", classId);
          const { data: updated } = await db
            .from("sb_classes")
            .select("id, name, class_code")
            .eq("id", classId)
            .maybeSingle();
          return ok({ class: updated });
        }

        const requestedClassCode = text((body.classCode ?? ""), 10).toUpperCase();
        let class_code = requestedClassCode;
        let result: { error: { code?: string; message?: string } | null } = { error: null };

        // class_code 는 NOT NULL·UNIQUE 이므로 교사가 직접 입력하지 않은 경우
        // 서버에서 생성한다. 생성 코드가 우연히 충돌하면 짧게 재시도한다.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (!class_code) class_code = generateClassCode();
          result = await db.from("sb_classes").insert({
            teacher_id: teacherId,
            name,
            class_code,
          });
          if (!result.error || result.error.code !== "23505" || requestedClassCode) break;
          class_code = "";
        }

        if (result.error) {
          if (result.error.code === "23505" && requestedClassCode) {
            return fail(409, "DUPLICATE", "이미 사용 중인 반 코드입니다.");
          }
          console.error("[student-api] teacher:class-upsert insert failed", {
            code: result.error.code ?? "UNKNOWN",
            message: result.error.message ?? "unknown database error",
          });
          return fail(500, "CLASS_CREATE_FAIL", "학급을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        }

        const createdClass = await db
          .from("sb_classes")
          .select("id, name, class_code")
          .eq("teacher_id", teacherId)
          .eq("name", name)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (createdClass.error) {
          console.error("[student-api] teacher:class-upsert select failed", {
            code: createdClass.error.code ?? "UNKNOWN",
            message: createdClass.error.message ?? "unknown database error",
          });
          return fail(500, "CLASS_CREATE_SERVER", "학급을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        }

        if (createdClass.data) {
          const classData = createdClass.data as ClassRow;
          const settingsResult = await db.from("sb_lesson_settings").upsert(makeDefaultLessonSettings(classData.id), {
            onConflict: "class_id,lesson",
          });
          if (settingsResult.error) {
            console.error("[student-api] teacher:class-upsert lesson defaults failed", {
              code: settingsResult.error.code ?? "UNKNOWN",
              message: settingsResult.error.message ?? "unknown database error",
            });
            return fail(500, "CLASS_CREATE_SERVER", "학급을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
          }
        }

        return ok({ class: createdClass.data });
      } catch (error) {
        console.error("[student-api] teacher:class-upsert unexpected error", error instanceof Error ? error.message : String(error));
        return fail(500, "CLASS_CREATE_SERVER", "학급을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    }

    if (action === "teacher:students:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const { data: students } = await db
        .from("sb_students")
        .select("id,name,student_no,status,failed_attempts,locked_until,created_at")
        .eq("class_id", classId)
        .order("name", { ascending: true });

      const { data: vaultRows } = await db
        .from("sb_student_pin_vault")
        .select("student_id,pin_plain")
        .eq("class_id", classId);

      const pinMap = new Map((vaultRows ?? []).map((row) => [row.student_id, row.pin_plain]));
      const normalized = (students ?? []).map((row) => ({
        ...(row as Record<string, unknown>),
        pinPlain: pinMap.get((row as { id: string }).id) ?? "",
      }));
      return ok({ students: normalized });
    }

    if (action === "teacher:students:create") {
      const classId = text(body.classId, 80);
      const name = text(body.name, 40);
      const studentNo = Number.isFinite(toInt(body.studentNo)) ? toInt(body.studentNo) : null;
      if (!name) return fail(400, "BAD_PARAM", "이름이 필요합니다.");
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const nextNo = studentNo;
      const pin = generatePin();
      const fakeId = crypto.randomUUID();
      const id = fakeId;
      const pinHash = await hashPin(id, pin);
      const { data: existing } = await db
        .from("sb_students")
        .select("student_no")
        .eq("class_id", classId)
        .order("student_no", { ascending: false })
        .limit(1);
      const finalNo = nextNo ?? (Number((existing?.[0] as { student_no: number } | undefined)?.student_no ?? 0) + 1);

      const inserted = await db
        .from("sb_students")
        .insert({ id, class_id: classId, name, student_no: finalNo, pin_hash: pinHash, status: "active" });

      if (inserted.error) {
        if (inserted.error.code === "23505") {
          return fail(409, "STUDENT_DUP", "동일한 이름과 번호가 이미 존재합니다.");
        }
        return fail(500, "STUDENT_CREATE_FAIL", inserted.error.message);
      }

      await db.from("sb_student_pin_vault").insert({ student_id: id, class_id: classId, pin_plain: pin });
      await db.from("sb_student_rewards").insert({ student_id: id });

      return ok({
        student: {
          id,
          name,
          studentNo: finalNo,
          status: "active",
        },
        pinPlain: pin,
      });
    }

    if (action === "teacher:students:update") {
      const studentId = text(body.studentId, 80);
      const name = text(body.name, 40);
      const status = text(body.status, 12);
      if (!studentId) return fail(400, "BAD_PARAM", "studentId 가 필요합니다.");
      const { data: student } = await db
        .from("sb_students")
        .select("class_id")
        .eq("id", studentId)
        .single();
      if (!student || !(await teacherOwnsClass(db, teacherId, student.class_id))) {
        return fail(403, "FORBIDDEN_STUDENT", "해당 학생에 접근할 수 없습니다.");
      }
      const update: Record<string, unknown> = {};
      if (name) update.name = name;
      if (status === "active" || status === "disabled") update.status = status;
      if (Object.keys(update).length === 0) return fail(400, "BAD_PARAM", "수정할 항목이 없습니다.");

      await db.from("sb_students").update(update).eq("id", studentId);
      return ok({ ok: true });
    }

    if (action === "teacher:students:pin-reset") {
      const studentId = text(body.studentId, 80);
      const pin = generatePin();
      if (!studentId) return fail(400, "BAD_PARAM", "studentId 가 필요합니다.");
      const { data: student } = await db
        .from("sb_students")
        .select("class_id")
        .eq("id", studentId)
        .maybeSingle();
      if (!student || !(await teacherOwnsClass(db, teacherId, (student as { class_id: string }).class_id))) {
        return fail(403, "FORBIDDEN_STUDENT", "해당 학생에 접근할 수 없습니다.");
      }

      const pinHash = await hashPin(studentId, pin);
      await db.from("sb_students").update({ pin_hash: pinHash }).eq("id", studentId);
      await db
        .from("sb_student_pin_vault")
        .upsert(
          {
            student_id: studentId,
            class_id: (student as { class_id: string }).class_id,
            pin_plain: pin,
          },
          { onConflict: "student_id" },
        );
      return ok({ pinPlain: pin });
    }

    if (action === "teacher:students:toggle") {
      const studentId = text(body.studentId, 80);
      const disabled = Boolean(body.disabled);
      if (!studentId) return fail(400, "BAD_PARAM", "studentId 가 필요합니다.");
      const { data: student } = await db
        .from("sb_students")
        .select("class_id")
        .eq("id", studentId)
        .maybeSingle();
      if (!student || !(await teacherOwnsClass(db, teacherId, student.class_id))) {
        return fail(403, "FORBIDDEN_STUDENT", "해당 학생에 접근할 수 없습니다.");
      }
      await db.from("sb_students").update({ status: disabled ? "disabled" : "active" }).eq("id", studentId);
      return ok({ ok: true });
    }

    if (action === "teacher:students:move-class") {
      const studentId = text(body.studentId, 80);
      const targetClassId = text(body.targetClassId, 80);
      if (!studentId || !targetClassId) return fail(400, "BAD_PARAM", "studentId, targetClassId가 필요합니다.");

      const { data: student } = await db
        .from("sb_students")
        .select("id,class_id,name,student_no")
        .eq("id", studentId)
        .maybeSingle();
      if (!student) return fail(404, "STUDENT_NOT_FOUND", "학생을 찾을 수 없습니다.");
      // 이동 대상 학급과 원래 학급 모두 이 교사 소유여야 한다.
      const [ownsSource, ownsTarget] = await Promise.all([
        teacherOwnsClass(db, teacherId, student.class_id),
        teacherOwnsClass(db, teacherId, targetClassId),
      ]);
      if (!ownsSource || !ownsTarget) return fail(403, "FORBIDDEN_CLASS", "해당 학급에 접근할 수 없습니다.");
      if (student.class_id === targetClassId) return fail(400, "SAME_CLASS", "이미 같은 학급입니다.");

      // sb_students에는 (class_id,name,student_no) unique 제약이 있다 --
      // 대상 학급에 이미 같은 이름/번호 학생이 있으면 이동 전에 막는다.
      const { data: collision } = await db
        .from("sb_students")
        .select("id")
        .eq("class_id", targetClassId)
        .eq("name", student.name)
        .eq("student_no", student.student_no)
        .maybeSingle();
      if (collision) return fail(409, "STUDENT_NAME_CONFLICT", "대상 학급에 같은 이름·번호의 학생이 이미 있습니다.");

      // 학생 ID는 그대로 유지하고 class_id만 바꾼다 -- 진도/시도/보상은
      // sb_owns_student() 기반 RLS라 학생의 현재 class_id를 따라 자동으로
      // 새 학급 교사에게 보인다. PIN 금고·프로젝트는 class_id로 직접
      // 스코프되어 있어 함께 옮겨야 한다. 그 외 데이터는 삭제/재생성하지
      // 않는다.
      const { error: moveErr } = await db.from("sb_students").update({ class_id: targetClassId }).eq("id", studentId);
      if (moveErr) { console.error("[student-api] move-class failed", { code: moveErr.code }); return fail(500, "MOVE_FAILED", "학급 이동에 실패했습니다."); }
      await db.from("sb_student_pin_vault").update({ class_id: targetClassId }).eq("student_id", studentId);
      await db.from("sb_projects").update({ class_id: targetClassId }).eq("student_id", studentId);

      return ok({ ok: true, studentId, fromClassId: student.class_id, toClassId: targetClassId });
    }

    if (action === "teacher:progress:summary") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const { data: studentRows, error: studentsErr } = await db
        .from("sb_students")
        .select("id,name,student_no")
        .eq("class_id", classId)
        .order("name", { ascending: true });
      if (studentsErr) return fail(500, "PROGRESS_LOAD_FAILED", "학생 목록을 불러오지 못했습니다.");

      const studentIds = (studentRows ?? []).map((row) => String(row.id));
      if (studentIds.length === 0) return ok({ students: [] });

      // 학생마다 개별 요청하지 않는다 -- 학급 전체를 테이블당 1회 쿼리로
      // 가져온 뒤 메모리에서 집계한다 (N+1 금지).
      const [progressRes, attemptsRes] = await Promise.all([
        db.from("sb_student_progress").select("student_id,lesson,completed,updated_at").in("student_id", studentIds),
        db.from("sb_problem_attempts").select("student_id,lesson,wrong_count,completed,updated_at").in("student_id", studentIds),
      ]);
      if (progressRes.error || attemptsRes.error) return fail(500, "PROGRESS_LOAD_FAILED", "진도 정보를 불러오지 못했습니다.");

      const progressByStudent = new Map<string, ProgressSourceRow[]>();
      for (const row of progressRes.data ?? []) {
        const sid = String(row.student_id);
        if (!progressByStudent.has(sid)) progressByStudent.set(sid, []);
        progressByStudent.get(sid)!.push({ lesson: Number(row.lesson), completed: Boolean(row.completed), updated_at: String(row.updated_at) });
      }

      const attemptsByStudent = new Map<string, AttemptSourceRow[]>();
      for (const row of attemptsRes.data ?? []) {
        const sid = String(row.student_id);
        if (!attemptsByStudent.has(sid)) attemptsByStudent.set(sid, []);
        attemptsByStudent.get(sid)!.push({
          lesson: Number(row.lesson),
          wrong_count: Number(row.wrong_count ?? 0),
          completed: Boolean(row.completed),
          updated_at: String(row.updated_at),
        });
      }

      const students = (studentRows ?? []).map((student) =>
        summarizeStudentProgress(
          String(student.id),
          String(student.name ?? ""),
          (student as { student_no?: number | null }).student_no ?? null,
          progressByStudent.get(String(student.id)) ?? [],
          attemptsByStudent.get(String(student.id)) ?? [],
        ),
      );

      return ok({ students });
    }

    if (action === "teacher:progress:reset-class") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const lesson = toInt(body.lesson); // null = 전체 차시 초기화
      if (lesson !== null && lesson > 12) return fail(400, "BAD_LESSON", "lesson 값은 1~12 사이여야 합니다.");

      // 클라이언트가 studentId 배열을 보내 임의 대상을 고르게 하지 않는다:
      // 서버가 classId 소유권을 확인한 뒤 이 학급 소속 학생을 직접 조회한다.
      const { data: studentRows, error: studentsErr } = await db.from("sb_students").select("id").eq("class_id", classId);
      if (studentsErr) return fail(500, "RESET_FAILED", "학생 목록을 불러오지 못했습니다.");
      const studentIds = (studentRows ?? []).map((row) => String(row.id));
      if (studentIds.length === 0) return ok({ ok: true, targetedCount: 0, lesson });

      // 아래는 202609110007_teacher_reset.sql 의 sb_reset_progress() 와 같은
      // 삭제 규칙을 그대로 반영한다. 그 함수는 auth.uid() 기반
      // sb_owns_student 검사를 내부에 갖고 있어 service-role 컨텍스트
      // (교사 JWT 없이 호출되는 이 edge function 안)에서는 항상
      // FORBIDDEN_STUDENT로 실패하므로 재사용할 수 없다. 그래서 같은 삭제
      // 규칙을 학급 전체에 대해 테이블당 1회 배치 쿼리로 재구현한다
      // (학생별 반복 호출 아님 -- N+1 금지).
      let attemptsQuery = db.from("sb_problem_attempts").delete().in("student_id", studentIds);
      let snapshotsQuery = db.from("sb_block_snapshots").delete().in("student_id", studentIds);
      let progressQuery = db.from("sb_student_progress").delete().in("student_id", studentIds);
      if (lesson !== null) {
        attemptsQuery = attemptsQuery.eq("lesson", lesson);
        snapshotsQuery = snapshotsQuery.eq("lesson", lesson);
        progressQuery = (lesson === 10 || lesson === 11)
          ? progressQuery.in("lesson", [10, 11])
          : progressQuery.eq("lesson", lesson);
      }

      const steps: Array<{ name: string; error: { code?: string } | null }> = [];
      steps.push({ name: "attempts", error: (await attemptsQuery).error });
      steps.push({ name: "snapshots", error: (await snapshotsQuery).error });
      steps.push({ name: "progress", error: (await progressQuery).error });
      if (lesson === null || lesson === 9) {
        steps.push({ name: "challenge_solves", error: (await db.from("sb_challenge_solves").delete().in("student_id", studentIds)).error });
      }
      if (lesson === null || lesson === 10 || lesson === 11) {
        steps.push({ name: "projects", error: (await db.from("sb_projects").delete().in("student_id", studentIds)).error });
      }
      if (lesson === null || lesson === 12) {
        steps.push({ name: "self_evaluations", error: (await db.from("sb_self_evaluations").delete().in("student_id", studentIds)).error });
      }

      const failedStep = steps.find((step) => step.error);
      if (failedStep) {
        console.error("[student-api] class reset failed", { step: failedStep.name, code: failedStep.error?.code });
        return fail(500, "RESET_PARTIAL_FAILED", `초기화 중 일부 단계(${failedStep.name})가 실패했습니다. 새로고침 후 다시 시도해 주세요.`);
      }

      // 남은 attempts로 보상 재계산 -- 학생별 upsert 대신 배치 upsert 1회.
      const { data: remainingAttempts, error: remErr } = await db
        .from("sb_problem_attempts")
        .select("student_id,xp_earned,stars")
        .in("student_id", studentIds);
      if (remErr) return fail(500, "RESET_PARTIAL_FAILED", "진도는 초기화됐지만 보상 재계산에 실패했습니다. 새로고침 후 다시 확인해 주세요.");

      const rewardTotals = new Map<string, { xp: number; stars: number }>();
      for (const id of studentIds) rewardTotals.set(id, { xp: 0, stars: 0 });
      for (const row of remainingAttempts ?? []) {
        const sid = String(row.student_id);
        const current = rewardTotals.get(sid) ?? { xp: 0, stars: 0 };
        current.xp += Number(row.xp_earned ?? 0);
        current.stars += Number(row.stars ?? 0);
        rewardTotals.set(sid, current);
      }
      const rewardRows = Array.from(rewardTotals.entries()).map(([studentId, totals]) => ({
        student_id: studentId,
        total_xp: totals.xp,
        total_stars: totals.stars,
        badges: [],
        streak: 0,
      }));
      const rewardUpsert = await db.from("sb_student_rewards").upsert(rewardRows, { onConflict: "student_id" });
      if (rewardUpsert.error) {
        console.error("[student-api] class reset reward recompute failed", { code: rewardUpsert.error.code });
        return fail(500, "RESET_PARTIAL_FAILED", "진도는 초기화됐지만 보상 재계산에 실패했습니다. 새로고침 후 다시 확인해 주세요.");
      }

      return ok({ ok: true, targetedCount: studentIds.length, lesson });
    }

    if (action === "teacher:sessions:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const { data: studentRows, error: studentsErr } = await db.from("sb_students").select("id").eq("class_id", classId);
      if (studentsErr) return fail(500, "SESSIONS_LOAD_FAILED", "학생 목록을 불러오지 못했습니다.");
      const studentIds = (studentRows ?? []).map((row) => String(row.id));
      if (studentIds.length === 0) return ok({ students: [] });

      // sb_student_sessions는 RLS 정책이 없어 service-role 경로로만 읽는다
      // (교사 클라이언트가 직접 조회할 수 없는 경계를 유지). token_hash 등
      // 민감한 컬럼은 아예 select 하지 않는다.
      const [sessionsRes, attemptsRes, progressRes] = await Promise.all([
        db.from("sb_student_sessions").select("student_id,issued_at,expires_at,revoked").in("student_id", studentIds),
        db.from("sb_problem_attempts").select("student_id,updated_at").in("student_id", studentIds),
        db.from("sb_student_progress").select("student_id,updated_at").in("student_id", studentIds),
      ]);
      if (sessionsRes.error || attemptsRes.error || progressRes.error) return fail(500, "SESSIONS_LOAD_FAILED", "접속 정보를 불러오지 못했습니다.");

      const sessionsByStudent = new Map<string, SessionSourceRow[]>();
      for (const row of sessionsRes.data ?? []) {
        const sid = String(row.student_id);
        if (!sessionsByStudent.has(sid)) sessionsByStudent.set(sid, []);
        sessionsByStudent.get(sid)!.push({ issued_at: String(row.issued_at), expires_at: String(row.expires_at), revoked: Boolean(row.revoked) });
      }
      const lastActivityByStudent = new Map<string, string>();
      for (const row of [...(attemptsRes.data ?? []), ...(progressRes.data ?? [])]) {
        const sid = String(row.student_id);
        const ts = String(row.updated_at);
        const prev = lastActivityByStudent.get(sid);
        if (!prev || ts > prev) lastActivityByStudent.set(sid, ts);
      }

      const students = studentIds.map((sid) =>
        summarizeStudentLiveStatus(sid, sessionsByStudent.get(sid) ?? [], lastActivityByStudent.get(sid) ?? null),
      );
      return ok({ students });
    }

    if (action === "teacher:results:summary") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      const lesson = toInt(body.lesson);
      if (lesson !== null && lesson > 12) return fail(400, "BAD_LESSON", "lesson 값은 1~12 사이여야 합니다.");

      const { data: studentRows, error: studentsErr } = await db.from("sb_students").select("id").eq("class_id", classId);
      if (studentsErr) return fail(500, "RESULTS_LOAD_FAILED", "학생 목록을 불러오지 못했습니다.");
      const studentIds = (studentRows ?? []).map((row) => String(row.id));
      const totalStudents = studentIds.length;

      if (totalStudents === 0 || lesson === null) {
        return ok({ summary: summarizeLessonResults(lesson ?? 0, totalStudents, [], [], []) });
      }

      const [attemptsRes, progressRes] = await Promise.all([
        db.from("sb_problem_attempts").select("student_id,problem_id,wrong_count").in("student_id", studentIds).eq("lesson", lesson),
        db.from("sb_student_progress").select("student_id,completed").in("student_id", studentIds).eq("lesson", lesson),
      ]);
      if (attemptsRes.error || progressRes.error) return fail(500, "RESULTS_LOAD_FAILED", "결과 정보를 불러오지 못했습니다.");

      const attemptRows: ResultAttemptRow[] = (attemptsRes.data ?? []).map((a) => ({
        student_id: String(a.student_id),
        problem_id: String(a.problem_id),
        wrong_count: Number(a.wrong_count ?? 0),
      }));
      const progressRows: ResultProgressRow[] = (progressRes.data ?? []).map((p) => ({
        student_id: String(p.student_id),
        completed: Boolean(p.completed),
      }));

      const problemIds = [...new Set(attemptRows.map((a) => a.problem_id))];
      const problemsRes = problemIds.length
        ? await db.from("sb_problems").select("id,problem_type,code").in("id", problemIds)
        : { data: [] as Array<{ id: string; problem_type: string; code: string | null }>, error: null };
      if (problemsRes.error) return fail(500, "RESULTS_LOAD_FAILED", "문제 정보를 불러오지 못했습니다.");
      const problemRows: ResultProblemRow[] = (problemsRes.data ?? []).map((p) => ({
        id: String(p.id),
        problem_type: parseProblemType(p.problem_type),
        code: p.code ?? null,
      }));

      const summary = summarizeLessonResults(lesson, totalStudents, attemptRows, progressRows, problemRows);
      return ok({ summary });
    }

    if (action === "teacher:lessons:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      const { data, error: listErr } = await db
        .from("sb_lesson_settings")
        .select("lesson, locked, practice_count, allow_similar, allow_retry")
        .eq("class_id", classId)
        .order("lesson", { ascending: true });
      if (listErr) { console.error("[student-api] teacher:lessons:list failed", { code: listErr.code }); return fail(500, "LESSON_SETTINGS_LOAD_FAILED", "차시 설정을 불러오지 못했습니다."); }
      return ok({ lessons: (data ?? []).sort((a, b) => a.lesson - b.lesson) });
    }

    if (action === "teacher:lessons:set-lock") {
      const classId = text(body.classId, 80);
      const lesson = toInt(body.lesson);
      const locked = Boolean(body.locked);
      const practiceCount = [5,10,15,20].includes(Number(body.practiceCount)) ? Number(body.practiceCount) : undefined;
      // allowSimilar/allowRetry는 명시적으로 boolean이 온 경우에만 바꾼다 --
      // 기존 practiceCount 필드처럼 undefined면 현재 값을 건드리지 않는다.
      const allowSimilar = typeof body.allowSimilar === "boolean" ? body.allowSimilar : undefined;
      const allowRetry = typeof body.allowRetry === "boolean" ? body.allowRetry : undefined;
      if (!lesson) return fail(400, "BAD_PARAM", "lesson 값이 필요합니다.");
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      const { data: existing, error: existingErr } = await db.from("sb_lesson_settings").select("allow_similar,allow_retry").eq("class_id", classId).eq("lesson", lesson).maybeSingle();
      if (existingErr) { console.error("[student-api] teacher:lessons:set-lock existing-read failed", { code: existingErr.code }); return fail(500, "LESSON_SETTING_SAVE_FAILED", "차시 설정을 저장하지 못했습니다."); }
      const finalAllowSimilar = allowSimilar ?? existing?.allow_similar ?? true;
      const finalAllowRetry = allowRetry ?? existing?.allow_retry ?? true;
      const { error: upsertErr } = await db.from("sb_lesson_settings").upsert({
        class_id: classId, lesson, locked,
        ...(practiceCount ? { practice_count: practiceCount } : {}),
        allow_similar: finalAllowSimilar,
        allow_retry: finalAllowRetry,
      }, { onConflict: "class_id,lesson" });
      if (upsertErr) { console.error("[student-api] teacher:lessons:set-lock upsert failed", { code: upsertErr.code }); return fail(500, "LESSON_SETTING_SAVE_FAILED", "차시 설정을 저장하지 못했습니다."); }
      return ok({ ok: true, lesson, locked, practiceCount, allowSimilar: finalAllowSimilar, allowRetry: finalAllowRetry });
    }

    if (action === "teacher:problems:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const { data: classProblems } = await db
        .from("sb_problems")
        .select(
          "id,image_path, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, grading_mode, answer, hint, explanation, difficulty, xp, active, code",
        )
        .eq("class_id", classId)
        .order("lesson", { ascending: true })
        .order("order_index", { ascending: true });

      const custom = (classProblems ?? []).map((row) => parseProblemRow(row as DbProblemRow)).filter(Boolean);
      const seed = SEED_PROBLEMS.map((seed) => parseSeedProblem(seed));

      // sanitizeToStudentProblem() is shared with the student-facing problem
      // envelope, which never needs `active` -- teacher:problems:list is the
      // only caller that does (to render the active/inactive toggle), so add
      // it back in here rather than widening the student-facing shape.
      return ok({
        customProblems: custom
          .map((row) => (row ? { ...sanitizeToStudentProblem(row), active: row.active } : null))
          .filter(Boolean),
        builtinCount: seed.length,
      });
    }

    if (action === "teacher:problems:set-active") {
      const problemId = text(body.problemId, 80);
      const active = Boolean(body.active);
      if (!problemId || problemId.startsWith("seed:")) {
        return fail(400, "BAD_PARAM", "커스텀 문제 id 만 변경할 수 있습니다.");
      }
      const { data: target } = await db.from("sb_problems").select("class_id").eq("id", problemId).maybeSingle();
      if (!target?.class_id || !(await teacherOwnsClass(db, teacherId, target.class_id))) {
        return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      }
      const { error } = await db.from("sb_problems").update({ active }).eq("id", problemId);
      if (error) return fail(500, "SAVE_FAILED", "문제 상태를 저장하지 못했습니다.");
      return ok({ ok: true, active });
    }

    return fail(400, "BAD_ACTION", "지원되지 않는 teacher action 입니다.");
  }

  return fail(400, "BAD_ACTION", "지원되지 않는 action 입니다.");
});
