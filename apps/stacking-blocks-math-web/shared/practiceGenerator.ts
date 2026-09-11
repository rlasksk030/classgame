import { fromHeightMap, project, toHeightMap, toLayers } from './blocks.ts';
import type { BlockCoord, Grid2D, GridConfig, ProblemGiven, ProblemType } from './types.ts';
import type { SeedProblem } from './seedProblems.ts';

/** 차시별 권장 연습량. 교사 설정이 있으면 서버에서 이 값을 덮어쓴다. */
export function recommendedPracticeCount(lesson:number):number {
  return [3,4,6,7,8,12].includes(lesson) ? 20 : 15;
}

const G3:GridConfig={gridWidth:3,gridDepth:3,maxHeight:3};
const G4:GridConfig={gridWidth:4,gridDepth:4,maxHeight:4};

function shape(seed:number, lesson:number):BlockCoord[]{
  const rows=lesson%2===0?4:3;
  const cols=lesson%3===0?4:3;
  const heights:number[][]=Array.from({length:rows},(_,z)=>Array.from({length:cols},(_,x)=>{
    const edge=(x===0||z===0)?1:0;
    return 1+((seed*7+x*3+z*5+lesson)%3)+edge;
  }));
  return fromHeightMap(heights);
}
function cells(blocks:BlockCoord[],grid:GridConfig):Grid2D[]{return toLayers(blocks,grid);}
function base(lesson:number,index:number,blocks:BlockCoord[],type:ProblemType,given:ProblemGiven,answer:SeedProblem['answer'],grid:GridConfig,mode:'exact'|'constraint'='exact'):SeedProblem{
  const tier=index<5?1:index<10?2:index<13?3:3;
  return {code:`GEN-L${lesson}-${String(index+1).padStart(2,'0')}`,lesson,orderIndex:100+index,problemType:type,title:`${lesson}차시 연습 ${index+1}`,prompt:'쌓기나무 모양을 여러 방향에서 살펴보고 문제를 해결해 보세요.',grid,givenBlocks:blocks,startBlocks:[],given,choices:[],answer,gradingMode:mode,hint:'아래층부터 차례로 확인하고, 필요한 경우 층별 보기와 숫자 지도를 활용해 보세요.',explanation:'블록 좌표와 투영 정보를 비교하면 같은 입체를 정확히 표현할 수 있어요.',difficulty:tier===1?1:tier===2?2:3,xp:tier===1?20:tier===2?25:30};
}

/** 저장된 seed 없이도 같은 lesson/index가 늘 같은 문제를 만드는 순수 생성기. */
export function generatePracticeProblems(lesson:number,count:number,seed=0):SeedProblem[]{
  const out:SeedProblem[]=[];
  const grid=lesson%2===0?G4:G3;
  for(let i=0;i<count;i++){
    const blocks=shape(seed+i+1,lesson);
    const p=project(blocks,grid);
    const h=toHeightMap(blocks,grid);
    let item:SeedProblem;
    if(lesson===2){item=base(lesson,i,blocks,'CAMERA_DIRECTION',{projections:{front:p.front},shownFrom:'front',allowRotate:true},{kind:'direction',value:'front'},grid);}
    else if(lesson===3){item=base(lesson,i,blocks,'PROJECTION_DRAW',{projections:p,allowRotate:true},{kind:'projections',projections:p},grid);}
    else if(lesson===4){item=base(lesson,i,blocks,'COUNT',{allowRotate:true,allowLayerView:true},{kind:'count',value:blocks.length},grid);}
    else if(lesson===5){item=base(lesson,i,blocks,'CHOICE',{allowRotate:false,note:'먼저 한 방향에서만 판단해 보세요.'},{kind:'choice',index:1},grid);item.choices=['이 정보만으로 정확히 알 수 있어요.','가려진 곳의 정보가 더 필요해요.'];item.prompt='한 방향에서 본 모습만 보고 전체 개수를 정확히 알 수 있을까요?';}
    else if(lesson===6){item=base(lesson,i,blocks,'BUILD_FROM_VIEWS',{projections:p,allowRotate:true},{kind:'blocks',blocks},grid,'constraint');}
    else if(lesson===7){item=base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true,allowLayerView:true},{kind:'heightMap',heightMap:h},grid);}
    else if(lesson===8){item=base(lesson,i,blocks,'BUILD_FROM_LAYERS',{layers:cells(blocks,grid),allowRotate:true,allowLayerView:true},{kind:'blocks',blocks},grid);}
    else if(lesson===12){const mode=i%3;item=mode===0?base(lesson,i,blocks,'COUNT',{allowRotate:true},{kind:'count',value:blocks.length},grid):mode===1?base(lesson,i,blocks,'HEIGHTMAP_FROM_BUILD',{allowRotate:true},{kind:'heightMap',heightMap:h},grid):base(lesson,i,blocks,'BUILD_FROM_VIEWS',{projections:p,allowRotate:true},{kind:'blocks',blocks},grid,'constraint');}
    else {item=base(lesson,i,blocks,'COUNT',{allowRotate:true,allowLayerView:true},{kind:'count',value:blocks.length},grid);}
    out.push(item);
    item.stage='more';
    item.code=`GEN-L${lesson}-S${seed}-${String(i+1).padStart(2,'0')}`;
  }
  return out;
}
