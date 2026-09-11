import { fromHeightMap, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord, DifficultyTier, Grid2D, GridConfig, ProblemGiven, ProblemSourceType, ProblemType } from './types.ts';
import type { SeedProblem } from './seedProblems.ts';
import { conceptTagsForLesson } from './problemMetadata.ts';

/** 차시별 권장 연습량. 교사 설정이 있으면 서버에서 이 값을 덮어쓴다. */
export function recommendedPracticeCount(lesson:number):number {
  return [3,4,6,7,8,12].includes(lesson) ? 20 : 15;
}

export interface ProblemTemplate {
  templateId: string;
  lesson: number;
  problemType: ProblemType;
  conceptTags: string[];
  generatorVersion: number;
  difficulty: DifficultyTier;
}

export interface GeneratedProblem extends SeedProblem {
  templateId: string;
  seed: number;
  generatorVersion: number;
  difficultyTier: DifficultyTier;
  conceptTags: string[];
  sourceType: ProblemSourceType;
}

const TEMPLATES: Record<number, ProblemTemplate[]> = Object.fromEntries(
  Array.from({length: 12}, (_, i) => {
    const lesson = i + 1;
    const type: ProblemType = lesson === 2 ? 'CAMERA_DIRECTION' : lesson === 3 ? 'PROJECTION_DRAW' : lesson === 5 ? 'CHOICE' : lesson === 6 ? 'BUILD_FROM_VIEWS' : lesson === 7 ? 'HEIGHTMAP_FROM_BUILD' : lesson === 8 ? 'BUILD_FROM_LAYERS' : lesson === 12 ? 'COUNT' : lesson === 1 ? 'BLOCK_POSITION' : 'COUNT';
    return [lesson, [{templateId: `lesson${lesson}-${type.toLowerCase()}`, lesson, problemType:type, conceptTags:conceptTagsForLesson(lesson), generatorVersion:1, difficulty:'PRACTICE'}]];
  }),
) as Record<number, ProblemTemplate[]>;

export function getProblemTemplates(lesson:number): ProblemTemplate[] {
  return (TEMPLATES[lesson] ?? []).map(template => ({...template}));
}

export function validateGeneratedProblem(problem: Pick<SeedProblem, 'grid'|'givenBlocks'|'startBlocks'|'answer'|'gradingMode'>): boolean {
  if (!validStructure(problem.givenBlocks, problem.grid) || !validStructure(problem.startBlocks, problem.grid)) return false;
  if (problem.answer.kind === 'blocks' && !validStructure(problem.answer.blocks, problem.grid)) return false;
  if (problem.answer.kind === 'count' && (!Number.isInteger(problem.answer.value) || problem.answer.value < 0)) return false;
  return true;
}

const G3:GridConfig={gridWidth:3,gridDepth:3,maxHeight:3};
const G4:GridConfig={gridWidth:4,gridDepth:4,maxHeight:4};

function shape(seed:number, lesson:number, maxHeight=4, gridWidth=4, gridDepth=4):BlockCoord[]{
  const rows=Math.min(lesson%2===0?4:3, gridDepth);
  const cols=Math.min(lesson%3===0?4:3, gridWidth);
  const heights:number[][]=Array.from({length:rows},(_,z)=>Array.from({length:cols},(_,x)=>{
    const edge=(x===0||z===0)?1:0;
    return Math.min(maxHeight, 1+((seed*7+x*3+z*5+lesson)%3)+edge);
  }));
  return fromHeightMap(heights);
}
function cells(blocks:BlockCoord[],grid:GridConfig):Grid2D[]{return toLayers(blocks,grid);}
function base(lesson:number,index:number,blocks:BlockCoord[],type:ProblemType,given:ProblemGiven,answer:SeedProblem['answer'],grid:GridConfig,mode:'exact'|'constraint'='exact'):GeneratedProblem{
  const tier=index<5?1:index<10?2:index<13?3:3;
  const template = TEMPLATES[lesson]?.[0] ?? {templateId:`lesson${lesson}-practice`, lesson, problemType:type, conceptTags:conceptTagsForLesson(lesson), generatorVersion:1, difficulty:'PRACTICE' as DifficultyTier};
  const difficultyTier:DifficultyTier=tier===1?'BASIC':tier===2?'PRACTICE':index<15?'APPLICATION':'CHALLENGE';
  return {code:`GEN-L${lesson}-${String(index+1).padStart(2,'0')}`,lesson,orderIndex:100+index,problemType:type,title:`${lesson}차시 연습 ${index+1}`,prompt:'쌓기나무 모양을 여러 방향에서 살펴보고 문제를 해결해 보세요.',grid,givenBlocks:blocks,startBlocks:[],given,choices:[],answer,gradingMode:mode,hint:'아래층부터 차례로 확인하고, 필요한 경우 층별 보기와 숫자 지도를 활용해 보세요.',explanation:'블록 좌표와 투영 정보를 비교하면 같은 입체를 정확히 표현할 수 있어요.',difficulty:tier===1?1:tier===2?2:3,xp:tier===1?20:tier===2?25:30,templateId:template.templateId,seed:index,generatorVersion:template.generatorVersion,difficultyTier,conceptTags:template.conceptTags,sourceType:'GENERATED_PRACTICE'};
}

/** 저장된 seed 없이도 같은 lesson/index가 늘 같은 문제를 만드는 순수 생성기. */
export function generatePracticeProblems(lesson:number,count:number,seed=0):GeneratedProblem[]{
  const out:GeneratedProblem[]=[];
  const grid=lesson%2===0?G4:G3;
  for(let i=0;i<count;i++){
    const blocks=shape(seed+i+1,lesson,grid.maxHeight,grid.gridWidth,grid.gridDepth);
    const p=project(blocks,grid);
    const h=toHeightMap(blocks,grid);
    let item:GeneratedProblem;
    if(lesson===1){const position=i%2===0?'오른쪽':'위';item=base(lesson,i,blocks,'BLOCK_POSITION',{allowRotate:true},{kind:'choice',index:0},grid);item.choices=[`${position}에 있는 블록`, '뒤쪽에 있는 블록', '다른 층의 블록'];item.prompt=`빨간 블록의 ${position}에 있는 블록을 골라 보세요.`;}
    else if(lesson===2){item=base(lesson,i,blocks,'CAMERA_DIRECTION',{projections:{front:p.front},shownFrom:'front',allowRotate:true},{kind:'direction',value:'front'},grid);}
    else if(lesson===3){item=base(lesson,i,blocks,'PROJECTION_DRAW',{projections:p,allowRotate:true},{kind:'projections',projections:p},grid);}
    else if(lesson===4){item=base(lesson,i,blocks,'COUNT',{allowRotate:true,allowLayerView:true},{kind:'count',value:blocks.length},grid);}
    else if(lesson===5){item=base(lesson,i,blocks,'CHOICE',{allowRotate:false,note:'먼저 한 방향에서만 판단해 보세요.'},{kind:'choice',index:1},grid);item.choices=['이 정보만으로 정확히 알 수 있어요.','가려진 곳의 정보가 더 필요해요.'];item.prompt='한 방향에서 본 모습만 보고 전체 개수를 정확히 알 수 있을까요?';}
    else if(lesson===6){item=base(lesson,i,blocks,'BUILD_FROM_VIEWS',{projections:p,allowRotate:true},{kind:'blocks',blocks},grid,'constraint');}
    else if(lesson===7){item=base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true,allowLayerView:true},{kind:'heightMap',heightMap:h},grid);}
    else if(lesson===8){item=base(lesson,i,blocks,'BUILD_FROM_LAYERS',{layers:cells(blocks,grid),allowRotate:true,allowLayerView:true},{kind:'blocks',blocks},grid);}
    else if(lesson===12){const mode=i%3;item=mode===0?base(lesson,i,blocks,'COUNT',{allowRotate:true},{kind:'count',value:blocks.length},grid):mode===1?base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true},{kind:'heightMap',heightMap:h},grid):base(lesson,i,blocks,'BUILD_FROM_VIEWS',{projections:p,allowRotate:true},{kind:'blocks',blocks},grid,'constraint');}
    else {item=base(lesson,i,blocks,'COUNT',{allowRotate:true,allowLayerView:true},{kind:'count',value:blocks.length},grid);}
    if (!validateGeneratedProblem(item)) continue;
    out.push(item);
    item.stage='more';
    item.code=`GEN-L${lesson}-S${seed}-${String(i+1).padStart(2,'0')}`;
  }
  return out;
}
