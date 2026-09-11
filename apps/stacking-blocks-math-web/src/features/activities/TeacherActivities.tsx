import { useEffect,useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import type { TeacherStudentRow } from '../../lib/studentApi';
import { ACTIVITY_GRID,type Building } from '../../../shared/activities.ts';
import { project,toLayers } from '../../../shared/blocks.ts';
import ActivityBuilder from './ActivityBuilder';
import Representations from './Representations';
interface Challenge {id:string;author_id:string;share_code:string}
interface Solve {challenge_id:string;student_id:string;correct:boolean;used_hint:boolean;wrong_count:number;score:number}
interface Project extends Building {student_id:string}
export default function TeacherActivities({classId,students}:{classId:string;students:TeacherStudentRow[]}){
 const [challenges,setChallenges]=useState<Challenge[]>([]),[solves,setSolves]=useState<Solve[]>([]),[projects,setProjects]=useState<Project[]>([]),[selected,setSelected]=useState<Project|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(!classId)return;void(async()=>{const db=getSupabase();const [c,p]=await Promise.all([db.from('sb_shared_challenges').select('id,author_id,share_code').eq('class_id',classId),db.from('sb_projects').select('*').eq('class_id',classId)]);if(c.error||p.error)throw new Error('활동 기록을 불러오지 못했습니다.');const results=c.data.length?await db.from('sb_challenge_solves').select('challenge_id,student_id,correct,used_hint,wrong_count,score').in('challenge_id',c.data.map(r=>r.id)):{data:[],error:null};if(results.error)throw results.error;if(active){setChallenges(c.data);setProjects(p.data);setSolves(results.data??[]);setSelected(null);}})().catch(e=>setError(e.message));return()=>{active=false;};},[classId]);
 const name=(id:string)=>students.find(s=>s.id===id)?.name??'학생';
 return <section className="panel stack"><h2>놀이와 건축물 기록</h2>{error&&<p role="alert">{error}</p>}
 {challenges.length===0&&<p>아직 만든 친구 문제가 없습니다.</p>}
 {challenges.map(c=><div key={c.id}><strong>{name(c.author_id)} · {c.share_code}</strong><p>{solves.filter(s=>s.challenge_id===c.id).map(s=>`${name(s.student_id)}: ${s.correct?'완료':'풀이 중'} · 시도 ${s.wrong_count}회 · ${s.used_hint?'힌트 사용':'힌트 없음'} · ${s.score}점`).join(', ')||'아직 풀이 기록이 없습니다.'}</p></div>)}
 <div className="toolbar-row">{projects.map(p=><button className="btn" key={p.student_id} onClick={()=>setSelected(p)}>{name(p.student_id)} · {p.building_name||'이름 없는 건축물'} · {p.submitted?'완성':'설계 중'}</button>)}</div>
 {selected&&<article className="stack"><h3>{selected.building_name}</h3><p>{selected.reason}</p><p>{selected.description}</p><ActivityBuilder blocks={selected.blocks} disabled onChange={()=>undefined}/><Representations given={{projections:project(selected.blocks,ACTIVITY_GRID),layers:toLayers(selected.blocks,ACTIVITY_GRID)}}/>{selected.layer_notes.map((note,i)=><p key={i}>{i+1}층: {note}</p>)}</article>}
 </section>;
}
