import { fromHeightMap, project, validStructure, placeOnColumn } from '../../blocks.ts';
import type { BlockCoord, GridConfig } from '../../types.ts';
import { CURRICULUM_VERSION, type Face, type Problem, type ConceptTag, type Stage } from '../contracts/spatial.ts';
export const LESSON3_GRID:GridConfig={gridWidth:3,gridDepth:3,maxHeight:3};
export const LESSON3_MODEL=fromHeightMap([[1,2,0],[0,1,0],[0,0,3]]);
export const FACE_LABELS:Record<Face,string>={top:'위',front:'앞',side:'옆'};
export const FACES:Face[]=['top','front','side'];
export function modelForSeed(seed:number):BlockCoord[] {
 let state=(seed>>>0)||1;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 for(let attempt=0;attempt<64;attempt++) {
  const heights=Array.from({length:3},()=>Array.from({length:3},()=>Math.floor(random()*4)));
  const blocks=fromHeightMap(heights);const projections=project(blocks,LESSON3_GRID);
  if(blocks.length>=4 && validStructure(blocks,LESSON3_GRID) && new Set(FACES.map(f=>JSON.stringify(projections[f]))).size===3) return blocks;
 }
 throw new Error('구별 가능한 모형을 생성하지 못했습니다.');
}
export type Lesson3Kind='direction'|'side-choice'|'top'|'front'|'side'|'error'|'change';
export function lesson3Problem(kind:Lesson3Kind,seed:number,stage:Stage,index:number):Problem {
 const blocks=modelForSeed(seed);const projections=project(blocks,LESSON3_GRID);
 const tag:ConceptTag=kind==='direction'?'projection-direction':kind==='error'?'projection-error-analysis':kind==='change'?'projection-change':kind==='side-choice'?'projection-side':`projection-${kind}`;
 const focus:Face=kind==='side'||kind==='side-choice'?'side':kind==='top'?'top':'front';
 const p:Problem={id:`${CURRICULUM_VERSION}:l3:${stage}:${index}:${kind}:${seed}`,curriculumVersion:CURRICULUM_VERSION,version:1,seed,lessonId:3,stage,conceptTags:[tag],prompt:'',learningIntent:'입체와 위·앞·오른쪽 옆 표현을 연결한다.',grid:LESSON3_GRID,
 presentedMaterials:[{kind:'model',blocks,caption:'살펴볼 모형'}],answerInput:{kind:'projection-grid',faces:[focus]},gradingPolicy:{kind:'exact-grid',grids:{[focus]:projections[focus]}},
 feedbackPolicy:{first:focus==='top'?'높이 대신 블록이 있는 자리를 살펴보세요.':'각 자리에서 가장 높은 블록까지 보이는지 살펴보세요.',hint:focus==='top'?'위에서 보며 각 바닥 자리에 블록이 하나라도 있으면 표시하세요.':'아래 칸부터 가장 높은 블록까지 빠짐없이 표시하세요. 옆은 오른쪽에서 봅니다.',focus},
 revealPolicy:{kind:'compare-answer',reason:'위는 블록이 있는 자리, 앞·옆은 그 방향에서 가려지지 않고 보이는 칸을 나타냅니다.'},completionPolicy:{kind:'correct-or-correct-after-reveal'},cameraPolicy:{kind:'free',initialView:'home',allowedViews:['home','top','front','side']},allowedViews:['home','top','front','side'],solutionPolicy:{kind:'unique'}};
 if(kind==='top'||kind==='front'||kind==='side') {p.prompt=`${FACE_LABELS[kind]}에서 본 모양을 격자에 표시하세요.`;return p;}
 if(kind==='direction') {
  const face=FACES[(seed>>>0)%3];p.prompt='이 그림은 어느 방향에서 본 모양인가요?';
  p.presentedMaterials.push({kind:'projection',face,grid:projections[face],caption:'방향을 찾을 그림'});
  p.answerInput={kind:'choice',choices:FACES.map(f=>({id:f,label:FACE_LABELS[f]}))};p.gradingPolicy={kind:'exact-choice',value:face};return p;
 }
 if(kind==='side-choice') {
  p.prompt='오른쪽 옆에서 본 모양을 찾으세요.';
  const order:Face[]=seed%2?['front','side','top']:['side','top','front'];
  order.forEach((face,i)=>p.presentedMaterials.push({kind:'projection',face,grid:projections[face],caption:['가','나','다'][i]}));
  p.answerInput={kind:'choice',choices:order.map((f,i)=>({id:f,label:['가','나','다'][i]}))};p.gradingPolicy={kind:'exact-choice',value:'side'};return p;
 }
 if(kind==='error') {
  const wrong=projections.front.map(r=>[...r]);let changed=false;
  for(let y=0;y<3&&!changed;y++)for(let x=0;x<3&&!changed;x++)if(!wrong[y][x]){wrong[y][x]=true;changed=true;}
  if(!changed){wrong[2][0]=false;}
  p.prompt='잘못 그린 그림과 그 이유를 함께 고르세요.';
  p.presentedMaterials.push({kind:'projection',face:'top',grid:projections.top,caption:'가 · 위'},{kind:'projection',face:'front',grid:wrong,caption:'나 · 앞'},{kind:'projection',face:'side',grid:projections.side,caption:'다 · 옆'});
  p.answerInput={kind:'choice',choices:[{id:'extra',label:changed?'나 · 블록이 보이지 않는 칸을 표시했다.':'나 · 블록이 보이는 칸을 빠뜨렸다.'},{id:'height',label:'가 · 높이 숫자를 쓰지 않았다.'},{id:'direction',label:'다 · 왼쪽과 오른쪽을 반대로 보았다.'}]};p.gradingPolicy={kind:'exact-choice',value:'extra'};
  p.revealPolicy.reason=changed?'앞에서 각 열의 최대 높이를 넘는 칸은 보이지 않습니다. 나에는 그 칸이 더 표시되어 있습니다.':'앞에서 보이는 칸을 빠짐없이 표시해야 합니다. 나에는 보이는 칸이 빠져 있습니다.';return p;
 }
 let added=blocks;let location={x:0,z:0};
 outer:for(let z=0;z<3;z++)for(let x=0;x<3;x++){const result=placeOnColumn(blocks,x,z,LESSON3_GRID);if(result.check.ok){added=result.blocks;location={x,z};break outer;}}
 const after=project(added,LESSON3_GRID);const changed=FACES.filter(f=>JSON.stringify(after[f])!==JSON.stringify(projections[f]));
 p.prompt=`가로 ${location.x+1}번, 앞에서 ${location.z+1}번째 자리에 블록 하나를 더 쌓았습니다. 달라진 모습을 모두 포함한 설명을 고르세요.`;
 p.presentedMaterials.push({kind:'model',blocks:added,caption:'블록 하나를 더 쌓은 모형'});
 const combos:Face[][]=[[],['top'],['front'],['side'],['top','front'],['top','side'],['front','side'],['top','front','side']];
 p.answerInput={kind:'choice',choices:combos.map(fs=>({id:fs.length?fs.join('-'):'none',label:fs.length?fs.map(f=>FACE_LABELS[f]).join('·')+' 모습이 달라졌다.':'세 모습 모두 그대로이다.'}))};
 p.gradingPolicy={kind:'exact-choice',value:changed.length?changed.join('-'):'none'};p.revealPolicy.reason=changed.length?`바뀐 자리와 높이를 비교하면 ${changed.map(f=>FACE_LABELS[f]).join('·')}의 칸이 달라집니다.`:'추가된 블록은 세 방향 모두 기존 모양에 가려져, 세 모습이 그대로입니다.';return p;
}
export const COMMON_KINDS:Lesson3Kind[]=['direction','side-choice','top','front','side','error'];
export const PRACTICE_KINDS:Lesson3Kind[]=['top','front','side','direction','change'];
export function commonProblems(seed:number) {return COMMON_KINDS.map((kind,i)=>lesson3Problem(kind,seed+i*97,'solve',i));}
export function adaptiveProblems(seed:number,errors:Partial<Record<ConceptTag,number>>) {
 const ranked=Object.entries(errors).filter(([,n])=>n!>0).sort((a,b)=>b[1]!-a[1]!||a[0].localeCompare(b[0]));
 const kinds:Lesson3Kind[]=ranked.length ? ranked.map(([tag])=>tag==='projection-top'?'top':tag==='projection-front'?'front':tag==='projection-side'?'side':tag==='projection-direction'?'direction':'error') : ['change','error','change','error'];
 return Array.from({length:4},(_,i)=>lesson3Problem(kinds[i%kinds.length],seed+900+i*97,ranked.length?'remediation':'challenge',6+i));
}
export function practiceProblems(seed:number,count=5) {return Array.from({length:Math.min(10,count)},(_,i)=>lesson3Problem(PRACTICE_KINDS[i%5],seed+2000+i*97,'practice',i));}
