import { canonicalize, validStructure, toHeightMap } from "../../../shared/blocks.ts";
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
import { grade as gradeShared } from "../../../shared/grading.ts";
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
  generateShareCode,
  hashPin,
  hashToken,
  verifySessionToken,
} from "../_shared/security.ts";

type Action =
  | "home"
  | "lessonProblems"
  | "problem"
  | "attempt"
  | "snapshot"
  | "snapshot:get"
  | "share:create"
  | "teacher:classes"
  | "teacher:class-upsert"
  | "teacher:students:list"
  | "teacher:students:create"
  | "teacher:students:update"
  | "teacher:students:pin-reset"
  | "teacher:students:toggle"
  | "teacher:lessons:list"
  | "teacher:lessons:set-lock"
  | "teacher:problems:list"
  | "teacher:problems:set-active";

interface BaseBody {
  action?: string;
}

interface DbProblemRow {
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

  return {
    id: row.id,
    lesson: Number(row.lesson),
    orderIndex: Number(row.order_index ?? 0),
    problemType: parseProblemType(row.problem_type),
    title: String(row.title ?? ""),
    prompt,
    grid,
    givenBlocks: canonicalizeProblemBlocks(row.given_blocks),
    startBlocks: canonicalizeProblemBlocks(row.start_blocks),
    given,
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
    return {
      projections: row.answer.projections ?? {},
      explanation: row.explanation ?? null,
    };
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
    lesson: raw.lesson,
    orderIndex: raw.orderIndex,
    problemType: raw.problemType,
    title: raw.title,
    prompt: raw.prompt,
    grid: raw.grid,
    givenBlocks: canonicalize(raw.givenBlocks),
    startBlocks: canonicalize(raw.startBlocks),
    given: raw.given,
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

function makeDefaultLessonSettings(classId: string): Array<{ class_id: string; lesson: number; locked: boolean }> {
  return Array.from({ length: 12 }, (_, index) => ({
    class_id: classId,
    lesson: index + 1,
    locked: index === 0 ? false : true,
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
  if (action === "home" || action === "lessonProblems" || action === "problem" || action === "attempt" || action === "snapshot" || action === "snapshot:get") {
    const studentSession = await requireStudent(req, db);
    if (studentSession instanceof Response) return studentSession;

    if (action !== "home") {
      let targetLesson = toInt(body.lesson);
      if (action !== "lessonProblems") {
        const targetId = text(body.problemId, 80);
        const { data: target } = await db.from("sb_problems").select("lesson,active,class_id,grid_width,grid_depth,max_height")
          .eq("id", targetId).or(`class_id.eq.${studentSession.classId},class_id.is.null`).maybeSingle();
        if (!target || !target.active) return fail(404, "PROBLEM_NOT_FOUND", "문제를 찾을 수 없어요.");
        targetLesson = target.lesson;
        if (action === "snapshot") {
          if (!validStructure(body.blocks as { x: number; y: number; z: number }[], { gridWidth: target.grid_width, gridDepth: target.grid_depth, maxHeight: target.max_height })) {
            return fail(400, "INVALID_BLOCKS", "올바른 블록 좌표가 아닙니다.");
          }
          body.lesson = target.lesson;
          body.gridWidth = target.grid_width; body.gridDepth = target.grid_depth; body.maxHeight = target.max_height;
        }
      }
      if (!Number.isInteger(targetLesson) || !targetLesson || targetLesson < 1 || targetLesson > 12) return fail(400, "BAD_LESSON", "차시를 확인해 주세요.");
      const { data: setting, error } = await db.from("sb_lesson_settings").select("locked").eq("class_id", studentSession.classId).eq("lesson", targetLesson).maybeSingle();
      if (error || (setting?.locked ?? targetLesson !== 1)) return fail(403, "LESSON_LOCKED", "선생님이 아직 열지 않은 차시예요.");
    }

    if (action === "home") {
      const [classRowsRes, lessonSettingRes, progressRes, rewardRes, problemRowsRes] = await Promise.all([
        db
          .from("sb_classes")
          .select("id, name")
          .eq("id", studentSession.classId)
          .maybeSingle(),
        db.from("sb_lesson_settings").select("lesson, locked").eq("class_id", studentSession.classId),
        db
          .from("sb_student_progress")
          .select("lesson, completed, stars")
          .eq("student_id", studentSession.studentId),
        db.from("sb_student_rewards").select("total_xp,total_stars,badges,streak").eq("student_id", studentSession.studentId).maybeSingle(),
        db
          .from("sb_problems")
          .select(
            "lesson,problem_type,title,prompt,grid_width,grid_depth,max_height,given_blocks,start_blocks,given,choices,answer,grading_mode,difficulty,xp,hint,explanation,order_index,active,id,class_id",
          )
          .or(`class_id.eq.${studentSession.classId},class_id.is.null`),
      ]);

      if (classRowsRes.error) return fail(500, "CLASS_ERROR", "반 정보를 읽지 못했습니다.");
      const baseClass = classRowsRes.data as ClassRow | null;
      if (!baseClass) return fail(404, "CLASS_NOT_FOUND", "반 정보를 못 찾았어요.");

      const lessonSettings = lessonSettingRes.error
        ? []
        : (lessonSettingRes.data as Array<{ lesson: number; locked: boolean }>) ?? [];

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
      const reward = (rewardRes.data as { total_xp: number; total_stars: number; badges: unknown[]; streak: number } | null) ?? {
        total_xp: 0,
        total_stars: 0,
        badges: [],
        streak: 0,
      };

      const countByLesson = countProblemsFromRows(
        ((problemRowsRes.data as unknown[]) as DbProblemRow[])?.filter((row) => (row as DbProblemRow).active) ?? [],
      );

      const lessons = Array.from({ length: 12 }, (_, index) => {
        const lesson = index + 1;
        const setting =
          finalLessonSettings.find((item) => Number(item.lesson) === lesson) ??
          { lesson, locked: lesson === 1 ? false : true };
        const progress = progressRows.find((row) => row.lesson === lesson);

        const totalProblems = countByLesson[lesson] ?? 0;
        const completedProblems = progress?.completed ? totalProblems : 0;
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
            totalXp: Number(reward.total_xp ?? 0),
            totalStars: Number(reward.total_stars ?? 0),
            badges: reward.badges ?? [],
            streak: Number(reward.streak ?? 0),
          },
          lessons,
        },
      });
    }

    if (action === "lessonProblems") {
      const lesson = toInt(body.lesson);
      if (!lesson) return fail(400, "BAD_LESSON", "lesson 는 1~12 사이의 값이어야 합니다.");

      const { data: problemRows } = await db
        .from("sb_problems")
        .select(
          "id, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, answer, grading_mode, hint, explanation, difficulty, xp, active, code",
        )
        .or(`class_id.eq.${studentSession.classId},class_id.is.null`)
        .eq("lesson", lesson)
        .eq("active", true)
        .order("order_index", { ascending: true });

      const parsed = (
        (problemRows as DbProblemRow[] | null)?.map((row) => parseProblemRow(row)).filter(Boolean) ?? []
      );

      const merged = [...parsed];

      const problems = merged
        .filter((p) => p?.active)
        .map((problem) => sanitizeToStudentProblem(problem))
        .filter(Boolean);

      return ok({ problems, seedFallback: parsed.length === 0 && problems.length > 0 });
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
            "id, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, answer, grading_mode, hint, explanation, difficulty, xp, active, code",
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
          "id, lesson, answer, grading_mode, problem_type, prompt, title, given_blocks, start_blocks, given, choices, hint, explanation, difficulty, xp, active, grid_width, grid_depth, max_height, order_index, code",
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
          revealedAnswer: nextAttempt.sendAnswer
            ? {
                blocks:
                  parsed.answer.kind === "blocks"
                    ? (state.answerRevealed ? canonicalize(parsed.answer.blocks) : undefined)
                    : undefined,
                count: parsed.answer.kind === "count" ? (state.answerRevealed ? parsed.answer.value : undefined) : undefined,
                direction:
                  parsed.answer.kind === "direction"
                    ? (state.answerRevealed ? (parsed.answer.value as string | undefined) : undefined)
                    : undefined,
                choiceIndex:
                  parsed.answer.kind === "choice" && state.answerRevealed ? parsed.answer.index : undefined,
                projections:
                  parsed.answer.kind === "projections" && state.answerRevealed
                    ? safeJson(parsed.answer.projections, {})
                    : undefined,
                heightMap:
                  parsed.answer.kind === "heightMap" && state.answerRevealed
                    ? safeJson(parsed.answer.heightMap, [])
                    : undefined,
                layers:
                  parsed.answer.kind === "layers" && state.answerRevealed
                    ? safeJson(parsed.answer.layers, [])
                    : undefined,
                explanation: parsed.explanation ?? null,
              }
            : null,
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

    if (action === "teacher:classes") {
      const { data } = await db
        .from("sb_classes")
        .select("id, name, class_code")
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: true });
      return ok({ classes: data ?? [] });
    }

    if (action === "teacher:class-upsert") {
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

      const class_code = "" + text((body.classCode ?? ""), 10);
      const result = await db.from("sb_classes").insert({
        teacher_id: teacherId,
        name,
        class_code: class_code || undefined,
      });

      if (result.error) {
        if (result.error.code === "23505") {
          return fail(409, "DUPLICATE", "이미 사용 중인 반 코드입니다.");
        }
        return fail(500, "CLASS_CREATE_FAIL", result.error.message);
      }

      const createdClass = await db
        .from("sb_classes")
        .select("id, name, class_code")
        .eq("teacher_id", teacherId)
        .eq("name", name)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (createdClass.data) {
        const classData = createdClass.data as ClassRow;
        await db.from("sb_lesson_settings").upsert(makeDefaultLessonSettings(classData.id), {
          onConflict: "class_id,lesson",
        });
      }

      return ok({ class: createdClass.data });
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

    if (action === "teacher:lessons:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      const { data } = await db
        .from("sb_lesson_settings")
        .select("lesson, locked")
        .eq("class_id", classId)
        .order("lesson", { ascending: true });
      return ok({ lessons: (data ?? []).sort((a, b) => a.lesson - b.lesson) });
    }

    if (action === "teacher:lessons:set-lock") {
      const classId = text(body.classId, 80);
      const lesson = toInt(body.lesson);
      const locked = Boolean(body.locked);
      if (!lesson) return fail(400, "BAD_PARAM", "lesson 값이 필요합니다.");
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");
      await db.from("sb_lesson_settings").upsert({ class_id: classId, lesson, locked }, { onConflict: "class_id,lesson" });
      return ok({ ok: true, lesson, locked });
    }

    if (action === "teacher:problems:list") {
      const classId = text(body.classId, 80);
      const owns = await teacherOwnsClass(db, teacherId, classId);
      if (!owns) return fail(403, "FORBIDDEN_CLASS", "해당 반에 접근할 수 없습니다.");

      const { data: classProblems } = await db
        .from("sb_problems")
        .select(
          "id, lesson, order_index, problem_type, title, prompt, grid_width, grid_depth, max_height, given_blocks, start_blocks, given, choices, grading_mode, answer, hint, explanation, difficulty, xp, active, code",
        )
        .eq("class_id", classId)
        .order("lesson", { ascending: true })
        .order("order_index", { ascending: true });

      const custom = (classProblems ?? []).map((row) => parseProblemRow(row as DbProblemRow)).filter(Boolean);
      const seed = SEED_PROBLEMS.map((seed) => parseSeedProblem(seed));

      return ok({
        customProblems: custom.map((row) => sanitizeToStudentProblem(row)).filter(Boolean),
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
