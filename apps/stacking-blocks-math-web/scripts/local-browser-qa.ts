import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { deriveProblemPresentation } from "../shared/problemPresentation.ts";
import { EMPTY_BUILDING, ARCHITECTURE_GRID, type Building } from "../shared/activities.ts";
import type { BlockCoord, Grid2D, StudentProblem, StudentSubmission } from "../shared/types.ts";

type JsonRecord = Record<string, unknown>;

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
type CaseResult = {
  id: string;
  title: string;
  category: "UI_WITH_TEST_DATA" | "LOCAL_LOGIC" | "LIVE_SUPABASE";
  status: Status;
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
const headed = process.argv.includes("--headed") || process.env.QA_HEADED === "1";
const representativeCount = 12;

mkdirSync(screenshotDir, { recursive: true });

function git(args: string[]): string {
  try { return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim(); }
  catch { return "git 정보 확인 실패"; }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function textVisible(page: Page, text: string): Promise<boolean> {
  return page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
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
  id: "qa-live-l3-grid", code: "qa-live-l3-grid", lesson: 3, orderIndex: 1, stage: "concept", problemType: "PROJECTION_DRAW",
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
  problems: StudentProblem[];
  snapshots: Record<string, BlockCoord[]>;
  attempts: Array<{ problemId: string; submission: StudentSubmission }>;
  project: Building | null;
  savedProjectPayload: JsonRecord | null;
  calls: string[];
  countReveal: boolean;
};

function homePayload() {
  return { student: { classId: "qa-class", className: "QA 학급", rewards: { totalXp: 50, totalStars: 2, badges: [], streak: 1, equippedMaterial: "pastel", introTheme: "blueprint", catalog: [] }, lessons: Array.from({ length: 12 }, (_, i) => ({ lesson: i + 1, locked: false, totalProblems: 3, completedProblems: 0, stars: 0, completed: false })) } };
}

function makeMock(problems: StudentProblem[], project: Building | null = null): MockState {
  return { problems, snapshots: {}, attempts: [], project, savedProjectPayload: null, calls: [], countReveal: false };
}

async function installMock(page: Page, state: MockState, baseUrl: string, requiredComplete = false) {
  await page.addInitScript(({ url }) => {
    localStorage.setItem("stacking-installation-config", JSON.stringify({ installationId: "qa-local", supabaseUrl: url, supabasePublishableKey: "qa-publishable-key" }));
    localStorage.setItem("sb.student.token", "qa-student-session");
  }, { url: baseUrl });
  await page.route("**/functions/v1/student-api", async route => {
    const body = (route.request().postDataJSON() ?? {}) as JsonRecord;
    const action = String(body.action ?? "");
    state.calls.push(action);
    const current = state.problems.find(problem => problem.id === String(body.problemId)) ?? state.problems[0];
    let response: JsonRecord;
    if (action === "lessonProblems") response = { problems: state.problems.filter(problem => problem.lesson === Number(body.lesson)), requiredComplete, seedFallback: false, currentProblemId: null };
    else if (action === "problem") response = { problem: current, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    else if (action === "snapshot:get") response = { snapshot: { blocks: state.snapshots[String(body.problemId)] ?? [] } };
    else if (action === "snapshot") { state.snapshots[String(body.problemId)] = Array.isArray(body.blocks) ? body.blocks as BlockCoord[] : []; response = { ok: true }; }
    else if (action === "position") response = { ok: true };
    else if (action === "home") response = homePayload();
    else if (action === "rewards") response = { xp: 50, equippedMaterial: "pastel", introTheme: "blueprint", catalog: [] };
    else if (action === "activity:project:get") response = { building: state.project };
    else if (action === "activity:project:save") { state.savedProjectPayload = body; state.project = body.building; response = { version: (state.project?.version ?? 0) + 1 }; }
    else if (action === "attempt") {
      const submission = body.submission as StudentSubmission;
      state.attempts.push({ problemId: String(body.problemId), submission });
      let correct = false;
      if (current?.problemType === "COUNT") correct = submission.kind === "count" && submission.value === 9;
      else if (current?.problemType === "CHOICE") correct = submission.kind === "choice" && submission.index === 1;
      else if (current?.problemType === "PROJECTION_DRAW") correct = submission.kind === "projections" && JSON.stringify(submission.projections) === JSON.stringify({ top: tripleProjection, front: tripleProjection, side: tripleProjection });
      else if (current?.problemType === "FREE_BUILD") correct = submission.kind === "blocks" && (submission.blocks?.length ?? 0) > 0;
      if (state.countReveal) response = { grade: { correct: false, wrongCount: 4, message: "정답을 확인하고 다시 풀어 보세요.", hint: "앞면의 칸을 세어 보세요.", revealedAnswer: { count: 9, explanation: "앞면의 아홉 칸이 정답입니다." }, needsRebuild: false, completed: false, xpEarned: 0, stars: 0, detail: null } };
      else response = { grade: { correct, wrongCount: correct ? 0 : 1, message: correct ? "정답이에요!" : "다시 살펴보세요.", hint: null, revealedAnswer: null, needsRebuild: false, completed: correct, xpEarned: correct ? 10 : 0, stars: correct ? 1 : 0, detail: null } };
    } else if (action.startsWith("activity:")) response = { ok: true, code: "QA1234", state: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, outcome: { correct: true, message: "정답이에요!" }, answer: null };
    else response = { error: { code: "QA_UNEXPECTED_ACTION", message: "QA mock에 없는 요청입니다." } };
    await route.fulfill({ status: response.error ? 400 : 200, json: response });
  });
}

async function dragPaletteToBoard(page: Page): Promise<void> {
  const palette = await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).boundingBox();
  const canvas = await page.getByLabel("쌓기나무 3D 작업판").boundingBox();
  assertCondition(palette && canvas, "보관함 또는 3D 작업판의 화면 영역을 찾지 못했습니다.");
  await page.mouse.move(palette.x + palette.width / 2, palette.y + palette.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 });
  await page.mouse.up();
}

async function touchDragPaletteToBoard(page: Page): Promise<void> {
  const palette = await page.getByRole("button", { name: "쌓기나무 보관함. 블록을 작업판에 놓기" }).boundingBox();
  const canvas = await page.getByLabel("쌓기나무 3D 작업판").boundingBox();
  assertCondition(palette && canvas, "터치 QA에서 보관함 또는 3D 작업판의 화면 영역을 찾지 못했습니다.");
  const session = await page.context().newCDPSession(page);
  const start = { x: palette.x + palette.width / 2, y: palette.y + palette.height / 2 };
  const end = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function runCase(browser: Browser, baseUrl: string, spec: { id: string; title: string; problemId?: string; problems: StudentProblem[]; run: (page: Page, state: MockState) => Promise<void>; project?: Building | null; requiredComplete?: boolean; touch?: boolean }): Promise<CaseResult> {
  const state = makeMock(spec.problems, spec.project);
  const context = await browser.newContext({ viewport: spec.touch ? { width: 1024, height: 768 } : { width: 1366, height: 768 }, hasTouch: Boolean(spec.touch) });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  const metadata = spec.problems.find(problem => problem.id === spec.problemId) ?? spec.problems[0];
  const result: CaseResult = { id: spec.id, title: spec.title, category: "UI_WITH_TEST_DATA", status: "FAIL", problemId: metadata?.id, templateId: metadata?.templateId, seed: metadata?.seed, generatorVersion: metadata?.generatorVersion, problemVersion: "qa-fixture-v1" };
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
    result.failedStep = "browser-flow";
    result.expected = "학생 route의 실제 입력·제출·결과 흐름이 끝까지 동작";
    result.actual = error instanceof Error ? error.message : String(error);
    const path = join(screenshotDir, `${spec.id}-fail.png`);
    await page.screenshot({ path, fullPage: true }).catch(() => undefined);
    result.screenshot = path;
    result.trace = caseTracePath;
    result.errors = browserErrors.slice(-10);
  }
  await context.tracing.stop({ path: caseTracePath }).catch(() => undefined);
  await context.close();
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
  const counts = results.reduce<Record<string, number>>((all, item) => { all[item.status] = (all[item.status] ?? 0) + 1; return all; }, {});
  const report = {
    generatedAt: new Date().toISOString(),
    execution: { head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), workingTree: git(["status", "--short"]), mode: headed ? "headed" : "headless", category: "UI_WITH_TEST_DATA", baseUrl: extra.baseUrl ?? null },
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
    "| ID | 상태 | 문제/활동 | 실패 단계 | 화면 증거 |",
    "|---|---|---|---|---|",
    ...results.map(item => `| ${item.id} | ${item.status} | ${item.problemId ?? item.title} | ${item.failedStep ?? "-"} | ${item.screenshot ? `[캡처](${item.screenshot})` : "-"} |`),
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
    writeFileSync(previewLogPath, "local-browser-qa startup\n");
    const buildEnv = { ...process.env };
    delete buildEnv.VITE_SUPABASE_URL;
    delete buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
    delete buildEnv.VITE_INSTALLATION_ID;
    const build = spawnSync("npm", ["run", "build"], { cwd: appDir, env: buildEnv, stdio: "inherit" });
    assertCondition(build.status === 0, "production build가 실패했습니다.");
    const executable = chromium.executablePath();
    assertCondition(existsSync(executable), `Playwright Chromium 실행 파일이 없습니다: ${executable}`);
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    writeFileSync(previewLogPath, `preview ${baseUrl}\n`);
    preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: appDir, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] });
    preview.stdout?.on("data", chunk => appendFileSync(previewLogPath, String(chunk)));
    preview.stderr?.on("data", chunk => appendFileSync(previewLogPath, String(chunk)));
    const ready = await waitForPreview(`${baseUrl}/`);
    assertCondition(ready, `production preview가 시작되지 않았습니다. 로그: ${previewLogPath}`);
    const browser = await chromium.launch({ headless: !headed, args: ["--enable-unsafe-swiftshader"] });
    try {
      const run = (spec: Parameters<typeof runCase>[2]) => runCase(browser, baseUrl, spec);
      initial.push(await run({ id: "T01-l3-triple-grid", title: "3차시 실제 세 격자 입력·제출", problemId: projectionFixture.id, problems: [projectionFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/3`);
        assertCondition(await visible(page, '[data-answer-renderer="TripleProjectionGridRenderer"]'), "세 방향 답안 Renderer가 보이지 않습니다.");
        const cells = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] button.cell-btn');
        assertCondition(await cells.count() === 12, "세 격자의 실제 셀 수가 12개가 아닙니다.");
        // front/side 실루엣은 화면에서 행을 뒤집어 표시하므로 underlying row 0은 두 번째 행이다.
        const edgeCell = await cells.nth(0).boundingBox();
        assertCondition(edgeCell, "첫 번째 입력 셀의 화면 영역을 찾지 못했습니다.");
        await page.mouse.click(edgeCell.x + 3, edgeCell.y + 3);
        for (const index of [6, 10]) await cells.nth(index).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "projections", "제출 payload가 projections가 아닙니다.");
        assertCondition(state.attempts[0]?.submission.projections?.top?.[0]?.[0] === true, "입력한 셀이 payload에 반영되지 않았습니다.");
        assertCondition(await textVisible(page, "정답이에요"), "채점 결과가 화면에 표시되지 않았습니다.");
      }}));
      initial.push(await run({ id: "T02-l12-triple-grid", title: "12차시 실제 세 격자 입력·제출", problemId: lesson12Fixture.id, problems: [lesson12Fixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/12`);
        assertCondition(await page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] table.projection-table').count() === 3, "12차시 세 격자가 보이지 않습니다.");
        const cells = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"] button.cell-btn');
        for (const index of [0, 6, 10]) await cells.nth(index).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts.length === 1 && state.attempts[0].submission.kind === "projections", "12차시 격자 제출이 발생하지 않았습니다.");
      }}));
      initial.push(await run({ id: "T03-l5-choice", title: "5차시 정보 충분성 판단", problemId: choiceFixture.id, problems: [choiceFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/5`);
        assertCondition(await page.getByRole("button", { name: "위에서 보기", exact: true }).isDisabled(), "제한 단계에서 카메라 보기 버튼이 활성화되어 있습니다.");
        await page.getByRole("button", { name: "2. 알 수 없어요", exact: true }).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "choice" && state.attempts[0].submission.index === 1, "정보 충분성 선택 payload가 잘못되었습니다.");
        assertCondition(await textVisible(page, "정답이에요"), "판단형 채점 결과가 보이지 않습니다.");
      }}));
      initial.push(await run({ id: "T04-l5-hidden-none-count", title: "5차시 숨은 블록 없음 3×3 개수", problemId: countFixture.id, problems: [countFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/5`);
        await page.locator('input[placeholder="정답을 입력"]').fill("9");
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(state.attempts[0]?.submission.kind === "count" && state.attempts[0].submission.value === 9, "3×3 입력이 9로 제출되지 않았습니다.");
        assertCondition(await textVisible(page, "정답이에요"), "9개 정답 결과가 보이지 않습니다.");
      }}));
      initial.push(await run({ id: "T05-number-reveal", title: "숫자 정답 공개는 재구성을 요구하지 않음", problemId: countFixture.id, problems: [countFixture], run: async (page, state) => {
        state.countReveal = true;
        await page.goto(`${baseUrl}/lesson/5`);
        await page.locator('input[placeholder="정답을 입력"]').fill("8");
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(await textVisible(page, "정답: 9개"), "숫자 정답 공개 자료가 보이지 않습니다.");
        assertCondition(!(await textVisible(page, "정답 모양대로 다시 쌓기")), "숫자 문제에 재구성 단계가 표시됩니다.");
      }}));
      initial.push(await run({ id: "T06-stage-position", title: "학습 단계와 현재 문항 위치 유지", problemId: stageFixtures[0].id, problems: stageFixtures, requiredComplete: true, run: async (page, _state) => {
        await page.goto(`${baseUrl}/lesson/2`);
        assertCondition(await textVisible(page, "개념 단계 문항"), "개념 단계 문항이 시작 화면에 없습니다.");
        await page.getByRole("button", { name: /② 문제로 익히기/ }).click();
        assertCondition(await textVisible(page, "확인 단계 문항"), "문제 확인 단계로 전환되지 않았습니다.");
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(await textVisible(page, "확인 단계 문항"), "제출 후 현재 문항이 바뀌거나 초기화되었습니다.");
      }}));
      initial.push(await run({ id: "T07-builder-drag", title: "실제 보관함 드래그·블록 저장", problemId: builderFixture.id, problems: [builderFixture], run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/1`);
        await dragPaletteToBoard(page);
        assertCondition(await textVisible(page, "블록 수: 1"), "보관함 드래그 후 블록 수가 1로 갱신되지 않았습니다.");
        await page.getByRole("button", { name: "저장", exact: true }).click();
        assertCondition(state.snapshots[builderFixture.id]?.length === 1, "3D snapshot 저장 요청이 없거나 블록이 저장되지 않았습니다.");
      }}));
      initial.push(await run({ id: "T08-builder-touch", title: "터치 보관함 드래그·블록 배치", problemId: builderFixture.id, problems: [builderFixture], touch: true, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/1`);
        await touchDragPaletteToBoard(page);
        assertCondition(await textVisible(page, "블록 수: 1"), "터치 보관함 드래그 후 블록 수가 1로 갱신되지 않았습니다.");
      }}));
      initial.push(await run({ id: "T09-architecture-10x10", title: "10차시 10×10 작업판·재료·저장", problems: [], project: null, run: async (page, state) => {
        await page.goto(`${baseUrl}/lesson/10/project`);
        assertCondition(await textVisible(page, "10×10"), "신규 건축판 10×10 표시가 없습니다.");
        assertCondition(await textVisible(page, "최대 3층"), "최대 3층 조건이 보이지 않습니다.");
        assertCondition(await visible(page, '[aria-label="블록 재료 선택"]'), "건축 재료 영역이 보이지 않습니다.");
        await page.getByRole("button", { name: "파스텔", exact: true }).click();
        await page.getByLabel("건축물 이름").fill("QA 건축물");
        await page.getByLabel("설계 이유").fill("수업 테스트");
        await page.getByLabel("건축물 설명").fill("10×10 작업판 저장 확인");
        await dragPaletteToBoard(page);
        await page.getByRole("button", { name: "10차시 설계 저장", exact: true }).click();
        assertCondition(state.savedProjectPayload?.building?.grid_width === ARCHITECTURE_GRID.gridWidth && state.savedProjectPayload?.building?.grid_depth === ARCHITECTURE_GRID.gridDepth, "저장 payload의 신규 작업판 크기가 10×10이 아닙니다.");
        assertCondition(Object.values(state.savedProjectPayload?.building?.block_appearance ?? {}).includes("pastel"), "선택한 재료가 저장 payload에 반영되지 않았습니다.");
      }}));
      initial.push(await run({ id: "T10-architecture-restore", title: "11차시 건축물 소개서 복원", problems: [], project: initialBuilding, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/11/project`);
        assertCondition(await textVisible(page, "QA 건축물"), "저장된 건축물 이름이 복원되지 않았습니다.");
        assertCondition(await textVisible(page, "1층 · 1층 공간"), "층별 설명이 복원되지 않았습니다.");
        assertCondition(await textVisible(page, "위에서 본 모양"), "소개서의 투영 자료가 보이지 않습니다.");
      }}));
      initial.push(await run({ id: "T11-grid-shape-orientation", title: "격자 셀 정사각형·앞/옆 위치", problemId: projectionFixture.id, problems: [projectionFixture], run: async (page) => {
        await page.goto(`${baseUrl}/lesson/3`);
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
      initial.push(await run({ id: "T12-completion-navigation", title: "4차시 완료 후 다음 학습 단계 이동", problemId: completionFixtures[0].id, problems: completionFixtures, requiredComplete: true, run: async (page) => {
        await page.goto(`${baseUrl}/lesson/4`);
        await page.getByRole("button", { name: "2. 두 번째", exact: true }).click();
        await page.getByRole("button", { name: "정답 확인", exact: true }).click();
        assertCondition(await textVisible(page, "개념 단계 문항"), "제출 뒤 현재 완료 문항이 사라졌습니다.");
        await page.getByRole("button", { name: "문제로 익히기 시작", exact: true }).click();
        assertCondition(await textVisible(page, "확인 단계 문항"), "완료 후 다음 학습 단계로 이동하지 못했습니다.");
      }}));
    } finally {
      await browser.close();
    }
    writeReport(initial, { baseUrl, previewLog: previewLogPath, traceDirectory: artifactDir, browser: "Chromium" });
    if (initial.some(item => item.status !== "PASS")) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeReport([...initial, { id: "QA-BOOT", title: "QA 실행기 사전 준비", category: "UI_WITH_TEST_DATA", status: "BLOCKED", failedStep: "preflight", expected: "production build·preview·Chromium 시작", actual: message, errors: [message] }], { planned: representativeCount, previewLog: previewLogPath, traceDirectory: artifactDir });
    process.exitCode = 2;
  } finally {
    if (preview && preview.exitCode === null) {
      preview.kill("SIGTERM");
      setTimeout(() => { if (preview && preview.exitCode === null) preview.kill("SIGKILL"); }, 2000).unref();
    }
  }
}

void main();
