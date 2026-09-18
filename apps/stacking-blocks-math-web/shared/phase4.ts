import { canonicalize, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord, Grid2D, GridConfig } from './types.ts';

export type ChallengeCardType = 'views' | 'top' | 'heightMap' | 'layers';
export type HintCardType = 'heightMap' | 'layers';
export interface ChallengeCard { type: ChallengeCardType; title: string; description: string; projections?: Partial<ReturnType<typeof project>>; heightMap?: number[][]; layers?: Grid2D[]; }
export interface PeerChallenge { id: string; version: number; classId: string; authorId: string; title: string; blocks: BlockCoord[]; card: ChallengeCard; hint: ChallengeCard; published: boolean; hidden: boolean; }
export type PeerChallengeStatus = 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
export interface PublicPeerChallenge { id: string; classId: string; authorId: string; version: number; title: string; card: ChallengeCard; publishedAt?: string; hiddenAt?: string; status: PeerChallengeStatus; }
export interface PeerChallengeValidation { ok: boolean; code?: 'BLOCK_COUNT_INVALID'|'OUT_OF_BOUNDS'|'INVALID_SUPPORT'|'PROJECTION_MISMATCH'|'HINT_MISMATCH'|'VERSION_REQUIRED'; message?: string; }
export interface ChallengeAttempt { challengeId: string; version: number; studentId: string; hintShown: boolean; completed: boolean; score: 0|1|2; submission: BlockCoord[]; }
export const PEER_GRID: GridConfig = { gridWidth: 3, gridDepth: 3, maxHeight: 12 };

export function makeChallengeCard(blocks: BlockCoord[], type: ChallengeCardType): ChallengeCard {
  const projections = project(blocks, PEER_GRID);
  const base = { views: ['위·앞·오른쪽 옆에서 본 모양','세 방향 자료를 보고 조건에 맞게 쌓아요.'], top: ['위에서 본 모양','바닥 모양만 보고 높이를 생각해요.'], heightMap: ['위에서 본 모양에 수 쓰기','자리마다 높이를 숫자로 나타냈어요.'], layers: ['층별로 나타낸 모양','층별 자료를 보고 다시 쌓아요.'] }[type];
  return { type, title: base[0], description: base[1], ...(type === 'views' ? { projections } : type === 'top' ? { projections: { top: projections.top } } : type === 'heightMap' ? { heightMap: toHeightMap(blocks, PEER_GRID) } : { layers: toLayers(blocks, PEER_GRID) }) };
}
export function validatePeerBlocks(blocks: BlockCoord[]): string | null {
  const normalized = canonicalize(blocks);
  if (normalized.length !== 10) return '쌓기나무를 정확히 10개 사용해야 해요.';
  if (!validStructure(normalized, PEER_GRID)) return '모든 블록은 3×3 작업판 안에서 아래 블록 위에 놓아야 해요.';
  return null;
}
export function gradePeer(blocks: BlockCoord[], challenge: PeerChallenge, _hintShown: boolean): boolean {
  if (validatePeerBlocks(blocks)) return false;
  const got = project(blocks, PEER_GRID); const expected = challenge.card;
  const matches = (card: ChallengeCard) => card.type === 'views' ? JSON.stringify(got) === JSON.stringify(card.projections) : card.type === 'top' ? JSON.stringify(got.top) === JSON.stringify(card.projections?.top) : card.type === 'heightMap' ? JSON.stringify(toHeightMap(blocks, PEER_GRID)) === JSON.stringify(card.heightMap) : JSON.stringify(toLayers(blocks, PEER_GRID)) === JSON.stringify(card.layers);
  return matches(expected) && (!_hintShown || matches(challenge.hint));
}
export function peerScore(hintShown: boolean, completed: boolean): 0|1|2 { return completed ? (hintShown ? 1 : 2) : 0; }

function publicChallenge(c: PeerChallenge): PublicPeerChallenge {
  return { id: c.id, classId: c.classId, authorId: c.authorId, version: c.version, title: c.title, card: c.card, status: c.hidden ? 'HIDDEN' : c.published ? 'PUBLISHED' : 'DRAFT' };
}
export function validatePeerChallenge(c: PeerChallenge): PeerChallengeValidation {
  const structure = validatePeerBlocks(c.blocks);
  if (structure) return { ok: false, code: structure.includes('정확히') ? 'BLOCK_COUNT_INVALID' : structure.includes('3×3') ? 'OUT_OF_BOUNDS' : 'INVALID_SUPPORT', message: structure };
  const expectedCard = makeChallengeCard(c.blocks, c.card.type);
  const expectedHint = makeChallengeCard(c.blocks, c.hint.type);
  if (JSON.stringify(expectedCard) !== JSON.stringify(c.card)) return { ok: false, code: 'PROJECTION_MISMATCH', message: '문제 카드가 원본 모형과 일치하지 않아요.' };
  if (JSON.stringify(expectedHint) !== JSON.stringify(c.hint)) return { ok: false, code: 'HINT_MISMATCH', message: '힌트 카드가 원본 모형과 일치하지 않아요.' };
  return { ok: true };
}
export interface LocalPhase4Store {
  challenges: Map<string, PeerChallenge>;
  attempts: Map<string, ChallengeAttempt>;
  publish(c: PeerChallenge): void;
  list(classId: string, viewerId: string): PublicPeerChallenge[];
  attempt(input: Omit<ChallengeAttempt,'score'|'completed'>): ChallengeAttempt;
  publishProblem(installationId: string, c: PeerChallenge): PeerChallengeValidation;
  listClassProblems(installationId: string, classId: string, viewerId: string): PublicPeerChallenge[];
  getPublicProblem(installationId: string, classId: string, viewerId: string, id: string, version: number): PublicPeerChallenge | null;
  getHint(installationId: string, classId: string, id: string, version: number): ChallengeCard | null;
  submitSolution(installationId: string, input: Omit<ChallengeAttempt,'score'|'completed'>): ChallengeAttempt;
  hideProblem(installationId: string, classId: string, id: string, version: number): boolean;
  getStudentAttempts(installationId: string, studentId: string): ChallengeAttempt[];
  getClassProblemStats(installationId: string, classId: string): Array<{ id: string; version: number; attempts: number; completed: number }>;
}
export function createLocalPhase4Store(): LocalPhase4Store {
  const challenges = new Map<string, PeerChallenge>(); const attempts = new Map<string, ChallengeAttempt>(); const installations = new Map<string, string>();
  const publishInternal = (c: PeerChallenge) => { challenges.set(`${c.id}:v${c.version}`, c); };
  const find = (installationId: string, classId: string, id: string, version: number) => { const challenge = challenges.get(`${id}:v${version}`); return challenge && installations.get(`${id}:v${version}`) === installationId && challenge.classId === classId ? challenge : undefined; };
  return { challenges, attempts,
    publish(c) { publishInternal(c); },
    list(classId, viewerId) { return [...challenges.values()].filter(c => c.classId === classId && c.published && !c.hidden && c.authorId !== viewerId).map(publicChallenge); },
    attempt(input) { const key = `${input.studentId}:${input.challengeId}:v${input.version}`; const old = attempts.get(key); if (old) return old; const c = [...challenges.values()].find(v => v.id === input.challengeId && v.version === input.version); const completed = Boolean(c && gradePeer(input.submission, c, input.hintShown)); const result = { ...input, completed, score: peerScore(input.hintShown, completed) }; attempts.set(key, result); return result; },
    publishProblem(installationId, c) { const validation = validatePeerChallenge(c); if (!validation.ok) return validation; const previous = [...challenges.values()].find(value => value.id === c.id); if (previous && previous.version >= c.version && JSON.stringify(previous) !== JSON.stringify(c)) return { ok: false, code: 'VERSION_REQUIRED', message: '채점 조건을 바꿀 때는 새 버전으로 게시해야 해요.' }; installations.set(`${c.id}:v${c.version}`, installationId); publishInternal({ ...c, published: true, hidden: false }); return { ok: true }; },
    listClassProblems(installationId, classId, viewerId) { return [...challenges.values()].filter(c => installations.get(`${c.id}:v${c.version}`) === installationId && c.classId === classId && c.published && !c.hidden && c.authorId !== viewerId).map(publicChallenge); },
    getPublicProblem(installationId, classId, viewerId, id, version) { const c = find(installationId, classId, id, version); return c && c.published && !c.hidden && c.authorId !== viewerId ? publicChallenge(c) : null; },
    getHint(installationId, classId, id, version) { return find(installationId, classId, id, version)?.hint ?? null; },
    submitSolution(installationId, input) { const c = [...challenges.values()].find(v => v.id === input.challengeId && v.version === input.version && installations.get(`${v.id}:v${v.version}`) === installationId); const key = `${input.studentId}:${input.challengeId}:v${input.version}`; const old = attempts.get(key); if (old) return old; const completed = Boolean(c && c.classId && gradePeer(input.submission, c, input.hintShown)); const result = { ...input, completed, score: peerScore(input.hintShown, completed) }; attempts.set(key, result); return result; },
    hideProblem(installationId, classId, id, version) { const c = find(installationId, classId, id, version); if (!c) return false; c.hidden = true; return true; },
    getStudentAttempts(_installationId, studentId) { return [...attempts.values()].filter(a => a.studentId === studentId); },
    getClassProblemStats(installationId, classId) { return [...challenges.values()].filter(c => installations.get(`${c.id}:v${c.version}`) === installationId && c.classId === classId).map(c => { const rows = [...attempts.values()].filter(a => a.challengeId === c.id && a.version === c.version); return { id: c.id, version: c.version, attempts: rows.length, completed: rows.filter(a => a.completed).length }; }); },
  };
}

export type Lesson12Stage = 'learn' | 'solve' | 'practice';
export interface Lesson12ProgressRecord { installationId: string; classId: string; studentId: string; lessonId: 12; stage: Lesson12Stage; setId: string; problemId: string; problemVersion: number; questionIndex: number; answer: unknown; firstAttemptResult: 'correct' | 'incorrect' | null; attemptCount: number; hintLevel: number; finalResult: 'correct' | 'incorrect' | null; remediationStatus: 'none' | 'needed' | 'complete'; completedAt: string | null; selfEvaluation: { confidence?: number; favoriteConcept?: string; selfPraise?: string }; }
export interface ProgressRepository { save(record: Lesson12ProgressRecord): Promise<void>; load(scope: Pick<Lesson12ProgressRecord, 'installationId'|'classId'|'studentId'|'lessonId'|'setId'>): Promise<Lesson12ProgressRecord[]>; }
export class MemoryProgressRepository implements ProgressRepository {
  private rows = new Map<string, Lesson12ProgressRecord>();
  async save(record: Lesson12ProgressRecord) { this.rows.set(`${record.installationId}:${record.classId}:${record.studentId}:${record.lessonId}:${record.setId}:${record.problemId}`, { ...record, selfEvaluation: { ...record.selfEvaluation } }); }
  async load(scope: Pick<Lesson12ProgressRecord, 'installationId'|'classId'|'studentId'|'lessonId'|'setId'>) { return [...this.rows.values()].filter(row => row.installationId === scope.installationId && row.classId === scope.classId && row.studentId === scope.studentId && row.lessonId === scope.lessonId && row.setId === scope.setId).sort((a, b) => a.questionIndex - b.questionIndex); }
}

export interface ReviewItem { id: string; prompt: string; answerKind: 'direction'|'projections'|'count'|'heightMap'|'layers'|'blocks'; expected: unknown; conceptTag: string; }
export function reviewProblems(seed: number): ReviewItem[] {
  const s = Math.abs(seed) % 7; const blocks = [{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0},{x:2,y:0,z:1},{x:2,y:1,z:1},{x:2,y:2,z:1}]; const grid={gridWidth:3,gridDepth:3,maxHeight:3}; const p=project(blocks,grid);
  return [
    {id:`l12-direction-${s}`,prompt:'모형의 앞을 기준으로 오른쪽 옆은 어느 쪽에서 본 모양인가요?',answerKind:'direction',expected:'right',conceptTag:'direction'},
    {id:`l12-projection-${s}`,prompt:'위·앞·옆에서 본 모양을 모두 나타내 보세요.',answerKind:'projections',expected:p,conceptTag:'projection'},
    {id:`l12-count-${s}`,prompt:'보이는 블록을 자리별 높이로 세면 모두 몇 개인가요?',answerKind:'count',expected:blocks.length,conceptTag:'count'},
    {id:`l12-height-${s}`,prompt:'높이 지도를 완성해 보세요.',answerKind:'heightMap',expected:toHeightMap(blocks,grid),conceptTag:'height'},
    {id:`l12-layers-${s}`,prompt:'층별 모양을 보고 입체를 생각해 보세요.',answerKind:'layers',expected:toLayers(blocks,grid),conceptTag:'layers'},
    {id:`l12-pattern-${s}`,prompt:'1층부터 한 개씩 늘어날 때 4층은 몇 개인가요?',answerKind:'count',expected:10+s,conceptTag:'pattern'},
  ];
}
