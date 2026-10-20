import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ARCHITECTURE_GRID, EMPTY_BUILDING, type Building } from "../../shared/activities.ts";

import { activityApi, getStudentHome, getStudentToken } from "../lib/studentApi";
import { draftKey } from "../lib/snapshotDraft";
import ActivityBuilder from "../features/activities/ActivityBuilder";
import BuildingBrochure from "../features/activities/BuildingBrochure";
import BuildingSharing from "../features/activities/BuildingSharing";
import { BuildingSession, SAVE_TEXT, type BuildingState } from "../features/activities/buildingSave";

function splitLayerNote(value: string) {
  const [name = "", ...rest] = value.split("\n");
  return { name, description: rest.join("\n") };
}
function joinLayerNote(name: string, description: string) { return `${name}\n${description}`.trimEnd(); }

export default function ArchitecturePage() {
  const { lesson } = useParams();
  const lessonNumber = Number(lesson);
  const isDesignLesson = lessonNumber === 10;
  const [view,setView]=useState<BuildingState>({building:EMPTY_BUILDING,status:'loading',ready:false,revision:0,activityContract:1,error:'',conflict:null,confirmed:null});
  const [message,setMessage]=useState('');
  const session=useRef<BuildingSession|null>(null);
  const {building,ready}=view;
  const [activeFloor,setActiveFloor]=useState(0);
  const [showBuilder,setShowBuilder]=useState(isDesignLesson);
  const [equippedMaterial,setEquippedMaterial]=useState<import('../../shared/rewards.ts').RewardMaterial>('wood');
  const [rewardXp,setRewardXp]=useState(0);
  const current=useRef(building);current.current=building;
  const key=draftKey(getStudentToken(),'architecture');
  const builderGrid={gridWidth:building.grid_width??10,gridDepth:building.grid_depth??10,maxHeight:building.max_height??ARCHITECTURE_GRID.maxHeight};
  const edit=(next:Building)=>{current.current=next;setMessage('');session.current?.edit(next);};
  const save=(submit=false)=>{setMessage('');if(submit&&isDesignLesson)return;return session.current?.save(submit,true);};
  useEffect(()=>{setShowBuilder(isDesignLesson);},[isDesignLesson]);
  useEffect(()=>{
    let active=true;
    const writer=new BuildingSession({get:()=>activityApi('project:get',{lesson:lessonNumber}),save:building=>activityApi('project:save',{lesson:lessonNumber,building})},{
      read:()=>{try{return key?JSON.parse(localStorage.getItem(key)??'null'):null;}catch{return null;}},
      write:value=>{try{if(!key)return false;localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}},
      clear:()=>{try{if(key)localStorage.removeItem(key);}catch{/* Keep recoverable local copy. */}},
    },setView);
    session.current=writer;void writer.load();
    void getStudentHome().then(home=>{if(active){setEquippedMaterial(home.rewards.equippedMaterial??'wood');setRewardXp(home.rewards.totalXp??0);}}).catch(()=>{/* Project retrieval remains available. */});
    return()=>{active=false;writer.stop();};
  },[key,lessonNumber]);
  useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void session.current?.save(false,false),1500);return()=>clearTimeout(timer);},[view.revision,ready]);
  useEffect(()=>{const sync=()=>void session.current?.save(false,false);window.addEventListener('online',sync);return()=>window.removeEventListener('online',sync);},[]);
  const editTextFields = <div className="stack">{(["building_name", "reason", "description"] as const).map((field, index) => <label key={field}>{["건축물 이름", "설계 이유", "건축물 설명"][index]}<textarea aria-label={["건축물 이름", "설계 이유", "건축물 설명"][index]} className="field" maxLength={2000} value={building[field]} onChange={event => edit({ ...building, [field]: event.target.value, submitted: false })} /></label>)}</div>;
  const parsed = splitLayerNote(building.layer_notes[activeFloor] ?? "");
  const editFloor = <div className="stack"><div className="toolbar-row" role="tablist" aria-label="층 선택">{building.layer_notes.map((_, index) => <button key={index} type="button" role="tab" aria-selected={activeFloor === index} className={`btn btn-sm ${activeFloor === index ? "btn-primary" : ""}`} onClick={() => setActiveFloor(index)}>{index + 1}층</button>)}</div><strong>{activeFloor + 1}층 공간</strong><label>공간 이름<input className="field" maxLength={200} value={parsed.name} onChange={event => edit({ ...building, layer_notes: building.layer_notes.map((note, index) => index === activeFloor ? joinLayerNote(event.target.value, parsed.description) : note), submitted: false })} /></label><label>공간 설명<textarea className="field" maxLength={1800} value={parsed.description} onChange={event => edit({ ...building, layer_notes: building.layer_notes.map((note, index) => index === activeFloor ? joinLayerNote(parsed.name, event.target.value) : note), submitted: false })} /></label></div>;
  const appearance = building.block_appearance ?? {};
  const allowedMaterials = (['wood','pastel','brick','tile'] as const).filter(material => material === 'wood' || (material === 'pastel' && rewardXp >= 50) || (material === 'brick' && rewardXp >= 150) || (material === 'tile' && rewardXp >= 300));
  const onAppearanceChange = (next: Record<string, import('../../shared/rewards.ts').RewardMaterial>) => edit({ ...current.current, block_appearance: next, submitted: false });
  const changeBoardPreset = (size: 4 | 10) => {
    if (building.blocks.some(block => block.x >= size || block.z >= size)) {
      setMessage('현재 블록이 새 작업판 밖으로 나가서 크기를 바꿀 수 없어요. 먼저 바깥 블록을 옮겨 주세요.');
      return;
    }
    edit({ ...building, grid_width: size, grid_depth: size, max_height: builderGrid.maxHeight, submitted: false });
  };

  return <main className="screen app-max stack architecture-page">
    <h1>{isDesignLesson ? "10차시 · 나만의 건축물 설계하기" : "11차시 · 나만의 건축물 소개서 만들기"}</h1><Link to="/world">공간과 입체 월드</Link>
    <p role="status">{message || (view.status==='loading'?'설계를 불러오고 있어요.':view.status==='conflict'?view.error:SAVE_TEXT[view.status])}</p>
    {view.error&&view.status!=='conflict'&&<p role="alert">{view.error}</p>}
    {['saved','completed'].includes(view.status)&&view.confirmed?.updated_at&&<p>저장 완료 · {new Date(view.confirmed.updated_at).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'})}</p>}
    {view.status==='failed'&&ready&&<button className="btn" onClick={()=>void save()}>저장 다시 시도</button>}
    {ready&&view.activityContract<2&&<p className="notice">이 연결은 기존 저장 방식을 사용해 저장 시각을 표시하지 못할 수 있어요. 최대 10층과 공유 기능은 선생님이 연결하고 업데이트를 완료한 뒤 사용할 수 있어요.</p>}
    {view.conflict&&<section className="panel stack" aria-label="설계 충돌 비교"><h2>두 설계를 비교해 주세요</h2><p>블록과 설명을 확인하고 하나를 선택해요. 선택하기 전에는 자동으로 덮어쓰지 않아요.</p><div className="world-layout"><div><h3>이 기기의 설계</h3><BuildingBrochure building={building}/><p>버전 {building.version}</p></div><div><h3>서버의 설계</h3><BuildingBrochure building={view.conflict}/><p>버전 {view.conflict.version} · {view.conflict.updated_at&&new Date(view.conflict.updated_at).toLocaleString('ko-KR')}</p></div></div><div className="toolbar-row"><button className="btn" onClick={()=>session.current?.useServer()}>서버 설계 불러오기</button><button className="btn" onClick={()=>void session.current?.useLocal()}>비교한 뒤 이 기기 설계로 저장</button></div></section>}
    {ready && isDesignLesson && <><div className="world-layout"><section className="stack"><p className="muted">② 3D 건축 설계 · {builderGrid.gridWidth}×{builderGrid.gridDepth} · 최대 {builderGrid.maxHeight}층</p><label>설계판 크기<select className="field" value={builderGrid.gridWidth === 4 && builderGrid.gridDepth === 4 ? '4' : '10'} onChange={e => changeBoardPreset(e.target.value === '4' ? 4 : 10)}><option value="10">넓은 작업판 10×10 (기본)</option><option value="4">교과서형 4×4</option></select></label><ActivityBuilder grid={builderGrid} blocks={building.blocks} appearance={appearance} activeMaterial={allowedMaterials.includes(equippedMaterial) ? equippedMaterial : 'wood'} allowedMaterials={[...allowedMaterials]} onAppearanceChange={onAppearanceChange} onChange={blocks => edit({ ...current.current, blocks, submitted: false })} /></section><section className="panel stack"><h2>① 건축물 구상</h2>{editTextFields}<h2>③ 층별 공간 정하기</h2>{editFloor}<button className="btn" disabled={!ready||Boolean(view.conflict)} onClick={() => void save()}>10차시 설계 저장</button></section></div><section className="panel"><strong>11차시 안내</strong><p className="muted">설계를 저장한 뒤 11차시에서 외부 모습과 층별 설명을 다듬어 소개서를 완성해요.</p></section></>}
    {ready && !isDesignLesson && <><BuildingBrochure building={building}/><section className="panel stack"><h2>소개서 다듬기</h2>{editTextFields}<label>소개서 테마<select className="field" value={building.intro_theme ?? 'blueprint'} onChange={e => edit({ ...building, intro_theme: e.target.value as Building['intro_theme'], submitted: false })}><option value="blueprint">설계 도면</option><option value="museum" disabled={rewardXp < 250}>전시관 {rewardXp < 250 ? '(250 XP 필요)' : ''}</option><option value="sky" disabled={rewardXp < 450}>하늘 정원 {rewardXp < 450 ? '(450 XP 필요)' : ''}</option></select></label>{editFloor}<div className="toolbar-row"><button className="btn" disabled={!ready||Boolean(view.conflict)} onClick={() => void save()}>설계 저장</button><button className="btn btn-primary" disabled={!ready||Boolean(view.conflict)} onClick={() => void save(true)}>소개서 완성</button><button className="btn" onClick={() => setShowBuilder(value => !value)}>{showBuilder ? "3D 설계 닫기" : "건축물 수정하기"}</button></div></section>{showBuilder && <section className="panel"><ActivityBuilder grid={builderGrid} blocks={building.blocks} appearance={appearance} activeMaterial={allowedMaterials.includes(equippedMaterial) ? equippedMaterial : 'wood'} allowedMaterials={[...allowedMaterials]} onAppearanceChange={onAppearanceChange} onChange={blocks => edit({ ...current.current, blocks, submitted: false })} /></section>}</>}
    {!isDesignLesson&&view.status==='completed'&&view.confirmed&&view.activityContract>=2&&<BuildingSharing building={view.confirmed}/>}
  </main>;
}
