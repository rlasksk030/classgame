import test from "node:test";
import assert from "node:assert/strict";
import { Phase5ApiError, Phase5ApiStore, type ProgressRecord } from "../shared/phase5Api.ts";
import type { BlockCoord } from "../shared/types.ts";

const blocks: BlockCoord[] = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 },
  { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 1, z: 0 },
];
const altBlocks: BlockCoord[] = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 },
  { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 1, y: 1, z: 1 },
];
const scope = { installationId: "test-install", classId: "class-a" };
const alice = { ...scope, studentId: "student-a" };
const bob = { ...scope, studentId: "student-b" };
const other = { installationId: "test-install", classId: "class-b", studentId: "student-b" };

function setup() { const store = new Phase5ApiStore(); store.registerClass(scope, "teacher-a"); store.registerClass({ ...scope, classId: "class-b" }, "teacher-b"); store.registerStudent(alice, "학생1"); store.registerStudent(bob, "학생2"); store.registerStudent(other, "학생2"); for (const id of ["student-5", "student-10", "student-15", "student-20"]) store.registerStudent({ ...scope, studentId: id }, id); return store; }
function published(store: Phase5ApiStore, author = alice, cardType: "views" | "top" | "heightMap" | "layers" = "top") { return store.publish(author, { title: "친구 문제", blocks, cardType, hintType: "heightMap" }); }

test("A01 publish derives author and class ownership", () => { const store = setup(); const p = published(store); assert.equal(p.classId, scope.classId); assert.equal(p.authorDisplayName, "학생1"); });
test("A02 invalid publish is rejected", () => { const store = setup(); assert.throws(() => store.publish(alice, { title: "", blocks: blocks.slice(0, 9), cardType: "top", hintType: "heightMap" }), (e: unknown) => e instanceof Phase5ApiError && e.code === "PEER_VALIDATION"); });
test("A03 public DTO never contains hidden validation", () => { const store = setup(); const p = published(store); assert.equal("hiddenValidationData" in p, false); assert.equal("blocks" in p, false); });
test("A04 hint state is server truth", () => { const store = setup(); const p = published(store); store.hint(bob, p.problemId, p.version); const result = store.submit(bob, p.problemId, p.version, blocks); assert.equal(result.usedHint, true); assert.equal(result.score, 1); });
test("A05 a valid solution is graded from public conditions", () => { const store = setup(); const p = published(store, alice, "top"); const result = store.submit(bob, p.problemId, p.version, altBlocks); assert.equal(result.correct, true); });
test("A06 duplicate submit cannot award twice", () => { const store = setup(); const p = published(store); const first = store.submit(bob, p.problemId, p.version, blocks); const second = store.submit(bob, p.problemId, p.version, blocks); assert.deepEqual(second, first); assert.equal(store.get(bob, p.problemId, p.version).myAttempt?.score, 2); });
test("A07 author cannot earn peer score", () => { const store = setup(); const p = published(store); const result = store.submit(alice, p.problemId, p.version, blocks); assert.equal(result.score, 0); });
test("A08 cross-class access is blocked", () => { const store = setup(); const p = published(store); assert.throws(() => store.get(other, p.problemId, p.version), (e: unknown) => e instanceof Phase5ApiError && e.code === "PEER_NOT_FOUND"); });
test("A09 only owning teacher can hide", () => { const store = setup(); const p = published(store); assert.throws(() => store.hide({ installationId: "test-install", teacherId: "teacher-b", classIds: ["class-b"] }, scope.classId, p.problemId, p.version), (e: unknown) => e instanceof Phase5ApiError && e.code === "TEACHER_FORBIDDEN"); store.hide({ installationId: "test-install", teacherId: "teacher-a", classIds: [scope.classId] }, scope.classId, p.problemId, p.version); assert.equal(store.list(alice).length, 0); });
test("A10 project optimistic version guard", () => { const store = setup(); const input = { projectId: "project-a", boardSize: { gridWidth: 10, gridDepth: 10, maxHeight: 0 }, blocks, materials: {}, title: "작품", description: "", layerUsageNotes: {} }; const saved = store.saveProject(alice, input); assert.equal(saved.projectVersion, 1); assert.throws(() => store.saveProject(alice, { ...input, expectedVersion: 0 }), (e: unknown) => e instanceof Phase5ApiError && e.code === "PROJECT_VERSION_CONFLICT"); });
function progress(first: ProgressRecord["firstAttemptResult"], final: ProgressRecord["finalResult"]): ProgressRecord { return { lesson: 12, stage: "solve", curriculumVersion: "v1", setId: "set-a", problemId: "p1", problemVersion: 1, questionIndex: 0, answer: { kind: "count", value: 4 }, firstAttemptResult: first, attemptCount: final ? 2 : 1, hintLevel: 1, finalResult: final, remediationStatus: final === "correct" ? "complete" : "needed", completedAt: final ? new Date().toISOString() : null }; }
test("A11 first result survives final result", () => { const store = setup(); store.saveProgress(alice, progress("incorrect", "incorrect")); const result = store.saveProgress(alice, progress("correct", "correct")); assert.equal(result.firstAttemptResult, "incorrect"); assert.equal(result.finalResult, "correct"); assert.equal(result.attemptCount, 2); });
test("A12 practice assignment is stable", () => { const store = setup(); const first = store.getOrCreatePractice(alice, 12, "v1", 5, 123); const second = store.getOrCreatePractice(alice, 12, "v1", 20, 999); assert.deepEqual(second, first); });
test("A13 practice totals support only 5/10/15/20", () => { const store = setup(); for (const total of [5, 10, 15, 20] as const) { const assignment = store.getOrCreatePractice({ ...alice, studentId: `student-${total}` }, total === 5 ? 1 : 2, "v1", total, total); assert.equal(assignment.problemIds.length, total); } });
test("A14 reflection is separate from score records", () => { const store = setup(); store.saveProgress(alice, progress("correct", "correct")); const reflection = store.saveReflection(alice, { lesson: 12, curriculumVersion: "v1", confidence: 4, favoriteConcept: "층별 모양", selfPraise: "끝까지 해냈어요" }); assert.equal(reflection.confidence, 4); assert.equal(store.getReflection(alice, 12, "v1")?.favoriteConcept, "층별 모양"); });
test("A15 spoofed student identity cannot read another student's project", () => { const store = setup(); store.saveProject(alice, { projectId: "p", boardSize: { gridWidth: 10, gridDepth: 10, maxHeight: 0 }, blocks, materials: {}, title: "A", description: "", layerUsageNotes: {} }); assert.equal(store.loadProject(bob, "p"), null); });
