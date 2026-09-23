import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { deriveProblemPresentation } from "../shared/problemPresentation.ts";
import { EMPTY_BUILDING, ARCHITECTURE_GRID, type Building } from "../shared/activities.ts";
import type { BlockCoord, Grid2D, StudentProblem, StudentSubmission } from "../shared/types.ts";
import { generateValidatedPracticeSet, practiceSetStatus, generatedProblemId } from "../shared/practiceSet.ts";
import { grade } from "../shared/grading.ts";
import { applyAttempt, INITIAL_ATTEMPT, type AttemptState } from "../shared/attempts.ts";

type JsonRecord = Record<string, unknown>;

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
type CaseResult = {
  id: string;
  title: string;
  category: "UI_WITH_TEST_DATA" | "LOCAL_LOGIC" | "LIVE_SUPABASE";
  status: Status;
  cause?: "APP" | "FIXTURE" | "TEST" | "ENVIRONMENT" | "UNKNOWN";
  problemId?: string;
  templateId?: string;
  seed?: number;
  generatorVersion?: number;
  problemVersion?: string;
  failedStep?: string;
  expected?: string;
  actual?: string;
  screenshot?: string;
  trace?: string;
  errors?: string[];
};

const appDir = process.cwd();
const repoDir = resolve(appDir, "../..");
const artifactDir = resolve(appDir, "qa/local-browser-qa");
const screenshotDir = join(artifactDir, "screenshots");
const reportJsonPath = join(artifactDir, "report.json");
const reportMarkdownPath = join(artifactDir, "report.md");
const previewLogPath = join(artifactDir, "preview.log");
const qaToken = Buffer.from(JSON.stringify({sid:'qa-student',cid:'qa-class'})).toString('base64url')+'.qa-not-a-real-signature';
const headed = process.argv.includes("--headed") || process.env.QA_HEADED === "1";
const representativeCount = 16;
let executionIdentity: Record<string,string> = {};
const lesson5Set = await Promise.all(generateValidatedPracticeSet(5,35,123).map(async p=>({...p,id:await generatedProblemId(p.code)})));

mkdirSync(screenshotDir, { recursive: true });

function git(args: string[]): string {
  try { return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim(); }
  catch { return "git 정보 확인 실패"; }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function failureStep(message: string): string {
  if (message.includes("찾지 못했습니다") || message.includes("보이지 않습니다")) return "render-input";
  if (message.includes("유효한 칸") || message.includes("드래그")) return "interact";
  if (message.includes("payload") || message.includes("제출")) return "submit";
  if (message.includes("정답") || message.includes("채점")) return "assert-grade";
  if (message.includes("복원") || message.includes("저장")) return "restore";
  if (message.includes("이동") || message.includes("단계")) return "navigate";
  return "browser-flow";
}

function failureCause(message: string): CaseResult["cause"] {
  if (/listen EPERM|Chromium 실행 파일|하드웨어 가속|WebGL|browserType|Target page, context or browser has been closed/i.test(message)) return "ENVIRONMENT";
  if (/QA mock|fixture|모의 API/i.test(message)) return "FIXTURE";
  if (/wait|timeout|찾지 못했습니다|보이지 않습니다|bounding box|선택자/i.test(message)) return "TEST";
  return "UNKNOWN";
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function textVisible(page: Page, text: string): Promise<boolean> {
  return page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
}

async function waitForStudentPage(page: Page): Promise<void> {
  // 각 case가 새 context를 쓰므로 lazy route가 로드되기 전에 검사하면
  // fallback 문구만 캡처하는 일이 있다. 실제 학생 route의 h1을 기다린다.
  await page.locator("main h1, .screen h1").first().waitFor({ state: "visible", timeout: 15000 });
}

function studentProblem(input: JsonRecord): StudentProblem {
  const { answer: _answer, explanation: _explanation, gradingMode: _gradingMode, ...publicProblem } = input;
  return {
    ...publicProblem,
    id: String(input.id ?? input.code),
    hint: null,
    presentation: input.presentation ?? deriveProblemPresentation(input),
  } as StudentProblem;
}

function grid(rows: number, cols: number, filled: Array<[number, number]> = []): Grid2D {
  const result = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (const [row, col] of filled) result[row][col] = true;
  return result;
}

const tripleProjection = grid(2, 2, [[0, 0]]);
const front3x3 = grid(3, 3, [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]);

const projectionFixture = studentProblem({
  id: "qa-live-l3-grid", code: "qa-live-l3-grid", lesson: 3, orderIndex: 2, stage: "check", problemType: "PROJECTION_DRAW",
  title: "세 방향 격자 표현", prompt: "위·앞·옆에서 본 모양을 모두 그려 보세요.",
  grid: { gridWidth: 2, gridDepth: 2, maxHeight: 2 }, givenBlocks: [{ x: 0, y: 0, z: 0 }], startBlocks: [],
  given: { projections: { top: tripleProjection, front: tripleProjection, side: tripleProjection }, allowRotate: true }, choices: [],
  answer: { kind: "projections", projections: { top: tripleProjection, front: tripleProjection, side: tripleProjection } }, gradingMode: "exact", hint: "", explanation: "", difficulty: 1, xp: 10,
});

const lesson12Fixture = studentProblem({ ...projectionFixture, id: "qa-live-l12-grid", code: "qa-live-l12-grid", lesson: 12, title: "단원 종합 격자", prompt: "위·앞·옆에서 본 모양을 모두 그려 보세요." });

const choiceFixture = studentProblem({
  id: "qa-live-l5-choice", code: "qa-live-l5-choice", lesson: 5, orderIndex: 1, stage: "concept", problemType: "CHOICE",
  title: "정보가 충분할까요", prompt: "지금 앞에서 본 모양만으로 쌓기나무의 전체 개수를 정확히 알 수 있을까요?",
  grid: { gridWidth: 3, gridDepth: 3, maxHeight: 3 }, givenBlocks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], startBlocks: [],
  given: { projections: { front: grid(3, 3, [[0, 0], [1, 0]]) }, allowRotate: false }, choices: ["알 수 있어요", "알 수 없어요"],
  answer: { kind: "choice", index: 1 }, gradingMode: "exact", hint: "", explanation: "", difficulty: 1, xp: 10,
});

const countFixture = studentProblem({
  id: "qa-live-l5-count", code: "qa-live-l5-count", lesson: 5, orderIndex: 2, stage: "check", problemType: "COUNT",
  title: "숨은 블록이 없다고 할 때", prompt: "보이지 않는 쌓기나무는 없다고 가정할 때, 쌓기나무는 몇 개인가요?",
  grid: { gridWidth: 3, gridDepth: 3, maxHeight: 3 }, givenBlocks: Array.from({ length: 20 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) % 3, z: Math.floor(i / 9) })), startBlocks: [],
  given: { projections: { front: front3x3 }, allowRotate: true, note: "숨은 블록 없음" }, choices: [],
  answer: { kind: "count", value: 9 }, gradingMode: "exact", hint: "", explanation: "앞면의 아홉 칸을 세어 보세요.", difficulty: 1, xp: 10,
});

const builderFixture = studentProblem({
  id: "qa-live-l1-builder", code: "qa-live-l1-builder", lesson: 1, orderIndex: 1, stage: "concept", problemType: "FREE_BUILD",
  title: "쌓기 연습", prompt: "쌓기나무를 1개 이상 자유롭게 쌓아 보세요.", grid: { gridWidth: 4, gridDepth: 4, maxHeight: 3 }, givenBlocks: [], startBlocks: [],
  given: { allowRotate: true, allowLayerView: true, minBlocks: 1 }, choices: [], answer: { kind: "blocks", blocks: [] }, gradingMode: "constraint", hint: "", explanation: "", difficulty: 1, xp: 10,
});

const stageFixtures = [
  studentProblem({ ...choiceFixture, id: "qa-stage-concept", lesson: 2, stage: "concept", title: "개념 단계 문항", problemType: "CHOICE", choices: ["첫 번째", "두 번째"], answer: { kind: "choice", index: 0 } }),
  studentProblem({ ...choiceFixture, id: "qa-stage-check", lesson: 2, stage: "check", title: "확인 단계 문항", problemType: "CHOICE", choices: ["첫 번째", "두 번째"], answer: { kind: "choice", index: 0 } }),
  studentProblem({ ...choiceFixture, id: "qa-stage-more", lesson: 2, stage: "more", title: "추가 단계 문항", problemType: "CHOICE", choices: ["첫 번째", "두 번째"], answer: { kind: "choice", index: 0 } }),
];
const completionFixtures = stageFixtures.map((problem, index) => ({ ...problem, id: `qa-l4-stage-${index}`, lesson: 4 }));

const initialBuilding: Building = { ...EMPTY_BUILDING, building_name: "QA 건축물", reason: "수업 확인", description: "합성 데이터 건축물", layer_notes: ["1층 공간\n입구", "2층 공간\n전시", "3층 공간\n전망대"], blocks: [{ x: 0, y: 0, z: 0 }], block_appearance: { "0,0,0": "pastel" } };

type MockState = {
  positions: Record<number,string>;
  problems: StudentProblem[];
  snapshots: Record<string, BlockCoord[]>;
  attempts: Array<{ problemId: string; submission: StudentSubmission }>;
  project: Building | null;
  savedProjectPayload: JsonRecord | null;
  calls: string[];
  outcomes: Record<string, AttemptState>;
  delayedAttempt?: string;
  replacement?: {seed:number;displayedSeed:number;starts:number;records:StudentProblem[]};
  lists: string[][];
};

function homePayload() {
  return { student: { classId: "qa-class", className: "QA 학급", rewards: { totalXp: 50, totalStars: 2, badges: [], streak: 1, equippedMaterial: "pastel", introTheme: "blueprint", catalog: [] }, lessons: Array.from({ length: 12 }, (_, i) => ({ lesson: i + 1, locked: false, totalProblems: 3, completedProblems: 0, stars: 0, completed: false })) } };
}

function makeMock(problems: StudentProblem[], project: Building | null = null): MockState {
  return { positions: {}, problems, snapshots: {}, attempts: [], project, savedProjectPayload: null, calls: [], outcomes: {}, lists: [] };
}

async function installMock(page: Page, state: MockState, baseUrl: string, requiredComplete = false) {
  await page.context().route('**/*', async route => {
    const url=new URL(route.request().url());
    if(url.origin!==new URL(baseUrl).origin && !['data:','blob:'].includes(url.protocol)) return route.abort();
    return route.fallback();
  });
  await page.addInitScript(({ url, token }) => {
    localStorage.setItem("stacking-installation-config", JSON.stringify({ installationId: "qa-local", supabaseUrl: url, supabasePublishableKey: "qa-publishable-key" }));
    if(!sessionStorage.getItem("qa-started")) { localStorage.setItem("sb.student.token", token); sessionStorage.setItem("qa-started","1"); }
  }, { url: baseUrl, token:qaToken });
  await page.route("**/functions/v1/student-auth", async route => {
    const body=route.request().postDataJSON();
    if(body.action==='class') return route.fulfill({json:{classId:'qa-class',className:'QA 학급'}});
    if(body.action==='login' && body.name==='QA 학생' && body.pin==='0000') return route.fulfill({json:{token:qaToken,expiresAt:'2099-01-01',student:{id:'qa-student',classId:'qa-class',name:'QA 학생'}}});
    return route.fulfill({status:401,json:{code:'PIN_INVALID',message:'합성 계정만 허용'}});
  });
  await page.route("**/functions/v1/student-api", async route => {
    const body = (route.request().postDataJSON() ?? {}) as JsonRecord;
    const action = String(body.action ?? "");
    state.calls.push(action);
    const current = state.problems.find(problem => problem.id === String(body.problemId)) ?? state.problems[0];
    let response: JsonRecord;
    if (action === "lessonProblems") {
      const rows=state.problems.filter(problem=>problem.lesson===Number(body.lesson));
      state.lists.push(rows.map(p=>p.id));
      response={problems:rows,requiredComplete,seedFallback:false,currentProblemId:state.positions[Number(body.lesson)]??null,
        practiceSet:practiceSetStatus(rows.map(p=>({code:(p as StudentProblem & {code?:string}).code??p.id,order_index:p.orderIndex})),Number(body.lesson),state.replacement?.seed??rows.find(p=>p.seed!==undefined)?.seed??0,20,state.replacement?.displayedSeed??rows.find(p=>p.seed!==undefined)?.seed??0)};
    }
    else if(action==='practice:new-set' && state.replacement) {
      const before=state.replacement.seed;
      if(body.expectedSeed===before) {
        const nextSeed=(before+7919)%1000000;
        const next=await Promise.all(generateValidatedPracticeSet(5,20,nextSeed).map(async p=>studentProblem({...p,id:await generatedProblemId(p.code)})));
        if(state.replacement.seed===before) { state.problems=next;state.replacement.seed=nextSeed;state.replacement.displayedSeed=nextSeed;state.replacement.starts++; }
      }
      response={seed:state.replacement.seed};
    }
    else if (action === "problem") response = { problem: current, attempt: state.outcomes[String(body.problemId)] ?? INITIAL_ATTEMPT, hint: null, revealedAnswer: null };
    else if (action === "snapshot:get") response = { snapshot: { blocks: state.snapshots[String(body.problemId)] ?? [] } };
    else if (action === "snapshot") { state.snapshots[String(body.problemId)] = Array.isArray(body.blocks) ? body.blocks as BlockCoord[] : []; response = { ok: true }; }
    else if (action === "position") { state.positions[Number(body.lesson)]=String(body.problemId); response = { ok: true }; }
    else if (action === "home") response = homePayload();
    else if (action === "rewards") response = { xp: 50, equippedMaterial: "pastel", introTheme: "blueprint", catalog: [] };
    else if (action === "activity:project:get") response = { building: state.project };
    else if (action === "activity:project:save") { state.savedProjectPayload = body; state.project = {...body.building,version:(body.building?.version??0)+1}; response = { version: state.project?.version }; }
    else if (action === "attempt") {
      const submission = body.submission as StudentSubmission;
      state.attempts.push({ problemId: String(body.problemId), submission });
      let correct = false;
      if (current?.problemType === "COUNT") correct = submission.kind === "count" && submission.value === 9;
      else if (current?.problemType === "CHOICE") correct = submission.kind === "choice" && submission.index === 1;
      else if (current?.problemType === "PROJECTION_DRAW") correct = submission.kind === "projections" && JSON.stringify(submission.projections) === JSON.stringify({ top: tripleProjection, front: tripleProjection, side: tripleProjection });
      else if (current?.problemType === "FREE_BUILD") correct = submission.kind === "blocks" && (submission.blocks?.length ?? 0) > 0;
      const generated = lesson5Set.find(p=>p.id===current?.id);
      if (generated) correct=grade({...generated,submission}).correct;
      const outcome=applyAttempt(state.outcomes[current.id]??INITIAL_ATTEMPT,correct,current.problemType==='FREE_BUILD');
      state.outcomes[current.id]=outcome.state;
      if(state.delayedAttempt===current.id) await new Promise(resolve=>setTimeout(resolve,1200));
      response = { grade: { correct, wrongCount:outcome.state.wrongCount, message:outcome.message,
        hint:outcome.sendHint?'앞면의 칸을 세어 보세요.':null,
        revealedAnswer:outcome.sendAnswer?{count:9,explanation:'앞면의 아홉 칸이 정답입니다.'}:null,
        needsRebuild:outcome.needsRebuild,completed:outcome.state.completed,xpEarned:outcome.xpEarned,stars:outcome.stars,detail:null } };
    } else if (action.startsWith("activity:")) response = { ok: true, code: "QA1234", state: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, outcome: { correct: true, message: "정답이에요!" }, answer: null };
    else response = { error: { code: "QA_UNEXPECTED_ACTION", message: "QA mock에 없는 요청입니다." } };
    await route.fulfill({ status: response.error ? 400 : 200, json: response });
  });
}

async function dragPaletteToBoard(page: Page, countLabel='블록 수: 1'): Promise<void> {
  await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).scrollIntoViewIfNeeded();
  const palette = await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).boundingBox();
  const canvas = await page.getByLabel("쌓기나무 3D 작업판").boundingBox();
  assertCondition(palette && canvas, "보관함 또는 3D 작업판의 화면 영역을 찾지 못했습니다.");
  const targets = [[.5, .7], [.5, .8], [.4, .72], [.6, .72], [.5, .6], [.35, .8], [.65, .8]];
  for (const [rx, ry] of targets) {
    await page.mouse.move(palette.x + palette.width / 2, palette.y + palette.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * rx, canvas.y + canvas.height * ry, { steps: 20 });
    await page.mouse.up();
    try { await expect(page.getByText(countLabel,{exact:true})).toBeVisible({timeout:800}); return; } catch { /* 다음 유효 칸 후보 */ }
  }
  throw new Error("실제 작업판의 유효한 칸에 보관함 블록을 놓지 못했습니다.");
}

async function touchDragPaletteToBoard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).scrollIntoViewIfNeeded();
  const palette = await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).boundingBox();
  const canvas = await page.getByLabel("쌓기나무 3D 작업판").boundingBox();
  assertCondition(palette && canvas, "터치 QA에서 보관함 또는 3D 작업판의 화면 영역을 찾지 못했습니다.");
  const session = await page.context().newCDPSession(page);
  const start = { x: palette.x + palette.width / 2, y: palette.y + palette.height / 2 };
  const targets = [[.5, .7], [.5, .8], [.4, .72], [.6, .72], [.5, .6], [.35, .8], [.65, .8]];
  for (const [rx, ry] of targets) {
    const end = { x: canvas.x + canvas.width * rx, y: canvas.y + canvas.height * ry };
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [middle] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    try { await expect(page.getByText("블록 수: 1",{exact:true})).toBeVisible({timeout:800}); return; } catch { /* 다음 유효 칸 후보 */ }
  }
  throw new Error("터치로 실제 작업판의 유효한 칸에 보관함 블록을 놓지 못했습니다.");
}

async function runCase(browser: Browser, baseUrl: string, spec: { id: string; title: string; problemId?: string; problems: StudentProblem[]; run: (page: Page, state: MockState) => Promise<void>; prepare?: (state:MockState)=>void; project?: Building | null; requiredComplete?: boolean; touch?: boolean }): Promise<CaseResult> {
  const state = makeMock(spec.problems, spec.project);
  spec.prepare?.(state);
  const context = await browser.newContext({ viewport: spec.touch ? { width: 1024, height: 768 } : { width: 1366, height: 768 }, hasTouch: Boolean(spec.touch) });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  const metadata = spec.problems.find(problem => problem.id === spec.problemId) ?? spec.problems[0];
  const result: CaseResult = { id: spec.id, title: spec.title, category: "UI_WITH_TEST_DATA", status: "FAIL", problemId: metadata?.id, templateId: metadata?.templateId, seed: metadata?.seed, generatorVersion: metadata?.generatorVersion, problemVersion: metadata?.generatorVersion ? `generator-v${metadata.generatorVersion}` : "qa-fixture-v1" };
  const caseTracePath = join(artifactDir, `${spec.id}.trace.zip`);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await installMock(page, state, baseUrl, spec.requiredComplete);
    await spec.run(page, state);
    result.status = "PASS";
    const path = join(screenshotDir, `${spec.id}-pass.png`);
    await page.screenshot({ path, fullPage: true });
    result.screenshot = path;
  } catch (error) {
    result.status = "FAIL";
    const failureMessage = error instanceof Error ? error.message : String(error);
    result.failedStep = failureStep(failureMessage);
    result.cause = failureCause(failureMessage);
    result.expected = "학생 route의 실제 입력·제출·결과 흐름이 끝까지 동작";
    result.actual = (error instanceof Error ? error.message : String(error))+`\n최근 합성 API: ${state.calls.slice(-10).join(", ")}`;
    const path = join(screenshotDir, `${spec.id}-fail.png`);
    await page.screenshot({ path, fullPage: true }).catch(() => undefined);
    result.screenshot = path;
    result.trace = caseTracePath;
    result.errors = browserErrors.length ? browserErrors.slice(-10) : ["브라우저 콘솔 오류 없음: assertion 또는 대기 단계에서 실패"];
  }
  await context.tracing.stop({ path: caseTracePath }).catch(() => undefined);
  await context.close();
  console.log(`[QA] ${spec.id}: ${result.status}${result.actual ? ' — '+result.actual.slice(0,150):''}`);
  return result;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => server.listen(0, "127.0.0.1", () => resolvePromise()).on("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
  assertCondition(port > 0, "preview 포트를 확보하지 못했습니다.");
  return port;
}

async function waitForPreview(url: string, timeoutMs = 30000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return true; } catch { /* 아직 시작 전 */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  return false;
}

function writeReport(results: CaseResult[], extra: Record<string, unknown> = {}) {
  const inventoryPath = resolve(appDir, "PROBLEM_INVENTORY.json");
  let inventory: { counts?: { fixed?: number; templates?: number; activities?: number; assignedPractice?: number } } | null = null;
  try { inventory = JSON.parse(readFileSync(inventoryPath, "utf8")); } catch { /* 보고서에 없음으로 기록 */ }
  const counts = results.reduce<Record<string, number>>((all, item) => { all[item.status] = (all[item.status] ?? 0) + 1; return all; }, {PASS:0,FAIL:0,BLOCKED:0,NOT_RUN:0});
  const report = {
    generatedAt: new Date().toISOString(),
    execution: { ...executionIdentity, mode: headed ? "headed" : "headless", category: "UI_WITH_TEST_DATA", baseUrl: extra.baseUrl ?? null },
    inventory: inventory ? { fixed: inventory.counts.fixed, templates: inventory.counts.templates, activities: inventory.counts.activities, assignedPractice: inventory.counts.assignedPractice, note: "inventory 항목은 중복될 수 있어 합산하지 않음" } : null,
    planned: Number(extra.planned ?? results.length),
    executed: results.filter(item => item.status === "PASS" || item.status === "FAIL").length,
    counts,
    results,
    ...extra,
  };
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# 로컬 브라우저 QA 결과",
    "",
    `- 실행 시각: ${report.generatedAt}`,
    `- 대상 HEAD: ${report.execution.head}`,
    `- 모드: ${report.execution.mode} / ${report.execution.category}`,
    `- 계획 ${report.planned} · 실행 ${report.executed} · PASS ${counts.PASS ?? 0} · FAIL ${counts.FAIL ?? 0} · BLOCKED ${counts.BLOCKED ?? 0} · NOT_RUN ${counts.NOT_RUN ?? 0}`,
    "- 이 보고서는 합성 API를 사용한 UI_WITH_TEST_DATA 결과이며 LIVE_SUPABASE 성공을 의미하지 않는다.",
    "",
    "| ID | 상태 | 원인 분류 | 문제/활동 | 실패 단계 | 화면 증거 |",
    "|---|---|---|---|---|---|",
    ...results.map(item => `| ${item.id} | ${item.status} | ${item.cause ?? "-"} | ${item.problemId ?? item.title} | ${item.failedStep ?? "-"} | ${item.screenshot ? `[캡처](${item.screenshot})` : "-"} |`),
    "",
    "## 미실행 및 제한",
    "",
    "- 이 실행기는 실제 Supabase 계정·PIN·토큰을 사용하지 않는다.",
    `- 이번 실행의 대표 UI 흐름은 ${results.length}개다. inventory의 고정 ${inventory?.counts.fixed ?? "확인 불가"}개·template ${inventory?.counts.templates ?? "확인 불가"}개·manifest ${inventory?.counts.assignedPractice ?? "확인 불가"}개 전체를 브라우저로 순회한 결과로 오해하지 않도록, 대표 범위 밖 항목은 NOT_RUN 후속 대상으로 남긴다.`,
    "- 실패한 case의 trace가 생성된 경우: `qa/local-browser-qa/<case-id>.trace.zip`",
  ];
  writeFileSync(reportMarkdownPath, `${lines.join("\n")}\n`);
}

async function main() {
  const packageJson = JSON.parse(readFileSync(resolve(appDir, "package.json"), "utf8"));
  assertCondition(packageJson.name === "stacking-blocks-math-web", `앱 디렉터리가 아닙니다: ${appDir}`);
  const initial: CaseResult[] = [];
  let preview: ReturnType<typeof spawn> | null = null;
  try {
    if (existsSync(reportJsonPath)) {
      const historyDir = join(artifactDir, "history", `${git(["rev-parse", "HEAD"])}-${Date.now()}`);
      mkdirSync(historyDir, { recursive: true });
      for (const file of [reportJsonPath, reportMarkdownPath, previewLogPath, join(artifactDir,"lesson5-set35-browser.json"),join(artifactDir,'build-manifest.json')]) if (existsSync(file)) cpSync(file, join(historyDir, file.split("/").pop()!));
      if (existsSync(screenshotDir)) cpSync(screenshotDir, join(historyDir, "screenshots"), { recursive: true });
      for (const file of readdirSync(artifactDir).filter(name => name.endsWith(".trace.zip"))) cpSync(join(artifactDir, file), join(historyDir, file));
    }
    writeFileSync(previewLogPath, "local-browser-qa startup\n");
    executionIdentity={head:git(["rev-parse","HEAD"]),branch:git(["branch","--show-current"]),workingTree:git(["status","--short"])};
    const buildEnv = { ...process.env };
    delete buildEnv.VITE_SUPABASE_URL;
    delete buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete buildEnv.VITE_INSTALLATION_ID;
    const build = spawnSync("npm", ["run", "build"], { cwd: appDir, env: buildEnv, stdio: "inherit" });
    assertCondition(build.status === 0, "production build가 실패했습니다.");
    const distFiles=readdirSync(resolve(appDir,'dist'),{recursive:true}).map(String).filter(name=>!name.endsWith('/')&& /\.(html|js|css|mjs|svg|png|json|txt)$/.test(name)).sort();
    const distHashes=distFiles.map(name=>({name,sha256:createHash('sha256').update(readFileSync(resolve(appDir,'dist',name))).digest('hex')}));
    executionIdentity.buildSha256=createHash('sha256').update(JSON.stringify(distHashes)).digest('hex');
    writeFileSync(join(artifactDir,'build-manifest.json'),JSON.stringify({execution:executionIdentity,files:distHashes},null,2));
    const executable = chromium.executablePath();
    assertCondition(existsSync(executable), `Playwright Chromium 실행 파일이 없습니다: ${executable}`);
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    writeFileSync(previewLogPath, `preview ${baseUrl}\n`);
    preview = spawn(process.execPath, [resolve(appDir,"node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: appDir, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] });
    preview.stdout?.on("data", chunk => appendFileSync(previewLogPath, String(chunk)));
    preview.stderr?.on("data", chunk => appendFileSync(previewLogPath, String(chunk)));
    const ready = await waitForPreview(`${baseUrl}/`);
    assertCondition(ready, `production preview가 시작되지 않았습니다. 로그: ${previewLogPath}`);
    assertCondition(await (await fetch(`${baseUrl}/`)).text()===readFileSync(resolve(appDir,'dist/index.html'),'utf8'),'preview가 이번 production build와 일치하지 않습니다.');
    const browser = await chromium.launch({ headless: !headed, args: ["--enable-unsafe-swiftshader"] });
    try {
      const run = (spec: Parameters<typeof runCase>[2]) => runCase(browser, baseUrl, spec);
      initial.push(await run({ id: "T01-l3-triple-grid", title: "3차시 실제 세 격자 입력·제출", problemId: projectionFixture.id, problems: [projectionFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/3/solve`);
        await waitForStudentPage(page);
        assertCondition(await visible(page, '[data-answer-renderer="TripleProjectionGridRenderer"]'), "세 방향 답안 Renderer가 보이지 않습니다.");
        const cells = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] button.cell-btn');
        assertCondition(await cells.count() === 12, "세 격자의 실제 셀 수가 12개가 아닙니다.");
        // front/side 실루엣은 화면에서 행을 뒤집어 표시하므로 underlying row 0은 두 번째 행이다.
        const edgeCell = await cells.nth(0).boundingBox();
        assertCondition(edgeCell, "첫 번째 입력 셀의 화면 영역을 찾지 못했습니다.");
        await cells.nth(0).click({ position: { x: 3, y: 3 } });
        for (const index of [6, 10]) await cells.nth(index).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "projections", "제출 payload가 projections가 아닙니다.");
        assertCondition(state.attempts[0]?.submission.projections?.top?.[0]?.[0] === true, "입력한 셀이 payload에 반영되지 않았습니다.");
        await expect(page.getByText("정답이에요", { exact: false }).first()).toBeVisible();
      }}));
      initial.push(await run({ id: "T02-l12-triple-grid", title: "12차시 실제 세 격자 입력·제출", problemId: lesson12Fixture.id, problems: [lesson12Fixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/12/solve`);
        await waitForStudentPage(page);
        assertCondition(await page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] table.projection-table').count() === 3, "12차시 세 격자가 보이지 않습니다.");
        const cells = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] button.cell-btn');
        for (const index of [0, 6, 10]) await cells.nth(index).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts.length === 1 && state.attempts[0].submission.kind === "projections", "12차시 격자 제출이 발생하지 않았습니다.");
      }}));
      initial.push(await run({ id: "T03-l5-choice", title: "5차시 정보 충분성 판단", problemId: choiceFixture.id, problems: [choiceFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/5`);
        await waitForStudentPage(page);
        assertCondition(await page.getByRole("button", { name: "위에서 보기", exact: true }).isDisabled(), "제한 단계에서 카메라 보기 버튼이 활성화되어 있습니다.");
        await page.getByRole("button", { name: "2. 알 수 없어요", exact: true }).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "choice" && state.attempts[0].submission.index === 1, "정보 충분성 선택 payload가 잘못되었습니다.");
        await expect(page.getByText("정답이에요",{exact:false}).first()).toBeVisible();
      }}));
      initial.push(await run({ id: "T04-l5-hidden-none-count", title: "5차시 숨은 블록 없음 3×3 개수", problemId: countFixture.id, problems: [countFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/5`);
        await waitForStudentPage(page);
        await page.locator('input[placeholder="정답을 입력"]').fill("9");
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "count" && state.attempts[0].submission.value === 9, "3×3 입력이 9로 제출되지 않았습니다.");
        await expect(page.getByText("정답이에요",{exact:false}).first()).toBeVisible();
      }}));
      initial.push(await run({ id: "T05-number-reveal", title: "숫자 정답 공개는 재구성을 요구하지 않음", problemId: countFixture.id, problems: [countFixture], run: async (page) => {
        await page.goto(`${baseUrl}/lesson/5`);
        await waitForStudentPage(page);
        await page.locator('input[placeholder="정답을 입력"]').fill("8");
        for(let attempt=1;attempt<=4;attempt++) {
          await page.getByRole("button", { name: "정답 확인", exact: true }).click();
          await expect(page.getByText(`오답 수: ${attempt}`,{exact:true})).toBeVisible();
          if(attempt<4) await expect(page.getByText('정답: 9개',{exact:true})).toHaveCount(0);
          if(attempt===3) await expect(page.getByText('힌트: 앞면의 칸을 세어 보세요.',{exact:true})).toBeVisible();
        }
        await expect(page.getByText("정답: 9개",{exact:true})).toBeVisible();
        assertCondition(!(await textVisible(page, "정답 모양대로 다시 쌓기")), "숫자 문제에 재구성 단계가 표시됩니다.");
      }}));
      initial.push(await run({ id: "T06-stage-position", title: "학습 단계와 현재 문항 위치 유지", problemId: stageFixtures[0].id, problems: stageFixtures, requiredComplete: true, run: async (page, _state) => {
        await page.goto(`${baseUrl}/lesson/2`);
        await waitForStudentPage(page);
        await expect(page.getByText("개념 단계 문항",{exact:false}).first()).toBeVisible();
        await page.getByRole("button", { name: /② 문제 풀기/ }).click();
        await expect(page.getByText("확인 단계 문항",{exact:false}).first()).toBeVisible();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        await expect(page.getByText("확인 단계 문항",{exact:false}).first()).toBeVisible();
      }}));
      initial.push(await run({ id: "T07-builder-drag", title: "실제 보관함 드래그·블록 저장", problemId: builderFixture.id, problems: [builderFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/1`);
        await waitForStudentPage(page);
        await dragPaletteToBoard(page);
        await expect(page.getByText("블록 수: 1",{exact:false}).first()).toBeVisible();
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect.poll(()=>state.snapshots[builderFixture.id]?.length).toBe(1);
      }}));
      initial.push(await run({ id: "T08-builder-touch", title: "터치 보관함 드래그·블록 배치", problemId: builderFixture.id, problems: [builderFixture], touch: true, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/1`);
        await waitForStudentPage(page);
        await touchDragPaletteToBoard(page);
        await expect(page.getByText("블록 수: 1",{exact:false}).first()).toBeVisible();
      }}));
      initial.push(await run({ id: "T09-architecture-10x10", title: "10차시 10×10 작업판·재료·저장", problems: [], project: null, run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/10/project`);
        await waitForStudentPage(page);
        await expect(page.getByText("10×10",{exact:false}).first()).toBeVisible();
        await expect(page.getByText("최대 3층",{exact:false}).first()).toBeVisible();
        assertCondition(await visible(page, '[aria-label="블록 재료 선택"]'), "건축 재료 영역이 보이지 않습니다.");
        await page.getByRole("button", { name: "파스텔", exact: true }).click();
        await page.getByLabel("건축물 이름").fill("QA 건축물");
        await page.getByLabel("설계 이유").fill("수업 테스트");
        await page.getByLabel("건축물 설명").fill("10×10 작업판 저장 확인");
        await dragPaletteToBoard(page,"쌓기나무 1개");
        // 3개 층의 공간 이름·설명은 실제 저장 검증 조건이다.
        for(let floor=1;floor<=3;floor++) {
          await page.getByRole('tab',{name:`${floor}층`,exact:true}).click();
          await page.getByLabel('공간 이름',{exact:true}).fill(`QA ${floor}층`);
          await page.getByLabel('공간 설명',{exact:true}).fill(`공간 ${floor} 설명`);
        }
        await page.getByRole("button", { name: "10차시 설계 저장", exact: true }).click();
        await expect.poll(()=>state.savedProjectPayload?.building?.blocks?.length).toBe(1);
        assertCondition(state.savedProjectPayload?.building?.grid_width === ARCHITECTURE_GRID.gridWidth && state.savedProjectPayload?.building?.grid_depth === ARCHITECTURE_GRID.gridDepth, "저장 payload의 신규 작업판 크기가 10×10이 아닙니다.");
        assertCondition(Object.values(state.savedProjectPayload?.building?.block_appearance ?? {}).includes("pastel"), "선택한 재료가 저장 payload에 반영되지 않았습니다.");
        // 네 모서리는 기존 접근성용 좌표 입력 UI로 검사한다. 위의 실제 drag 검사와 구분한다.
        await page.getByText('버튼으로 놓기',{exact:true}).click();
        for(const [x,z] of [[1,1],[10,1],[1,10],[10,10]]) {
          await page.getByLabel('가로',{exact:true}).fill(String(x));
          await page.getByLabel('세로',{exact:true}).fill(String(z));
          await page.getByRole('button',{name:'쌓기',exact:true}).click();
        }
        await expect(page.getByText('쌓기나무 5개',{exact:true})).toBeVisible();
        await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();
        await expect.poll(()=>state.project?.blocks.length).toBe(5);
        for(const [x,z] of [[0,0],[9,0],[0,9],[9,9]]) assertCondition(state.project!.blocks.some(b=>b.x===x&&b.z===z),'저장 구조에 실제 모서리 좌표가 없습니다.');
        await page.screenshot({path:join(screenshotDir,'T09-four-corners.png'),fullPage:true});
        const saved=JSON.stringify(state.project);
        await page.goto(`${baseUrl}/lesson/11/project`);
        await expect(page.getByText('QA 건축물',{exact:true}).first()).toBeVisible();
        await expect(page.getByText('1층 · QA 1층 — 공간 1 설명',{exact:true})).toBeVisible();
        await page.getByRole('button',{name:'건축물 수정하기',exact:true}).click();
        await expect(page.getByText('쌓기나무 5개',{exact:true})).toBeVisible();
        assertCondition(JSON.stringify(state.project)===saved,'10→11차시 열람이 저장 작품을 바꿨습니다.');
      }}));
      initial.push(await run({ id: "T10-architecture-restore", title: "11차시 건축물 소개서 복원", problems: [], project: initialBuilding, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/11/project`);
        await waitForStudentPage(page);
        await expect(page.getByText("QA 건축물",{exact:false}).first()).toBeVisible();
        await expect(page.getByText("1층 · 1층 공간",{exact:false}).first()).toBeVisible();
        await expect(page.getByRole('table',{name:'위',exact:true})).toBeVisible();
      }}));
      initial.push(await run({ id: "T11-grid-shape-orientation", title: "격자 셀 정사각형·앞/옆 위치", problemId: projectionFixture.id, problems: [projectionFixture], run: async (page) => {
        await page.goto(`${baseUrl}/lesson/3/solve`);
        await waitForStudentPage(page);
        const grid = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] .projection-frame').first();
        const table = grid.locator("table.projection-table");
        const cell = grid.locator("button.cell-btn").first();
        const frameBox = await grid.boundingBox();
        const tableBox = await table.boundingBox();
        const cellBox = await cell.boundingBox();
        const frontBox = await grid.locator(".projection-label-front").boundingBox();
        const sideBox = await grid.locator(".projection-label-side").boundingBox();
        assertCondition(frameBox && tableBox && cellBox && frontBox && sideBox, "격자 또는 관찰 위치 라벨이 보이지 않습니다.");
        assertCondition(Math.abs(cellBox.width - cellBox.height) <= 1, "입력 셀이 정사각형이 아닙니다.");
        assertCondition(frontBox.y >= tableBox.y + tableBox.height - 1, "앞 라벨이 격자 아래쪽에 붙어 있지 않습니다.");
        assertCondition(sideBox.x >= tableBox.x + tableBox.width - 1, "옆 라벨이 격자 오른쪽에 붙어 있지 않습니다.");
      }}));
      initial.push(await run({ id:"T14-lesson5-set35", title:"5차시 새 합성 세트 35문항 입력·제출·전환", problems:lesson5Set.map(p=>studentProblem({...p})), requiredComplete:true, run:async(page,state)=>{
        const comparison:JsonRecord[]=[];
        try {
          await page.goto(`${baseUrl}/lesson/5/practice`);
          for(let index=0;index<lesson5Set.length;index++) {
            const p=lesson5Set[index];
            await page.getByText(p.title,{exact:true}).waitFor({state:'visible'});
            await page.getByText(p.prompt,{exact:true}).waitFor({state:'visible'});
            if(p.given.projections?.front) {
              const table=page.getByRole('table',{name:'앞에서 본 조건',exact:true});
              await expect(table).toBeVisible();
              for(let y=0;y<p.given.projections.front.length;y++) for(let x=0;x<p.given.projections.front[y].length;x++) {
                const cell=table.getByRole('button',{name:`앞에서 본 조건 ${y+1}행 ${x+1}열`,exact:true});
                await expect(cell).toBeVisible();
                await expect(cell).toHaveAttribute('aria-pressed',String(p.given.projections.front[y][x]));
              }
            }
            const submit=page.getByRole('button',{name:'정답 확인',exact:true});
            await expect(submit).toBeEnabled();
            if(p.answer.kind==='choice') await page.getByRole('button',{name:`${p.answer.index+1}. ${p.choices[p.answer.index]}`,exact:true}).click();
            else if(p.answer.kind==='count') await page.locator('input[inputmode="numeric"]').fill(String(p.answer.value));
            if(index===2 && p.answer.kind==='count') {
              await page.getByRole('button',{name:'① 개념 배우기',exact:true}).click();
              await page.getByRole('button',{name:'③ 선택 연습으로 이동',exact:true}).click();
              await expect(page.getByText(p.title,{exact:true})).toBeVisible();
              await expect(page.locator('input[inputmode="numeric"]')).toHaveValue(String(p.answer.value));
              await page.reload();
              await page.getByText(p.title,{exact:true}).waitFor({state:'visible'});
              await expect(page.locator('input[inputmode="numeric"]')).toHaveValue(String(p.answer.value));
              await expect(submit).toBeEnabled();
            }
            const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/student-api')&&r.request().postDataJSON()?.action==='attempt'),submit.click()]);
            const payload=await response.json();
            assertCondition(payload.grade?.correct===true,`문항 ${index+1}: 입력 payload 채점 실패`);
            assertCondition(state.attempts.at(-1)?.problemId===p.id,`문항 ${index+1}: 이전 문항 ID로 제출됨`);
            await page.getByText('정답이에요!',{exact:false}).first().waitFor({state:'visible'});
            const screenshot=join(screenshotDir,`T14-${String(index+1).padStart(2,'0')}.png`);
            await page.screenshot({path:screenshot,fullPage:true});
            comparison.push({index:index+1,problemId:p.id,templateId:p.templateId,seed:p.seed,version:p.generatorVersion,prompt:p.prompt,status:'PASS',screenshot});
            if(index<lesson5Set.length-1) await page.getByRole('button',{name:'다음 문제',exact:true}).click();
          }
          await page.getByRole('button',{name:'차시 결과 보기',exact:true}).click();
          await expect(page).toHaveURL(/\/world$/);
          await page.getByRole('button',{name:'나가기',exact:false}).click();
          await page.goto(`${baseUrl}/?class=QA`);
          await page.getByLabel('이름',{exact:true}).fill('QA 학생');
          await page.getByLabel('PIN 4자리',{exact:true}).fill('0000');
          await page.getByRole('button',{name:'들어가기',exact:false}).click();
          await expect(page).toHaveURL(/\/world$/);
          await page.goto(`${baseUrl}/lesson/5/practice`);
          await expect(page.getByText(lesson5Set[34].title,{exact:true})).toBeVisible();
          await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeDisabled();
          assertCondition(state.lists.every(ids=>JSON.stringify(ids)===JSON.stringify(lesson5Set.map(p=>p.id))),'재조회 순서/ID 불일치');
        } finally {
          writeFileSync(join(artifactDir,'lesson5-set35-browser.json'),JSON.stringify({category:'UI_WITH_TEST_DATA',head:git(['rev-parse','HEAD']),rows:comparison,notRun:35-comparison.length,liveSet:false},null,2));
        }
      }}));
      initial.push(await run({id:'T15-late-grade',title:'늦은 채점 응답은 다음 문항을 덮지 않는다',problems:lesson5Set.map(p=>studentProblem({...p})),requiredComplete:true,run:async(page,state)=>{
        state.delayedAttempt=lesson5Set[0].id;
        await page.goto(`${baseUrl}/lesson/5/practice`);
        const first=lesson5Set[0];
        await expect(page.getByText(first.title,{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeEnabled();
        const pending=page.waitForResponse(r=>r.request().postDataJSON()?.action==='attempt');
        void pending.catch(()=>undefined);
        await page.getByRole('button',{name:'정답 확인',exact:true}).click();
        await page.getByRole('button',{name:'다음',exact:true}).click();
        await expect(page.getByText(lesson5Set[1].title,{exact:true})).toBeVisible();
        await page.locator('input[inputmode="numeric"]').fill('7');
        await pending;
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await expect(page.locator('input[inputmode="numeric"]')).toHaveValue('7');
        await expect(page.getByText('오답 수: 0',{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeEnabled();
      }}));
      const oldRows=JSON.parse(readFileSync(resolve(appDir,'qa/practice-sets/2026-09-12-live-investigation/remote-public-problems.json'),'utf8')).rows.filter((r:JsonRecord)=>r.order_index>2);
      const oldProblems:StudentProblem[]=oldRows.map((r:JsonRecord)=>studentProblem({id:r.id,code:r.code,lesson:5,stage:'more',orderIndex:r.order_index,title:r.title,prompt:r.prompt,problemType:r.problem_type,grid:{gridWidth:r.grid_width,gridDepth:r.grid_depth,maxHeight:r.max_height},givenBlocks:r.given_blocks,startBlocks:r.start_blocks??[],given:r.given,choices:r.choices,difficulty:1,xp:10}));
      initial.push(await run({id:'T16-old-set-replacement',title:'옛 11번 보존·명시적 새 세트·중복 클릭',problems:oldProblems,requiredComplete:true,prepare:state=>{
        state.positions[5]=oldProblems[10].id;
        state.outcomes[oldProblems[10].id]={...INITIAL_ATTEMPT,wrongCount:2};
        state.replacement={seed:603756,displayedSeed:595837,starts:0,records:structuredClone(oldProblems)};
      },run:async(page,state)=>{
        await page.goto(`${baseUrl}/lesson/5/practice`);
        await expect(page.getByRole('heading',{name:'③ 선택 연습 1 / 5',exact:true})).toBeVisible();
        await expect(page.getByText('오답 수: 2',{exact:true})).toBeVisible();
        await expect(page.getByText('이전에 요청한 새 묶음이 아직 준비되지 않아',{exact:false})).toBeVisible();
        await page.reload();
        await expect(page.getByRole('heading',{name:'③ 선택 연습 1 / 5',exact:true})).toBeVisible();
        const oldRecord=JSON.stringify(state.outcomes),oldIds=state.replacement!.records.map(p=>p.id);
        page.on('dialog',dialog=>dialog.accept());
        await page.getByRole('button',{name:'5문제 더 풀기',exact:true}).dblclick();
        await expect(page.getByRole('heading',{name:'③ 선택 연습 1 / 5',exact:true})).toBeVisible();
        assertCondition(state.replacement?.starts===1,'이중 클릭이 새 묶음을 두 번 만듦');
        assertCondition(state.replacement.seed===611675,'기대 seed에서 전환되지 않음');
        assertCondition(JSON.stringify(state.outcomes)===oldRecord,'이전 시도 기록 변경');
        assertCondition(JSON.stringify(state.replacement.records.map(p=>p.id))===JSON.stringify(oldIds),'이전 문항 삭제');
        const nextIds=state.problems.map(p=>p.id);
        await page.reload();
        await expect(page.getByRole('heading',{name:'③ 선택 연습 1 / 5',exact:true})).toBeVisible();
        assertCondition(JSON.stringify(state.problems.map(p=>p.id))===JSON.stringify(nextIds),'새 세트 재조회 ID 변경');
      }}));
      initial.push(await run({ id: "T13-learn-stage-page", title: "개념 배우기 독립 페이지와 문제 풀기 전환", problems: [projectionFixture], run: async (page) => {
        await page.goto(`${baseUrl}/lesson/3/learn`);
        await waitForStudentPage(page);
        await expect(page.getByText("① 개념 배우기",{exact:false}).first()).toBeVisible();
        await expect(page.getByText("안내된 탐구",{exact:false}).first()).toBeVisible();
        await expect(page.getByText("직접 해 보기",{exact:false}).first()).toBeVisible();
        await page.getByRole("button", { name: "② 문제 풀기 시작", exact: true }).click();
        await waitForStudentPage(page);
        assertCondition(page.url().endsWith("/lesson/3/solve"), "문제 풀기 페이지 URL로 이동하지 않았습니다.");
        await expect(page.getByText("세 방향 격자 표현",{exact:true})).toBeVisible();
      }}));
      initial.push(await run({ id: "T12-completion-navigation", title: "4차시 완료 후 다음 학습 단계 이동", problemId: completionFixtures[0].id, problems: completionFixtures, requiredComplete: true, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/4`);
        await waitForStudentPage(page);
        await page.getByRole("button", { name: "2. 두 번째", exact: true }).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        await expect(page.getByText("개념 단계 문항",{exact:false}).first()).toBeVisible();
        await page.getByRole("button", { name: "문제 풀기 시작", exact: true }).click();
        await expect(page.getByText("확인 단계 문항",{exact:true})).toBeVisible();
      }}));
    } finally {
      await browser.close();
    }
    writeReport(initial, { baseUrl, previewLog: previewLogPath, traceDirectory: artifactDir, browser: "Chromium" });
    if (initial.some(item => item.status !== "PASS")) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeReport([...initial, { id: "QA-BOOT", title: "QA 실행기 사전 준비", category: "UI_WITH_TEST_DATA", status: "BLOCKED", cause: failureCause(message), failedStep: "preflight", expected: "production build·preview·Chromium 시작", actual: message, errors: [message] }], { planned: representativeCount, previewLog: previewLogPath, traceDirectory: artifactDir });
    process.exitCode = 2;
  } finally {
    if (preview && preview.exitCode === null) {
      preview.kill("SIGTERM");
      setTimeout(() => { if (preview && preview.exitCode === null) preview.kill("SIGKILL"); }, 2000).unref();
    }
  }
}

void main();
