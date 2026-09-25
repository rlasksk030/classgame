import { useState } from 'react';
import BlockWorld from '../../components/world/BlockWorld';
import { ProjectionGrid } from '../../components/world/ProjectionGrid';
import Representations from './Representations';
import ReviewSummary from './ReviewSummary';
import { fromHeightMap, fromLayers, project, toHeightMap, toLayers, usedHeight } from '../../../shared/blocks.ts';
import type { BlockCoord, Grid2D, HeightMap, ViewPreset } from '../../../shared/types.ts';
import { CONSTRAINT_EXAMPLES, CONSTRAINT_GRID, CONSTRAINT_TARGET, EXPLORATION_GRID, HEIGHT_EDIT_GRID, INFORMATION_MODELS, START_BLOCKS, editExplorationLayer, matchesExplorationConditions, type ExplorationKind } from './explorationActivities';

export default function GuidedExploration({kind}:{kind:ExplorationKind}) {
 const [blocks,setBlocks]=useState<BlockCoord[]>(kind==='constraints'?[]:START_BLOCKS);
 const [selected,setSelected]=useState<BlockCoord|null>(null);
 const [preset,setPreset]=useState<ViewPreset>('home');
 const [face,setFace]=useState<'top'|'front'|'side'>('top');
 const [level,setLevel]=useState(0),[example,setExample]=useState(0);
 const [prediction,setPrediction]=useState(''),[compare,setCompare]=useState(false),[reveal,setReveal]=useState(false),[extra,setExtra]=useState(false);
 const [representation,setRepresentation]=useState('height'),[message,setMessage]=useState('');
 const grid=kind==='constraints'?CONSTRAINT_GRID:kind==='height-edit'||kind==='connections'?HEIGHT_EDIT_GRID:EXPLORATION_GRID;
 const shown=kind==='information'?INFORMATION_MODELS[example]:blocks;
 const heights=toHeightMap(shown,grid), layers=toLayers(shown,grid), projections=project(shown,{...grid,maxHeight:Math.max(1,usedHeight(shown))});
 // Numeric maps allow 0..9, but frame the current model rather than nine empty floors.
 const displayGrid=kind==='height-edit'||kind==='connections'?{...grid,maxHeight:Math.max(3,usedHeight(shown))}:grid;
 const editable=['count','height-layers','constraints'].includes(kind);
 const change=(next:BlockCoord[])=>{setBlocks(next);setSelected(null);setCompare(false);};
 const world=<BlockWorld grid={displayGrid} blocks={shown} selected={selected} layerMax={null} preset={preset} onPreset={setPreset}
  allowedViews={kind==='viewpoints'?['home','front','back','left','right','top']:undefined}
  disabled={!editable} onBlocksChange={change} onSelect={setSelected} onMessage={m=>setMessage(m??'')} />;
 const map=<ProjectionGrid title="높이 지도" rows={heights} orientation="floor" valueType="number" editable={kind==='height-edit'||kind==='connections'} onChange={next=>change(fromHeightMap(next as HeightMap))}/>;
 return <div className="stack" data-exploration-kind={kind}>
  <p className="muted">탐구 조작은 문제 답안이나 점수로 기록되지 않아요.</p>
  {kind==='information' && <>
   <ProjectionGrid title="주어진 앞모습" rows={project(INFORMATION_MODELS[0],grid).front} reverseRows valueType="boolean" editable={false} onChange={()=>undefined}/>
   <p>앞모습만으로 전체 블록 수를 정할 수 있을까요?</p>
   <div className="toolbar-row">{['알 수 있다','알 수 없다'].map(text=><button className="btn" key={text} onClick={()=>{setPrediction(text);setReveal(true);}}> {text} </button>)}</div>
   {reveal && <><p>내 생각: {prediction}. 두 모형을 비교해 근거를 찾아보세요.</p><button className="btn" onClick={()=>setExample(1-example)}>다른 가능한 입체 보기</button><p role="status">모형 {example+1}: {shown.length}개 · 앞모습은 같아요.</p><button className="btn" onClick={()=>setExtra(!extra)}>{extra?'추가 정보 접기':'높이 정보 추가'}</button>{extra&&map}</>}
  </>}
  {(kind!=='information'||reveal)&&world}
  {kind!=='information'&&(kind!=='count'||compare)&&<output aria-label="탐구 블록 수">현재 {shown.length}개 · {usedHeight(shown)}층</output>}
  {kind==='count'&&<><label>먼저 센 개수 <input type="number" min="0" value={prediction} onChange={e=>{setPrediction(e.target.value);setCompare(false);}}/></label><button className="btn" disabled={prediction===''} onClick={()=>setCompare(true)}>개수 비교</button>{compare&&<p role="status">내가 센 개수 {prediction}개 / 실제 {blocks.length}개. {Number(prediction)===blocks.length?'같아요.':'층별로 다시 세어 보세요.'}</p>}</>}
  {kind==='viewpoints'&&<p>블록 수와 구조는 그대로예요. 서로 다른 두 방향에서 보이는 모양을 말해 보세요.</p>}
  {kind==='projections'&&<><div className="toolbar-row">{(['top','front','side'] as const).map(f=><button key={f} className="btn" aria-pressed={face===f} onClick={()=>{setFace(f);setPreset(f);}}>{{top:'위 모양 확인',front:'앞 모양 확인',side:'오른쪽 옆 모양 확인'}[f]}</button>)}</div><ProjectionGrid title={{top:'위 투영',front:'앞 투영',side:'오른쪽 옆 투영'}[face]} rows={projections[face]} orientation={face==='top'?'floor':undefined} reverseRows={face!=='top'} mirrorColumns={face==='side'} valueType="boolean" editable={false} onChange={()=>undefined}/></>}
  {kind==='height-layers'&&<>{map}<Representations given={{layers:layers.slice(0,Math.max(1,usedHeight(blocks)))}}/><p role="status">높이 합 {heights.flat().reduce((a,b)=>a+b,0)} = 층별 합 {layers.flat(2).filter(Boolean).length} = 전체 {blocks.length}</p></>}
  {kind==='constraints'&&<><h3>맞추어야 할 세 방향 조건</h3><Representations given={{projections:CONSTRAINT_TARGET}}/><button className="btn" onClick={()=>setCompare(true)}>세 방향 조건 비교</button>{compare&&<p role="status">{matchesExplorationConditions(blocks)?'세 방향 조건을 모두 만족해요.':'아직 다른 모양이 있어요. 위·앞·옆을 다시 비교하세요.'}</p>}<button className="btn" onClick={()=>{change(CONSTRAINT_EXAMPLES[example]);setExample((example+1)%CONSTRAINT_EXAMPLES.length);setReveal(true);}}>조건에 맞는 다른 예 보기</button>{reveal&&<p>이 범위에서 최소 {CONSTRAINT_EXAMPLES[0].length}개, 최대 {CONSTRAINT_EXAMPLES.at(-1)!.length}개예요. 위 모양 때문에 네 자리 모두 비어 있지 않고, 각 가로·세로 줄에 2층이 하나 이상 필요해요.</p>}</>}
  {kind==='height-edit'&&map}
  {kind==='layer-edit'&&<><label>편집할 층 <select value={level} onChange={e=>setLevel(Number(e.target.value))}>{layers.map((_,i)=><option key={i} value={i}>{i+1}층</option>)}</select></label><ProjectionGrid title={`${level+1}층 편집`} rows={layers[level]} orientation="floor" valueType="boolean" editable onChange={next=>{const updated=editExplorationLayer(layers,level,next as Grid2D);if(!updated){setMessage('윗층을 놓으려면 아래층이 필요해요. 아래층을 지우려면 위의 블록부터 지워 주세요.');return;}change(fromLayers(updated));setMessage('층별 지도와 입체를 함께 바꿨어요.');}}/></>}
  {kind==='connections'&&<><div className="toolbar-row">{[['height','높이로 보기'],['projections','세 방향으로 보기'],['layers','층별로 보기']].map(([value,label])=><button className="btn" key={value} aria-pressed={representation===value} onClick={()=>setRepresentation(value)}>{label}</button>)}</div>{representation==='height'?map:<Representations given={representation==='projections'?{projections}:{layers:layers.slice(0,Math.max(1,usedHeight(blocks)))}}/>}<ReviewSummary/></>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
