import type { Direction, Grid2D, HeightMap } from './types.ts';

/** A student's submitted input only. Never supplies an expected answer or grade. */
export interface SubmittedAnswerDraft {
  countInput?: string;
  directionValue?: Direction;
  choiceIndex?: number;
  topMap?: Grid2D;
  frontMap?: Grid2D;
  sideMap?: Grid2D;
  heightMap?: HeightMap;
  layerMaps?: Grid2D[];
}
const grid = (v: unknown): v is Grid2D => Array.isArray(v) && v.length > 0 && v.every(r => Array.isArray(r) && r.every(c => typeof c === 'boolean'));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function submittedAnswerDraft(value: unknown): SubmittedAnswerDraft | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  if (a.kind === 'count' && integer(a.value)) return { countInput: String(a.value) };
  if (a.kind === 'choice' && integer(a.index)) return { choiceIndex: a.index };
  if (a.kind === 'direction' && ['front','back','left','right','top'].includes(String(a.direction))) return { directionValue: a.direction as Direction };
  if (a.kind === 'heightMap' && Array.isArray(a.heightMap) && a.heightMap.every(r => Array.isArray(r) && r.every(integer))) return { heightMap: a.heightMap as HeightMap };
  if (a.kind === 'layers' && Array.isArray(a.layers) && a.layers.every(grid)) return { layerMaps: a.layers };
  if (a.kind === 'projections' && a.projections && typeof a.projections === 'object') {
    const p = a.projections as Record<string, unknown>;
    const draft: SubmittedAnswerDraft = {};
    for (const [face, field] of [['top','topMap'],['front','frontMap'],['side','sideMap']] as const) {
      if (p[face] === undefined) continue;
      if (!grid(p[face])) return null;
      draft[field] = p[face];
    }
    return Object.keys(draft).length ? draft : null;
  }
  return null;
}
