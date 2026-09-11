import { useState } from 'react';
import BlockWorld from '../../components/world/BlockWorld';
import { ACTIVITY_GRID } from '../../../shared/activities.ts';
import type { BlockCoord,ViewPreset } from '../../../shared/types.ts';
import type { RewardMaterial } from '../../../shared/rewards.ts';
export default function ActivityBuilder({blocks,onChange,disabled=false,answer,grid=ACTIVITY_GRID,appearance,onAppearanceChange,allowedMaterials,activeMaterial}:{blocks:BlockCoord[];onChange:(blocks:BlockCoord[])=>void;disabled?:boolean;answer?:BlockCoord[];grid?:{gridWidth:number;gridDepth:number;maxHeight:number};appearance?:Record<string,RewardMaterial>;onAppearanceChange?:(next:Record<string,RewardMaterial>)=>void;allowedMaterials?:RewardMaterial[];activeMaterial?:RewardMaterial}) {
 const [selected,setSelected]=useState<BlockCoord|null>(null),[preset,setPreset]=useState<ViewPreset>('home'),[message,setMessage]=useState<string|null>(null);
 const [history,setHistory]=useState<BlockCoord[][]>([]),[future,setFuture]=useState<BlockCoord[][]>([]);
 const change=(next:BlockCoord[])=>{setHistory(h=>[...h,blocks]);setFuture([]);onChange(next);};
 return <section className="stack"><div className="toolbar-row"><span>쌓기나무 {blocks.length}개</span>
 <button className="btn" disabled={disabled||!history.length} onClick={()=>{setFuture(f=>[blocks,...f]);onChange(history[history.length-1]);setHistory(history.slice(0,-1));}}>되돌리기</button>
 <button className="btn" disabled={disabled||!future.length} onClick={()=>{setHistory(h=>[...h,blocks]);onChange(future[0]);setFuture(future.slice(1));}}>다시 실행</button>
 <button className="btn" disabled={disabled} onClick={()=>{if(window.confirm('현재 쌓은 모양을 모두 지울까요?'))change([]);}}>전체 초기화</button></div>
 <BlockWorld grid={grid} blocks={blocks} selected={selected} layerMax={null} preset={preset} onPreset={setPreset} onBlocksChange={change} onSelect={setSelected} onMessage={setMessage} disabled={disabled} answerGhost={answer} appearance={appearance} onAppearanceChange={onAppearanceChange} allowedMaterials={allowedMaterials} activeMaterial={activeMaterial}/>
 {message&&<p role="status">{message}</p>}</section>;
}
