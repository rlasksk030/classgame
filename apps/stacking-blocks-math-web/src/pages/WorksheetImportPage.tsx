import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {getSupabase} from '../lib/supabase';
import {teacherListClasses,type ClassData} from '../lib/studentApi';
import {openWorksheet,cropPage,type FilePreview,type CropRect} from '../features/worksheet/filePreview';
import ActivityBuilder from '../features/activities/ActivityBuilder';
import {ACTIVITY_GRID} from '../../shared/activities.ts';
import {canonicalize,project,toHeightMap,toLayers} from '../../shared/blocks.ts';
import type {BlockCoord,ProblemAnswer} from '../../shared/types.ts';
export default function WorksheetImportPage(){
 const [classes,setClasses]=useState<ClassData[]>([]),[classId,setClassId]=useState(''),[file,setFile]=useState<File|null>(null),[importId,setImportId]=useState(''),[page,setPage]=useState(1),[pages,setPages]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const preview=useRef<FilePreview|null>(null),source=useRef<HTMLCanvasElement|null>(null),canvas=useRef<HTMLCanvasElement>(null),start=useRef<{x:number;y:number}|null>(null);
 const [rect,setRect]=useState<CropRect|null>(null),[crop,setCrop]=useState<Blob|null>(null),[cropUrl,setCropUrl]=useState('');
 const [title,setTitle]=useState(''),[prompt,setPrompt]=useState(''),[lesson,setLesson]=useState(3),[type,setType]=useState('COUNT'),[answer,setAnswer]=useState(''),[choices,setChoices]=useState(''),[hint,setHint]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [blocks,setBlocks]=useState<BlockCoord[]>([]),[builder,setBuilder]=useState(false);
 const is3D=['BUILD_FROM_VIEWS','PROJECTION_DRAW','HEIGHTMAP_FROM_BUILD','LAYER_DRAW'].includes(type);
 useEffect(()=>{void teacherListClasses().then(data=>{setClasses(data.classes);setClassId(data.classes[0]?.id??'');}).catch(e=>setMessage(e.message));return()=>preview.current?.dispose();},[]);
 useEffect(()=>{if(!crop){setCropUrl('');return;}const url=URL.createObjectURL(crop);setCropUrl(url);return()=>URL.revokeObjectURL(url);},[crop]);
 const render=async(n:number)=>{if(!preview.current)return;const image=await preview.current.render(n);source.current=image;setPage(n);setRect(null);setCrop(null);if(canvas.current){canvas.current.width=image.width;canvas.current.height=image.height;canvas.current.getContext('2d')!.drawImage(image,0,0);}};
 const upload=async()=>{if(!file||!classId)return;setBusy(true);setMessage('');try{
  preview.current?.dispose();preview.current=await openWorksheet(file);setPages(preview.current.pages);
  const db=getSupabase();const {data:user}=await db.auth.getUser();if(!user.user)throw new Error('교사 로그인이 필요합니다.');const id=crypto.randomUUID();
  const path=`${user.user.id}/${id}/original.${file.type==='application/pdf'?'pdf':file.type.split('/')[1]}`;
  const result=await db.storage.from('sb-worksheets').upload(path,file,{contentType:file.type});if(result.error)throw result.error;
  const row=await db.from('sb_worksheet_imports').insert({id,teacher_id:user.user.id,class_id:classId,filename:file.name,storage_path:path});if(row.error)throw row.error;
  setImportId(id);await render(1);setMessage('마우스나 손가락으로 문제 영역을 드래그해 선택하세요.');
 }catch(e){setMessage(e instanceof Error?e.message:'업로드하지 못했습니다.');}finally{setBusy(false);}};
 const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const c=e.currentTarget,r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(c.width,(e.clientX-r.left)*c.width/r.width)),y:Math.max(0,Math.min(c.height,(e.clientY-r.top)*c.height/r.height))};};
 const select=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(!start.current||!source.current)return;const end=point(e);const r={x:Math.min(start.current.x,end.x),y:Math.min(start.current.y,end.y),width:Math.abs(end.x-start.current.x),height:Math.abs(end.y-start.current.y)};setRect(r);setCrop(null);const ctx=e.currentTarget.getContext('2d')!;ctx.drawImage(source.current,0,0);ctx.strokeStyle='#d12b31';ctx.lineWidth=3;ctx.strokeRect(r.x,r.y,r.width,r.height);};
 const save=async()=>{if(!crop||!confirmed||!classId||!importId)return;setBusy(true);try{
  let value:ProblemAnswer;
  if(is3D){if(!blocks.length)throw new Error('3D 정답을 만들어 주세요.');value=type==='PROJECTION_DRAW'?{kind:'projections',projections:project(blocks,ACTIVITY_GRID)}:type==='HEIGHTMAP_FROM_BUILD'?{kind:'heightMap',heightMap:toHeightMap(blocks,ACTIVITY_GRID)}:type==='LAYER_DRAW'?{kind:'layers',layers:toLayers(blocks,ACTIVITY_GRID)}:{kind:'blocks',blocks:canonicalize(blocks)};}
  else if(type==='CHOICE'){const index=Number(answer)-1;if(!Number.isInteger(index)||index<0||index>=choices.split('\n').filter(Boolean).length)throw new Error('정답 보기 번호를 확인해 주세요.');value={kind:'choice',index};}
  else {const count=Number(answer);if(!answer.trim()||!Number.isInteger(count)||count<0)throw new Error('숫자 정답을 확인해 주세요.');value={kind:'count',value:count};}
  const db=getSupabase();const {data:user}=await db.auth.getUser();const id=crypto.randomUUID(),path=`${classId}/${id}.png`;
  const uploaded=await db.storage.from('sb-problem-images').upload(path,crop,{contentType:'image/png'});if(uploaded.error)throw uploaded.error;
  const approved=await db.from('sb_worksheet_imports').update({status:'APPROVED'}).eq('id',importId);if(approved.error)throw approved.error;
  const result=await db.from('sb_problems').insert({id,class_id:classId,created_by:user.user?.id,lesson,problem_type:type,title,prompt,hint,image_path:path,answer:value,source_type:'WORKSHEET_IMPORT',grid_width:5,grid_depth:5,max_height:3,given_blocks:is3D&&type!=='BUILD_FROM_VIEWS'?canonicalize(blocks):[],start_blocks:[],given:{allowRotate:true,allowLayerView:true},choices:choices.split('\n').filter(Boolean),active:true});if(result.error)throw result.error;
  await db.from('sb_worksheet_imports').update({status:'PUBLISHED'}).eq('id',importId);setConfirmed(false);setMessage('문제은행에 등록했습니다. 같은 학급 학생에게 출제됩니다.');
 }catch(e){setMessage(e instanceof Error?e.message:'등록하지 못했습니다.');}finally{setBusy(false);}};
 return <main className="screen app-max stack"><h1>학습지로 문제 만들기</h1><Link to="/teacher">교사 관리로</Link><p>자동 분석 없이 선생님이 문제 영역과 정답을 확인해 등록합니다. 원본은 교사만 볼 수 있어요.</p>
 <section className="panel stack"><label>학급<select disabled={Boolean(importId)} value={classId} onChange={e=>setClassId(e.target.value)}>{classes.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><input aria-label="학습지 파일" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e=>{setFile(e.target.files?.[0]??null);setImportId('');setCrop(null);}}/><button className="btn" disabled={busy||!file||!classId} onClick={()=>void upload()}>업로드</button><p>{file?.name} {pages?`· ${pages}쪽`:''}</p>
 {pages>0&&<label>페이지<select value={page} onChange={e=>void render(Number(e.target.value)).catch(err=>setMessage(err.message))}>{Array.from({length:pages},(_,i)=><option key={i} value={i+1}>{i+1}쪽</option>)}</select></label>}
 <canvas ref={canvas} aria-label="학습지 문제 영역 선택" style={{maxWidth:'100%',height:'auto',touchAction:'none',border:pages?'1px solid #777':undefined}} onPointerDown={e=>{start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={select} onPointerUp={e=>{select(e);start.current=null;}}/>
 <button className="btn" disabled={!rect||!importId||busy} onClick={async()=>{try{setCrop(await cropPage(source.current!,rect!));const {error}=await getSupabase().from('sb_worksheet_imports').update({status:'REVIEW'}).eq('id',importId);if(error)throw error;}catch(e){setMessage(e instanceof Error?e.message:'자르지 못했습니다.');}}}>선택한 영역 자르기 / 문제 그림 다시 자르기</button>
 </section>
 {cropUrl&&<section className="panel stack"><h2>문제 검토</h2><img src={cropUrl} alt="학생에게 보여 줄 문제 그림" style={{maxWidth:'100%',maxHeight:500,objectFit:'contain'}}/>
 <label>문제 제목<input className="field" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>문제 내용<textarea className="field" value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
 <label>차시<select value={lesson} onChange={e=>setLesson(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}차시</option>)}</select></label>
 <label>문제 유형<select value={type} onChange={e=>{setType(e.target.value);setConfirmed(false);}}><option value="COUNT">숫자 / 개수</option><option value="CHOICE">객관식</option><option value="BUILD_FROM_VIEWS">3D 모양 만들기</option><option value="PROJECTION_DRAW">위·앞·옆 그리기</option><option value="HEIGHTMAP_FROM_BUILD">높이 지도</option><option value="LAYER_DRAW">층별 모양</option></select></label>
 {type==='CHOICE'&&<label>보기 (한 줄에 하나)<textarea className="field" value={choices} onChange={e=>{setChoices(e.target.value);setConfirmed(false);}}/></label>}
 {is3D?<><button className="btn" onClick={()=>setBuilder(true)}>3D 정답 만들기</button>{builder&&<ActivityBuilder blocks={blocks} onChange={next=>{setBlocks(next);setConfirmed(false);}}/>}<button className="btn" disabled={!blocks.length} onClick={()=>setConfirmed(true)}>현재 모양을 정답으로 저장</button></>:<><label>{type==='CHOICE'?'정답 보기 번호':'숫자 정답'}<input className="field" inputMode="numeric" value={answer} onChange={e=>{setAnswer(e.target.value);setConfirmed(false);}}/></label><button className="btn" onClick={()=>setConfirmed(true)}>정답 확정</button></>}
 <label>힌트<textarea className="field" value={hint} onChange={e=>setHint(e.target.value)}/></label><p>{confirmed?'정답 확인됨':'정답을 확인해 주세요.'}</p><button className="btn btn-primary" disabled={busy||!confirmed||!title.trim()||!prompt.trim()} onClick={()=>void save()}>검토한 문제 등록</button>
 </section>}
 <p role="status">{message}</p></main>;
}
