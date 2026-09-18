import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertCleanupTarget, assertNoSensitiveText, assertTestTarget, fixtureIdentity, fixtureMarker, formatRemoteApiFailure, isFixtureProjectMarker, isFixtureStudentMarker, isUsableFixturePin, parseCreatedFixtureStudent, readRemoteProjectGridWidth, readRemoteProjectVersion, recoverFixtureStudentPin, redactSensitive, RemoteApiError, runMockPhase5, runPipeline, RunnerError } from "../scripts/phase5b-runner.ts";

test("F01 mock fixture pipeline passes all phase 5 checks", () => {
  const result = runMockPhase5();
  assert.equal(result.mode, "MOCK");
  assert.equal(result.status, "PASS", result.errors.join("; "));
  assert.equal(result.checks.peer_grade, "PASS");
  assert.equal(result.checks.project_save_restore, "PASS");
});

test("F02 target guard rejects production and non-TEST targets", () => {
  assert.throws(() => assertTestTarget({ targetEnv: "PRODUCTION", testRef: "abc", testUrl: "https://abc.supabase.co", productionRef: "prod" }), (error: unknown) => error instanceof RunnerError && error.code === "TEST_FLAG_REQUIRED");
  assert.throws(() => assertTestTarget({ targetEnv: "TEST", testRef: "prod", testUrl: "https://prod.supabase.co", productionRef: "prod" }), (error: unknown) => error instanceof RunnerError && error.code === "PRODUCTION_TARGET_BLOCKED");
});

test("F03 TEST URL and project ref must match", () => {
  assert.throws(() => assertTestTarget({ targetEnv: "TEST", testRef: "test-ref", testUrl: "https://different.supabase.co", productionRef: "prod" }), (error: unknown) => error instanceof RunnerError && error.code === "TEST_REF_URL_MISMATCH");
});

test("F04 fixture identities are stable TEST markers", () => {
  assert.equal(fixtureIdentity("CLASS"), "PHASE5E_TEST_CLASS");
  assert.equal(fixtureIdentity("STUDENT", 1), "PHASE5E_TEST_STUDENT_1");
  assert.equal(fixtureIdentity("CLASS"), fixtureIdentity("CLASS"));
  assert.match(fixtureMarker("STUDENT_1"), /^PHASE5E_TEST_/);
});

test("F05 sensitive response fields are redacted and never printed", () => {
  const redacted = redactSensitive({ pinPlain: "1234", token: "opaque", nested: { password: "secret" }, safe: "ok" });
  assert.deepEqual(redacted, { pinPlain: "[REDACTED]", token: "[REDACTED]", nested: { password: "[REDACTED]" }, safe: "ok" });
  assertNoSensitiveText({ safe: "ok" });
});

test("F06 cleanup requires explicit TEST marker and blocks production", () => {
  assert.throws(() => assertCleanupTarget({ targetEnv: "TEST", projectRef: "test", productionRef: "prod", marker: fixtureMarker("CLASS") }), (error: unknown) => error instanceof RunnerError && error.code === "CLEANUP_CONFIRMATION_REQUIRED");
  assert.throws(() => assertCleanupTarget({ targetEnv: "TEST", projectRef: "prod", productionRef: "prod", marker: fixtureMarker("CLASS"), explicit: true }), (error: unknown) => error instanceof RunnerError && error.code === "PRODUCTION_CLEANUP_BLOCKED");
  assert.throws(() => assertCleanupTarget({ targetEnv: "TEST", projectRef: "test", productionRef: "prod", marker: "ordinary", explicit: true }), (error: unknown) => error instanceof RunnerError && error.code === "CLEANUP_MARKER_REQUIRED");
});

test("F07 fixture pipeline result is safe to persist", () => {
  const result = runMockPhase5();
  const safe = redactSensitive(result);
  assertNoSensitiveText(safe);
  assert.equal((safe as { mode: string }).mode, "MOCK");
});

test("F08 pipeline stops after the first failed phase and mock is not LIVE", async () => {
  const order: string[] = [];
  const pipeline = await runPipeline([() => { order.push("schema"); throw new Error("schema failed"); }, () => { order.push("fixtures"); }]);
  assert.deepEqual(order, ["schema"]);
  assert.equal(pipeline.completed, 0);
  const result = runMockPhase5();
  assert.equal(result.mode, "MOCK");
  assert.notEqual(result.mode, "REMOTE");
});

test("remote HTTP failures retain stage/status/code without secrets", () => {
  const cases = [
    [401, "INVALID_CREDENTIALS", "teacher-auth"],
    [403, "FORBIDDEN", "teacher-api"],
    [404, "NOT_FOUND", "student-auth"],
    [500, "SERVER_ERROR", "student-api"],
    [null, "NETWORK_ERROR", "student-api"],
  ] as const;
  for (const [status, code, stage] of cases) {
    const line = formatRemoteApiFailure(new RemoteApiError({ stage, functionName: stage, method: "POST", status, contentType: "application/json", code, message: "safe failure" }));
    assert.match(line, new RegExp(`stage=${stage}`)); assert.match(line, new RegExp(`status=${status ?? "NETWORK"}`)); assert.match(line, new RegExp(`code=${code}`));
    assert.doesNotMatch(line, /token|password|pin|secret/iu);
  }
  const malformed = formatRemoteApiFailure(new RemoteApiError({ stage: "student-api", functionName: "student-api", method: "POST", status: 500, contentType: "text/plain", code: "HTTP_500", message: "응답 내용이 없습니다." }));
  assert.match(malformed, /contentType=text\/plain/);
  const action = formatRemoteApiFailure(new RemoteApiError({ stage: "teacher-api", functionName: "student-api", method: "POST", status: 500, contentType: "text/plain", code: "HTTP_500", message: "응답 내용이 없습니다.", action: "teacher:classes" }));
  assert.match(action, /action=teacher:classes/);
});

test("R01 marker student without a row remains eligible for the normal create path", () => {
  const source = fs.readFileSync(new URL("../scripts/phase5b-runner.ts", import.meta.url), "utf8");
  assert.match(source, /teacher:students:create/);
  assert.equal(isFixtureStudentMarker({ name: fixtureMarker("학생1") }, "학생1"), true);
});

test("R02 existing marker student with a known PIN is reused without reset", async () => {
  let resetCalls = 0;
  const result = await recoverFixtureStudentPin({ id: "student-id", name: fixtureMarker("학생1"), pinPlain: "8642" }, "학생1", async () => { resetCalls += 1; return { pinPlain: "9753" }; });
  assert.deepEqual(result, { studentId: "student-id", pin: "8642", reissued: false });
  assert.equal(resetCalls, 0);
});

test("R03 existing marker student without a known PIN uses the normal reset action", async () => {
  let resetStudentId = "";
  const result = await recoverFixtureStudentPin({ id: "keep-this-id", name: fixtureMarker("학생2") }, "학생2", async (studentId) => { resetStudentId = studentId; return { pinPlain: "9753" }; });
  assert.equal(resetStudentId, "keep-this-id");
  assert.equal(result.studentId, "keep-this-id");
  assert.equal(result.reissued, true);
  assert.equal(isUsableFixturePin(result.pin), true);
});

test("R04 reset result must be a four digit PIN", async () => {
  await assert.rejects(() => recoverFixtureStudentPin({ id: "student-id", name: fixtureMarker("학생1") }, "학생1", async () => ({ pinPlain: "invalid" })), (error: unknown) => error instanceof RunnerError && error.code === "FIXTURE_STUDENT_CREDENTIALS_REQUIRED");
});

test("R05 non-marker students cannot enter PIN recovery", async () => {
  await assert.rejects(() => recoverFixtureStudentPin({ id: "ordinary-id", name: "일반 학생" }, "학생1", async () => ({ pinPlain: "9753" })), (error: unknown) => error instanceof RunnerError && error.code === "FIXTURE_MARKER_REQUIRED");
});

test("R06 a reset always keeps the existing student ID", async () => {
  const result = await recoverFixtureStudentPin({ id: "stable-id", name: fixtureMarker("학생3"), pinPlain: null }, "학생3", async () => ({ pinPlain: "8642", id: "different-id" }));
  assert.equal(result.studentId, "stable-id");
});

test("R07 repeated recovery with an acquired PIN does not rotate it again", async () => {
  let resetCalls = 0;
  const first = await recoverFixtureStudentPin({ id: "student-id", name: fixtureMarker("학생1") }, "학생1", async () => { resetCalls += 1; return { pinPlain: "8642" }; });
  const second = await recoverFixtureStudentPin({ id: first.studentId, name: fixtureMarker("학생1"), pinPlain: first.pin }, "학생1", async () => { resetCalls += 1; return { pinPlain: "9753" }; });
  assert.equal(resetCalls, 1);
  assert.equal(second.pin, first.pin);
});

test("R08 recovery reports whether a PIN was reissued without logging it", async () => {
  const result = await recoverFixtureStudentPin({ id: "student-id", name: fixtureMarker("학생1") }, "학생1", async () => ({ pinPlain: "9753" }));
  assert.equal(result.reissued, true);
  const safe = redactSensitive({ student1: "READY", pinPlain: result.pin });
  assert.deepEqual(safe, { student1: "READY", pinPlain: "[REDACTED]" });
  assert.doesNotMatch(JSON.stringify(safe), /9753/);
});

test("R09 runner calls the existing teacher PIN reset action", () => {
  const source = fs.readFileSync(new URL("../scripts/phase5b-runner.ts", import.meta.url), "utf8");
  assert.match(source, /action: "teacher:students:pin-reset"/);
});

test("R10 marker recovery is bounded to the expected fixture name", () => {
  assert.equal(isFixtureStudentMarker({ name: fixtureMarker("학생1") }, "학생2"), false);
  assert.equal(isUsableFixturePin("8642"), true);
  assert.equal(isUsableFixturePin("864"), false);
});

test("N01 missing student parser accepts the normal create response", () => {
  const parsed = parseCreatedFixtureStudent({ student: { id: "new-id", name: fixtureMarker("학생1") }, pinPlain: "8642" }, "학생1");
  assert.deepEqual(parsed, { id: "new-id", name: fixtureMarker("학생1"), pin: "8642" });
});

test("N02 existing student with PIN does not call reset", async () => {
  let calls = 0;
  const result = await recoverFixtureStudentPin({ id: "student-id", name: fixtureMarker("학생1"), pinPlain: "8642" }, "학생1", async () => { calls += 1; return { pinPlain: "9753" }; });
  assert.equal(result.reissued, false);
  assert.equal(calls, 0);
});

test("N03 create response PIN is read from the top-level pinPlain field", () => {
  assert.equal(parseCreatedFixtureStudent({ student: { id: "new-id" }, pinPlain: "9753" }, "학생2").pin, "9753");
});

test("N04 a create response without a usable PIN fails closed", () => {
  assert.throws(() => parseCreatedFixtureStudent({ student: { id: "new-id" } }, "학생1"), (error: unknown) => error instanceof RunnerError && error.code === "FIXTURE_STUDENT_CREDENTIALS_REQUIRED");
});

test("N05 PIN response is redacted before any artifact can be written", () => {
  const safe = redactSensitive({ student: { id: "new-id" }, pinPlain: "8642" });
  assert.deepEqual(safe, { student: { id: "new-id" }, pinPlain: "[REDACTED]" });
  assert.doesNotMatch(JSON.stringify(safe), /8642/);
});

test("N06 recovery preserves the existing student ID", async () => {
  const result = await recoverFixtureStudentPin({ id: "stable-id", name: fixtureMarker("학생2") }, "학생2", async () => ({ pinPlain: "9753" }));
  assert.equal(result.studentId, "stable-id");
});

test("N07 reset remains the existing teacher action", () => {
  const source = fs.readFileSync(new URL("../scripts/phase5b-runner.ts", import.meta.url), "utf8");
  assert.match(source, /teacher:students:pin-reset/);
});

test("N08 a partially created marker student can be recovered", async () => {
  const result = await recoverFixtureStudentPin({ id: "partial-id", name: fixtureMarker("학생2"), pinPlain: null }, "학생2", async () => ({ pinPlain: "8642" }));
  assert.equal(result.reissued, true);
  assert.equal(result.studentId, "partial-id");
});

test("N09 student3 uses the same create parser contract", () => {
  const parsed = parseCreatedFixtureStudent({ student: { id: "student3", name: fixtureMarker("학생3") }, pinPlain: "9753" }, "학생3");
  assert.equal(parsed.name, fixtureMarker("학생3"));
  assert.equal(isUsableFixturePin(parsed.pin), true);
});

test("N10 reacquiring an existing marker does not create a duplicate row", async () => {
  let resetCalls = 0;
  const existing = { id: "stable-id", name: fixtureMarker("학생1"), pinPlain: "8642" };
  await recoverFixtureStudentPin(existing, "학생1", async () => { resetCalls += 1; return { pinPlain: "9753" }; });
  await recoverFixtureStudentPin(existing, "학생1", async () => { resetCalls += 1; return { pinPlain: "9753" }; });
  assert.equal(resetCalls, 0);
});

test("N11 remote project save assertion follows the student-api snake_case contract", () => {
  assert.equal(readRemoteProjectGridWidth({ grid_width: 12, grid_depth: 12, max_height: 8 }), 12);
  assert.notEqual(readRemoteProjectGridWidth({ gridWidth: 12 }), 12);
});

test("N12 existing TEST marker projects reuse their version for an idempotent save", () => {
  assert.equal(readRemoteProjectVersion({ building_name: fixtureMarker("PROJECT"), version: 4 }), 4);
  assert.equal(readRemoteProjectVersion(null), 0);
  assert.equal(isFixtureProjectMarker({ building_name: fixtureMarker("PROJECT") }), true);
  assert.equal(isFixtureProjectMarker({ building_name: "학생 작품" }), false);
});

test("N13 remote project recovery loads before saving and protects non-marker rows", () => {
  const source = fs.readFileSync(new URL("../scripts/phase5b-runner.ts", import.meta.url), "utf8");
  const load = source.indexOf('action: "project:load"');
  const save = source.indexOf('action: "project:save"');
  assert.ok(load >= 0 && save > load);
  assert.match(source, /REMOTE_PROJECT_MARKER_REQUIRED/);
});
