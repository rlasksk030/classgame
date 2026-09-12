import { PHASE2_TAGS } from '../problems/templates/phase2.ts';
import type { ActivityDefinition } from '../problems/contracts/spatial.ts';
import type { LessonDefinition } from './contracts.ts';
import type { ActivityState } from '../progress/spatial.ts';
export type Phase2Lesson = 1 | 2 | 4;
export type Exploration = 'building'|'count-plan'|'position'|'layers'|'directions'|'observer'|'direction-match'|'camera-find'|'estimate'|'columns'|'height-sum'|'layer-counting'|'compare-strategies';
export type ExplorationActivity = Omit<ActivityDefinition,'interaction'|'completionCondition'> & {interaction:Exploration;completionCondition:'exploration-evidence'};
export type ExplorationLesson = Omit<LessonDefinition,'activities'> & {activities:ExplorationActivity[]};
const entries:Record<Phase2Lesson,[string,string,Exploration][]>={
 1:[['우리 주변의 건축물','건축물을 돌려 보고, 어떤 공간으로 쓰고 싶은지 골라 보세요.','building'],['개수는 어떻게 알아볼까?','아직 정확한 개수를 구하지 않아도 좋아요. 세어 볼 방법을 예상해 보세요.','count-plan'],['기준 블록의 오른쪽과 위','파란 기준 블록의 바로 오른쪽, 바로 위 블록을 차례로 직접 눌러 보세요.','position'],['층별로 살펴봐요','1층, 2층, 3층을 눌러 각 층에 놓인 블록을 살펴보세요.','layers']],
 2:[['같은 건축물, 다른 모습','앞·뒤·왼쪽·오른쪽에서 같은 건축물을 살펴보세요.','directions'],['누가 보고 있을까요?','사진과 같은 모습이 보이는 관찰자를 고르고 실제 시점으로 비교하세요.','observer'],['네 방향을 구별해요','앞을 기준으로 뒤·왼쪽·오른쪽 관찰 위치를 연결하세요.','direction-match'],['카메라는 어디에 있었을까?','사진을 찍은 카메라의 위치를 찾아 직접 그 방향에서 확인하세요.','camera-find']],
 4:[['먼저 예상해 봐요','어떤 방법으로 빠뜨리지 않고 셀 수 있을지 예상해 보세요.','estimate'],['자리별 높이를 알아봐요','숫자 지도의 칸과 3D 블록을 각각 눌러 같은 기둥을 찾아보세요.','columns'],['높이 숫자를 더해요','자리마다 쌓인 높이를 더해 전체 개수를 구해 보세요.','height-sum'],['층별로 나누어 세어요','각 층을 살펴보고 1층·2층·3층의 개수를 더해 보세요.','layer-counting'],['두 방법을 비교해요','높이의 합과 층별 개수의 합을 비교해 같은 전체 개수를 확인하세요.','compare-strategies']],
};
function definition(id:Phase2Lesson):ExplorationLesson {return {
 curriculumVersion:'spatial-v2',lessonId:id,title:{1:'단원 열기 · 공간과 입체',2:'어느 방향에서 본 모양일까요(1)',4:'쌓기나무의 개수를 알아볼까요'}[id],objective:{1:'위치, 층, 개수에 관한 선수학습을 확인한다.',2:'보는 위치에 따라 다른 모습을 앞·뒤·왼쪽·오른쪽으로 구별한다.',4:'자리별 높이와 층별 개수를 연결하여 전체 개수를 구한다.'}[id],
 stages:[{stage:'learn',label:'개념 배우기',required:true},{stage:'solve',label:'문제 풀기',required:true},{stage:'practice',label:'더 풀어보기',required:true}],
 activities:entries[id].map(([title,shortInstruction,interaction],i)=>({activityId:`l${id}-${interaction}`,lessonId:id,order:i+1,title,shortInstruction,interaction,completionCondition:'exploration-evidence',primaryRepresentation:id===4?'model-and-grid':'model',optionalHelp:'직접 조작한 뒤 알게 된 점을 확인해 보세요.',conceptTags:interaction==='position'?['position-right','position-up']:interaction==='columns'?['column-height','height-map']:interaction==='layers'||interaction==='layer-counting'?['layer-count']:interaction==='compare-strategies'?['strategy-comparison']:interaction==='height-sum'?['height-map','total-count']:interaction==='observer'?['observer-position']:interaction==='camera-find'?['photo-camera-position']:interaction==='directions'||interaction==='direction-match'?['direction-front','direction-back','direction-left','direction-right']:['total-count']})),
 assessment:{commonCount:6,adaptiveCount:id===1?2:3,selection:'concept-tag-errors'},practice:{requiredCount:5,optionalCount:0},conceptTags:[...new Set(PHASE2_TAGS[id])],
};}
export const phase2Definitions={1:definition(1),2:definition(2),4:definition(4)};
export function explorationCompleted(kind:Exploration,s:ActivityState):boolean {
 const m=s.mapping;
 switch(kind){
 case 'building':return Boolean(m.space&&m.observed);
 case 'count-plan':case 'estimate':return Boolean(m.strategy);
 case 'position':return m.right==='yes'&&m.up==='yes';
 case 'layers':case 'layer-counting':return [1,2,3].every(n=>m[`layer${n}`]==='yes');
 case 'directions':return ['front','back','left','right'].every(d=>m[d]==='yes');
 case 'observer':case 'camera-find':return m.matched==='yes'&&m.viewCompared==='yes';
 case 'direction-match':return m['뒤']==='back'&&m['왼쪽']==='left'&&m['오른쪽']==='right';
 case 'columns':return m.mapSelected==='yes'&&m.modelSelected==='yes';
 case 'height-sum':return m.sumChecked==='yes';
 case 'compare-strategies':return m.compared==='yes';
 }
}
