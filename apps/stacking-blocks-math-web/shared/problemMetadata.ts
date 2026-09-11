import type { ProblemType } from './types.ts';

export const LESSON_CONCEPT_TAGS: Record<number, string[]> = {
  1: ['POSITION', 'BLOCK_COUNT'],
  2: ['DIRECTION', 'FRONT_VIEW', 'SIDE_VIEW'],
  3: ['TOP_VIEW', 'FRONT_VIEW', 'SIDE_VIEW'],
  4: ['BLOCK_COUNT', 'HEIGHT_MAP', 'LAYER_MAP'],
  5: ['HIDDEN_BLOCK', 'BLOCK_COUNT', 'SPATIAL_REASONING'],
  6: ['CONSTRAINT_BUILD', 'TOP_VIEW', 'FRONT_VIEW', 'SIDE_VIEW'],
  7: ['HEIGHT_MAP', 'BLOCK_COUNT'],
  8: ['LAYER_MAP', 'BLOCK_COUNT', 'SPATIAL_REASONING'],
  12: ['DIRECTION', 'TOP_VIEW', 'FRONT_VIEW', 'SIDE_VIEW', 'BLOCK_COUNT', 'HEIGHT_MAP', 'LAYER_MAP'],
};

export function conceptTagsForLesson(lesson: number): string[] {
  return [...(LESSON_CONCEPT_TAGS[lesson] ?? ['SPATIAL_REASONING'])];
}

export function conceptTagsForProblemType(type: ProblemType): string[] {
  switch (type) {
    case 'CAMERA_DIRECTION': return ['DIRECTION', 'FRONT_VIEW', 'SIDE_VIEW'];
    case 'PROJECTION_DRAW': return ['TOP_VIEW', 'FRONT_VIEW', 'SIDE_VIEW'];
    case 'COUNT': case 'COUNT_AMBIGUOUS': return ['BLOCK_COUNT'];
    case 'BUILD_FROM_HEIGHTMAP': case 'HEIGHTMAP_FROM_BUILD': return ['HEIGHT_MAP', 'BLOCK_COUNT'];
    case 'BUILD_FROM_LAYERS': case 'LAYER_DRAW': case 'PATTERN_NEXT': return ['LAYER_MAP', 'BLOCK_COUNT'];
    case 'BUILD_FROM_VIEWS': return ['CONSTRAINT_BUILD', 'TOP_VIEW', 'FRONT_VIEW', 'SIDE_VIEW'];
    case 'BLOCK_POSITION': return ['POSITION'];
    default: return ['SPATIAL_REASONING'];
  }
}
