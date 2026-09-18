#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Phase5ApiError, Phase5ApiStore, type ProgressRecord } from "../shared/phase5Api.ts";
import type { BlockCoord } from "../shared/types.ts";

export type RunnerStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export interface RunnerResult { status: RunnerStatus; mode: "MOCK" | "REMOTE"; checks: Record<string, RunnerStatus>; errors: string[]; artifactPath?: string; }

export class RunnerError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface RemoteFailureDetails { stage: string; functionName: string; method: string; status: number | null; contentType: string; code: string; message: string; action?: string; }
export class RemoteApiError extends RunnerError {
  readonly details: RemoteFailureDetails;
  constructor(details: RemoteFailureDetails) { super("REMOTE_API_FAILED", details.message); this.details = details; }
}
function safeText(value: unknown): string { const text = String(value ?? "").replace(/[\r\n]+/g, " ").slice(0, 240); return /(pin|token|secret|password|service.?role)/iu.test(text) ? "[REDACTED]" : text || "응답 내용이 없습니다."; }
export function formatRemoteApiFailure(error: unknown): string {
  if (!(error instanceof RemoteApiError)) return `REMOTE_RUNNER_ERROR: ${error instanceof Error ? error.message : String(error)}`;
  const d = error.details;
  const action = d.action ? ` action=${d.action}` : "";
  return `REMOTE_API_FAILED stage=${d.stage} function=${d.functionName} method=${d.method} status=${d.status ?? "NETWORK"} contentType=${d.contentType || "unknown"} code=${d.code}${action} message=${safeText(d.message)}`;
}

export function assertTestTarget(input: { targetEnv?: string; testRef?: string; testUrl?: string; productionRef?: string }): void {
  if (input.targetEnv !== "TEST") throw new RunnerError("TEST_FLAG_REQUIRED", "TARGET_ENV=TEST인 경우에만 실행할 수 있습니다.");
  if (!input.testRef || !/^[a-z0-9-]{1,80}$/.test(input.testRef)) throw new RunnerError("TEST_PROJECT_REF_MISSING", "TEST project ref가 없습니다.");
  if (!input.testUrl || !/^https:\/\/[^/]+\.supabase\.co$/i.test(input.testUrl)) throw new RunnerError("TEST_URL_INVALID", "TEST URL 형식이 올바르지 않습니다.");
  if (!input.testUrl.toLowerCase().startsWith(`https://${input.testRef.toLowerCase()}.supabase.co`)) throw new RunnerError("TEST_REF_URL_MISMATCH", "TEST ref와 URL이 일치하지 않습니다.");
  if (input.productionRef && input.testRef === input.productionRef) throw new RunnerError("PRODUCTION_TARGET_BLOCKED", "운영 project ref는 TEST runner 대상이 아닙니다.");
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (/(pin|token|secret|password|service.?role|publishable.?key|anon.?key)/iu.test(key)) out[key] = "[REDACTED]";
    else out[key] = redactSensitive(val);
  }
  return out;
}

export function assertNoSensitiveText(value: unknown): void {
  const text = JSON.stringify(value);
  if (/(pin|token|secret|password|service.?role)/iu.test(text)) throw new RunnerError("SENSITIVE_OUTPUT", "민감한 값이 결과에 포함되었습니다.");
}

export function fixtureMarker(name: string): string { return `PHASE5E_TEST_${name}`; }
export function fixtureIdentity(role: "CLASS" | "STUDENT", index?: number): string { return fixtureMarker(index === undefined ? role : `${role}_${index}`); }

/** 단계 하나가 실패하면 이후 원격 단계는 실행하지 않는 실행 계약입니다. */
export async function runPipeline(phases: Array<() => Promise<void> | void>): Promise<{ completed: number; error: string | null }> {
  for (let index = 0; index < phases.length; index += 1) {
    try { await phases[index](); } catch (error) { return { completed: index, error: error instanceof Error ? error.message : String(error) }; }
  }
  return { completed: phases.length, error: null };
}

export function assertCleanupTarget(input: { targetEnv?: string; projectRef?: string; productionRef?: string; marker?: string; explicit?: boolean }): void {
  if (!input.explicit) throw new RunnerError("CLEANUP_CONFIRMATION_REQUIRED", "fixture 정리는 명시적 --cleanup 확인이 필요합니다.");
  if (input.targetEnv !== "TEST") throw new RunnerError("CLEANUP_TEST_ONLY", "TEST 환경에서만 fixture 정리를 허용합니다.");
  if (!input.projectRef || input.projectRef === input.productionRef) throw new RunnerError("PRODUCTION_CLEANUP_BLOCKED", "운영 project 정리는 차단되었습니다.");
  if (!input.marker || !input.marker.startsWith("PHASE5E_TEST_")) throw new RunnerError("CLEANUP_MARKER_REQUIRED", "TEST marker가 없는 행은 정리할 수 없습니다.");
}

const blocks: BlockCoord[] = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 },
  { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 1, z: 0 },
];
const altBlocks: BlockCoord[] = [...blocks.slice(0, 9), { x: 1, y: 1, z: 1 }];

function mockFixture(): { store: Phase5ApiStore; scope: { installationId: string; classId: string }; alice: { installationId: string; classId: string; studentId: string }; bob: { installationId: string; classId: string; studentId: string }; carol: { installationId: string; classId: string; studentId: string }; teacher: { installationId: string; teacherId: string; classIds: string[] } } {
  const scope = { installationId: "test-install", classId: "test-class" };
  const store = new Phase5ApiStore();
  store.registerClass(scope, "test-teacher");
  const alice = { ...scope, studentId: "test-student-1" }; const bob = { ...scope, studentId: "test-student-2" }; const carol = { ...scope, studentId: "test-student-3" };
  store.registerStudent(alice, fixtureMarker("STUDENT_1")); store.registerStudent(bob, fixtureMarker("STUDENT_2")); store.registerStudent(carol, fixtureMarker("STUDENT_3"));
  return { store, scope, alice, bob, carol, teacher: { installationId: scope.installationId, teacherId: "test-teacher", classIds: [scope.classId] } };
}

export function runMockPhase5(): RunnerResult {
  const checks: Record<string, RunnerStatus> = {}; const errors: string[] = [];
  try {
    const { store, scope, alice, bob, carol, teacher } = mockFixture();
    const published = store.publish(alice, { title: fixtureMarker("PEER"), blocks, cardType: "top", hintType: "heightMap" });
    try { store.publish(alice, { problemId: published.problemId, version: published.version, title: fixtureMarker("PEER"), blocks, cardType: "top", hintType: "heightMap" }); throw new RunnerError("FIXTURE_IDEMPOTENCY", "같은 fixture가 중복 생성되었습니다."); } catch (error) { if (!(error instanceof Phase5ApiError) || error.code !== "PEER_VERSION_CONFLICT") throw error; }
    const listed = store.list(bob); if (listed.length !== 1 || "hiddenValidationData" in listed[0]) throw new RunnerError("PUBLIC_DTO", "공개 문제 DTO가 안전하지 않습니다."); checks.peer_public_isolation = "PASS";
    store.hint(carol, published.problemId, published.version);
    const b = store.submit(bob, published.problemId, published.version, altBlocks); const c = store.submit(carol, published.problemId, published.version, blocks);
    if (!b.correct || b.score !== 2 || !c.correct || c.score !== 1) throw new RunnerError("PEER_GRADE", "친구 문제 점수 계약이 맞지 않습니다."); checks.peer_grade = "PASS";
    const duplicate = store.submit(bob, published.problemId, published.version, blocks); if (duplicate.score !== b.score) throw new RunnerError("DUPLICATE_REWARD", "중복 점수가 지급되었습니다."); checks.duplicate_submit = "PASS";
    try { store.get({ ...bob, classId: "other-class" }, published.problemId, published.version); throw new RunnerError("CROSS_CLASS", "다른 반 접근이 허용되었습니다."); } catch (error) { if (!(error instanceof Phase5ApiError)) throw error; } checks.cross_class_blocked = "PASS";
    store.hide(teacher, scope.classId, published.problemId, published.version); checks.teacher_hide = "PASS";
    const project = { projectId: "test-project", boardSize: { gridWidth: 10, gridDepth: 10, maxHeight: 0 }, blocks, materials: { "0:0:0": "wood" }, title: fixtureMarker("PROJECT"), description: "", layerUsageNotes: {} };
    const saved = store.saveProject(alice, project); const expanded = store.saveProject(alice, { ...project, boardSize: { gridWidth: 12, gridDepth: 12, maxHeight: 8 }, expectedVersion: saved.projectVersion, blocks: [...blocks, { x: 11, y: 3, z: 11 }], materials: { ...project.materials, "11:3:11": "stone" } });
    if (expanded.boardSize.gridWidth !== 12 || store.loadProject(bob, project.projectId) !== null) throw new RunnerError("PROJECT_SCOPE", "작품 저장/격리 계약이 맞지 않습니다."); checks.project_save_restore = "PASS";
    const record: ProgressRecord = { lesson: 12, stage: "solve", curriculumVersion: "v1", setId: "test-set", problemId: "p1", problemVersion: 1, questionIndex: 0, answer: { value: 9 }, firstAttemptResult: "incorrect", attemptCount: 1, hintLevel: 0, finalResult: null, remediationStatus: "needed", completedAt: null };
    store.saveProgress(alice, record); store.saveProgress(alice, { ...record, firstAttemptResult: "correct", attemptCount: 2, hintLevel: 1, finalResult: "correct", remediationStatus: "complete" });
    const practice = [5, 10, 15, 20].map((n) => { const identity = { ...alice, studentId: `${alice.studentId}-${n}` }; store.registerStudent(identity, fixtureMarker(`PRACTICE_${n}`)); return store.getOrCreatePractice(identity, 12, "v1", n as 5 | 10 | 15 | 20, n); }); if (practice.some((p) => p.problemIds.length !== p.targetTotal)) throw new RunnerError("PRACTICE_TOTAL", "연습 총량이 맞지 않습니다."); checks.progress_practice_reflection = "PASS";
    assertNoSensitiveText(redactSensitive({ published, b, c, expanded })); checks.response_redaction = "PASS";
    checks.fixture_idempotency = "PASS";
  } catch (error) { errors.push(error instanceof RunnerError || error instanceof Phase5ApiError ? `${error.code}: ${error.message}` : String(error)); }
  const status: RunnerStatus = errors.length ? "FAIL" : "PASS";
  return { status, mode: "MOCK", checks, errors };
}

interface RemoteContext { url: string; key: string; teacherToken: string; classId: string; classCode: string; students: Array<{ id: string; name: string; pin: string; token?: string }>; }
type JsonRecord = Record<string, unknown>;
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function parseJsonRecord(raw: string): JsonRecord { if (!raw) return {}; try { return asRecord(JSON.parse(raw)); } catch { return {}; } }
/** student-api project:save 응답의 저장 모델은 DB 계약과 같은 snake_case 필드를 사용합니다. */
export function readRemoteProjectGridWidth(project: unknown): number { return Number(asRecord(project).grid_width); }
export function readRemoteProjectVersion(project: unknown): number {
  const version = Number(asRecord(project).version);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}
export function isFixtureProjectMarker(project: unknown): boolean {
  return String(asRecord(project).building_name ?? "") === fixtureMarker("PROJECT");
}
export function parseCreatedFixtureStudent(response: JsonRecord, expectedName: string): { id: string; name: string; pin: string } {
  const row = asRecord(response.student);
  const id = String(row.id ?? "");
  const name = String(row.name ?? fixtureMarker(expectedName));
  const pin = String(response.pinPlain ?? "");
  if (!id || !isUsableFixturePin(pin)) throw new RunnerError("FIXTURE_STUDENT_CREDENTIALS_REQUIRED", "새 TEST 학생의 PIN을 확인할 수 없습니다.");
  return { id, name, pin };
}
export function isUsableFixturePin(value: unknown): value is string { return /^\d{4}$/.test(String(value ?? "")); }
export function isFixtureStudentMarker(row: JsonRecord, expectedName: string): boolean {
  return String(row.name ?? "") === fixtureMarker(expectedName);
}
/** 기존 marker 학생의 ID를 유지하면서, PIN을 모를 때만 정상 재발급 경로를 호출합니다. */
export async function recoverFixtureStudentPin(
  existing: JsonRecord,
  expectedName: string,
  resetPin: (studentId: string) => Promise<JsonRecord>,
): Promise<{ studentId: string; pin: string; reissued: boolean }> {
  const studentId = String(existing.id ?? "");
  if (!studentId || !isFixtureStudentMarker(existing, expectedName)) {
    throw new RunnerError("FIXTURE_MARKER_REQUIRED", "TEST marker 학생만 PIN을 복구할 수 있습니다.");
  }
  const knownPin = String(existing.pinPlain ?? "");
  if (isUsableFixturePin(knownPin)) return { studentId, pin: knownPin, reissued: false };
  const reset = await resetPin(studentId);
  const pin = String(reset.pinPlain ?? "");
  if (!isUsableFixturePin(pin)) throw new RunnerError("FIXTURE_STUDENT_CREDENTIALS_REQUIRED", "PIN 재발급 결과를 확인할 수 없습니다.");
  return { studentId, pin, reissued: true };
}
async function call(url: string, key: string, body: Record<string, unknown>, headers: Record<string, string> = {}, stage = "student-api"): Promise<JsonRecord> {
  const action = typeof body.action === "string" ? body.action.slice(0, 80) : undefined;
  let response: Response;
  try { response = await fetch(`${url}/functions/v1/student-api`, { method: "POST", headers: { apikey: key, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch { throw new RemoteApiError({ stage, functionName: "student-api", method: "POST", status: null, contentType: "", code: "NETWORK_ERROR", message: "TEST API에 연결하지 못했습니다.", action }); }
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text().catch(() => "");
  const parsed = parseJsonRecord(raw);
  if (!response.ok) throw new RemoteApiError({ stage, functionName: "student-api", method: "POST", status: response.status, contentType, code: safeText(asRecord(parsed.error).code) === "응답 내용이 없습니다." ? `HTTP_${response.status}` : safeText(asRecord(parsed.error).code), message: safeText(asRecord(parsed.error).message), action });
  return parsed;
}
async function studentLogin(url: string, key: string, classCode: string, name: string, pin: string): Promise<{ token: string; id: string }> {
  let response: Response;
  try { response = await fetch(`${url}/functions/v1/student-auth`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ action: "login", classCode, name, pin }) }); }
  catch { throw new RemoteApiError({ stage: "student-auth", functionName: "student-auth", method: "POST", status: null, contentType: "", code: "NETWORK_ERROR", message: "student-auth에 연결하지 못했습니다.", action: "login" }); }
  const contentType = response.headers.get("content-type") ?? ""; const raw = await response.text().catch(() => ""); const parsed = parseJsonRecord(raw);
  const student = asRecord(parsed.student); if (!response.ok || !parsed.token) throw new RemoteApiError({ stage: "student-auth", functionName: "student-auth", method: "POST", status: response.status, contentType, code: safeText(asRecord(parsed.error).code) === "응답 내용이 없습니다." ? `HTTP_${response.status}` : safeText(asRecord(parsed.error).code), message: safeText(asRecord(parsed.error).message), action: "login" });
  return { token: String(parsed.token), id: String(student.id ?? "") };
}
async function teacherLogin(url: string, key: string, email: string, password: string): Promise<string> {
  let response: Response;
  try { response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); }
  catch { throw new RemoteApiError({ stage: "teacher-auth", functionName: "auth/v1/token", method: "POST", status: null, contentType: "", code: "NETWORK_ERROR", message: "TEST 교사 Auth에 연결하지 못했습니다.", action: "password-grant" }); }
  const contentType = response.headers.get("content-type") ?? ""; const raw = await response.text().catch(() => ""); const parsed = parseJsonRecord(raw);
  if (!response.ok || !parsed.access_token) throw new RemoteApiError({ stage: "teacher-auth", functionName: "auth/v1/token", method: "POST", status: response.status, contentType, code: safeText(asRecord(parsed.error).code) === "응답 내용이 없습니다." ? `HTTP_${response.status}` : safeText(asRecord(parsed.error).code), message: safeText(asRecord(parsed.error).message), action: "password-grant" });
  return String(parsed.access_token);
}

export async function probeRemoteFunctions(url: string, key: string): Promise<Record<string, RemoteFailureDetails | { status: number; contentType: string }>> {
  const result: Record<string, RemoteFailureDetails | { status: number; contentType: string }> = {};
  for (const functionName of ["student-auth", "student-api"]) {
    try {
      const response = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/${functionName}`, { method: "OPTIONS", headers: { apikey: key } });
      result[functionName] = response.ok ? { status: response.status, contentType: response.headers.get("content-type") ?? "" } : { stage: "probe", functionName, method: "OPTIONS", status: response.status, contentType: response.headers.get("content-type") ?? "", code: `HTTP_${response.status}`, message: "함수 OPTIONS probe가 실패했습니다." };
    } catch { result[functionName] = { stage: "probe", functionName, method: "OPTIONS", status: null, contentType: "", code: "NETWORK_ERROR", message: "함수 probe에 연결하지 못했습니다." }; }
  }
  return result;
}

export async function createRemoteFixture(env: Record<string, string>): Promise<RemoteContext> {
  const url = env.SUPABASE_TEST_URL.replace(/\/+$/, ""); const key = env.SUPABASE_TEST_PUBLISHABLE_KEY; const teacherToken = await teacherLogin(url, key, env.SUPABASE_TEST_TEACHER_EMAIL, env.SUPABASE_TEST_TEACHER_PASSWORD);
  const auth = { Authorization: `Bearer ${teacherToken}` };
  const classes = await call(url, key, { action: "teacher:classes" }, auth, "teacher-api");
  const existingClass = (Array.isArray(classes.classes) ? classes.classes : []).map(asRecord).find((item) => item.name === fixtureMarker("CLASS"));
  console.log(`TEST FIXTURE MARKER: class=${existingClass ? "EXISTS" : "MISSING"}`);
  const classRow = existingClass ?? asRecord((await call(url, key, { action: "teacher:class-upsert", name: fixtureMarker("CLASS") }, auth, "teacher-api")).class);
  if (!classRow?.id || !classRow?.class_code) throw new RunnerError("FIXTURE_CLASS_FAILED", "TEST 학급을 확인할 수 없습니다.");
  const listed = await call(url, key, { action: "teacher:students:list", classId: String(classRow.id) }, auth, "teacher-api"); const students: Array<{ id: string; name: string; pin: string; token?: string }> = [];
  for (const [index, name] of ["학생1", "학생2", "학생3"].entries()) {
    const fixtureName = fixtureMarker(name);
    const existing = (Array.isArray(listed.students) ? listed.students : []).map(asRecord).find((s) => s.name === fixtureName && Number(s.student_no) === index + 1);
    console.log(`TEST FIXTURE MARKER: student${index + 1}=${existing ? "EXISTS" : "MISSING"}`);
    if (existing) {
      const recovered = await recoverFixtureStudentPin(existing, name, (studentId) => call(url, key, { action: "teacher:students:pin-reset", studentId }, auth, "teacher-api"));
      const verified = await studentLogin(url, key, String(classRow.class_code), String(existing.name), recovered.pin);
      if (verified.id !== recovered.studentId) throw new RunnerError("FIXTURE_STUDENT_ID_MISMATCH", "학생 로그인 계정이 기존 marker와 일치하지 않습니다.");
      students.push({ id: recovered.studentId, name: String(existing.name), pin: recovered.pin, token: verified.token });
      console.log(`TEST FIXTURE PIN: student${index + 1}=READY`);
      continue;
    }
    const created = await call(url, key, { action: "teacher:students:create", classId: String(classRow.id), name: fixtureName, studentNo: index + 1 }, auth, "teacher-api");
    const row = parseCreatedFixtureStudent(created, name);
    const verified = await studentLogin(url, key, String(classRow.class_code), row.name, row.pin);
    if (verified.id !== row.id) throw new RunnerError("FIXTURE_STUDENT_ID_MISMATCH", "새 학생 로그인 계정이 생성된 학생과 일치하지 않습니다.");
    students.push({ ...row, token: verified.token });
    console.log(`TEST FIXTURE PIN: student${index + 1}=READY`);
  }
  return { url, key, teacherToken, classId: String(classRow.id), classCode: String(classRow.class_code), students };
}

export async function runRemotePhase5(env: Record<string, string>): Promise<RunnerResult> {
  const checks: Record<string, RunnerStatus> = {}; const errors: string[] = [];
  try {
    const fixture = await createRemoteFixture(env); const sessions = await Promise.all(fixture.students.map((s) => s.token ? Promise.resolve({ token: s.token, id: s.id }) : studentLogin(fixture.url, fixture.key, fixture.classCode, s.name, s.pin)));
    const student = (index: number, body: Record<string, unknown>) => call(fixture.url, fixture.key, { ...body, installationId: env.SUPABASE_TEST_INSTALLATION_ID || fixture.classId }, { "x-student-token": sessions[index].token });
    const peer = await student(0, { action: "peer-problem:publish", title: fixtureMarker("PEER"), blocks, cardType: "top", hintType: "heightMap" }); const problem = peer.problem;
    const list = await student(1, { action: "peer-problem:list" }); if (!(Array.isArray(list.problems) ? list.problems : []).map(asRecord).some((p) => p.problemId === asRecord(problem).problemId)) throw new RunnerError("REMOTE_PEER_LIST", "친구 문제 목록에 나타나지 않습니다."); checks.peer_publish_list = "PASS";
    const hinted = await student(2, { action: "peer-problem:hint", problemId: problem.problemId, version: problem.version }); if (!hinted.hint) throw new RunnerError("REMOTE_HINT", "힌트를 받지 못했습니다.");
    const solved = await student(1, { action: "peer-problem:submit", problemId: problem.problemId, version: problem.version, blocks }); const helped = await student(2, { action: "peer-problem:submit", problemId: problem.problemId, version: problem.version, blocks });
    if (solved.attempt?.score_awarded !== 2 || helped.attempt?.score_awarded !== 1) throw new RunnerError("REMOTE_PEER_SCORE", "친구 문제 점수가 예상과 다릅니다."); checks.peer_grade = "PASS";
    await call(fixture.url, fixture.key, { action: "teacher:peer-problem:hide", classId: fixture.classId, installationId: env.SUPABASE_TEST_INSTALLATION_ID || fixture.classId, problemId: problem.problemId, version: problem.version }, { Authorization: `Bearer ${fixture.teacherToken}` }, "teacher-api");
    const afterHide = await student(1, { action: "peer-problem:list" }); if ((Array.isArray(afterHide.problems) ? afterHide.problems : []).map(asRecord).some((item) => item.problemId === asRecord(problem).problemId)) throw new RunnerError("REMOTE_HIDE", "교사 숨김 후 문제가 계속 노출됩니다."); checks.teacher_hide = "PASS";
    const loadedProject = await student(0, { action: "project:load" });
    const existingProject = asRecord(loadedProject.project);
    const hasExistingProject = Object.keys(existingProject).length > 0;
    if (hasExistingProject && !isFixtureProjectMarker(existingProject)) throw new RunnerError("REMOTE_PROJECT_MARKER_REQUIRED", "TEST marker 작품이 아닌 기존 작품은 덮어쓰지 않습니다.");
    const saved = await student(0, { action: "project:save", expectedVersion: hasExistingProject ? readRemoteProjectVersion(existingProject) : 0, title: fixtureMarker("PROJECT"), reason: "TEST", description: "TEST", blocks, materials: { "0:0:0": "wood" }, gridWidth: 10, gridDepth: 10, maxHeight: 8, submitted: true }); const version = Number(saved.projectVersion ?? 1);
    const expanded = await student(0, { action: "project:save", expectedVersion: version, title: fixtureMarker("PROJECT"), reason: "TEST", description: "TEST", blocks: [...blocks, { x: 9, y: 3, z: 9 }], materials: { "0:0:0": "wood" }, gridWidth: 12, gridDepth: 12, maxHeight: 8, submitted: true }); if (readRemoteProjectGridWidth(expanded.project) !== 12) throw new RunnerError("REMOTE_PROJECT", "12×12 작품 저장이 확인되지 않습니다."); checks.project_save = "PASS";
    const progress: Record<string, unknown> = { action: "progress:save", lesson: 12, stage: "solve", curriculumVersion: "v1", setId: "phase5e-test", problemId: "p1", problemVersion: 1, questionIndex: 0, answer: { value: 9 }, firstAttemptResult: "incorrect", attemptCount: 1, hintLevel: 0, finalResult: null, remediationStatus: "needed" };
    await student(0, progress); await student(0, { ...progress, firstAttemptResult: "correct", attemptCount: 2, hintLevel: 1, finalResult: "correct", remediationStatus: "complete" }); const assignment = await student(0, { action: "practice-set:get-or-create", lesson: 12, curriculumVersion: "v1", targetTotal: 5, seed: 505 }); if (assignment.assignment?.target_total !== 5) throw new RunnerError("REMOTE_PROGRESS", "진도/연습 저장이 확인되지 않습니다."); checks.progress_practice = "PASS";
    await student(0, { action: "reflection:save", lesson: 12, curriculumVersion: "v1", confidence: 4, favoriteConcept: "층별 모양", selfPraise: "끝까지 해냈어요" }); checks.reflection = "PASS";
    const publicPayload = JSON.stringify(list); if (/(hidden_validation|pin_plain|token)/iu.test(publicPayload)) throw new RunnerError("REMOTE_PUBLIC_LEAK", "공개 응답에 비공개 필드가 있습니다."); checks.security_public_dto = "PASS";
    const forbiddenStudentTeacherAction = await fetch(`${fixture.url}/functions/v1/student-api`, { method: "POST", headers: { apikey: fixture.key, "content-type": "application/json", "x-student-token": sessions[0].token }, body: JSON.stringify({ action: "teacher:classes" }) }); if (forbiddenStudentTeacherAction.ok) throw new RunnerError("REMOTE_TEACHER_SCOPE", "학생 세션으로 교사 API가 허용되었습니다."); checks.student_teacher_forbidden = "PASS";
    const directVault = await fetch(`${fixture.url}/rest/v1/sb_student_pin_vault?select=student_id`, { headers: { apikey: fixture.key } }); if (directVault.ok) throw new RunnerError("REMOTE_VAULT_SCOPE", "publishable key로 PIN vault 조회가 허용되었습니다."); checks.anon_vault_blocked = "PASS";
  } catch (error) { errors.push(error instanceof RemoteApiError ? formatRemoteApiFailure(error) : error instanceof RunnerError ? `${error.code}: ${error.message}` : String(error)); }
  return { status: errors.length ? "FAIL" : "PASS", mode: "REMOTE", checks, errors };
}

function readEnv(file: string): Record<string, string> { if (!fs.existsSync(file)) return {}; return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; })); }
function productionRef(root: string): string { const file = path.join(root, "supabase", ".temp", "linked-project.json"); if (!fs.existsSync(file)) return ""; try { return String(JSON.parse(fs.readFileSync(file, "utf8")).ref ?? ""); } catch { return ""; } }
function writeArtifact(root: string, report: RunnerResult): string { const dir = path.join(root, "qa", "redesign-phase5", "runtime"); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, "PHASE5B_REMOTE_RESULT.json"); fs.writeFileSync(file, JSON.stringify(redactSensitive({ ...report, generatedAt: new Date().toISOString() }), null, 2) + "\n"); return file; }

async function main(): Promise<void> {
  const root = process.cwd(); const args = new Set(process.argv.slice(2));
  if (args.has("--mock")) { const report = runMockPhase5(); report.artifactPath = writeArtifact(root, report); console.log(`PHASE5E MOCK: ${report.status} | artifact=${report.artifactPath}`); if (report.status !== "PASS") process.exitCode = 1; return; }
  const fileEnv = readEnv(process.env.SUPABASE_TEST_ENV_FILE ?? path.join(root, ".env.test.local")); const get = (name: string) => process.env[name] ?? fileEnv[name] ?? "";
  try { assertTestTarget({ targetEnv: get("TARGET_ENV"), testRef: get("SUPABASE_TEST_PROJECT_REF"), testUrl: get("SUPABASE_TEST_URL"), productionRef: productionRef(root) }); } catch (error) { const e = error as RunnerError; console.error(`${e.code}: ${e.message}`); process.exitCode = 1; return; }
  if (args.has("--probe")) { const probe = await probeRemoteFunctions(get("SUPABASE_TEST_URL"), get("SUPABASE_TEST_PUBLISHABLE_KEY")); console.log(`TEST API PROBE: ${JSON.stringify(redactSensitive(probe))}`); return; }
  if (!args.has("--apply")) { console.error("REMOTE_APPLY_REQUIRED: 원격 fixture/E2E는 --apply 없이 실행하지 않습니다."); process.exitCode = 1; return; }
  if (!get("SUPABASE_TEST_TEACHER_EMAIL") || !get("SUPABASE_TEST_TEACHER_PASSWORD")) { console.error("REMOTE_TEACHER_CREDENTIALS_REQUIRED: TEST 교사 자격증명을 환경변수로 제공해야 합니다."); process.exitCode = 1; return; }
  const report = args.has("--fixtures") ? await createRemoteFixture({ SUPABASE_TEST_URL: get("SUPABASE_TEST_URL"), SUPABASE_TEST_PUBLISHABLE_KEY: get("SUPABASE_TEST_PUBLISHABLE_KEY"), SUPABASE_TEST_TEACHER_EMAIL: get("SUPABASE_TEST_TEACHER_EMAIL"), SUPABASE_TEST_TEACHER_PASSWORD: get("SUPABASE_TEST_TEACHER_PASSWORD") }).then(() => ({ status: "PASS" as RunnerStatus, mode: "REMOTE" as const, checks: { fixture: "PASS" as RunnerStatus }, errors: [] })) : await runRemotePhase5({ SUPABASE_TEST_URL: get("SUPABASE_TEST_URL"), SUPABASE_TEST_PUBLISHABLE_KEY: get("SUPABASE_TEST_PUBLISHABLE_KEY"), SUPABASE_TEST_TEACHER_EMAIL: get("SUPABASE_TEST_TEACHER_EMAIL"), SUPABASE_TEST_TEACHER_PASSWORD: get("SUPABASE_TEST_TEACHER_PASSWORD"), SUPABASE_TEST_INSTALLATION_ID: get("SUPABASE_TEST_INSTALLATION_ID") });
  report.artifactPath = writeArtifact(root, report); console.log(`PHASE5E REMOTE: ${report.status} | artifact=${report.artifactPath}`); if (report.status !== "PASS") process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(formatRemoteApiFailure(error)); process.exitCode = 1; });
