import { useEffect, useRef } from 'react';
import { project } from '../../../shared/blocks.ts';
import { usedFloors, type Building } from '../../../shared/activities.ts';
import { drawBuilding } from './brochureExport';
import Representations from './Representations';
export default function BuildingBrochure({building}:{building:Building}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const ctx=ref.current?.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,1000,600);drawBuilding(ctx,building,0,0,1000,600);},[building]);
 return <section className={`panel stack architecture-presentation theme-${building.intro_theme??'blueprint'}`} aria-label="건축물 소개서">
 <h2>나만의 건축물 소개서</h2><h3>{building.building_name||'이름을 지어 주세요'}</h3><p style={{whiteSpace:'pre-wrap'}}>{building.reason}</p><p style={{whiteSpace:'pre-wrap'}}>{building.description}</p>
 <canvas ref={ref} width={1000} height={600} style={{width:'100%',maxHeight:450,objectFit:'contain'}} aria-label="저장한 건축물의 입체 모습"/>
 <Representations given={{projections:project(building.blocks,{gridWidth:building.grid_width??10,gridDepth:building.grid_depth??10,maxHeight:building.max_height??10})}}/>
 {usedFloors(building).map(f=><p key={f} style={{whiteSpace:'pre-wrap'}}><strong>{f+1}층</strong> · {building.layer_notes[f]}</p>)}
 <p className="status-chip">{building.submitted?'완성된 소개서':'작성 중인 소개서'}</p>
 </section>;
}
