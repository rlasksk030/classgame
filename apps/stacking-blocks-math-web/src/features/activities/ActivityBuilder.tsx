import { useRef, useState } from 'react';
import BlockWorld from '../../components/world/BlockWorld';
import { ACTIVITY_GRID } from '../../../shared/activities.ts';
import type { BlockCoord,ViewPreset } from '../../../shared/types.ts';
import type { CameraPolicy } from '../../../shared/problems/contracts/spatial.ts';
import type { RewardMaterial } from '../../../shared/rewards.ts';
type BuilderSnapshot = { blocks: BlockCoord[]; appearance: Record<string, RewardMaterial> };
export default function ActivityBuilder({blocks,onChange,disabled=false,answer,grid=ACTIVITY_GRID,appearance,onAppearanceChange,allowedMaterials,activeMaterial,onActiveMaterialChange,cameraPolicy}:{blocks:BlockCoord[];onChange:(blocks:BlockCoord[])=>void;disabled?:boolean;answer?:BlockCoord[];grid?:{gridWidth:number;gridDepth:number;maxHeight:number};appearance?:Record<string,RewardMaterial>;onAppearanceChange?:(next:Record<string,RewardMaterial>)=>void;allowedMaterials?:RewardMaterial[];activeMaterial?:RewardMaterial;onActiveMaterialChange?:(next:RewardMaterial)=>void;cameraPolicy?:CameraPolicy}) {
 const snapshot = (): BuilderSnapshot => ({ blocks: blocks.map(block => ({ ...block })), appearance: { ...(appearance ?? {}) } });
 const restore = (next: BuilderSnapshot) => { onChange(next.blocks); onAppearanceChange?.(next.appearance); };
 const blockChangeInProgress = useRef(false);
 const [selected,setSelected]=useState<BlockCoord|null>(null),[preset,setPreset]=useState<ViewPreset>(cameraPolicy?.initialView??'home'),[message,setMessage]=useState<string|null>(null);
 const [history,setHistory]=useState<BuilderSnapshot[]>([]),[future,setFuture]=useState<BuilderSnapshot[]>([]);
 const change=(next:BlockCoord[])=>{setHistory(h=>[...h,snapshot()]);setFuture([]);blockChangeInProgress.current=true;onChange(next);};
 const appearanceChange=(next:Record<string,RewardMaterial>)=>{if (!blockChangeInProgress.current) { setHistory(h=>[...h,snapshot()]); setFuture([]); } blockChangeInProgress.current=false; onAppearanceChange?.(next);};
 return <section className="stack"><div className="toolbar-row"><span>쌓기나무 {blocks.length}개</span>
 <button className="btn" disabled={disabled||!history.length} onClick={()=>{const previous=history[history.length-1];setFuture(f=>[snapshot(),...f]);restore(previous);setHistory(history.slice(0,-1));}}>되돌리기</button>
 <button className="btn" disabled={disabled||!future.length} onClick={()=>{const next=future[0];setHistory(h=>[...h,snapshot()]);restore(next);setFuture(future.slice(1));}}>다시 실행</button>
 <button className="btn" disabled={disabled} onClick={()=>{if(window.confirm('현재 쌓은 모양을 모두 지울까요?'))change([]);}}>전체 초기화</button></div>
 <BlockWorld grid={grid} blocks={blocks} selected={selected} layerMax={null} preset={preset} onPreset={setPreset} onBlocksChange={change} onSelect={setSelected} onMessage={setMessage} disabled={disabled} answerGhost={answer} appearance={appearance} onAppearanceChange={appearanceChange} allowedMaterials={allowedMaterials} activeMaterial={activeMaterial} onActiveMaterialChange={onActiveMaterialChange} allowRotate={cameraPolicy?.kind!=='fixed'} allowedViews={cameraPolicy?.allowedViews}/>
 {message&&<p role="status">{message}</p>}</section>;
}
