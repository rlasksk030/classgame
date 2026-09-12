import { fromHeightMap, toHeightMap, toLayers, project, validStructure } from '../../blocks.ts';
import type { BlockCoord, GridConfig } from '../../types.ts';
import type { Problem, ConceptTag, Stage } from '../contracts/spatial.ts';
import type { Phase2Lesson } from '../../curriculum/phase2.ts';
export const PHASE2_GRID:GridConfig={gridWidth:3,gridDepth:3,maxHeight:3};
export const INTRO_MODEL=fromHeightMap([[2,1,0],[0,1,0],[0,0,3]]);
export const COUNT_MODEL=fromHeightMap([[2,1,0],[1,3,0],[0,1,2]]);
export const DIRECTION_MODEL=fromHeightMap([[1,0,0],[1,1,0],[0,2,3]]);
export const OBSERVERS=['front','back','left','right'] as const;
export type Observer=typeof OBSERVERS[number];
export const OBSERVER_LABELS:Record<Observer,string>={front:'앞',back:'뒤',left:'왼쪽',right:'오른쪽'};
export function phase2Model(id:Phase2Lesson){return id===1?INTRO_MODEL:id===2?DIRECTION_MODEL:COUNT_MODEL;}
/** A legal model must give the same count by both counting strategies, before it is served. */
export function countEvidence(blocks:BlockCoord[],grid=PHASE2_GRID){
 if(!validStructure(blocks,grid))throw new Error('INVALID_COUNT_MODEL');
 const heights=toHeightMap(blocks,grid),layers=toLayers(blocks,grid),heightSum=heights.flat().reduce((a,b)=>a+b,0),layerCounts=layers.map(g=>g.flat().filter(Boolean).length);
 if(blocks.length!==heightSum||heightSum!==layerCounts.reduce((a,b)=>a+b,0))throw new Error('COUNT_REPRESENTATION_MISMATCH');
 return {heights,layers,heightSum,layerCounts};
}
export function fourDistinctViews(blocks:BlockCoord[]){const p=project(blocks,PHASE2_GRID);const mirror=(g:boolean[][])=>g.map(r=>r.slice().reverse());return new Set([p.front,mirror(p.front),p.side,mirror(p.side)].map(g=>JSON.stringify(g))).size===4;}
export const PHASE2_TAGS:Record<Phase2Lesson,ConceptTag[]>={1:['position-right','position-up','layer-count','total-count','description-to-model','layer-count'],2:['direction-front','direction-back','direction-left','direction-right','observer-position','photo-camera-position'],4:['column-height','height-map','layer-count','layer-map','total-count','strategy-comparison']};
export function phase2Problem(id:Phase2Lesson,tag:ConceptTag,seed:number,stage:Stage,index:number):Problem {
 const shift=(seed>>>0)%3;
 const blocks=id===1?INTRO_MODEL:id===2?DIRECTION_MODEL:fromHeightMap([[1+shift,1,0],[1,3,0],[0,1,2]]);
 const counts=countEvidence(blocks);const p:Problem={id:`spatial-v2:l${id}:${stage}:${index}:${tag}:${seed}`,version:1,curriculumVersion:'spatial-v2',seed,lessonId:id,stage,conceptTags:[tag],learningIntent:tag,prompt:'',grid:PHASE2_GRID,presentedMaterials:[{kind:'model',blocks,caption:'살펴볼 건축물'}],answerInput:{kind:'number',min:0,max:27},gradingPolicy:{kind:'exact-number',value:blocks.length},feedbackPolicy:{first:'기준과 자료를 다시 살펴보세요.',hint:'같은 블록을 두 번 세거나 빠뜨리지 않았는지 확인하세요.',focus:'front'},revealPolicy:{kind:'compare-answer',reason:`모든 블록을 빠짐없이 한 번씩 세면 ${blocks.length}개입니다.`},completionPolicy:{kind:'correct-or-correct-after-reveal'},cameraPolicy:{kind:'free',initialView:'home',allowedViews:['home','front']},allowedViews:['home','front'],solutionPolicy:{kind:'unique'}};
 if(id===2){p.allowedViews=['home',...OBSERVERS];p.cameraPolicy.allowedViews=p.allowedViews;}
 if(id===4){p.allowedViews=['home','top','front','side'];p.cameraPolicy.allowedViews=p.allowedViews;}
 const choice=(choices:{id:string;label:string}[],value:string)=>{p.answerInput={kind:'choice',choices};p.gradingPolicy={kind:'exact-choice',value};};
 if(id===2){
  if(!fourDistinctViews(blocks))throw new Error('AMBIGUOUS_DIRECTION_MODEL');
  const direction=(tag.startsWith('direction-')?tag.slice(10):OBSERVERS[shift]) as Observer;
  p.prompt=tag==='observer-position'?'사진과 같은 모습을 본 관찰자는 어느 위치에 있나요?':tag==='photo-camera-position'?'이 사진을 찍은 카메라는 어느 위치에 있었나요?':'이 건축물 사진은 어느 위치에서 본 모습인가요?';
  p.presentedMaterials.push({kind:'model',blocks,view:direction,caption:'방향을 찾을 사진'});choice(OBSERVERS.map(d=>({id:d,label:OBSERVER_LABELS[d]})),direction);
  p.feedbackPolicy={first:'모형에 정해진 앞을 기준으로 생각해 보세요.',hint:'높은 기둥과 낮은 기둥의 좌우 순서를 사진과 비교하세요.',focus:'front'};
  p.revealPolicy.reason=`모형의 앞을 기준으로 ${OBSERVER_LABELS[direction]}에서 보면 사진과 같은 높이 순서가 됩니다.`;return p;
 }
 if(id===1&&(tag==='position-right'||tag==='position-up')){
  const right=tag==='position-right';p.prompt=`앞에서 첫째 줄, 가로 첫째 자리 1층 블록의 바로 ${right?'오른쪽':'위'} 블록은 어디에 있나요?`;
  choice([{id:'right',label:'같은 줄, 가로 둘째 자리 1층'},{id:'up',label:'같은 자리의 2층'},{id:'back',label:'뒤쪽 둘째 줄의 1층'}],right?'right':'up');p.feedbackPolicy.hint='오른쪽은 가로 자리, 위는 같은 자리의 층이 달라져요.';p.revealPolicy.reason=right?'오른쪽으로 한 자리 이동하며 층과 앞뒤 위치는 같아요.':'바로 위는 가로와 앞뒤 위치가 같고 층이 하나 높아요.';return p;
 }
 if(tag==='description-to-model'){
  p.prompt='앞에서 첫째 줄에 높이 2, 1의 기둥을 나란히 쌓았어요. 설명과 같은 모형을 고르세요.';
  p.presentedMaterials=[{kind:'model',blocks:fromHeightMap([[2,1,0],[0,0,0],[0,0,0]]),caption:'가'},{kind:'model',blocks:fromHeightMap([[1,2,0],[0,0,0],[0,0,0]]),caption:'나'}];choice([{id:'a',label:'가'},{id:'b',label:'나'}],'a');p.revealPolicy.reason='가의 첫째 기둥은 2개, 둘째 기둥은 1개입니다.';return p;
 }
 if(tag==='layer-count'){const layer=shift;p.prompt=`${layer+1}층에는 블록이 몇 개 있나요?`;p.gradingPolicy={kind:'exact-number',value:counts.layerCounts[layer]};p.revealPolicy.reason=`${layer+1}층에 있는 블록만 한 번씩 세면 ${counts.layerCounts[layer]}개입니다.`;if(id===4)p.presentedMaterials.push({kind:'layer-map',grids:counts.layers,caption:'층별 모양'});return p;}
 if(tag==='column-height'){p.prompt='앞에서 첫째 줄, 가로 첫째 자리에 쌓인 높이는 몇 층인가요?';p.gradingPolicy={kind:'exact-number',value:counts.heights[0][0]};p.revealPolicy.reason=`그 자리에는 아래부터 ${counts.heights[0][0]}개가 쌓여 있습니다.`;return p;}
 if(tag==='height-map'){p.prompt='각 자리의 쌓인 높이를 숫자 지도에 쓰세요.';p.answerInput={kind:'height-map',max:3};p.gradingPolicy={kind:'exact-height-map',grid:counts.heights};p.revealPolicy.reason='각 자리에 쌓인 블록 수를 씁니다. 비어 있는 자리는 0입니다.';return p;}
 if(tag==='layer-map'){p.prompt='각 층에 블록이 있는 자리를 층별 격자에 표시하세요.';p.answerInput={kind:'layer-map',layers:3};p.gradingPolicy={kind:'exact-layers',grids:counts.layers};p.revealPolicy.reason='1층부터 3층까지 그 층에 있는 블록의 바닥 자리만 표시합니다.';return p;}
 p.prompt=tag==='strategy-comparison'?'높이 숫자를 더한 값과 층별 개수를 더한 값은 어떤 관계인가요?':'건축물의 쌓기나무는 모두 몇 개인가요?';
 if(id===4){p.presentedMaterials.push({kind:'height-map',grid:counts.heights,caption:'자리별 높이'},{kind:'layer-map',grids:counts.layers,caption:'층별 모양'});p.revealPolicy.reason=`높이의 합 ${counts.heightSum} = 층별 개수 ${counts.layerCounts.join(' + ')} = ${blocks.length}개입니다.`;}
 if(tag==='strategy-comparison')choice([{id:'same',label:'두 합은 같은 전체 개수이다.'},{id:'height-more',label:'높이의 합이 더 크다.'},{id:'layer-more',label:'층별 개수의 합이 더 크다.'}],'same');
 return p;
}
export const phase2Common=(id:Phase2Lesson,seed:number)=>PHASE2_TAGS[id].map((tag,i)=>phase2Problem(id,tag,seed+i*97,'solve',i));
export function phase2Adaptive(id:Phase2Lesson,seed:number,errors:Partial<Record<ConceptTag,number>>){const tags=[...new Set(PHASE2_TAGS[id])].sort((a,b)=>(errors[b]??0)-(errors[a]??0));return Array.from({length:id===1?2:3},(_,i)=>phase2Problem(id,tags[i%tags.length],seed+900+i*97,errors[tags[i%tags.length]]?'remediation':'challenge',6+i));}
export const phase2Practice=(id:Phase2Lesson,seed:number)=>Array.from({length:5},(_,i)=>phase2Problem(id,PHASE2_TAGS[id][i],seed+2000+i*97,'practice',i));
