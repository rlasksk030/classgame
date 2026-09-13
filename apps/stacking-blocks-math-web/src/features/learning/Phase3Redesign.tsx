import { useEffect,useMemo,useState } from 'react';
import { Link,Navigate,useParams } from 'react-router-dom';
import { getResolvedSupabaseConfig } from '../../lib/config';
import { getStudentToken } from '../../lib/studentApi';
import type { Problem } from '../../../shared/problems/contracts/spatial.ts';
import { phase3Activities,phase3Practice,PHASE3_TITLES,middleLayerProblem,type Phase3Lesson } from '../../../shared/problems/templates/phase3.ts';
import { initialLesson,phase3Solve,phase3Restore,phase3EnsureAdaptive,phase3Total } from '../../../shared/progress/phase3.ts';
import { localProgressKey,type LessonState } from '../../../shared/progress/spatial.ts';
import { emptyAnswer,applyLearningAttempt,initialAttempt,answerForComparison,gradeSpatial } from '../../../shared/problems/grading/spatial.ts';
import { problemContractError } from '../../../shared/problems/contracts/validate.ts';
import BlockWorld from '../../components/world/BlockWorld';
import type { ViewPreset,BlockCoord } from '../../../shared/types.ts';
import AnswerRenderer from '../answers/AnswerRenderer';
import SpatialMaterials from '../representations/SpatialMaterials';
import './spatial.css';
import './phase3.css';
function identityFor(id:Phase3Lesson){const config=getResolvedSupabaseConfig(),token=getStudentToken();if(!config||!token)return null;try{const {sid,cid}=JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));return typeof sid==='string'&&typeof cid==='string'?localProgressKey(config.supabaseUrl,config.installationId,sid,cid).replace(/lesson3$/,`lesson${id}:phase3-v1`):null;}catch{return null;}}
export default function Phase3Redesign(){const id=Number(useParams().lessonId);if(id!==5&&id!==6&&id!==7&&id!==8)return <Navigate to="/world" replace/>;const identity=identityFor(id);return identity?<Session key={identity} id={id} identity={identity}/>:<Navigate to={getResolvedSupabaseConfig()?'/':'/setup'} replace/>;}
function Session({id,identity}:{id:Phase3Lesson;identity:string}){
 const [s,setS]=useState<LessonState>(()=>{try{return phase3Restore(id,localStorage.getItem(identity))??initialLesson(314159);}catch{return initialLesson(314159);}});
 const [save,setSave]=useState('');
 useEffect(()=>{try{localStorage.setItem(identity,JSON.stringify(s));setSave('현재 위치와 답안을 이 기기에 저장했어요.');}catch{setSave('기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.');}},[s,identity]);
 const activities=useMemo(()=>phase3Activities(id),[id]);
 const solve=useMemo(()=>phase3Solve(id,s),[id,s.seed,s.adaptive]);
 const practice=useMemo(()=>{const items=phase3Practice(id,s.seed,s.practiceCount);if(id===8&&s.practiceCount===10)items[5]=middleLayerProblem();return items;},[id,s.seed,s.practiceCount]);
 const def=activities[s.activity],p=s.section==='learn'?def?.problem:(s.section==='solve'?solve[s.solveIndex]:practice[s.practiceIndex]);
 const answer=p?(s.answers[p.id]??emptyAnswer(p)):null,attempt=p?(s.attempts[p.id]??initialAttempt()):null;
 const solveDone=solve.length===phase3Total(id)&&solve.every(p=>s.attempts[p.id]?.completed),practiceDone=practice.every(p=>s.attempts[p.id]?.completed);
 function stage(section:LessonState['section']){setS(prev=>({...prev,section}));}
 function submit(){if(!p||!answer||gradeSpatial(p,answer)==='unsupported')return;setS(prev=>{const next=applyLearningAttempt(p,answer,prev.attempts[p.id]??initialAttempt());return phase3EnsureAdaptive(id,{...prev,attempts:{...prev.attempts,[p.id]:next}});});}
 function nextActivity(){setS(prev=>{const next=activities[prev.activity+1]?.problem,previous=activities[prev.activity]?.problem,old=previous?prev.answers[previous.id]:null;const carry=(id===6||id===8)&&next?.answerInput.kind==='block-builder'&&old?.kind==='block-builder'&&!prev.answers[next.id]?{[next.id]:old}:{};return {...prev,activity:prev.activity+1,learnComplete:prev.learnComplete||prev.activity===4,answers:{...prev.answers,...carry}};});}
 return <main className="spatial-app phase3-app"><header><div><p className="eyebrow">{id}차시 · 공간과 입체</p><h1>{PHASE3_TITLES[id]}</h1></div><Link className="btn" to="/world">학생 홈</Link></header>
 <p className="spatial-local">새 교육과정 확인 화면 · 기록은 현재 기기에만 저장됩니다. 기존 학습 기록은 바뀌지 않습니다.</p><p className="direction-note">옆은 모형의 앞을 기준으로 오른쪽에서 본 모양이에요.</p>
 <nav aria-label="학습 단계">{(['learn','solve','practice'] as const).map((v,i)=><button className="btn" key={v} aria-current={s.section===v?'step':undefined} disabled={v==='solve'&&!s.learnComplete||v==='practice'&&!solveDone} onClick={()=>stage(v)}>{['① 개념 배우기','② 문제 풀기','③ 더 풀어보기'][i]}</button>)}</nav>
 {s.section==='learn'&&!def&&<section className="panel"><h2>개념 배우기 완료</h2><p>직접 비교하고 쌓으며 조건을 확인했어요.</p><button className="btn btn-primary" onClick={()=>stage('solve')}>문제 풀기 시작</button></section>}
 {p&&answer&&attempt&&<section key={p.id} data-problem-id={p.id} data-activity-id={s.section==='learn'?`l${id}-activity-${s.activity+1}`:undefined} data-answer-kind={p.answerInput.kind}>
 <h2>{s.section==='learn'?`활동 ${s.activity+1}/5 · ${def.title}`:s.section==='solve'?`문제 ${s.solveIndex+1}/${phase3Total(id)}`:`더 풀어보기 ${s.practiceIndex+1}/${s.practiceCount}`}</h2>
 {s.section==='learn'&&<p>{def.instruction} 이 활동은 점수나 별을 깎지 않아요.</p>}<h3>{p.prompt}</h3>
 {p.cameraPolicy.kind==='fixed'&&<p>지금은 지정된 방향과 공개된 자료만 살펴봐요.</p>}
 <div className={`phase3-task ${p.answerInput.kind==='block-builder'?'phase3-build':''}`}>
 <section className="phase3-evidence" aria-label="문제 자료"><SpatialMaterials materials={p.presentedMaterials}/><div className="phase3-model-pair">{p.presentedMaterials.map((m,i)=>m.kind==='model'&&<section key={i}><h3>{m.caption}</h3><Model problem={p} blocks={m.blocks}/></section>)}</div></section>
 <section className={`spatial-work ${attempt.wrong>=2&&!attempt.completed?'phase3-focus':''}`}>
 <div role="group" aria-label="내 답 입력"><AnswerRenderer problem={p} answer={answer} onChange={a=>setS(prev=>({...prev,answers:{...prev.answers,[p.id]:a}}))} readOnly={attempt.completed}/></div>
 {problemContractError(p)&&<p role="alert">문제를 표시하지 못했어요. {p.id}</p>}
 <button className="btn btn-primary" onClick={submit} disabled={attempt.completed||Boolean(problemContractError(p))}>{s.section==='learn'?'활동 확인':'정답 확인'}</button>
 <p role="status" className="spatial-feedback">{attempt.completed?'정답이에요. 조건을 잘 확인했어요.':attempt.revealed?'정답과 내 답을 비교한 뒤 직접 고쳐 보세요.':attempt.wrong===3?`힌트: ${p.feedbackPolicy.hint}`:attempt.wrong===2?'강조한 입력과 공개 자료를 한 칸씩 비교해 보세요.':attempt.wrong===1?p.feedbackPolicy.first:'자료를 살펴보고 직접 답해 보세요.'}</p>
 {attempt.completed&&<><p className="phase3-explanation">{p.revealPolicy.reason}</p>{p.additionalMaterials&&<SpatialMaterials materials={p.additionalMaterials}/>}</>}
 {attempt.revealed&&<section className="spatial-comparison"><h3>{p.answerInput.kind==='block-builder'&&p.solutionPolicy.kind==='any-valid'?'가능한 모양 중 하나':'정답과 이유'}</h3><p>{p.revealPolicy.reason}</p><div className="comparison-pair"><section aria-label="정답 예시">{answerForComparison(p)&&<AnswerRenderer problem={{...p,cameraPolicy:{kind:'free',initialView:'home',allowedViews:['home','top','front','side']}}} answer={answerForComparison(p)!} readOnly onChange={()=>undefined}/>}</section><section aria-label="내가 제출한 답">{attempt.submitted&&<AnswerRenderer problem={p} answer={attempt.submitted} readOnly onChange={()=>undefined}/>}</section></div><p>{p.answerInput.kind==='block-builder'?'작업판에서 조건을 만족하도록 다시 쌓아 보세요.':'내 답 입력에서 답을 고쳐 다시 확인해 보세요.'}</p></section>}
 </section></div>
 <footer>{s.section==='learn'?<><button className="btn" disabled={s.activity===0} onClick={()=>setS(prev=>({...prev,activity:prev.activity-1}))}>이전 활동</button><button className="btn btn-primary" disabled={!attempt.completed} onClick={nextActivity}>다음 활동</button></>:<><button className="btn" disabled={(s.section==='solve'?s.solveIndex:s.practiceIndex)===0} onClick={()=>setS(prev=>({...prev,...(prev.section==='solve'?{solveIndex:prev.solveIndex-1}:{practiceIndex:prev.practiceIndex-1})}))}>이전 문제</button>{(s.section==='solve'?s.solveIndex<phase3Total(id)-1:s.practiceIndex<s.practiceCount-1)&&<button className="btn" disabled={!attempt.completed} onClick={()=>setS(prev=>({...prev,...(prev.section==='solve'?{solveIndex:prev.solveIndex+1}:{practiceIndex:prev.practiceIndex+1})}))}>다음 문제</button>}</>}</footer>
 {s.section==='solve'&&solveDone&&<section className="panel"><h2>문제 풀기 {phase3Total(id)}문제 완료</h2><button className="btn btn-primary" onClick={()=>stage('practice')}>더 풀어보기 시작</button></section>}
 {s.section==='practice'&&practiceDone&&<section className="panel"><h2>더 풀어보기 {s.practiceCount===5?'기본 5':'추가 5'}문제 완료</h2>{s.practiceCount===5&&<button className="btn" onClick={()=>setS(prev=>({...prev,practiceCount:10,practiceIndex:5}))}>새 문제 5개 더 풀기</button>}</section>}
 </section>}
 <p role="status" className="spatial-local">{save}</p></main>;
}
function Model({problem,blocks}:{problem:Problem;blocks:BlockCoord[]}){const [view,setView]=useState<ViewPreset>(problem.cameraPolicy.initialView);return <BlockWorld grid={problem.grid} blocks={blocks} selected={null} layerMax={null} preset={view} onPreset={setView} onBlocksChange={()=>undefined} onSelect={()=>undefined} onMessage={()=>undefined} highlightedBlocks={problem.lessonId===5&&problem.stage==='learn'?blocks.filter(b=>problem.presentedMaterials.some(m=>m.kind==='model'&&m.blocks!==blocks&&!m.blocks.some(v=>v.x===b.x&&v.y===b.y&&v.z===b.z))):[]} disabled allowRotate={problem.cameraPolicy.kind==='free'} allowedViews={problem.allowedViews}/>;}
