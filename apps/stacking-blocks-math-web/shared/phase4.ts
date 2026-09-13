import { canonicalize, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord, Grid2D, GridConfig } from './types.ts';

export type ChallengeCardType = 'views' | 'top' | 'heightMap' | 'layers';
export type HintCardType = 'heightMap' | 'layers';
export interface ChallengeCard { type: ChallengeCardType; title: string; description: string; projections?: Partial<ReturnType<typeof project>>; heightMap?: number[][]; layers?: Grid2D[]; }
export interface PeerChallenge { id: string; version: number; classId: string; authorId: string; title: string; blocks: BlockCoord[]; card: ChallengeCard; hint: ChallengeCard; published: boolean; hidden: boolean; }
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
  if (expected.type === 'views') return JSON.stringify(got) === JSON.stringify(expected.projections);
  if (expected.type === 'top') return JSON.stringify(got.top) === JSON.stringify(expected.projections?.top);
  if (expected.type === 'heightMap') return JSON.stringify(toHeightMap(blocks, PEER_GRID)) === JSON.stringify(expected.heightMap);
  if (!expected.layers) return false;
  const layers = toLayers(blocks, PEER_GRID); return JSON.stringify(layers) === JSON.stringify(expected.layers);
}
export function peerScore(hintShown: boolean, completed: boolean): 0|1|2 { return completed ? (hintShown ? 1 : 2) : 0; }

export interface LocalPhase4Store { challenges: Map<string, PeerChallenge>; attempts: Map<string, ChallengeAttempt>; publish(c: PeerChallenge): void; list(classId: string, viewerId: string): PeerChallenge[]; attempt(input: Omit<ChallengeAttempt,'score'|'completed'>): ChallengeAttempt; }
export function createLocalPhase4Store(): LocalPhase4Store {
  const challenges = new Map<string, PeerChallenge>(); const attempts = new Map<string, ChallengeAttempt>();
  return { challenges, attempts,
    publish(c) { challenges.set(`${c.id}:v${c.version}`, c); },
    list(classId, viewerId) { return [...challenges.values()].filter(c => c.classId === classId && c.published && !c.hidden && c.authorId !== viewerId); },
    attempt(input) { const key = `${input.studentId}:${input.challengeId}:v${input.version}`; const old = attempts.get(key); if (old) return old; const c = [...challenges.values()].find(v => v.id === input.challengeId && v.version === input.version); const completed = Boolean(c && gradePeer(input.submission, c, input.hintShown)); const result = { ...input, completed, score: peerScore(input.hintShown, completed) }; attempts.set(key, result); return result; },
  };
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
