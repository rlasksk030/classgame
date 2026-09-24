import { useEffect,useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { getResolvedSupabaseConfig } from '../../lib/config';
import { teacherListPeerProblems, teacherHidePeerProblem, type TeacherStudentRow, type TeacherPeerProblemRow } from '../../lib/studentApi';
import { ACTIVITY_GRID, ARCHITECTURE_GRID,type Building } from '../../../shared/activities.ts';
import { project,toLayers } from '../../../shared/blocks.ts';
import ActivityBuilder from './ActivityBuilder';
import Representations from './Representations';
interface Challenge {id:string;author_id:string;share_code:string}
interface Solve {challenge_id:string;student_id:string;correct:boolean;used_hint:boolean;wrong_count:number;score:number}
interface Project extends Building {student_id:string}
export default function TeacherActivities({classId,students}:{classId:string;students:TeacherStudentRow[]}){
 const [challenges,setChallenges]=useState<Challenge[]>([]),[solves,setSolves]=useState<Solve[]>([]),[projects,setProjects]=useState<Project[]>([]),[selected,setSelected]=useState<Project|null>(null),[error,setError]=useState('');
 const [peerProblems,setPeerProblems]=useState<TeacherPeerProblemRow[]>([]),[peerError,setPeerError]=useState(''),[peerBusy,setPeerBusy]=useState(false);
 const installationId=getResolvedSupabaseConfig()?.installationId??'';
 useEffect(()=>{let active=true;if(!classId)return;void(async()=>{const db=getSupabase();const [c,p]=await Promise.all([db.from('sb_shared_challenges').select('id,author_id,share_code').eq('class_id',classId),db.from('sb_projects').select('*').eq('class_id',classId)]);if(c.error||p.error)throw new Error('활동 기록을 불러오지 못했습니다.');const results=c.data.length?await db.from('sb_challenge_solves').select('challenge_id,student_id,correct,used_hint,wrong_count,score').in('challenge_id',c.data.map(r=>r.id)):{data:[],error:null};if(results.error)throw results.error;if(active){setChallenges(c.data);setProjects(p.data);setSolves(results.data??[]);setSelected(null);}})().catch(e=>setError(e.message));return()=>{active=false;};},[classId]);
 const loadPeerProblems=async()=>{if(!classId||!installationId)return;try{setPeerError('');const res=await teacherListPeerProblems(classId,installationId);setPeerProblems(res.problems);}catch(e){setPeerError(e instanceof Error?e.message:'친구 문제를 불러오지 못했습니다.');}};
 useEffect(()=>{void loadPeerProblems();},[classId,installationId]);
 const hidePeerProblem=async(row:TeacherPeerProblemRow)=>{if(!window.confirm(`"${row.title||'제목 없음'}" 문제를 학생 화면에서 숨길까요? 언제든 다시 복원할 수 있어요.`))return;setPeerBusy(true);try{await teacherHidePeerProblem(classId,installationId,row.problemId,row.version);await loadPeerProblems();}catch(e){setPeerError(e instanceof Error?e.message:'숨기지 못했습니다.');}finally{setPeerBusy(false);}};
 const restorePeerProblem=async(row:TeacherPeerProblemRow)=>{setPeerBusy(true);try{const {error}=await getSupabase().from('sb_student_created_problems').update({status:'published',hidden_at:null}).eq('installation_id',installationId).eq('class_id',classId).eq('problem_id',row.problemId).eq('version',row.version);if(error)throw error;await loadPeerProblems();}catch(e){setPeerError(e instanceof Error?e.message:'복원하지 못했습니다.');}finally{setPeerBusy(false);}};
 const name=(id:string)=>students.find(s=>s.id===id)?.name??'학생';
 return <section className="panel stack" id="activities"><h2>놀이와 건축물 기록</h2>{error&&<p role="alert">{error}</p>}
 {challenges.length===0&&<p>아직 만든 친구 문제가 없습니다.</p>}
 {challenges.map(c=><div key={c.id}><strong>{name(c.author_id)} · {c.share_code}</strong><p>{solves.filter(s=>s.challenge_id===c.id).map(s=>`${name(s.student_id)}: ${s.correct?'완료':'풀이 중'} · 시도 ${s.wrong_count}회 · ${s.used_hint?'힌트 사용':'힌트 없음'} · ${s.score}점`).join(', ')||'아직 풀이 기록이 없습니다.'}</p></div>)}
 <div className="toolbar-row">{projects.map(p=><button className="btn" key={p.student_id} onClick={()=>setSelected(p)}>{name(p.student_id)} · {p.building_name||'이름 없는 건축물'} · {p.submitted?'완성':'설계 중'}</button>)}</div>
 {selected&&<article className="stack"><h3>{selected.building_name}</h3><p>{selected.reason}</p><p>{selected.description}</p>{(() => { const grid = selected.grid_width && selected.grid_depth && selected.max_height ? { gridWidth: selected.grid_width, gridDepth: selected.grid_depth, maxHeight: selected.max_height } : (selected.blocks.some(block => block.x >= 5 || block.z >= 5) ? ARCHITECTURE_GRID : ACTIVITY_GRID); return <><ActivityBuilder grid={grid} blocks={selected.blocks} appearance={selected.block_appearance} disabled onChange={()=>undefined}/><Representations given={{projections:project(selected.blocks,grid),layers:toLayers(selected.blocks,grid)}} /></>; })()}{selected.layer_notes.map((note,i)=><p key={i}>{i+1}층: {note}</p>)}</article>}
 <div className="stack" style={{marginTop:16}}>
  <h3>친구 문제 관리</h3>
  {peerError&&<p role="alert">{peerError}</p>}
  {peerProblems.length===0&&!peerError?<p className="muted">아직 학생이 만들어 공유한 문제가 없습니다.</p>:null}
  <div className="teacher-table-wrap">
   {peerProblems.length>0&&<table className="teacher-table">
    <thead><tr><th>제목</th><th>만든 학생</th><th>상태</th><th>푼 횟수</th><th>작업</th></tr></thead>
    <tbody>{peerProblems.map(row=><tr key={`${row.problemId}:${row.version}`}>
     <td>{row.title||'(제목 없음)'}</td>
     <td>{row.authorDisplayName}</td>
     <td>{row.status==='hidden'?'숨김':'공개'}</td>
     <td>{row.solveCount}</td>
     <td className="toolbar-row">{row.status==='hidden'
      ?<button className="btn btn-sm" type="button" disabled={peerBusy} onClick={()=>void restorePeerProblem(row)}>복원</button>
      :<button className="btn btn-sm" type="button" disabled={peerBusy} onClick={()=>void hidePeerProblem(row)}>숨기기</button>}</td>
    </tr>)}</tbody>
   </table>}
  </div>
 </div>
 </section>;
}
