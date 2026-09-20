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

/**
 * Human-readable Korean label per generator templateId, for teacher-facing screens only
 * (e.g. TeacherProblemPreview's template picker). Never used for grading/storage/API values —
 * the templateId itself is unchanged everywhere else. Grounded in each template's actual
 * prompt/behavior in practiceGenerator.ts, not guessed from the id string alone.
 */
export const PROBLEM_TEMPLATE_LABELS: Record<string, string> = {
  // 1차시
  'lesson1-position-right': '빨간 블록 오른쪽 블록 찾기',
  'lesson1-position-above': '빨간 블록 위 블록 찾기',
  'lesson1-layer-count': '2층 블록 개수 세기',
  'lesson1-total-count': '전체 블록 개수 세기',
  'lesson1-description-choice': '설명에 맞는 문장 고르기',
  'lesson1-layer-compare': '자리별·층별 개수 비교',
  // 2차시
  'lesson2-front-view': '앞에서 본 모양 판단',
  'lesson2-back-view': '뒤에서 본 모양 판단',
  'lesson2-left-view': '왼쪽에서 본 모양 판단',
  'lesson2-right-view': '오른쪽에서 본 모양 판단',
  'lesson2-top-view': '위에서 본 모양 판단',
  'lesson2-feature-check': '관찰 방향 특징 확인',
  // 3차시
  'lesson3-top-draw': '위에서 본 모양 그리기',
  'lesson3-front-draw': '앞에서 본 모양 그리기',
  'lesson3-side-draw': '옆에서 본 모양 그리기',
  'lesson3-all-views': '위·앞·옆 모양 모두 그리기',
  'lesson3-hidden-side': '보이지 않는 방향 모양 그리기',
  'lesson3-direction-judge': '어느 방향에서 본 모양인지 판단',
  // 4차시
  'lesson4-total-count': '전체 블록 개수 세기',
  'lesson4-height-map': '숫자 지도 완성하기',
  'lesson4-layer-count': '2층 블록 개수 세기',
  'lesson4-layer-map': '층별 모양 그리기',
  'lesson4-method-choice': '개수 세는 방법 고르기',
  'lesson4-missing-info': '주어진 자료로 숫자 지도 완성',
  // 5차시
  'lesson5-unknown-choice': '한 방향 정보만으로 알 수 있는지 판단',
  'lesson5-hidden-min': '보이는 자료로 개수 구하기',
  'lesson5-hidden-max': '숨겨진 블록 최대 개수 구하기',
  'lesson5-extra-info': '정확한 판단에 필요한 정보 고르기',
  'lesson5-same-view': '같은 모습이어도 개수가 다를 수 있는지 판단',
  'lesson5-reveal-count': '추가 정보로 실제 개수 구하기',
  'lesson5-minimum': '조건을 만족하는 최소 개수 찾기',
  'lesson5-counterexample': '정보 부족을 보여주는 반례 찾기',
  // 6차시
  'lesson6-build-views': '세 방향 모습 보고 쌓기',
  'lesson6-another-solution': '조건 만족하는 다른 모양 만들기',
  'lesson6-possible-shape': '가능한 입체 만들기',
  'lesson6-minimum': '조건을 만족하는 최소 개수 쌓기',
  'lesson6-maximum': '조건을 만족하는 최대 개수 쌓기',
  'lesson6-unique-or-many': '정답이 하나인지 여러 개인지 확인',
  'lesson6-add-height': '높이를 더해 조건 다시 만족하기',
  'lesson6-invalid-count': '조건에 맞지 않는 개수 판별',
  // 7차시
  'lesson7-height-to-build': '숫자 지도 보고 쌓기',
  'lesson7-build-to-height': '3D 모양 보고 숫자 지도 완성',
  'lesson7-total-from-height': '숫자 지도로 전체 개수 구하기',
  'lesson7-fill-height': '숫자 지도대로 빈 칸 채워 쌓기',
  'lesson7-find-wrong-height': '3D 모양 보고 숫자 지도 다시 확인',
  'lesson7-changed-height': '바뀐 높이만큼 다시 쌓기',
  // 8차시
  'lesson8-layers-to-build': '층별 그림 보고 쌓기',
  'lesson8-build-to-layers': '3D 모양 보고 층별 그림 그리기',
  'lesson8-missing-layer': '빠진 층 채워 그리기',
  'lesson8-layer-count': '특정 층 블록 개수 세기',
  'lesson8-total-count': '전체 블록 개수 세기',
  'lesson8-next-layer': '다음 층 모양 그리기',
  // 9~11차시
  'lesson9-peer-challenge': '친구 문제 만들고 풀기',
  'lesson10-project': '건축물 자유 설계',
  'lesson11-project': '작품 소개 작성',
  // 12차시
  'lesson12-direction': '어느 방향에서 본 모양인지 판단',
  'lesson12-projection': '위·앞·옆 모양 그리기',
  'lesson12-count': '전체 블록 개수 세기',
  'lesson12-height-map': '숫자 지도 완성하기',
  'lesson12-layer-map': '층별 모양 그리기',
  'lesson12-constraint': '조건에 맞는 입체 만들기',
  'lesson12-hidden-block': '숨겨진 블록 포함 개수 구하기',
  'lesson12-spatial-choice': '공간 개념 문장 고르기',
};

/** Unknown/future templateId falls back to the raw id rather than a blank or crashing label. */
export function problemTemplateLabel(templateId: string): string {
  return PROBLEM_TEMPLATE_LABELS[templateId] ?? templateId;
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
