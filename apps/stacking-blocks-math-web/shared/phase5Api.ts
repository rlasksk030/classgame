import { canonicalize, validStructure } from "./blocks.ts";
import {
  gradePeer,
  makeChallengeCard,
  validatePeerBlocks,
  type ChallengeCard,
  type ChallengeCardType,
} from "./phase4.ts";
import type { BlockCoord, GridConfig } from "./types.ts";

/**
 * Phase 5 서버 계약의 순수 구현입니다.
 * Edge Function은 이 계약을 DB adapter와 함께 사용하고, 테스트는 아래 메모리
 * 저장소를 사용합니다. 학생이 보내는 id·점수·정답 플래그는 판정에 사용하지 않습니다.
 */
export const PHASE5_ACTIONS = [
  "peer-problem:publish", "peer-problem:list", "peer-problem:get", "peer-problem:hint",
  "peer-problem:submit", "peer-problem:attempts", "teacher:peer-problem:list", "teacher:peer-problem:hide",
  "project:save", "project:load", "progress:save", "progress:get", "attempt:save",
  "reflection:save", "reflection:get", "practice-set:get-or-create",
] as const;

export type Phase5Action = (typeof PHASE5_ACTIONS)[number];
export interface Phase5Scope { installationId: string; classId: string; }
export interface StudentIdentity extends Phase5Scope { studentId: string; }
export interface TeacherIdentity { installationId: string; teacherId: string; classIds: string[]; }

export interface PeerPublicProblem {
  problemId: string;
  version: number;
  classId: string;
  authorDisplayName: string;
  title: string;
  publicProblemData: { card: ChallengeCard; grid: GridConfig; totalBlocks: number };
  publishedAt: string;
  solveCount: number;
  myAttempt: { completed: boolean; score: 0 | 1 | 2; usedHint: boolean } | null;
}
interface PeerPrivateProblem extends PeerPublicProblem {
  installationId: string;
  authorStudentId: string;
  hiddenValidationData: { blocks: BlockCoord[]; card: ChallengeCard; hint: ChallengeCard };
  hintType: ChallengeCardType;
  status: "published" | "hidden";
}
export interface PeerAttempt { problemId: string; version: number; studentId: string; usedHint: boolean; submittedBlocks: BlockCoord[]; correct: boolean; score: 0 | 1 | 2; completed: boolean; }
export interface PeerPublishInput { problemId?: string; version?: number; title: string; blocks: BlockCoord[]; cardType: ChallengeCardType; hintType: ChallengeCardType; grid?: GridConfig; }

export interface ProjectSnapshot { projectId: string; projectVersion: number; boardSize: GridConfig; blocks: BlockCoord[]; materials: Record<string, string>; title: string; description: string; representativeView?: string; layerUsageNotes: Record<string, string>; }
export interface ProgressRecord { lesson: number; stage: "learn" | "solve" | "practice"; curriculumVersion: string; setId: string; problemId: string; problemVersion: number; questionIndex: number; answer: unknown; firstAttemptResult: "correct" | "incorrect" | null; attemptCount: number; hintLevel: number; finalResult: "correct" | "incorrect" | null; remediationStatus: "none" | "needed" | "complete"; completedAt: string | null; }
export interface Reflection { lesson: number; curriculumVersion: string; confidence: number | null; favoriteConcept: string | null; selfPraise: string | null; }
export interface PracticeAssignment { setId: string; lesson: number; curriculumVersion: string; seed: number; problemIds: string[]; targetTotal: 5 | 10 | 15 | 20; active: true; }

function scopeKey(scope: Phase5Scope): string { return `${scope.installationId}:${scope.classId}`; }
function studentKey(identity: StudentIdentity): string { return `${scopeKey(identity)}:${identity.studentId}`; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function now(): string { return new Date().toISOString(); }

export class Phase5ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export class Phase5ApiStore {
  private problems = new Map<string, PeerPrivateProblem>();
  private attempts = new Map<string, PeerAttempt>();
  private hints = new Set<string>();
  private classTeachers = new Map<string, string>();
  private studentNames = new Map<string, string>();
  private projects = new Map<string, ProjectSnapshot>();
  private progress = new Map<string, ProgressRecord>();
  private practices = new Map<string, PracticeAssignment>();
  private reflections = new Map<string, Reflection>();

  registerClass(scope: Phase5Scope, teacherId: string): void { this.classTeachers.set(scopeKey(scope), teacherId); }
  registerStudent(identity: StudentIdentity, displayName: string): void { this.studentNames.set(studentKey(identity), displayName); }
  private ensureStudent(identity: StudentIdentity): void {
    if (!this.studentNames.has(studentKey(identity))) throw new Phase5ApiError("STUDENT_NOT_FOUND", "학생을 확인할 수 없습니다.");
  }
  private ensureTeacher(identity: TeacherIdentity, classId: string): void {
    if (!identity.classIds.includes(classId) || this.classTeachers.get(`${identity.installationId}:${classId}`) !== identity.teacherId) throw new Phase5ApiError("TEACHER_FORBIDDEN", "담당 학급이 아닙니다.");
  }

  publish(identity: StudentIdentity, input: PeerPublishInput): PeerPublicProblem {
    this.ensureStudent(identity);
    const grid = input.grid ?? { gridWidth: 3, gridDepth: 3, maxHeight: 12 };
    const blocks = canonicalize(input.blocks);
    const structureError = validatePeerBlocks(blocks);
    if (structureError || !validStructure(blocks, grid) || grid.gridWidth !== 3 || grid.gridDepth !== 3) throw new Phase5ApiError("PEER_VALIDATION", structureError ?? "3×3 범위의 유효한 모형이어야 합니다.");
    if (!input.title.trim()) throw new Phase5ApiError("PEER_VALIDATION", "문제 제목이 필요합니다.");
    const problemId = input.problemId ?? `peer-${crypto.randomUUID()}`;
    const version = input.version ?? 1;
    const key = `${scopeKey(identity)}:${problemId}:v${version}`;
    if (this.problems.has(key)) throw new Phase5ApiError("PEER_VERSION_CONFLICT", "같은 버전이 이미 게시되어 있습니다.");
    const card = makeChallengeCard(blocks, input.cardType);
    const hint = makeChallengeCard(blocks, input.hintType);
    const privateProblem: PeerPrivateProblem = {
      problemId, version, classId: identity.classId, installationId: identity.installationId, authorStudentId: identity.studentId,
      authorDisplayName: this.studentNames.get(studentKey(identity)) ?? "학생",
      title: input.title.trim(), publicProblemData: { card: clone(card), grid, totalBlocks: 10 },
      hiddenValidationData: { blocks: clone(blocks), card: clone(card), hint: clone(hint) },
      hintType: input.hintType, status: "published", publishedAt: now(), solveCount: 0, myAttempt: null,
    };
    this.problems.set(key, privateProblem);
    return this.publicProblem(privateProblem, null);
  }

  private publicProblem(problem: PeerPrivateProblem, attempt: PeerAttempt | null): PeerPublicProblem {
    return { problemId: problem.problemId, version: problem.version, classId: problem.classId, authorDisplayName: problem.authorDisplayName, title: problem.title, publicProblemData: clone(problem.publicProblemData), publishedAt: problem.publishedAt, solveCount: problem.solveCount, myAttempt: attempt ? { completed: attempt.completed, score: attempt.score, usedHint: attempt.usedHint } : null };
  }
  private find(identity: Phase5Scope, problemId: string, version: number): PeerPrivateProblem {
    const problem = [...this.problems.values()].find((p) => p.installationId === identity.installationId && p.classId === identity.classId && p.problemId === problemId && p.version === version && p.publicProblemData.grid.gridWidth === 3 && p.status !== "hidden");
    if (!problem) throw new Phase5ApiError("PEER_NOT_FOUND", "문제를 찾을 수 없습니다.");
    return problem;
  }
  list(identity: StudentIdentity): PeerPublicProblem[] {
    this.ensureStudent(identity);
    return [...this.problems.values()].filter((p) => p.installationId === identity.installationId && p.classId === identity.classId && p.status === "published" && p.authorStudentId !== identity.studentId).map((p) => this.publicProblem(p, this.attempts.get(`${studentKey(identity)}:${p.problemId}:v${p.version}`) ?? null));
  }
  get(identity: StudentIdentity, problemId: string, version: number): PeerPublicProblem {
    this.ensureStudent(identity); const p = this.find(identity, problemId, version); return this.publicProblem(p, this.attempts.get(`${studentKey(identity)}:${problemId}:v${version}`) ?? null);
  }
  hint(identity: StudentIdentity, problemId: string, version: number): ChallengeCard {
    this.ensureStudent(identity); const p = this.find(identity, problemId, version); this.hints.add(`${studentKey(identity)}:${problemId}:v${version}`); return clone(p.hiddenValidationData.hint);
  }
  submit(identity: StudentIdentity, problemId: string, version: number, submittedBlocks: BlockCoord[]): PeerAttempt {
    this.ensureStudent(identity); const p = this.find(identity, problemId, version); const key = `${studentKey(identity)}:${problemId}:v${version}`;
    const existing = this.attempts.get(key); if (existing) return clone(existing);
    const usedHint = this.hints.has(key); const valid = validStructure(canonicalize(submittedBlocks), p.publicProblemData.grid);
    const correct = valid && gradePeer(canonicalize(submittedBlocks), { id: p.problemId, version: p.version, classId: p.classId, authorId: p.authorStudentId, title: p.title, blocks: p.hiddenValidationData.blocks, card: p.hiddenValidationData.card, hint: p.hiddenValidationData.hint, published: true, hidden: false }, usedHint);
    const result: PeerAttempt = { problemId, version, studentId: identity.studentId, usedHint, submittedBlocks: clone(canonicalize(submittedBlocks)), correct, completed: correct, score: identity.studentId === p.authorStudentId || !correct ? 0 : correct ? (usedHint ? 1 : 2) : 0 };
    this.attempts.set(key, result); if (correct) p.solveCount += 1; return clone(result);
  }
  attemptsFor(identity: StudentIdentity): PeerAttempt[] { this.ensureStudent(identity); return [...this.attempts.values()].filter((a) => a.studentId === identity.studentId).map(clone); }
  hide(identity: TeacherIdentity, classId: string, problemId: string, version: number): void { this.ensureTeacher(identity, classId); const p = [...this.problems.values()].find((v) => v.installationId === identity.installationId && v.classId === classId && v.problemId === problemId && v.version === version); if (!p) throw new Phase5ApiError("PEER_NOT_FOUND", "문제를 찾을 수 없습니다."); p.status = "hidden"; }
  teacherList(identity: TeacherIdentity, classId: string): PeerPublicProblem[] { this.ensureTeacher(identity, classId); return [...this.problems.values()].filter((p) => p.installationId === identity.installationId && p.classId === classId).map((p) => this.publicProblem(p, null)); }

  saveProject(identity: StudentIdentity, snapshot: Omit<ProjectSnapshot, "projectVersion"> & { expectedVersion?: number }): ProjectSnapshot {
    this.ensureStudent(identity); const key = `${studentKey(identity)}:${snapshot.projectId}`; const current = this.projects.get(key); const expected = snapshot.expectedVersion ?? current?.projectVersion ?? 0;
    if (current && expected !== current.projectVersion) throw new Phase5ApiError("PROJECT_VERSION_CONFLICT", "최신 작품을 먼저 불러와 주세요.");
    const next: ProjectSnapshot = { ...clone(snapshot), projectVersion: (current?.projectVersion ?? 0) + 1, blocks: canonicalize(snapshot.blocks), materials: clone(snapshot.materials), layerUsageNotes: clone(snapshot.layerUsageNotes) };
    this.projects.set(key, next); return clone(next);
  }
  loadProject(identity: StudentIdentity, projectId: string): ProjectSnapshot | null { this.ensureStudent(identity); return clone(this.projects.get(`${studentKey(identity)}:${projectId}`) ?? null); }

  saveProgress(identity: StudentIdentity, record: ProgressRecord): ProgressRecord { this.ensureStudent(identity); if (record.lesson < 1 || record.lesson > 12) throw new Phase5ApiError("PROGRESS_INVALID", "차시를 확인해 주세요."); const key = `${studentKey(identity)}:${record.lesson}:${record.setId}:${record.problemId}:v${record.problemVersion}`; const old = this.progress.get(key); const merged: ProgressRecord = { ...clone(record), firstAttemptResult: old?.firstAttemptResult ?? record.firstAttemptResult, attemptCount: Math.max(old?.attemptCount ?? 0, record.attemptCount), hintLevel: Math.max(old?.hintLevel ?? 0, record.hintLevel) }; this.progress.set(key, merged); return clone(merged); }
  getProgress(identity: StudentIdentity, lesson: number, setId: string): ProgressRecord[] { this.ensureStudent(identity); return [...this.progress.values()].filter((p) => p.lesson === lesson && p.setId === setId && this.progressKeyBelongs(p, identity)).map(clone); }
  private progressKeyBelongs(record: ProgressRecord, identity: StudentIdentity): boolean { return [...this.progress.entries()].some(([key, value]) => value === record && key.startsWith(`${studentKey(identity)}:`)); }
  saveAttempt(identity: StudentIdentity, record: ProgressRecord): ProgressRecord { return this.saveProgress(identity, record); }
  saveReflection(identity: StudentIdentity, reflection: Reflection): Reflection { this.ensureStudent(identity); const key = `${studentKey(identity)}:${reflection.lesson}:${reflection.curriculumVersion}`; this.reflections.set(key, clone(reflection)); return clone(reflection); }
  getReflection(identity: StudentIdentity, lesson: number, curriculumVersion: string): Reflection | null { this.ensureStudent(identity); return clone(this.reflections.get(`${studentKey(identity)}:${lesson}:${curriculumVersion}`) ?? null); }
  getOrCreatePractice(identity: StudentIdentity, lesson: number, curriculumVersion: string, targetTotal: 5 | 10 | 15 | 20, seed = 0): PracticeAssignment { this.ensureStudent(identity); const key = `${studentKey(identity)}:${lesson}:${curriculumVersion}`; const old = this.practices.get(key); if (old) return clone(old); const actualSeed = seed || Math.abs([...identity.studentId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, lesson)) % 1000000; const assignment: PracticeAssignment = { setId: `practice-${lesson}-${actualSeed}`, lesson, curriculumVersion, seed: actualSeed, problemIds: Array.from({ length: targetTotal }, (_, i) => `generated-l${lesson}-s${actualSeed}-${i + 1}`), targetTotal, active: true }; this.practices.set(key, assignment); return clone(assignment); }
}
