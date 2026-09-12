import type { ActivityDefinition } from '../problems/contracts/spatial.ts';
export const LESSON3_ACTIVITIES:ActivityDefinition[]=[
 {activityId:'l3-views',lessonId:3,order:1,title:'위·앞·옆은 어디일까?',shortInstruction:'먼저 위·앞·옆 버튼으로 두 방향 이상 살펴보세요.',primaryRepresentation:'model',interaction:'visit-views',completionCondition:'two-views',optionalHelp:'옆은 모형의 오른쪽에서 보는 방향이에요.',conceptTags:['projection-direction']},
 {activityId:'l3-top',lessonId:3,order:2,title:'위에서 보면 무엇이 남을까?',shortInstruction:'위에서 본 뒤 블록이 있는 바닥 자리를 표시하세요.',primaryRepresentation:'model-and-grid',interaction:'paint-top',completionCondition:'top-and-cell',optionalHelp:'높이 숫자 대신 있는 자리를 표시해요.',conceptTags:['projection-top']},
 {activityId:'l3-columns',lessonId:3,order:3,title:'앞·옆에서 보면 어떻게 보일까?',shortInstruction:'앞과 옆 그림의 칸을 눌러 연결된 블록 열을 살펴보세요.',primaryRepresentation:'model-and-grid',interaction:'inspect-columns',completionCondition:'front-and-side-cell',optionalHelp:'그 방향의 같은 열에 놓인 블록들이 함께 강조돼요.',conceptTags:['projection-front','projection-side']},
 {activityId:'l3-match',lessonId:3,order:4,title:'어느 방향에서 본 모습일까?',shortInstruction:'세 그림에 위·앞·옆을 연결하고 실제 시점으로 비교하세요.',primaryRepresentation:'projection-comparison',interaction:'match-views',completionCondition:'matched-and-viewed',optionalHelp:'위는 자리, 앞과 옆은 보이는 높이를 살펴봐요.',conceptTags:['projection-direction']},
 {activityId:'l3-change',lessonId:3,order:5,title:'블록 하나가 바뀌면?',shortInstruction:'바뀔 모습을 예상한 뒤 지정된 자리에 하나를 쌓아 비교하세요.',primaryRepresentation:'projection-comparison',interaction:'predict-build-compare',completionCondition:'predicted-built-compared',optionalHelp:'앞에서 첫째 줄, 가로 첫째 자리에 한 개를 더 올려요.',conceptTags:['projection-change']},
];

import type { ActivityState } from '../progress/spatial.ts';
import { blocksEqual } from '../blocks.ts';
import { LESSON3_MODEL } from '../problems/templates/lesson3.ts';
export function activityCompleted(definition:ActivityDefinition,state:ActivityState):boolean {
 switch(definition.completionCondition){
  case 'two-views':return new Set(state.views).size>=2;
  case 'top-and-cell':return state.views.includes('top')&&state.top.some(row=>row.some(Boolean));
  case 'front-and-side-cell':return state.inspected.includes('front')&&state.inspected.includes('side');
  case 'matched-and-viewed':return state.mapping['가']==='side'&&state.mapping['나']==='top'&&state.mapping['다']==='front'&&state.compared;
  case 'predicted-built-compared':return state.predictionConfirmed&&state.prediction.length>0&&blocksEqual(state.blocks,[...LESSON3_MODEL,{x:0,y:1,z:0}])&&state.changeCompared;
 }
}

import type { LessonDefinition } from './contracts.ts';
export const LESSON3_DEFINITION:LessonDefinition={
 curriculumVersion:'spatial-v2',lessonId:3,title:'어느 방향에서 본 모양일까요(2)',objective:'쌓기나무로 쌓은 모양을 위, 앞, 오른쪽 옆에서 본 모양으로 나타낸다.',
 stages:[{stage:'learn',label:'개념 배우기',required:true},{stage:'solve',label:'문제 풀기',required:true},{stage:'practice',label:'더 풀어보기',required:true}],
 activities:LESSON3_ACTIVITIES,assessment:{commonCount:6,adaptiveCount:4,selection:'concept-tag-errors'},practice:{requiredCount:5,optionalCount:5},
 conceptTags:['projection-direction','projection-top','projection-front','projection-side','projection-error-analysis','projection-change'],
};
