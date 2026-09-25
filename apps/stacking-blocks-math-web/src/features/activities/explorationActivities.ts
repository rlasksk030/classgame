import { fromHeightMap, project, grid2DEqual, validStructure } from '../../../shared/blocks.ts';
import type { BlockCoord, GridConfig, Grid2D } from '../../../shared/types.ts';

export type ExplorationKind = 'count' | 'viewpoints' | 'projections' | 'height-layers' | 'information' | 'constraints' | 'height-edit' | 'layer-edit' | 'peer' | 'architecture' | 'presentation' | 'connections';
export interface ExplorationGuide { kind: ExplorationKind; title: string; observe: string; manipulate: string; discover: string }
// Explicit live learn mapping: never default an unknown lesson to an empty builder.
export const EXPLORATIONS: Record<number, ExplorationGuide> = {
  1: { kind:'count',title:'쌓고 세어 보세요',observe:'자리와 층에 따라 블록이 놓여 있어요.',manipulate:'블록을 추가하거나 선택해 삭제하고, 먼저 센 개수를 입력해 비교하세요.',discover:'보이지 않는 블록도 전체 개수에 포함돼요.' },
  2: { kind:'viewpoints',title:'같은 입체, 다른 관찰 위치',observe:'모형은 그대로 두고 앞·뒤·왼쪽·오른쪽·위에서 보세요.',manipulate:'보기 버튼과 회전으로 관찰 위치를 바꾸세요.',discover:'입체가 같아도 보는 방향에 따라 모습은 달라져요.' },
  3: { kind:'projections',title:'입체와 세 방향 모양을 연결해요',observe:'같은 입체의 위·앞·오른쪽 옆 모양을 비교하세요.',manipulate:'확인할 방향을 고르고, 모형을 돌려 해당 격자와 비교하세요.',discover:'세 방향 격자는 같은 입체의 서로 다른 정보를 담아요.' },
  4: { kind:'height-layers',title:'자리별 높이와 층별 개수',observe:'높이 지도와 층별 지도가 같은 블록을 나타내요.',manipulate:'한 블록을 추가하거나 선택해 삭제하고 두 지도의 변화를 보세요.',discover:'자리별 높이의 합 = 층별 개수의 합 = 전체 블록 수예요.' },
  5: { kind:'information',title:'앞모습만으로 개수를 알 수 있을까요?',observe:'지금 주어진 정보는 앞에서 본 격자 하나뿐이에요. 사선 그림은 주어지지 않았어요.',manipulate:'먼저 판단한 뒤 가능한 두 입체를 번갈아 보고, 높이 정보를 추가해 비교하세요.',discover:'앞모습이 같아도 개수는 다를 수 있어요. 추가 정보가 필요해요.' },
  6: { kind:'constraints',title:'세 방향 조건에 맞는 여러 입체',observe:'2×2판, 각 자리 2층 이하, 아래가 받쳐진 입체예요. 세 격자를 모두 만족해야 해요.',manipulate:'조건에 맞게 쌓고 비교하세요. 같은 조건의 예시도 바꾸어 보세요.',discover:'세 방향이 같아도 입체가 하나로 정해지지는 않아요. 이 조건의 최소·최대도 비교해요.' },
  7: { kind:'height-edit',title:'숫자를 바꾸면 입체도 바뀌어요',observe:'각 숫자는 그 자리에 쌓인 블록 수예요.',manipulate:'높이 지도의 ＋와 －를 눌러 입체를 바꾸세요.',discover:'높이 지도는 각 기둥의 높이를 정해요. 같은 숫자로 같은 입체를 복원해요.' },
  8: { kind:'layer-edit',title:'층을 합쳐 입체를 만들어요',observe:'각 층의 같은 자리가 위아래로 이어져요.',manipulate:'편집할 층을 고르고 칸을 켜거나 끄세요. 3D의 층 보기로 확인하세요.',discover:'윗층 블록 아래에는 받쳐 주는 블록이 있어야 해요.' },
  9: { kind:'peer',title:'문제를 만들고 친구에게 도전해요',observe:'내 모형과 친구에게 공개할 카드·힌트를 구별해요.',manipulate:'아래 제작 화면에서 10개를 쌓고 카드를 고르거나 친구·기본 연습을 선택하세요.',discover:'같은 공개 조건을 만족하는 답을 인정하며, 힌트 사용에 따라 놀이 점수가 달라져요.' },
  10: { kind:'architecture',title:'내 건축물을 설계해요',observe:'작업판과 작품의 여러 방향을 살펴보세요.',manipulate:'기존 제작 화면에서 쌓고 제목·설계 이유를 기록해 저장하세요.',discover:'자유롭게 만든 작품도 여러 표현으로 설명할 수 있어요.' },
  11: { kind:'presentation',title:'내 작품을 표현하고 소개해요',observe:'10차시에서 저장한 같은 작품을 불러와요.',manipulate:'위·앞·옆과 층별 모습을 확인하고 용도와 소개를 작성하세요.',discover:'입체의 표현과 공간 설명이 작품을 소개하는 근거가 돼요.' },
  12: { kind:'connections',title:'여러 표현으로 같은 입체 설명하기',observe:'하나의 입체를 높이·투영·층별 지도로 비교해요.',manipulate:'높이를 바꾸고 표현을 전환한 뒤, 아래 자기평가에 발견한 점을 기록하세요.',discover:'표현이 달라도 가리키는 입체와 전체 개수는 같아요.' },
};
export const EXPLORATION_GRID: GridConfig = { gridWidth:3,gridDepth:3,maxHeight:4 };
export const HEIGHT_EDIT_GRID: GridConfig = { ...EXPLORATION_GRID, maxHeight:9 };
export const CONSTRAINT_GRID: GridConfig = { gridWidth:2,gridDepth:2,maxHeight:2 };
export const START_BLOCKS = fromHeightMap([[2,1,0],[1,0,0],[0,0,1]]);
export const INFORMATION_MODELS = [fromHeightMap([[2,1,0],[0,0,0],[0,0,0]]),fromHeightMap([[2,1,0],[1,0,0],[0,0,0]])];
export const CONSTRAINT_TARGET = project(fromHeightMap([[2,1],[1,2]]),CONSTRAINT_GRID);
export function matchesExplorationConditions(blocks: BlockCoord[]): boolean {
  if (!validStructure(blocks,CONSTRAINT_GRID)) return false;
  const actual=project(blocks,CONSTRAINT_GRID);
  return (['top','front','side'] as const).every(face=>grid2DEqual(actual[face],CONSTRAINT_TARGET[face]));
}
// Complete enumeration of this deliberately small, supported height-map activity only.
export const CONSTRAINT_EXAMPLES = Array.from({length:16},(_,mask)=>fromHeightMap([[1+(mask&1),1+((mask>>1)&1)],[1+((mask>>2)&1),1+((mask>>3)&1)]]))
 .filter(matchesExplorationConditions).sort((a,b)=>a.length-b.length);
export function editExplorationLayer(layers:Grid2D[],level:number,next:Grid2D):Grid2D[]|null {
 for(let z=0;z<next.length;z++)for(let x=0;x<next[z].length;x++) {
  if(next[z][x] && level>0 && !layers[level-1][z][x])return null;
  if(!next[z][x] && layers.slice(level+1).some(layer=>layer[z][x]))return null;
 }
 return layers.map((layer,i)=>i===level?next:layer);
}
