import { useEffect,useRef,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import { ACTIVITY_GRID,EMPTY_BUILDING,validBuilding,type Building } from '../../shared/activities.ts';
import { project,toLayers } from '../../shared/blocks.ts';
import { activityApi,getStudentToken } from '../lib/studentApi';
import { draftKey } from '../lib/snapshotDraft';
import ActivityBuilder from '../features/activities/ActivityBuilder';
import Representations from '../features/activities/Representations';

function splitLayerNote(value:string):{name:string;description:string}{
 const [name='',...rest]=value.split('\n');
 return {name,description:rest.join('\n')};
}
function joinLayerNote(name:string,description:string):string{return `${name}\n${description}`.trimEnd();}

export default function ArchitecturePage(){
 const {lesson}=useParams();const lessonNumber=Number(lesson);
 const [building,setBuilding]=useState<Building>(EMPTY_BUILDING),[ready,setReady]=useState(false),[message,setMessage]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const current=useRef(building),dirty=useRef(false),saving=useRef(false),revisionRef=useRef(0);
 const key=draftKey(getStudentToken(),'architecture');
 const edit=(next:Building)=>{current.current=next;setBuilding(next);dirty.current=true;revisionRef.current++;setRevision(revisionRef.current);try{if(key)localStorage.setItem(key,JSON.stringify(next));setMessage('현재 기기에 임시 저장했어요.');}catch{setMessage('기기 저장 공간을 확인하고 저장 버튼을 눌러 주세요.');}};
 const save=async(submit=false)=>{
  if(submit&&lessonNumber!==11){setMessage('10차시는 설계를 저장하고 11차시에서 소개서를 완성해요.');return;}
  if(!ready||saving.current||(!dirty.current&&!submit))return;
  const value={...current.current,submitted:submit||current.current.submitted};
  if(!validBuilding(value,submit)){setMessage('이름, 설계 이유, 설명과 3개 층의 공간 이름·설명을 채우고 3층까지 쌓아 주세요.');return;}
  saving.current=true;setBusy(true);const sent=revisionRef.current;
  try{const result=await activityApi<{version:number}>('project:save',{building:value,lesson:lessonNumber});
   const next={...current.current,version:result.version,submitted:value.submitted};current.current=next;setBuilding(next);
   if(sent===revisionRef.current){dirty.current=false;if(key)localStorage.removeItem(key);}else if(key)localStorage.setItem(key,JSON.stringify(next));
   setMessage(submit?'건축물 소개서를 완성했어요.':'설계를 저장했어요.');
  }catch(error){setMessage(error instanceof Error?`현재 기기에 임시 저장했어요. 인터넷이 연결되면 다시 저장할게요. ${error.message}`:'저장하지 못했습니다.');}
  finally{saving.current=false;setBusy(false);}
 };
 const saveRef=useRef(save);saveRef.current=save;
 useEffect(()=>{let active=true;setReady(false);void activityApi<{building:Building|null}>('project:get',{lesson:lessonNumber}).then(({building:server})=>{
  if(!active)return;let draft:Building|null=null;try{draft=key?JSON.parse(localStorage.getItem(key)??'null'):null;}catch{/* server remains available */}
  const next=draft??server??EMPTY_BUILDING;current.current=next;setBuilding(next);dirty.current=Boolean(draft);setReady(true);
  if(draft&&draft.version!==(server?.version??0))setMessage('다른 창에서 바뀐 설계가 있습니다. 기기 기록을 보관하고 있어요. 저장 충돌 시 서버 상태를 확인해 주세요.');
 }).catch(error=>{
  if(!active)return;
  let draft:Building|null=null;try{draft=key?JSON.parse(localStorage.getItem(key)??'null'):null;}catch{/* ignore */}
  if(draft){current.current=draft;setBuilding(draft);dirty.current=true;setReady(true);setMessage('인터넷이 연결되지 않아 기기 임시 저장본으로 열었어요. 연결되면 다시 저장할게요.');}
  else setMessage(error instanceof Error?error.message:'설계를 불러오지 못했습니다.');
 });return()=>{active=false;void saveRef.current();};},[lessonNumber,key]);
 useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void saveRef.current(),1500);return()=>clearTimeout(timer);},[revision,ready]);
 useEffect(()=>{const sync=()=>void saveRef.current();const hidden=()=>{if(document.visibilityState==='hidden')sync();};window.addEventListener('online',sync);window.addEventListener('pagehide',sync);document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('online',sync);window.removeEventListener('pagehide',sync);document.removeEventListener('visibilitychange',hidden);};},[]);
 return <main className="screen app-max stack"><h1>{lessonNumber}차시 · 나만의 건축물</h1><Link to="/world">공간과 입체 월드</Link>
 <p role="status">{message||(!ready?'설계를 불러오고 있어요.':'3층짜리 건축물을 설계해 보세요.')}</p>
 {ready&&<><div className="world-layout"><ActivityBuilder blocks={building.blocks} onChange={blocks=>edit({...building,blocks,submitted:false})}/><section className="panel stack">
 {(['building_name','reason','description'] as const).map((field,i)=><label key={field}>{['건축물 이름','설계 이유','건축물 설명'][i]}<textarea className="field" maxLength={2000} value={building[field]} onChange={e=>edit({...building,[field]:e.target.value,submitted:false})}/></label>)}
 {building.layer_notes.map((note,i)=>{const parsed=splitLayerNote(note);return <div className="stack" key={i}><strong>{i+1}층</strong><label>공간 이름<input className="field" maxLength={200} value={parsed.name} onChange={e=>edit({...building,layer_notes:building.layer_notes.map((n,j)=>j===i?joinLayerNote(e.target.value,parsed.description):n),submitted:false})}/></label><label>공간 설명<textarea className="field" maxLength={1800} value={parsed.description} onChange={e=>edit({...building,layer_notes:building.layer_notes.map((n,j)=>j===i?joinLayerNote(parsed.name,e.target.value):n),submitted:false})}/></label></div>})}
 <button className="btn" disabled={busy} onClick={()=>void save()}>{lessonNumber===10?'10차시 설계 저장':'설계 저장'}</button>{lessonNumber===11&&<button className="btn btn-primary" disabled={busy} onClick={()=>void save(true)}>소개서 완성</button>}
 </section></div>
 <section className="panel stack"><h2>나만의 건축물 소개서 · {building.building_name||'이름을 지어 주세요'}</h2><p>{building.reason}</p><p>{building.description}</p>
 <Representations given={{projections:project(building.blocks,ACTIVITY_GRID),layers:toLayers(building.blocks,ACTIVITY_GRID)}}/>
 {building.layer_notes.map((note,i)=>{const parsed=splitLayerNote(note);return <p key={i}>{i+1}층 · {parsed.name||'공간 이름을 지어 주세요'}{parsed.description&&` — ${parsed.description}`}</p>})}<p>{building.submitted?'완성된 소개서':'작성 중인 소개서'}</p></section></>}
 </main>;
}
