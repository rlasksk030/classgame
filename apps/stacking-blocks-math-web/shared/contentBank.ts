/** Content v3: bounded inverse problems; no saved v1/v2 content is rewritten. */
import { fromHeightMap, project, toHeightMap, toLayers, grid2DEqual } from './blocks.ts';
import { analyzeSolutions } from './problems/solvers/projection.ts';
import type { GeneratedProblem } from './practiceGenerator.ts';
import type { DifficultyTier } from './types.ts';
import { conceptTagsForLesson } from './problemMetadata.ts';
import { validateCandidate } from '../oracle/validate.ts';

export const CONTENT_VERSION = 3;
export function randomFor(seed: number) {
 let state=seed>>>0;
 return () => { state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296; };
}
/** Shuffle labels and the answer together. Older stored choices are never reshuffled. */
export function shuffleChoices<T extends {choices:string[];answer:GeneratedProblem['answer']}>(p:T,seed:number):T {
 if(p.answer.kind!=='choice')return p;
 const next=randomFor(seed), entries=p.choices.map((label,index)=>({label,index}));
 for(let i=entries.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[entries[i],entries[j]]=[entries[j],entries[i]];}
 const correct=p.answer.index;
 return {...p,choices:entries.map(v=>v.label),answer:{kind:'choice',index:entries.findIndex(v=>v.index===correct)}};
}
export function contentDifficulty(p:GeneratedProblem):DifficultyTier {
 if(p.given.reasoning==='minimum'||p.given.reasoning==='maximum')return 'CHALLENGE';
 if(p.gradingMode==='constraint'||['sufficient','multiple','height-projection','layer-height','candidate-match','impossible-count'].includes(p.given.reasoning??''))return 'APPLICATION';
 if(p.given.reasoning==='no-hidden')return 'BASIC';
 if(p.problemType==='BUILD_FROM_HEIGHTMAP'||p.problemType==='BUILD_FROM_LAYERS')return 'APPLICATION';
 if(p.problemType==='BLOCK_POSITION'||(p.problemType==='COUNT'&&p.givenBlocks.length>0&&p.givenBlocks.length<=6))return 'BASIC';
 if(p.problemType==='PROJECTION_DRAW'&&p.answer.kind==='projections'&&Object.keys(p.answer.projections).length===1)return 'BASIC';
 return 'PRACTICE';
}
export function acceptContent(p:GeneratedProblem):GeneratedProblem {
 const result=validateCandidate(p);
 if(!result.ok)throw new Error(`CONTENT_ORACLE_REJECTED:${p.templateId}:${result.issues.map(v=>v.field).join(',')}`);
 const difficultyTier=contentDifficulty(p);
 return {...p,difficultyTier,difficulty:difficultyTier==='BASIC'?1:difficultyTier==='PRACTICE'?2:3};
}

export const CONTENT_TEMPLATES:Record<number,string[]>={
 5:['lesson5-unknown-choice','lesson5-hidden-min','lesson5-hidden-max','lesson5-extra-info','lesson5-same-view','lesson5-reveal-count','lesson5-minimum','lesson5-counterexample'],
 6:['lesson6-build-views','lesson6-another-solution','lesson6-possible-shape','lesson6-minimum','lesson6-maximum','lesson6-unique-or-many','lesson6-add-height','lesson6-invalid-count'],
 12:['lesson12-direction','lesson12-projection','lesson12-count','lesson12-height-map','lesson12-layer-map','lesson12-constraint','lesson12-hidden-block','lesson12-spatial-choice'],
};
export function contentProblem(lesson:number,index:number,seed:number):GeneratedProblem {
 const random=randomFor(seed+Math.imul(index+1,7919)+lesson*101);
 const grid={gridWidth:2+(seed%2===0?1:0),gridDepth:2,maxHeight:3};
 const heights=Array.from({length:2},()=>Array.from({length:grid.gridWidth},()=>Math.floor(random()*4)));
 heights[0][0]=2; heights[1][1]=3;
 const blocks=fromHeightMap(heights), projections=project(blocks,grid);
 const ids=CONTENT_TEMPLATES[lesson],mode=index%ids.length;
 const p:GeneratedProblem={code:`GEN-L${lesson}-S${seed}-${String(index+1).padStart(2,'0')}-V3`,lesson,orderIndex:100+index,stage:'more',templateId:ids[mode],seed,generatorVersion:3,sourceType:'GENERATED_PRACTICE',conceptTags:conceptTagsForLesson(lesson),difficultyTier:'PRACTICE',difficulty:2,xp:25,title:`${lesson}차시 연습 ${index+1}`,prompt:'',grid,givenBlocks:[],startBlocks:[],given:{projections,allowRotate:false,allowLayerView:false},choices:[],answer:{kind:'count',value:0},problemType:'COUNT',gradingMode:'exact',hint:'공개된 자료를 비교하고 같은 자리의 아래층부터 생각해 보세요.',explanation:''};
 const useViews=(frontOnly=false)=>{p.given.projections=frontOnly?{front:projections.front}:projections;return analyzeSolutions({grid,projections:p.given.projections});};
 const numeric=(value:number,prompt:string)=>{p.problemType='COUNT';p.answer={kind:'count',value};p.prompt=prompt;};
 const choice=(labels:string[],correct:number,prompt:string)=>{p.problemType='CHOICE';p.choices=labels;p.answer={kind:'choice',index:correct};p.prompt=prompt;};
 const build=()=>{p.problemType='BUILD_FROM_VIEWS';p.gradingMode='constraint';p.answer={kind:'blocks',blocks};p.prompt='위·앞·오른쪽 옆 조건을 모두 만족하도록 쌓아 보세요.';p.given.allowRotate=true;};
 const extremum=(max:boolean)=>{const r=useViews(lesson===5);p.given.reasoning=max?'maximum':'minimum';numeric(max?r.maxCubeCount!:r.minCubeCount!,`가로 ${grid.gridWidth}칸, 깊이 ${grid.gridDepth}칸, 높이 ${grid.maxHeight}층 안에서 공개된 모양을 유지하며 쌓는 ${max?'최대':'최소'} 개수는 얼마인가요?`);p.explanation=`모든 자리의 가능한 높이를 조건과 비교하면 ${r.minCubeCount}개부터 ${r.maxCubeCount}개까지 가능해요. ${max?'가장 많이':'가장 적게'} 쌓으면 ${max?r.maxCubeCount:r.minCubeCount}개예요.`;};
 if(lesson===5){
  const r=useViews(true);
  if(mode===0){p.given.reasoning='sufficient';choice(['알 수 있어요','알 수 없어요'],r.isCountDeterminable?0:1,'앞에서 본 모양만으로 전체 개수를 정확히 알 수 있나요?');}
  if(mode===1){p.given.reasoning='no-hidden';p.given.note='보이지 않는 블록은 없다고 가정해요.';numeric(projections.front.flat().filter(Boolean).length,'숨은 블록이 없고 앞면의 각 칸에 한 개씩 있다고 가정하면 몇 개인가요?');p.explanation='숨은 블록이 없다는 가정이므로 앞면의 칸 수를 더해요.';}
  if(mode===2||mode===6)extremum(mode===2);
  if(mode===3){p.given={heightMap:heights,projections:{front:projections.front},allowRotate:false,reasoning:'height-sum'};numeric(blocks.length,'앞모습에 더해 모든 자리의 높이를 공개했어요. 이제 전체는 몇 개인가요?');p.explanation=`높이 지도 ${heights.flat().join(' + ')} = ${blocks.length}개예요.`;}
  if(mode===4){p.given={projections:{...projections},allowRotate:false,reasoning:'sufficient'};const all=useViews();choice(['알 수 있어요','알 수 없어요'],all.isCountDeterminable?0:1,'이번에는 세 방향을 모두 공개했어요. 전체 개수가 하나로 정해지나요?');}
  if(mode===5){p.given={allowRotate:true,allowLayerView:true};p.givenBlocks=blocks;numeric(blocks.length,'회전과 층별 보기가 가능해졌어요. 실제 모형은 모두 몇 개인가요?');p.explanation=`자리별 높이 ${heights.flat().join(' + ')} = ${blocks.length}개예요.`;}
  if(mode===7){p.given={projections:{front:projections.front},heightMap:toHeightMap(r.representativeSolutions.at(-1)!,grid),allowRotate:false,reasoning:'height-sum'};numeric(r.maxCubeCount!,'앞면의 칸 수가 전체 개수라는 주장에 대해, 이 높이 지도의 반례는 모두 몇 개인지 구하세요.');p.explanation='앞모습은 같아도 뒤쪽에 블록을 더 놓으면 전체 개수는 커져요.';}
 }else if(lesson===6){
  const r=useViews();
  if(mode===0||mode===1)build();
  if(mode===1){p.prompt=r.isShapeUnique?'세 방향을 만족하는 입체를 복원하세요.':'같은 세 방향으로 여러 모양이 가능해요. 조건을 만족하는 모양 하나를 쌓으세요.';}
  if(mode===2){
   const candidate=heights.map(row=>row.map(v=>v));
   if(seed%2===0)candidate[0][0]=0;
   const got=project(fromHeightMap(candidate),grid);
   const valid=(['top','front','side'] as const).every(f=>grid2DEqual(got[f],projections[f]));
   p.given.heightMap=candidate;p.given.reasoning='candidate-match';
   choice(['조건에 맞아요','조건에 맞지 않아요'],valid?0:1,'후보 입체의 높이 지도와 세 방향 조건을 비교하세요. 이 후보가 조건에 맞나요?');
   p.explanation='후보 높이 지도를 세 방향으로 바꾸어 공개된 그림과 한 칸씩 비교해요.';
  }
  if(mode===5){p.given.reasoning='multiple';choice(['여러 모양이 가능해요','한 모양만 가능해요'],r.isShapeUnique?1:0,'세 방향 조건을 모두 맞추어도 서로 다른 모양이 가능한가요?');}
  if(mode===3||mode===4)extremum(mode===4);
  if(mode===6){p.problemType='BUILD_FROM_HEIGHTMAP';p.given={projections,heightMap:heights,allowRotate:true};p.answer={kind:'blocks',blocks};p.prompt='세 방향에 자리별 높이까지 추가했어요. 이제 정해진 한 모양을 복원하세요.';}
  if(mode===7){p.given.reasoning='impossible-count';choice([`${r.minCubeCount}개`,`${r.maxCubeCount}개`,`${r.maxCubeCount!+1}개`].filter((v,i,a)=>a.indexOf(v)===i),0,'세 방향 조건에서 만들 수 없는 전체 개수를 고르세요.');p.answer={kind:'choice',index:p.choices.length-1};p.explanation=`가능한 개수는 ${r.uniqueCubeCounts.join(', ')}개예요. 최대보다 큰 ${r.maxCubeCount!+1}개는 불가능해요.`;}
 }else{
  if(mode===0||mode===1){p.problemType='PROJECTION_DRAW';p.given={heightMap:heights,allowRotate:false,reasoning:'height-projection'};p.answer={kind:'projections',projections:mode===0?{side:projections.side}:projections};p.prompt=mode===0?'자리별 높이를 보고 오른쪽 옆모습을 그리세요.':'높이 지도를 위·앞·오른쪽 옆의 세 그림으로 바꾸세요.';}
  if(mode===2){p.given={layers:toLayers(blocks,grid),allowRotate:false,reasoning:'layer-sum'};numeric(blocks.length,'층별 자료를 자리별 높이로 생각하며 전체 개수를 구하세요.');}
  if(mode===3||mode===4){p.problemType='HEIGHTMAP_FROM_BUILD';p.given={layers:toLayers(blocks,grid),allowRotate:false,reasoning:'layer-height'};p.answer={kind:'heightMap',heightMap:heights};p.prompt='층별 그림에서 같은 자리의 칸을 세어 높이 지도로 바꾸세요.';if(mode===4){p.problemType='LAYER_DRAW';p.given={heightMap:heights,allowRotate:false,reasoning:'height-layers'};p.answer={kind:'layers',layers:toLayers(blocks,grid)};p.prompt='높이 지도의 숫자를 층별 모양으로 바꾸세요.';}}
  if(mode===5)build();
  if(mode===6)extremum(true);
  if(mode===7){const r=useViews();p.given.reasoning='sufficient';choice(['알 수 있어요','알 수 없어요'],r.isCountDeterminable?0:1,'세 방향의 모양을 알면 전체 개수도 반드시 하나로 정해질까요? 이 자료로 판단하세요.');}
 }
 if(!p.explanation)p.explanation=p.given.reasoning==='sufficient'?'조건에 맞는 높이 배치를 비교해서 전체 개수가 모두 같은지 확인해요.':'공개된 자료의 같은 자리와 방향을 비교해 조건을 모두 만족하는지 확인해요.';
 return acceptContent(shuffleChoices(p,seed^Math.imul(index+1,0x9e3779b9)^lesson));
}
