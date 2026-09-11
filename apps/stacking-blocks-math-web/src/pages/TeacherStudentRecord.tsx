import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSupabase } from '../lib/supabase';
import BlockWorld from '../components/world/BlockWorld';
import type { BlockCoord, ViewPreset } from '../../shared/types.ts';
interface Snapshot { problem_id:string;lesson:number;blocks:BlockCoord[];grid_width:number;grid_depth:number;max_height:number }
interface Attempt { problem_id:string;attempt_count:number;hint_shown:boolean;answer_revealed:boolean;completed:boolean }
export default function TeacherStudentRecord() {
  const {studentId}=useParams();
  const [name,setName]=useState(''),[snapshots,setSnapshots]=useState<Snapshot[]>([]),[attempts,setAttempts]=useState<Attempt[]>([]);
  const [selected,setSelected]=useState<Snapshot|null>(null),[preset,setPreset]=useState<ViewPreset>('home'),[error,setError]=useState('');
  useEffect(()=>{let active=true;void (async()=>{
    const db=getSupabase();
    const [student,shapes,results]=await Promise.all([db.from('sb_students').select('name').eq('id',studentId).single(),db.from('sb_block_snapshots').select('*').eq('student_id',studentId).order('lesson'),db.from('sb_problem_attempts').select('problem_id,attempt_count,hint_shown,answer_revealed,completed').eq('student_id',studentId)]);
    if(!active)return;
    if(student.error||shapes.error||results.error){setError('기록을 불러오지 못했습니다. 담당 학급인지 확인해 주세요.');return;}
    setName(student.data.name);setSnapshots(shapes.data);setAttempts(results.data);setSelected(shapes.data[0]??null);
  })().catch(()=>setError('기록 서버에 연결하지 못했습니다.'));return()=>{active=false;};},[studentId]);
  return <main className="screen app-max stack"><h1>{name} 학생의 쌓기 기록</h1><a href="/teacher">교사 관리로</a>
    {error&&<p role="alert">{error}</p>}
    <section className="panel"><h2>문제별 학습 기록</h2>{attempts.length===0?<p>아직 제출한 문제가 없습니다.</p>:<table className="teacher-table"><thead><tr><th>문제</th><th>시도</th><th>힌트</th><th>정답 공개</th><th>완료</th></tr></thead><tbody>{attempts.map((a,i)=><tr key={a.problem_id}><td>문제 {i+1}</td><td>{a.attempt_count}</td><td>{a.hint_shown?'사용':'없음'}</td><td>{a.answer_revealed?'공개':'없음'}</td><td>{a.completed?'완료':'진행 중'}</td></tr>)}</tbody></table>}</section>
    <div className="toolbar-row">{snapshots.map((s,i)=><button className="btn" key={s.problem_id} onClick={()=>setSelected(s)}>{s.lesson}차시 기록 {i+1}</button>)}</div>
    {selected?<BlockWorld grid={{gridWidth:selected.grid_width,gridDepth:selected.grid_depth,maxHeight:selected.max_height}} blocks={selected.blocks} selected={null} layerMax={null} preset={preset} onPreset={setPreset} disabled onBlocksChange={()=>undefined} onSelect={()=>undefined} onMessage={()=>undefined}/>:<p>저장한 3D 모양이 없습니다.</p>}
  </main>;
}
