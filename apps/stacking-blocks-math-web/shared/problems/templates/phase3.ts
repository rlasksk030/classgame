import { fromHeightMap,project,toLayers } from '../../blocks.ts';
import type { BlockCoord } from '../../types.ts';
import type { Problem,Stage,ConceptTag,Material } from '../contracts/spatial.ts';
import { analyzeSolutions,validatedHeightBlocks,validatedLayerBlocks,type ProjectionConstraints } from '../solvers/projection.ts';
export type Phase3Lesson=5|6|7|8;
export const INFERENCE_GRID={gridWidth:2,gridDepth:2,maxHeight:2};
const full=[[true,true],[true,true]];
export const MULTIPLE_CONSTRAINTS:ProjectionConstraints={grid:INFERENCE_GRID,projections:{top:full,front:full,side:full}};
export const FRONT_CONSTRAINTS:ProjectionConstraints={grid:{gridWidth:1,gridDepth:2,maxHeight:3},projections:{front:[[true],[true],[true]]}};
export const classify=(r:ReturnType<typeof analyzeSolutions>)=>r.isShapeUnique?'unique':r.isCountDeterminable?'multiple-shapes-same-count':'multiple-shapes-different-count';
export function constraintMaterials(c:ProjectionConstraints):Material[]{return Object.entries(c.projections??{}).map(([f,grid])=>({kind:'projection',face:f as 'top'|'front'|'side',grid,caption:({top:'위',front:'앞',side:'옆(오른쪽)'} as Record<string,string>)[f]+'에서 본 모양'}));}
export function inferenceBase(lessonId:Phase3Lesson,seed:number,stage:Stage,index:number,tag:ConceptTag,c:ProjectionConstraints):Problem{
 const r=analyzeSolutions(c);
 return {id:`spatial-v2:p3:l${lessonId}:${stage}:${index}:${tag}:${seed}`,curriculumVersion:'spatial-v2',version:1,seed,lessonId,stage,conceptTags:[tag],prompt:'',learningIntent:tag,grid:c.grid,presentedMaterials:constraintMaterials(c),answerInput:{kind:'number',min:0,max:c.grid.gridWidth*c.grid.gridDepth*c.grid.maxHeight},gradingPolicy:{kind:'exact-number',value:r.minCubeCount!},feedbackPolicy:{first:'공개된 조건을 하나씩 다시 살펴보세요.',hint:'같은 자리의 블록은 아래층부터 차례로 쌓여야 해요.',focus:'front'},revealPolicy:{kind:'compare-answer',reason:`조건을 만족하는 모양은 ${r.solutionCount}가지이며 가능한 개수는 ${r.uniqueCubeCounts.join(', ')}개입니다.`},completionPolicy:{kind:'correct-or-correct-after-reveal'},cameraPolicy:lessonId===5?{kind:'fixed',initialView:'front',allowedViews:['front']}:{kind:'free',initialView:'home',allowedViews:['home','top','front','side']},allowedViews:lessonId===5?['front']:['home','top','front','side'],solutionPolicy:{kind:r.isShapeUnique?'unique':'any-valid'},solutionEvidence:{solverVersion:r.solverVersion,classification:classify(r),solutionCount:r.solutionCount,counts:r.uniqueCubeCounts}};
}
function judgment(p:Problem,value:boolean,yes='알 수 있어요',no='알 수 없어요'){p.answerInput={kind:'boolean-judgment',yesLabel:yes,noLabel:no};p.gradingPolicy={kind:'determinability',determinable:value,evidence:p.revealPolicy.reason};}
function choices(p:Problem,items:{id:string;label:string}[],value:string){p.answerInput={kind:'choice',choices:items};p.gradingPolicy={kind:'exact-choice',value};}
function models(p:Problem,blocks:BlockCoord[][]){p.presentedMaterials.push(...blocks.map((b,i)=>({kind:'model' as const,blocks:b,caption:`가능한 모양 ${i===0?'가':'나'}`})));p.cameraPolicy={kind:'free',initialView:'home',allowedViews:['home','top','front','side']};p.allowedViews=p.cameraPolicy.allowedViews;}
function range(p:Problem,c:ProjectionConstraints,max:boolean){const r=analyzeSolutions(c);p.gradingPolicy={kind:max?'max-count':'min-count',solver:'projection-search-v1',constraints:c.projections??{},value:max?r.maxCubeCount!:r.minCubeCount!};}
export const PHASE3_TAGS:Record<Phase3Lesson,ConceptTag[]>={5:['hidden-blocks','information-sufficiency','total-count','solution-comparison','additional-information','count-range'],6:['solution-comparison','constraint-build','total-count','constraint-build','information-sufficiency','count-range'],7:['column-height','height-reconstruction','constraint-build','total-count','projection-front','projection-side'],8:['layer-reconstruction','total-count','layer-map','height-map','layer-reconstruction','layer-rule']};
export function lesson5Problem(seed:number,stage:Stage,index:number,kind=index%6):Problem{
 const c:ProjectionConstraints=kind===1&&seed%2===1?{...FRONT_CONSTRAINTS,projections:{...FRONT_CONSTRAINTS.projections,side:[[true,true],[false,true],[false,true]]}}:kind===2?{...FRONT_CONSTRAINTS,heights:[[3],[1]]}:kind===3?{...MULTIPLE_CONSTRAINTS,exactCount:6}:FRONT_CONSTRAINTS;
 const r=analyzeSolutions(c),p=inferenceBase(5,seed,stage,index,PHASE3_TAGS[5][kind],c);
 if(kind===0){p.prompt='지금 앞모습을 유지하면서 뒤쪽에 보이지 않는 블록을 더 놓을 수 있을까요?';judgment(p,r.minCubeCount!==r.maxCubeCount,'놓을 수 있어요','놓을 수 없어요');}
 if(kind===1){p.prompt='지금 공개된 방향 자료만으로 쌓기나무의 전체 개수를 정확히 알 수 있나요?';judgment(p,r.isCountDeterminable);}
 if(kind===2){p.presentedMaterials.push({kind:'height-map',grid:[[3],[1]],caption:'추가로 공개한 자리별 높이'});p.prompt='앞뒤 두 자리의 높이까지 공개했어요. 전체 개수는 몇 개인가요?';p.gradingPolicy={kind:'exact-number',value:r.minCubeCount!};}
 if(kind===3){p.prompt='조건이 같은 두 모양은 서로 다르지만 전체 개수는 같나요? (전체 6개 조건)';models(p,r.representativeSolutions);judgment(p,r.isCountDeterminable,'같아요','달라요');}
 if(kind===4){p.prompt='앞모습만 보고 정확한 개수를 알 수 없어요. 다음 중 전체 개수를 확정할 수 있는 추가 정보는 무엇인가요?';
  const right=project(fromHeightMap([[3],[1]]),c.grid).side;const top=analyzeSolutions({...c,projections:{...c.projections,top:[[true],[true]]}}),height=analyzeSolutions({...c,projections:{...c.projections,side:right}});if(top.isCountDeterminable||!height.isCountDeterminable)throw new Error('ADDITIONAL_INFORMATION_NOT_PROVEN');
  choices(p,[{id:'top',label:'위에서 두 자리가 찼다는 정보만'},{id:'right',label:'오른쪽 옆의 각 기둥 높이'},{id:'color',label:'블록의 색'}],'right');p.additionalMaterials=[{kind:'projection',face:'side',grid:right,caption:'추가로 선택한 오른쪽 옆'}];p.revealPolicy.reason=`이 판은 가로 한 자리이므로 오른쪽 옆에서 앞뒤 높이를 모두 알 수 있어요. 예시처럼 앞 3층·뒤 1층을 공개하면 가능한 모양은 ${r.solutionCount}가지에서 ${height.solutionCount}가지로 줄고 전체 ${height.minCubeCount}개로 정해져요. 일반적으로 옆 정보 한 장만으로 항상 충분한 것은 아니에요.`;
 }
 if(kind===5){const max=(seed&1)===1;p.prompt=`앞모습과 같은 높이 3칸, 깊이 2자리 판이에요. 가능한 블록의 ${max?'최대':'최소'} 개수는?`;range(p,c,max);}
 p.feedbackPolicy.hint=kind===4?'전체 개수는 각 자리 높이의 합이에요.':kind===3?'모양과 개수가 각각 같은지 따로 비교하세요.':'높이가 3인 기둥이 하나 이상 필요해요. 나머지 자리 높이는 달라질 수 있나요?';
 return p;
}
function buildPolicy(p:Problem,c:ProjectionConstraints){const r=analyzeSolutions(c);p.answerInput={kind:'block-builder'};p.gradingPolicy={kind:'projection-constraints',grids:c.projections??{},example:r.representativeSolutions[0],constraints:c};p.cameraPolicy={kind:'free',initialView:'home',allowedViews:['home','top','front','side']};p.allowedViews=p.cameraPolicy.allowedViews;}
export function lesson6Problem(seed:number,stage:Stage,index:number,kind=index%6):Problem{
 const c:ProjectionConstraints=kind===2?{...MULTIPLE_CONSTRAINTS,heights:[[2,2],[2,2]]}:MULTIPLE_CONSTRAINTS;
 const r=analyzeSolutions(c),p=inferenceBase(6,seed,stage,index,PHASE3_TAGS[6][kind],c);
 if(kind===0||kind===3){const valid=r.representativeSolutions[seed%2],invalid=fromHeightMap([[1,1],[1,1]]);models(p,[valid,invalid]);p.presentedMaterials[p.presentedMaterials.length-2]={kind:'model',blocks:valid,caption:'후보 가'};p.presentedMaterials[p.presentedMaterials.length-1]={kind:'model',blocks:invalid,caption:'후보 나'};p.prompt='위·앞·옆 조건을 모두 만족하는 후보를 고르세요.';choices(p,[{id:'a',label:'후보 가'},{id:'b',label:'후보 나'}],'a');p.revealPolicy.reason='후보 가는 두 앞 기둥과 두 옆 기둥의 최대 높이가 모두 2예요. 후보 나는 높이가 1이라 조건과 달라요.';}
 if(kind===1){p.prompt='위·앞·옆 자료를 모두 만족하게 직접 쌓으세요. 가능한 모양 중 하나를 만들면 돼요.';buildPolicy(p,c);}
 if(kind===2){p.presentedMaterials.push({kind:'height-map',grid:[[2,2],[2,2]],caption:'각 자리 높이도 공개했어요'});p.prompt='각 자리 높이가 모두 2로 정해졌어요. 필요한 블록은 몇 개인가요?';}
 if(kind===4){p.prompt='이 세 방향 조건에서도 서로 다른 입체가 가능할까요?';judgment(p,!r.isShapeUnique,'다른 모양도 가능해요','한 모양만 가능해요');}
 if(kind===5){models(p,r.representativeSolutions);p.prompt='조건을 만족하는 가능한 모양 가·나 중 어느 쪽의 블록이 더 많나요?';choices(p,[{id:'a',label:'가가 더 많아요'},{id:'b',label:'나가 더 많아요'},{id:'same',label:'같아요'}],r.minCubeCount===r.maxCubeCount?'same':'b');}
 p.feedbackPolicy.hint='위의 모든 자리를 채우고, 앞과 옆의 각 기둥 중 적어도 하나가 높이 2인지 확인해 보세요.';return p;
}
export const HEIGHT_GRID={gridWidth:2,gridDepth:2,maxHeight:3};
export function lesson7Problem(seed:number,stage:Stage,index:number,kind=index%6):Problem{
 const heights=[[2,0],[1,2+(seed%2)]],blocks=validatedHeightBlocks(HEIGHT_GRID,heights),c={grid:HEIGHT_GRID,heights},p=inferenceBase(7,seed,stage,index,PHASE3_TAGS[7][kind],c);
 p.presentedMaterials=[{kind:'height-map',grid:heights,caption:'자리별 높이 지도'}];
 p.cameraPolicy={kind:'free',initialView:'home',allowedViews:['home','top','front','side']};p.allowedViews=p.cameraPolicy.allowedViews;
 p.revealPolicy.reason=`각 자리의 높이 ${heights.flat().join(' + ')}를 더하면 ${blocks.length}개예요. 각 숫자는 그 자리에 아래부터 쌓인 개수입니다.`;
 if(kind===0){p.prompt='앞 첫째 줄, 가로 첫째 자리 숫자 2는 몇 층까지 쌓았다는 뜻인가요?';p.gradingPolicy={kind:'exact-number',value:2};}
 if(kind===1){models(p,[blocks,fromHeightMap([[1,0],[2,heights[1][1]]])]);p.prompt='높이 지도와 정확히 같은 입체를 고르세요.';choices(p,[{id:'a',label:'모양 가'},{id:'b',label:'모양 나'}],'a');}
 if(kind===2){p.prompt='높이 지도의 숫자만큼 각 자리에 직접 쌓으세요.';p.answerInput={kind:'block-builder'};p.gradingPolicy={kind:'exact-block-coordinates',blocks};}
 if(kind===3){p.prompt='높이 지도에 나타낸 블록은 모두 몇 개인가요?';p.gradingPolicy={kind:'exact-number',value:blocks.length};}
 if(kind===4||kind===5){const face=kind===4?'front':'side';p.prompt=`높이 지도를 보고 ${face==='front'?'앞':'옆(오른쪽)'}에서 본 모양을 그리세요.`;p.answerInput={kind:'projection-grid',faces:[face]};p.gradingPolicy={kind:'exact-grid',grids:{[face]:project(blocks,HEIGHT_GRID)[face]}};p.revealPolicy.reason='관찰 방향으로 겹치는 자리에서는 가장 높은 기둥까지 보여요.';}
 return p;
}
export function lesson8Problem(seed:number,stage:Stage,index:number,kind=index%6):Problem{
 const heights=[[3,1],[2,0]],blocks=validatedHeightBlocks(HEIGHT_GRID,heights),layers=toLayers(blocks,HEIGHT_GRID),p=inferenceBase(8,seed,stage,index,PHASE3_TAGS[8][kind],{grid:HEIGHT_GRID,layers});
 validatedLayerBlocks(HEIGHT_GRID,layers);p.presentedMaterials=[{kind:'layer-map',grids:layers,caption:'층별 모양'}];
 p.cameraPolicy={kind:'free',initialView:'home',allowedViews:['home','top','front','side']};p.allowedViews=p.cameraPolicy.allowedViews;
 p.revealPolicy.reason='윗층의 블록은 같은 자리의 아래층 블록 위에 놓입니다. 층별 개수를 더하면 3 + 2 + 1 = 6개예요.';
 if(kind===0){p.prompt='1층부터 순서대로 층별 지도와 같은 입체를 직접 쌓으세요.';p.answerInput={kind:'block-builder'};p.gradingPolicy={kind:'exact-block-coordinates',blocks};}
 if(kind===1){p.prompt='층별 지도의 블록을 모두 합하면 몇 개인가요?';}
 if(kind===2){p.prompt='3D 모형을 보고 각 층의 모양을 그리세요.';p.presentedMaterials=[{kind:'model',blocks,caption:'층별로 나타낼 입체'}];p.answerInput={kind:'layer-map',layers:3};p.gradingPolicy={kind:'exact-layers',grids:layers};}
 if(kind===3){p.prompt='층별 지도를 보고 각 자리의 높이 숫자를 쓰세요.';p.answerInput={kind:'height-map',max:3};p.gradingPolicy={kind:'exact-height-map',grid:heights};}
 if(kind===4){p.prompt='아래 자료는 잘못 그린 층이 있어요. 아래층의 받침이 없는 블록이 처음 생기는 층은?';p.presentedMaterials=[{kind:'layer-map',grids:[layers[0],[[true,false],[true,true]],layers[2]],caption:'오류를 찾아볼 층 그림'}];choices(p,[{id:'1',label:'1층'},{id:'2',label:'2층'},{id:'3',label:'3층'}],'2');p.revealPolicy.reason='2층 뒤 오른쪽 칸은 1층에 받침이 없어요. 이 층 그림은 실제로 쌓을 수 없는 오류 자료예요.';}
 if(kind===5){p.prompt='층이 올라갈 때마다 블록 수가 1개씩 줄어드는 규칙이에요. 1·2·3층에 3·2·1개가 있다면 다음 층은 몇 개인가요?';p.gradingPolicy={kind:'exact-number',value:0};p.revealPolicy.reason='문제에서 정한 규칙대로 1개에서 1개를 빼므로 다음 층은 0개예요.';}
 return p;
}
const factories={5:lesson5Problem,6:lesson6Problem,7:lesson7Problem,8:lesson8Problem};
export const phase3Common=(id:Phase3Lesson,seed:number)=>Array.from({length:6},(_,i)=>factories[id](seed+i,'solve',i));
export function phase3Adaptive(id:Phase3Lesson,seed:number,errors:Partial<Record<ConceptTag,number>>){const ranked=PHASE3_TAGS[id].map((tag,i)=>({tag,i})).sort((a,b)=>(errors[b.tag]??0)-(errors[a.tag]??0)||a.i-b.i);return Array.from({length:id<7?4:3},(_,i)=>factories[id](seed+101+i,errors[ranked[i].tag]?'remediation':'challenge',6+i,ranked[i].i));}
export const phase3Practice=(id:Phase3Lesson,seed:number,count=5)=>Array.from({length:count},(_,i)=>factories[id](seed+201+i,'practice',i,id===5?[1,0,4,5,3][i%5]:id===6?[1,0,4,1,5][i%5]:i%6));
export const PHASE3_TITLES:Record<Phase3Lesson,string>={5:'정보가 충분한지 알아보기',6:'세 방향으로 입체 추측하기',7:'높이 지도로 입체 만들기',8:'층별 지도로 입체 만들기'};
export interface Phase3Activity{title:string;instruction:string;problem:Problem;}
export function phase3Activities(id:Phase3Lesson):Phase3Activity[]{
 const base=(i:number,kind:number)=>factories[id](301+i,'learn',i,kind);
 if(id===5){
  const oblique:ProjectionConstraints={grid:HEIGHT_GRID,heights:[[3,3],[null,3]],layers:[null,null,[[true,true],[false,true]]],projections:{front:[[true,true],[true,true],[true,true]],side:[[true,true],[true,true],[true,true]]}};
  const a=inferenceBase(5,301,'learn',0,'hidden-blocks',oblique);a.prompt='고정된 사선 예시를 보고 쌓아 보세요. 앞 두 자리와 뒤 오른쪽은 3층이고, 뒤 왼쪽은 0~2층까지 가려질 수 있어요.';a.presentedMaterials=[{kind:'model',blocks:analyzeSolutions(oblique).representativeSolutions[0],caption:'지정된 사선에서 본 쌓기 예시'},...constraintMaterials(oblique)];buildPolicy(a,oblique);a.cameraPolicy={kind:'fixed',initialView:'home',allowedViews:['home']};a.allowedViews=['home'];
  const b=base(1,1),r=analyzeSolutions(FRONT_CONSTRAINTS);models(b,r.representativeSolutions);b.prompt='앞모습은 같지만 개수가 다른 두 모형을 돌려 비교했어요. 전체 개수가 하나로 정해지나요?';
  const c={...FRONT_CONSTRAINTS,projections:{...FRONT_CONSTRAINTS.projections,top:[[true],[true]]}},third=inferenceBase(5,303,'learn',2,'information-sufficiency',c);third.prompt='위에서 두 자리가 보인다는 정보까지 있으면 정확한 전체 개수를 알 수 있나요?';judgment(third,analyzeSolutions(c).isCountDeterminable);
  const e=base(4,5);models(e,analyzeSolutions(FRONT_CONSTRAINTS).representativeSolutions);
  return [a,b,third,base(3,4),e].map((problem,i)=>({title:['보이는 조건으로 쌓기','숨은 부분 비교하기','위에서 본 정보 더하기','무엇이 더 필요할까요?','최소와 최대 비교'][i],instruction:i===0?'지금은 지정된 사선 시점으로만 살펴봐요. 모형과 명시한 조건을 함께 보며 직접 쌓으세요.':'자료를 직접 비교하고 판단을 선택하거나 개수를 입력하세요.',problem}));
 }
 if(id===6){const constraints:ProjectionConstraints[]=[{grid:{...INFERENCE_GRID,maxHeight:1},projections:{top:full}},{grid:INFERENCE_GRID,projections:{top:full,front:full}},MULTIPLE_CONSTRAINTS];const ps=constraints.map((c,i)=>{const p=inferenceBase(6,301+i,'learn',i,'constraint-build',c);p.prompt=['위에서 보이는 자리에 1층을 직접 만드세요.','앞에서 본 조건까지 맞게 기둥을 쌓으세요.','오른쪽 옆 조건까지 모두 맞게 쌓으세요.'][i];buildPolicy(p,c);return p;});const other=base(3,4);models(other,analyzeSolutions(MULTIPLE_CONSTRAINTS).representativeSolutions);const last=base(4,1);last.prompt='원본을 그대로 복사할 필요는 없어요. 세 방향 조건을 만족하는 모양을 직접 완성하세요.';return [...ps,other,last].map((problem,i)=>({title:['위로 1층 만들기','앞 조건 맞추기','오른쪽 옆 조건 맞추기','다른 해 비교하기','조건을 만족하면 정답'][i],instruction:'같은 자리의 아래층부터 쌓아요. 공개된 격자와 비교해 보세요.',problem}));}
 if(id===7){const first=inferenceBase(7,301,'learn',0,'height-reconstruction',{grid:{gridWidth:1,gridDepth:1,maxHeight:3},heights:[[3]]});first.presentedMaterials=[{kind:'height-map',grid:[[3]],caption:'이 자리의 높이'}];first.prompt='높이 3은 1층부터 3층까지예요. 블록을 한 개씩 놓아 3층을 직접 만들어 보세요.';first.answerInput={kind:'block-builder'};first.gradingPolicy={kind:'exact-block-coordinates',blocks:fromHeightMap([[3]])};const fourth=base(3,4);fourth.prompt='높이 지도를 보고 앞과 오른쪽 옆 모양을 모두 그려 보세요.';fourth.answerInput={kind:'projection-grid',faces:['front','side']};const pr=project(fromHeightMap([[2,0],[1,2]]),HEIGHT_GRID);fourth.gradingPolicy={kind:'exact-grid',grids:{front:pr.front,side:pr.side}};
  const c={grid:HEIGHT_GRID,heights:[[2,0],[1,null]],exactCount:6},last=inferenceBase(7,305,'learn',4,'height-reconstruction',c);last.prompt='높이 지도에서 앞줄은 2, 0이고 뒤줄은 1, ?예요. 전체 6개라면 ?의 높이는?';last.presentedMaterials=[{kind:'partial-height-map',grid:[[2,0],[1,null]],caption:'전체 6개인 높이 지도'}];last.gradingPolicy={kind:'exact-number',value:analyzeSolutions(c).representativeSolutions[0].filter(b=>b.x===1&&b.z===1).length};last.revealPolicy.reason='6 − (2 + 0 + 1) = 3이므로 빈 자리의 높이는 3이에요.';
  return [first,base(1,2),base(2,3),fourth,last].map((problem,i)=>({title:['숫자와 층','높이 지도대로 쌓기','높이의 합','앞과 오른쪽 옆','빈 숫자 찾기'][i],instruction:'숫자는 같은 자리에 쌓인 높이예요. 0인 자리는 비워 둡니다.',problem}));}
 const model=fromHeightMap([[3,1],[2,0]]),layers=toLayers(model,HEIGHT_GRID);const ps=[0,1,2].map(i=>{const partial=layers.map((g,j)=>j<=i?g:g.map(r=>r.map(()=>false))),blocks=validatedLayerBlocks(HEIGHT_GRID,partial),p=inferenceBase(8,301+i,'learn',i,'layer-reconstruction',{grid:HEIGHT_GRID,layers:partial});p.presentedMaterials=[{kind:'layer-map',grids:partial.slice(0,i+1),caption:'이번에 만들 층'}];p.prompt=`${i+1}층까지 지도를 보고 직접 쌓으세요.`;p.answerInput={kind:'block-builder'};p.gradingPolicy={kind:'exact-block-coordinates',blocks};return p;});
 return [...ps,base(3,3),base(4,5)].map((problem,i)=>({title:['1층 만들기','2층 추가하기','3층 추가하기','층을 높이로 바꾸기','층별 변화 규칙'][i],instruction:'윗층 블록 아래에는 반드시 받침이 있어야 해요.',problem}));
}
export function middleLayerProblem():Problem{const c:ProjectionConstraints={grid:{gridWidth:2,gridDepth:1,maxHeight:3},layers:[[[true,true]],null,[[true,false]]],exactCount:5},r=analyzeSolutions(c);const p=inferenceBase(8,999,'practice',5,'layer-reconstruction',c);if(!r.isShapeUnique)throw new Error('MIDDLE_LAYER_NOT_UNIQUE');p.prompt='1층과 3층이 주어지고 전체가 5개예요. 빠진 2층을 포함해 모두 그려 보세요.';p.presentedMaterials=[{kind:'projection',face:'top',grid:[[true,true]],caption:'공개한 1층'},{kind:'projection',face:'top',grid:[[true,false]],caption:'공개한 3층'}];p.answerInput={kind:'layer-map',layers:3};p.gradingPolicy={kind:'exact-layers',grids:toLayers(r.representativeSolutions[0],c.grid)};return p;}
