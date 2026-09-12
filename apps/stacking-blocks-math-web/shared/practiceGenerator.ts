import { fromHeightMap, grid2DEqual, heightMapEqual, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord, DifficultyTier, Grid2D, GridConfig, ProblemGiven, ProblemSourceType, ProblemType } from './types.ts';
import type { SeedProblem } from './seedProblems.ts';
import { conceptTagsForLesson } from './problemMetadata.ts';
import { hasUniqueDirectionProjection, projectionForDirection } from './spatialConventions.ts';
import { validateProblemPresentation } from './problemPresentation.ts';

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

const template = (lesson:number, templateId:string, problemType:ProblemType):ProblemTemplate => ({
  templateId, lesson, problemType, conceptTags:conceptTagsForLesson(lesson), generatorVersion:1, difficulty:'PRACTICE',
});

/** 같은 모양만 바꾸지 않고 질문·답안 방식을 섞기 위한 차시별 템플릿 목록. */
const TEMPLATES: Record<number, ProblemTemplate[]> = {
  1: [template(1,'lesson1-position-right','BLOCK_POSITION'), template(1,'lesson1-position-above','BLOCK_POSITION'), template(1,'lesson1-layer-count','COUNT'), template(1,'lesson1-total-count','COUNT'), template(1,'lesson1-description-choice','CHOICE'), template(1,'lesson1-layer-compare','COUNT')],
  2: [template(2,'lesson2-front-view','CAMERA_DIRECTION'), template(2,'lesson2-back-view','CAMERA_DIRECTION'), template(2,'lesson2-left-view','CAMERA_DIRECTION'), template(2,'lesson2-right-view','CAMERA_DIRECTION'), template(2,'lesson2-top-view','CAMERA_DIRECTION'), template(2,'lesson2-feature-check','CAMERA_DIRECTION')],
  3: [template(3,'lesson3-top-draw','PROJECTION_DRAW'), template(3,'lesson3-front-draw','PROJECTION_DRAW'), template(3,'lesson3-side-draw','PROJECTION_DRAW'), template(3,'lesson3-all-views','PROJECTION_DRAW'), template(3,'lesson3-hidden-side','PROJECTION_DRAW'), template(3,'lesson3-direction-judge','PROJECTION_DRAW')],
  4: [template(4,'lesson4-total-count','COUNT'), template(4,'lesson4-height-map','HEIGHTMAP_FROM_BUILD'), template(4,'lesson4-layer-count','COUNT'), template(4,'lesson4-layer-map','LAYER_DRAW'), template(4,'lesson4-method-choice','CHOICE'), template(4,'lesson4-missing-info','HEIGHTMAP_FROM_BUILD')],
  5: [template(5,'lesson5-unknown-choice','CHOICE'), template(5,'lesson5-hidden-min','COUNT'), template(5,'lesson5-hidden-max','COUNT_AMBIGUOUS'), template(5,'lesson5-extra-info','CHOICE'), template(5,'lesson5-same-view','CHOICE'), template(5,'lesson5-reveal-count','COUNT')],
  6: [template(6,'lesson6-build-views','BUILD_FROM_VIEWS'), template(6,'lesson6-another-solution','BUILD_FROM_VIEWS'), template(6,'lesson6-possible-shape','BUILD_FROM_VIEWS'), template(6,'lesson6-minimum','BUILD_FROM_VIEWS'), template(6,'lesson6-maximum','BUILD_FROM_VIEWS'), template(6,'lesson6-unique-or-many','BUILD_FROM_VIEWS')],
  7: [template(7,'lesson7-height-to-build','BUILD_FROM_HEIGHTMAP'), template(7,'lesson7-build-to-height','HEIGHTMAP_FROM_BUILD'), template(7,'lesson7-total-from-height','HEIGHTMAP_FROM_BUILD'), template(7,'lesson7-fill-height','BUILD_FROM_HEIGHTMAP'), template(7,'lesson7-find-wrong-height','HEIGHTMAP_FROM_BUILD'), template(7,'lesson7-changed-height','HEIGHTMAP_FROM_BUILD')],
  8: [template(8,'lesson8-layers-to-build','BUILD_FROM_LAYERS'), template(8,'lesson8-build-to-layers','LAYER_DRAW'), template(8,'lesson8-missing-layer','LAYER_DRAW'), template(8,'lesson8-layer-count','COUNT'), template(8,'lesson8-total-count','COUNT'), template(8,'lesson8-next-layer','LAYER_DRAW')],
  9: [template(9,'lesson9-peer-challenge','BUILD_FROM_VIEWS')],
  10: [template(10,'lesson10-project','FREE_BUILD')],
  11: [template(11,'lesson11-project','FREE_BUILD')],
  12: [template(12,'lesson12-direction','CAMERA_DIRECTION'), template(12,'lesson12-projection','PROJECTION_DRAW'), template(12,'lesson12-count','COUNT'), template(12,'lesson12-height-map','HEIGHTMAP_FROM_BUILD'), template(12,'lesson12-layer-map','LAYER_DRAW'), template(12,'lesson12-constraint','BUILD_FROM_VIEWS'), template(12,'lesson12-hidden-block','COUNT_AMBIGUOUS'), template(12,'lesson12-spatial-choice','CHOICE')],
};

export function getProblemTemplates(lesson:number): ProblemTemplate[] {
  return (TEMPLATES[lesson] ?? []).map(template => ({...template}));
}

export function validateGeneratedProblem(problem: Pick<SeedProblem, 'grid'|'givenBlocks'|'startBlocks'|'answer'|'gradingMode'|'problemType'|'given'>): boolean {
  if (!validStructure(problem.givenBlocks, problem.grid) || !validStructure(problem.startBlocks, problem.grid)) return false;
  if (problem.answer.kind === 'blocks' && !validStructure(problem.answer.blocks, problem.grid)) return false;
  if (problem.answer.kind === 'count' && (!Number.isInteger(problem.answer.value) || problem.answer.value < 0)) return false;
  const expected: Record<ProblemType, string> = {
    FREE_BUILD:'blocks', BLOCK_POSITION:'choice', CAMERA_DIRECTION:'direction', PROJECTION_DRAW:'projections',
    COUNT:'count', COUNT_AMBIGUOUS:'count', BUILD_FROM_VIEWS:'blocks', BUILD_FROM_HEIGHTMAP:'blocks',
    HEIGHTMAP_FROM_BUILD:'heightMap', BUILD_FROM_LAYERS:'blocks', LAYER_DRAW:'layers', PATTERN_NEXT:'choice', CHOICE:'choice',
  };
  const expectedKind = expected[problem.problemType];
  const constraintViews = problem.problemType === 'BUILD_FROM_VIEWS' && problem.gradingMode === 'constraint' && problem.answer.kind === 'projections';
  if (problem.answer.kind !== expectedKind && !constraintViews) return false;
  const actual = project(problem.givenBlocks, problem.grid);
  if (problem.answer.kind === 'projections' && problem.givenBlocks.length > 0) {
    for (const face of ['top', 'front', 'side'] as const) {
      if (problem.answer.projections[face] && !grid2DEqual(problem.answer.projections[face], actual[face])) return false;
    }
  }
  if (problem.answer.kind === 'heightMap' && problem.givenBlocks.length > 0 && !heightMapEqual(problem.answer.heightMap, toHeightMap(problem.givenBlocks, problem.grid))) return false;
  if (problem.answer.kind === 'layers') {
    const expectedLayers = toLayers(problem.givenBlocks, problem.grid);
    if (problem.givenBlocks.length > 0 && (problem.answer.layers.length !== expectedLayers.length || problem.answer.layers.some((layer, index) => !grid2DEqual(layer, expectedLayers[index])))) return false;
  }
  if (problem.problemType === 'CAMERA_DIRECTION' && problem.answer.kind === 'direction') {
    if (problem.given.shownFrom !== problem.answer.value) return false;
  }
  if (validateProblemPresentation(problem).length > 0) return false;
  return true;
}

const G3:GridConfig={gridWidth:3,gridDepth:3,maxHeight:3};
const G4:GridConfig={gridWidth:4,gridDepth:4,maxHeight:4};

function shape(seed:number, lesson:number, maxHeight=4, gridWidth=4, gridDepth=4, version=1):BlockCoord[]{
  if (version === 2) {
    let state = (seed ^ Math.imul(lesson, 0x9e3779b9)) >>> 0 || 1;
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
    const heights = Array.from({length:gridDepth}, () => Array.from({length:gridWidth}, () => next() % (maxHeight + 1)));
    heights[0][0] = Math.max(1, heights[0][0]);
    return fromHeightMap(heights);
  }
  const rows=Math.min(lesson%2===0?4:3, gridDepth);
  const cols=Math.min(lesson%3===0?4:3, gridWidth);
  const heights:number[][]=Array.from({length:rows},(_,z)=>Array.from({length:cols},(_,x)=>{
    const edge=(x===0||z===0)?1:0;
    return Math.min(maxHeight, 1+((seed*7+x*3+z*5+lesson)%3)+edge);
  }));
  return fromHeightMap(heights);
}
function cells(blocks:BlockCoord[],grid:GridConfig):Grid2D[]{return toLayers(blocks,grid);}
function filledCells(rows: Grid2D): number { return rows.reduce((sum, row) => sum + row.filter(Boolean).length, 0); }
function base(lesson:number,index:number,blocks:BlockCoord[],type:ProblemType,given:ProblemGiven,answer:SeedProblem['answer'],grid:GridConfig,mode:'exact'|'constraint'='exact',selectedTemplate?:ProblemTemplate):GeneratedProblem{
  const tier=index<5?1:index<10?2:index<13?3:3;
  const chosenTemplate = selectedTemplate ?? TEMPLATES[lesson]?.[0] ?? {templateId:`lesson${lesson}-practice`, lesson, problemType:type, conceptTags:conceptTagsForLesson(lesson), generatorVersion:1, difficulty:'PRACTICE' as DifficultyTier};
  const difficultyTier:DifficultyTier=tier===1?'BASIC':tier===2?'PRACTICE':index<15?'APPLICATION':'CHALLENGE';
  return {code:`GEN-L${lesson}-${String(index+1).padStart(2,'0')}`,lesson,orderIndex:100+index,problemType:type,title:`${lesson}차시 연습 ${index+1}`,prompt:'쌓기나무 모양을 여러 방향에서 살펴보고 문제를 해결해 보세요.',grid,givenBlocks:blocks,startBlocks:[],given,choices:[],answer,gradingMode:mode,hint:'아래층부터 차례로 확인하고, 필요한 경우 층별 보기와 숫자 지도를 활용해 보세요.',explanation:'블록 좌표와 투영 정보를 비교하면 같은 입체를 정확히 표현할 수 있어요.',difficulty:tier===1?1:tier===2?2:3,xp:tier===1?20:tier===2?25:30,templateId:chosenTemplate.templateId,seed:index,generatorVersion:chosenTemplate.generatorVersion,difficultyTier,conceptTags:chosenTemplate.conceptTags,sourceType:'GENERATED_PRACTICE'};
}

/** 저장된 seed 없이도 같은 lesson/index가 늘 같은 문제를 만드는 순수 생성기. */
export function generatePracticeProblems(lesson:number,count:number,seed=0,version=1):GeneratedProblem[]{
  const out:GeneratedProblem[]=[];
  const grid=lesson%2===0?G4:G3;
  for(let i=0;i<count;i++){
    const direction = lesson === 2
      ? (['front','back','left','right','top'] as const)[i % 5]
      : lesson === 12 && i % 8 === 0
        ? 'front' as const
        : null;
    let shapeSeed = seed + i + 1;
    let blocks=shape(shapeSeed,lesson,grid.maxHeight,grid.gridWidth,grid.gridDepth,version);
    // 방향 하나를 고르는 문제는 같은 그림을 만드는 다른 방향을 제외한다.
    if (direction) {
      for (let attempt = 0; attempt < 100 && !hasUniqueDirectionProjection(blocks, grid, direction); attempt++) {
        shapeSeed += 1;
        blocks = shape(shapeSeed, lesson, grid.maxHeight, grid.gridWidth, grid.gridDepth,version);
      }
    }
    const p=project(blocks,grid);
    const h=toHeightMap(blocks,grid);
    const selectedTemplate = TEMPLATES[lesson]?.[i % (TEMPLATES[lesson]?.length || 1)];
    let item:GeneratedProblem;
    if(lesson===1){const mode=i%6; const position=mode===1?'위':'오른쪽'; const type=mode<2?'BLOCK_POSITION':mode===4?'CHOICE':'COUNT'; const answer=mode<2||mode===4?{kind:'choice',index:0} as const:{kind:'count',value:mode===2?blocks.filter(b=>b.y===1).length:blocks.length} as const; item=base(lesson,i,blocks,type,{allowRotate:true,allowLayerView:true,countOf:mode===2?'layer':undefined,countLayer:2},answer,grid,'exact',selectedTemplate); item.choices=[`${position}에 있는 블록`,'뒤쪽에 있는 블록','다른 층의 블록']; item.prompt=mode<2?`빨간 블록의 ${position}에 있는 블록을 골라 보세요.`:mode===4?'설명에 맞는 모양을 골라 보세요.':mode===5?'자리별로 센 수와 층별로 센 수가 같은지 확인해 보세요.':mode===2?'2층에 있는 쌓기나무는 몇 개인가요?':'전체 쌓기나무는 몇 개인가요?';}
    else if(lesson===2){const dirs=['front','back','left','right','top'] as const; const d=dirs[i%dirs.length]; const projection=projectionForDirection(blocks,grid,d); const face=d==='top'?'top':d==='front'||d==='back'?'front':'side'; item=base(lesson,i,blocks,'CAMERA_DIRECTION',{projections:{[face]:projection},shownFrom:d,allowRotate:true},{kind:'direction',value:d},grid,'exact',selectedTemplate); item.prompt=`아래 모습은 어느 방향에서 본 것일까요?`;
    }
    else if(lesson===3){const views=[{top:p.top},{front:p.front},{side:p.side},{top:p.top,front:p.front,side:p.side},{side:p.side},{top:p.top}] as Partial<typeof p>[]; item=base(lesson,i,blocks,'PROJECTION_DRAW',{projections:views[i%views.length],allowRotate:true},{kind:'projections',projections:views[i%views.length]},grid,'exact',selectedTemplate); item.prompt=['위에서 본 모양','앞에서 본 모양','옆에서 본 모양','세 방향에서 본 모양'][i%4]+'을 격자에 나타내 보세요.';}
    else if(lesson===4){const mode=i%6; const type=mode===1||mode===5?'HEIGHTMAP_FROM_BUILD':mode===3?'LAYER_DRAW':mode===4?'CHOICE':'COUNT'; const answer=type==='HEIGHTMAP_FROM_BUILD'?{kind:'heightMap',heightMap:h} as const:type==='LAYER_DRAW'?{kind:'layers',layers:cells(blocks,grid)} as const:type==='CHOICE'?{kind:'choice',index:0} as const:{kind:'count',value:blocks.length} as const; item=base(lesson,i,blocks,type,{allowRotate:true,allowLayerView:true,heightMap:h,layers:cells(blocks,grid)},answer,grid,'exact',selectedTemplate); item.choices=['자리별 높이로 세기','층별로 나누어 세기','둘 다 사용할 수 없어요']; item.prompt=type==='HEIGHTMAP_FROM_BUILD'?'각 자리의 높이를 숫자로 나타내 보세요.':type==='LAYER_DRAW'?'층별 모양을 격자에 나타내 보세요.':type==='CHOICE'?'개수를 세는 두 방법 중 맞는 것을 고르세요.':'쌓기나무는 모두 몇 개인가요?';}
    else if(lesson===5){const mode=i%6; if(mode===0){item=base(lesson,i,blocks,'CHOICE',{projections:{front:p.front},allowRotate:false,note:'먼저 한 방향에서만 판단해 보세요.'},{kind:'choice',index:1},grid,'exact',selectedTemplate); item.choices=['알 수 있어요','알 수 없어요']; item.prompt='지금 앞에서 본 모양만으로 쌓기나무의 전체 개수를 정확히 알 수 있을까요?';} else if(mode===1){item=base(lesson,i,blocks,'COUNT',{projections:{front:p.front},allowRotate:false,note:'보이지 않는 쌓기나무는 없다고 가정해요.'},{kind:'count',value:filledCells(p.front)},grid,'exact',selectedTemplate); item.prompt='보이지 않는 쌓기나무는 없다고 가정할 때, 앞에서 본 모양의 칸마다 한 개씩 있다면 몇 개인가요?';} else if(mode===2){const maxVisible=p.front[0]?.map((_,x)=>Math.max(0,...p.front.map((row,y)=>row[x]?y+1:0))).reduce((sum,height)=>sum+height*grid.gridDepth,0)??0; item=base(lesson,i,blocks,'COUNT_AMBIGUOUS',{projections:{front:p.front},allowRotate:false,note:'앞에서 본 모양만으로는 뒤쪽 블록을 모두 알 수 없어요.'},{kind:'count',value:maxVisible},grid,'exact',selectedTemplate); item.prompt='앞에서 본 모양이 같을 때, 숨겨진 블록을 더 쌓을 수 있다면 가능한 최대 개수는 얼마일까요?';} else if(mode===5){item=base(lesson,i,blocks,'COUNT',{allowRotate:true},{kind:'count',value:blocks.length},grid,'exact',selectedTemplate); item.prompt='추가 정보를 받은 뒤 실제 개수를 구해 보세요.';} else {item=base(lesson,i,blocks,'CHOICE',{projections:mode===3?{front:p.front}:undefined,allowRotate:false,note:'먼저 한 방향에서만 판단해 보세요.'},{kind:'choice',index:1},grid,'exact',selectedTemplate); item.choices=['이 정보만으로 정확히 알 수 있어요.','가려진 곳의 정보가 더 필요해요.']; item.prompt=mode===3?'정확히 알려면 어떤 정보가 더 필요할까요?':'한 방향에서 본 모습만 보고 전체 개수를 정확히 알 수 있을까요?';}}
    else if(lesson===6){item=base(lesson,i,blocks,'BUILD_FROM_VIEWS',{projections:p,allowRotate:true},{kind:'blocks',blocks},grid,'constraint',selectedTemplate); item.prompt=['세 방향 모습을 보고 직접 쌓아 보세요.','조건을 만족하는 다른 모양도 만들어 보세요.','가능한 입체를 만들어 보세요.','가능한 모양 중 하나를 찾아 보세요.'][i%4];}
    else if(lesson===7){const build=i%3===0; item=build?base(lesson,i,blocks,'BUILD_FROM_HEIGHTMAP',{heightMap:h,allowRotate:true,allowLayerView:true},{kind:'blocks',blocks},grid,'exact',selectedTemplate):base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true,allowLayerView:true},{kind:'heightMap',heightMap:h},grid,'exact',selectedTemplate); item.prompt=build?'숫자 지도를 보고 3D 모양을 쌓아 보세요.':'3D 모양을 보고 높이 지도를 완성해 보세요.';}
    else if(lesson===8){const draw=i%3===1; item=draw?base(lesson,i,blocks,'LAYER_DRAW',{layers:cells(blocks,grid),allowRotate:true,allowLayerView:true},{kind:'layers',layers:cells(blocks,grid)},grid,'exact',selectedTemplate):base(lesson,i,blocks,'BUILD_FROM_LAYERS',{layers:cells(blocks,grid),allowRotate:true,allowLayerView:true},{kind:'blocks',blocks},grid,'exact',selectedTemplate); item.prompt=draw?'3D 모양의 층별 표현을 그려 보세요.':'층별 표현을 보고 3D 모양을 쌓아 보세요.';}
    else if(lesson===12){const mode=i%8; if(mode===0)item=base(lesson,i,blocks,'CAMERA_DIRECTION',{projections:{front:p.front},shownFrom:'front',allowRotate:true},{kind:'direction',value:'front'},grid,'exact',selectedTemplate); else if(mode===1)item=base(lesson,i,blocks,'PROJECTION_DRAW',{projections:p,allowRotate:true},{kind:'projections',projections:p},grid,'exact',selectedTemplate); else if(mode===3)item=base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true},{kind:'heightMap',heightMap:h},grid,'exact',selectedTemplate); else if(mode===5)item=base(lesson,i,blocks,'LAYER_DRAW',{layers:cells(blocks,grid),allowRotate:true},{kind:'layers',layers:cells(blocks,grid)},grid,'exact',selectedTemplate); else if(mode===6)item=base(lesson,i,blocks,'COUNT_AMBIGUOUS',{allowRotate:false},{kind:'count',value:blocks.length},grid,'exact',selectedTemplate); else if(mode===7)item=base(lesson,i,blocks,'CHOICE',{allowRotate:true},{kind:'choice',index:0},grid,'exact',selectedTemplate); else item=base(lesson,i,blocks,'COUNT',{allowRotate:true},{kind:'count',value:blocks.length},grid,'exact',selectedTemplate);}
    else {item=base(lesson,i,blocks,'COUNT',{allowRotate:true,allowLayerView:true},{kind:'count',value:blocks.length},grid);}
    if (version === 2 && lesson === 5) {
      const mode = i % 6;
      const visible = filledCells(p.front);
      if (mode === 2) item.prompt = `작업판의 앞뒤 깊이는 ${grid.gridDepth}칸이에요. 앞에서 본 모양을 유지하며 쌓을 수 있는 최대 개수는 얼마일까요?`;
      if (mode === 3) {
        item.prompt = '앞에서 본 모양이 주어졌어요. 전체 개수를 정확히 결정하려면 어떤 정보가 충분할까요?';
        item.choices = ['각 바닥 자리의 쌓인 개수를 모두 알기', '블록 색깔만 알기', '앞에서 본 모양을 한 번 더 보기'];
        item.answer = {kind:'choice', index:0};
      }
      if (mode === 4) {
        item.given = {projections:{front:p.front}, allowRotate:false};
        item.prompt = `한 학생이 “앞에서 ${visible}칸이 보이니 전체도 반드시 ${visible}개”라고 했어요. 이 설명의 문제점은 무엇일까요?`;
        item.choices = ['뒤에 가려진 블록이 있을 가능성을 생각하지 않았어요.', '보이는 한 칸은 언제나 두 개의 블록이에요.', '앞에서 본 모양은 개수와 아무 관계가 없어요.'];
        item.answer = {kind:'choice',index:0};
      }
      if (mode === 5) item.prompt = '이제 자유롭게 돌려 모든 자리를 살펴볼 수 있어요. 실제 쌓기나무는 모두 몇 개인가요?';
      item.hint = mode === 1 ? '보이는 앞면의 칸을 줄별로 세어 보세요.' : mode === 2 ? '앞모습의 각 기둥 높이를 유지하며 뒤쪽 자리도 채워 보세요.' : mode === 5 ? '모형을 돌려 각 자리의 높이를 세어 보세요.' : '같은 앞모습 뒤에 블록을 더 놓을 수 있는지 생각해 보세요.';
      item.explanation = mode === 1 ? `숨은 블록이 없다는 가정에서는 보이는 ${visible}칸이 각각 한 개이므로 ${visible}개예요.` : mode === 2 ? `각 앞면 칸마다 깊이 ${grid.gridDepth}칸을 모두 채울 수 있어 최대 ${visible * grid.gridDepth}개예요.` : mode === 5 ? `각 자리의 높이를 모두 더하면 ${blocks.length}개예요.` : mode === 3 ? '모든 바닥 자리의 개수를 알면 그 수를 더해 전체를 정확히 구할 수 있어요.' : '같은 앞모습에서도 뒤에 블록을 더 놓으면 전체 개수가 달라질 수 있어요.';
    }
    if (version === 2 && lesson === 3) item.prompt = ['위에서 본 모양','앞에서 본 모양','옆에서 본 모양','위·앞·옆 세 방향에서 본 모양','옆에서 본 모양','위에서 본 모양'][i%6] + '을 격자에 나타내 보세요.';
    if (!validateGeneratedProblem(item)) continue;
    out.push(item);
    item.stage='more';
    item.code=`GEN-L${lesson}-S${seed}-${String(i+1).padStart(2,'0')}`;
    if (version === 2) { item.generatorVersion=2; item.seed=seed; item.code += '-V2'; }
  }
  return out;
}
