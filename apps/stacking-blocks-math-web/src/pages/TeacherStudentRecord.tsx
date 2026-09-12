import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSupabase } from '../lib/supabase';
import BlockWorld from '../components/world/BlockWorld';
import type { BlockCoord, ViewPreset } from '../../shared/types.ts';
import { ACTIVITY_GRID, ARCHITECTURE_GRID } from '../../shared/activities.ts';
interface Snapshot { problem_id:string;lesson:number;blocks:BlockCoord[];grid_width:number;grid_depth:number;max_height:number }
interface Attempt { problem_id:string;attempt_count:number;wrong_count:number;hint_shown:boolean;answer_revealed:boolean;completed:boolean }
interface ProblemMeta { id:string; lesson:number; order_index:number }
interface Project { building_name:string; reason:string; description:string; layer_notes:string[]; blocks:BlockCoord[]; grid_width?:number; grid_depth?:number; max_height?:number; block_appearance?:Record<string, import('../../shared/rewards.ts').RewardMaterial>; intro_theme?: import('../../shared/rewards.ts').RewardTheme; version:number; submitted:boolean }
function projectGrid(project: Project) {
  if (Number.isInteger(project.grid_width) && Number.isInteger(project.grid_depth) && Number.isInteger(project.max_height)) {
    return { gridWidth: project.grid_width!, gridDepth: project.grid_depth!, maxHeight: project.max_height! };
  }
  return project.blocks.some(block => block.x >= 5 || block.z >= 5) ? ARCHITECTURE_GRID : ACTIVITY_GRID;
}
export default function TeacherStudentRecord() {
  const {studentId}=useParams();
  const [progress,setProgress]=useState<Array<{lesson:number;completed:boolean;stars:number;updated_at:string}>>([]),[xp,setXp]=useState(0),[resetLesson,setResetLesson]=useState(0),[revision,setRevision]=useState(0);
  const [name,setName]=useState(''),[snapshots,setSnapshots]=useState<Snapshot[]>([]),[attempts,setAttempts]=useState<Attempt[]>([]),[problemMeta,setProblemMeta]=useState<ProblemMeta[]>([]),[project,setProject]=useState<Project|null>(null);
  const [selected,setSelected]=useState<Snapshot|null>(null),[preset,setPreset]=useState<ViewPreset>('home'),[error,setError]=useState('');
  useEffect(()=>{let active=true;void (async()=>{
    const db=getSupabase();
    const [student,shapes,results,projectResult,problemResult]=await Promise.all([db.from('sb_students').select('name').eq('id',studentId).single(),db.from('sb_block_snapshots').select('*').eq('student_id',studentId).order('lesson'),db.from('sb_problem_attempts').select('problem_id,attempt_count,wrong_count,hint_shown,answer_revealed,completed').eq('student_id',studentId),db.from('sb_projects').select('building_name,reason,description,layer_notes,blocks,grid_width,grid_depth,max_height,block_appearance,intro_theme,version,submitted').eq('student_id',studentId).maybeSingle(),db.from('sb_problems').select('id,lesson,order_index')]);
    if(!active)return;
    if(student.error||shapes.error||results.error||projectResult.error||problemResult.error){setError('기록을 불러오지 못했습니다. 담당 학급인지 확인해 주세요.');return;}
    const [p,r]=await Promise.all([db.from('sb_student_progress').select('lesson,completed,stars,updated_at').eq('student_id',studentId).order('updated_at',{ascending:false}),db.from('sb_student_rewards').select('total_xp').eq('student_id',studentId).maybeSingle()]);
    if(!active)return;setProgress(p.data??[]);setXp(r.data?.total_xp??0);
    setName(student.data.name);setSnapshots(shapes.data);setAttempts(results.data);setProblemMeta(problemResult.data??[]);setProject(projectResult.data as Project|null);setSelected(shapes.data[0]??null);
  })().catch(()=>setError('기록 서버에 연결하지 못했습니다.'));return()=>{active=false;};},[studentId,revision]);
  const metaById=new Map(problemMeta.map(row=>[row.id,row]));
  const moreAttempts=attempts.filter(row=>(metaById.get(row.problem_id)?.order_index??0)>2);
  const concept=attempts.filter(row=>(metaById.get(row.problem_id)?.order_index??0)<=1&&metaById.has(row.problem_id));
  const check=attempts.filter(row=>metaById.get(row.problem_id)?.order_index===2);
  const attemptedMore=moreAttempts.length, completedMore=moreAttempts.filter(row=>row.completed).length;
  const allAttempts=attempts.reduce((sum,row)=>sum+row.attempt_count,0), wrongAttempts=attempts.reduce((sum,row)=>sum+row.wrong_count,0);
  return <main className="screen app-max stack"><h1>{name} 학생의 쌓기 기록</h1><a href="/teacher">교사 관리로</a>
    <section className="panel stack"><p>현재 차시: {progress[0]?.lesson??'기록 없음'} · 완료 차시: {progress.filter(p=>p.completed).map(p=>p.lesson).join(', ')||'없음'} · {xp} XP · 별 {progress.reduce((sum,p)=>sum+p.stars,0)}</p>
    <label>초기화 범위<select value={resetLesson} onChange={e=>setResetLesson(Number(e.target.value))}><option value={0}>전체 진도</option>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}차시</option>)}</select></label><button className="btn" onClick={async()=>{if(!window.confirm(`${name} 학생의 ${resetLesson?resetLesson+'차시':'전체'} 진도를 초기화할까요? 저장한 작업도 지워집니다. 10~11차시는 함께 초기화됩니다.`))return;const {error}=await getSupabase().rpc('sb_reset_progress',{p_student:studentId,p_lesson:resetLesson||null});if(error)setError('초기화하지 못했습니다.');else setRevision(r=>r+1);}}>선택 범위 초기화</button></section>
    {error&&<p role="alert">{error}</p>}
    {project&&<section className="panel stack"><h2>나만의 건축물 소개서</h2><p><strong>{project.building_name||'이름 없음'}</strong> · {project.submitted?'완성':'작성 중'} · 저장 버전 {project.version}</p><p>{project.reason}</p><p>{project.description}</p>{project.layer_notes.map((note,i)=><p key={i}>{i+1}층 · {note.replace('\n',' — ')}</p>)}<BlockWorld grid={projectGrid(project)} blocks={project.blocks} appearance={project.block_appearance} selected={null} layerMax={null} preset={preset} onPreset={setPreset} disabled onBlocksChange={()=>undefined} onSelect={()=>undefined} onMessage={()=>undefined}/></section>}
    <section className="panel stack"><h2>학습 단계별 진도</h2><p>개념 익히기 완료 문제 {concept.filter(row=>row.completed).length}/{concept.length} · 개념 확인 완료 문제 {check.filter(row=>row.completed).length}/{check.length}</p><p>더 풀어보기 풀이 {attemptedMore}문제 · 완료 {completedMore}문제 · 정답률 {attemptedMore?Math.round(completedMore/attemptedMore*100):0}%</p><p>전체 오답 {wrongAttempts}회 · 힌트 사용 {attempts.filter(row=>row.hint_shown).length}문제 · 정답 공개 {attempts.filter(row=>row.answer_revealed).length}문제 · 전체 시도 {allAttempts}회</p></section>
    <section className="panel"><h2>문제별 학습 기록</h2>{attempts.length===0?<p>아직 제출한 문제가 없습니다.</p>:<table className="teacher-table"><thead><tr><th>문제</th><th>시도</th><th>힌트</th><th>정답 공개</th><th>완료</th></tr></thead><tbody>{attempts.map((a,i)=><tr key={a.problem_id}><td>문제 {i+1}</td><td>{a.attempt_count}</td><td>{a.hint_shown?'사용':'없음'}</td><td>{a.answer_revealed?'공개':'없음'}</td><td>{a.completed?'완료':'진행 중'}</td></tr>)}</tbody></table>}</section>
    <div className="toolbar-row">{snapshots.map((s,i)=><button className="btn" key={s.problem_id} onClick={()=>setSelected(s)}>{s.lesson}차시 기록 {i+1}</button>)}</div>
    {selected?<BlockWorld grid={{gridWidth:selected.grid_width,gridDepth:selected.grid_depth,maxHeight:selected.max_height}} blocks={selected.blocks} selected={null} layerMax={null} preset={preset} onPreset={setPreset} disabled onBlocksChange={()=>undefined} onSelect={()=>undefined} onMessage={()=>undefined}/>:<p>저장한 3D 모양이 없습니다.</p>}
  </main>;
}
