import { problemContractError } from '../../../shared/problems/contracts/validate.ts';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import BlockWorld from '../../components/world/BlockWorld';
import { getStudentToken } from '../../lib/studentApi';
import { getResolvedSupabaseConfig } from '../../lib/config';
import { blocksEqual, project } from '../../../shared/blocks.ts';
import type { BlockCoord, ViewPreset } from '../../../shared/types.ts';
import { LESSON3_ACTIVITIES, LESSON3_DEFINITION, activityCompleted } from '../../../shared/curriculum/lesson3.ts';
import { FACE_LABELS, FACES, LESSON3_GRID, LESSON3_MODEL, practiceProblems } from '../../../shared/problems/templates/lesson3.ts';
import type { Face, AnswerState, Problem } from '../../../shared/problems/contracts/spatial.ts';
import { answerForComparison, applyLearningAttempt, emptyAnswer, gradeSpatial, initialAttempt } from '../../../shared/problems/grading/spatial.ts';
import { activeProblem, ensureAdaptive, initialActivity, initialLesson, localProgressKey, restoreLesson, solveProblems, type ActivityState, type LessonState } from '../../../shared/progress/spatial.ts';
import AnswerRenderer from '../answers/AnswerRenderer';
import MathGrid from '../answers/MathGrid';
import SpatialMaterials from '../representations/SpatialMaterials';
import './spatial.css';
function storageIdentity():string|null {
 const config=getResolvedSupabaseConfig();const token=getStudentToken();if(!config||!token)return null;
 try {const identity=JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))) as {sid?:string;cid?:string};
 if(!identity.sid||!identity.cid)return null;
 return localProgressKey(config.supabaseUrl,config.installationId,identity.sid,identity.cid);
 }catch{return null;}
}
export default function Lesson3Redesign(){
 const identity=storageIdentity();
 if(!identity)return <Navigate to={getResolvedSupabaseConfig()?'/':'/setup'} replace/>;
 return <LessonSession key={identity} identity={identity}/>;
}
function LessonSession({identity}:{identity:string}) {
 const [state,setState]=useState<LessonState>(()=>{try{return restoreLesson(localStorage.getItem(identity))??initialLesson(314159);}catch{return initialLesson(314159);}});
 const [saveMessage,setSaveMessage]=useState('이 기기에 저장합니다. 다른 기기와는 아직 동기화되지 않습니다.');
 const [preset,setPreset]=useState<ViewPreset>('home');
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState<BlockCoord|null>(null);
 const [highlight,setHighlight]=useState<BlockCoord[]>([]);
 const activity=state.activities[state.activity]??initialActivity();
 const definition=LESSON3_ACTIVITIES[state.activity];
 const interaction=definition?.interaction;
 const problem=activeProblem(state);
 const answer=problem?(state.answers[problem.id]??emptyAnswer(problem)):null;
 useEffect(()=>{setPreset(problem?.cameraPolicy.initialView??'home');setSelected(null);setHighlight([]);},[problem?.id]);
 const attempt=problem?(state.attempts[problem.id]??initialAttempt()):null;
 useEffect(()=>{try{localStorage.setItem(identity,JSON.stringify(state));setSaveMessage('현재 위치와 답안을 이 기기에 저장했어요.');}catch{setSaveMessage('기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.');}},[identity,state]);
 function updateActivity(patch:Partial<ActivityState>) {setState(s=>({...s,activities:{...s.activities,[s.activity]:{...(s.activities[s.activity]??initialActivity()),...patch}}}));}
 function onView(view:ViewPreset){setPreset(view);if(state.section==='learn'&&FACES.includes(view as Face))updateActivity({views:[...new Set([...activity.views,view as Face])]});}
 function go(section:LessonState['section']) {setState(s=>({...s,section}));setPreset('home');setHighlight([]);setMessage('');}
 function updateAnswer(next:AnswerState){if(problem)setState(s=>({...s,answers:{...s.answers,[problem.id]:next}}));}
 function submit(){if(!problem||!answer)return;
 if(gradeSpatial(problem,answer)==='unsupported'){setMessage('문제를 표시하지 못했어요. 이 답안의 채점을 지원하지 않습니다.');return;}
 const next=applyLearningAttempt(problem,answer,attempt??initialAttempt());
 setState(s=>ensureAdaptive({...s,attempts:{...s.attempts,[problem.id]:next}}));
 if(next.wrong>=2&&!next.completed){setPreset(problem.feedbackPolicy.focus);const model=problem.presentedMaterials.find(m=>m.kind==='model');if(model?.kind==='model'){const max=Math.max(...model.blocks.map(b=>b.y));setHighlight(model.blocks.filter(b=>b.y===max));}}
 }
 function nextProblem(){if(!problem||!attempt?.completed)return;setState(s=>({...s,...(s.section==='solve'?{solveIndex:Math.min(9,s.solveIndex+1)}:{practiceIndex:Math.min(s.practiceCount-1,s.practiceIndex+1)})}));setPreset('home');setHighlight([]);setMessage('');}
 const world=(blocks:BlockCoord[],editable=false,onChange?:(b:BlockCoord[])=>void,policy=problem?.cameraPolicy)=> <BlockWorld grid={LESSON3_GRID} blocks={blocks} selected={selected} layerMax={null} highlightedBlocks={highlight} preset={preset} onPreset={onView} onBlocksChange={onChange??(()=>undefined)} onSelect={setSelected} onMessage={m=>setMessage(m??'')} disabled={!editable} allowRotate={state.section==='learn'||policy?.kind!=='fixed'} allowedViews={state.section==='learn'?['home','top','front','side']:policy?.allowedViews} />;
 const baseProjections=project(LESSON3_MODEL,LESSON3_GRID);
 const changedProjections=project(activity.blocks,LESSON3_GRID);
 const target=[...LESSON3_MODEL,{x:0,y:1,z:0}];
 const mappingCorrect=activity.mapping['가']==='side'&&activity.mapping['나']==='top'&&activity.mapping['다']==='front';
 const activityReady=definition?activityCompleted(definition,activity):false;
 const changeBlocks=(blocks:BlockCoord[])=>{updateActivity({blocks,history:[...activity.history,activity.blocks],future:[],changeCompared:false});};
 const solveDone=solveProblems(state).length===10&&solveProblems(state).every(p=>state.attempts[p.id]?.completed);
 const practiceBaseDone=practiceProblems(state.seed,5).every(p=>state.attempts[p.id]?.completed);
 return <main className="spatial-app">
 <header><div><p className="eyebrow">{LESSON3_DEFINITION.lessonId}차시 · {LESSON3_DEFINITION.title}</p><h1>위·앞·옆으로 살펴봐요</h1></div><Link className="btn" to="/world">학생 홈</Link></header>
 <p className="direction-note">이 단원에서 옆은 오른쪽에서 본 모양입니다.</p>
 <p className="spatial-local">새 교육과정 확인 화면 · 기록은 현재 기기에만 저장됩니다. 기존 학습 기록은 바뀌지 않습니다.</p>
 <nav aria-label="학습 단계">{(['learn','solve','practice'] as const).map((section,i)=><button className="btn" key={section} aria-current={state.section===section?'step':undefined} disabled={section==='solve'&&!state.learnComplete||section==='practice'&&!solveDone} onClick={()=>go(section)}>{['① 개념 배우기','② 문제 풀기','③ 더 풀어보기'][i]}</button>)}</nav>
 {state.section==='learn'&&state.activity<5&&<>
 <h2>활동 {state.activity+1}/5 · {LESSON3_ACTIVITIES[state.activity].title}</h2><p>{LESSON3_ACTIVITIES[state.activity].shortInstruction}</p>
 <div className={`spatial-layout ${interaction==='visit-views'?'model-primary':''}`}>
 <section className="spatial-model">{world(interaction==='predict-build-compare'?activity.blocks:LESSON3_MODEL,interaction==='predict-build-compare'&&activity.predictionConfirmed,changeBlocks)}{message&&<p role="status">{message}</p>}</section>
 <section className="spatial-work">
 {interaction==='visit-views'&&<><h3>관찰한 방향</h3><p>{activity.views.length?activity.views.map(f=>FACE_LABELS[f]).join(' · '):'위·앞·옆 버튼을 눌러 보세요.'}</p><p>두 방향 이상 확인하면 자유롭게 돌려 비교해도 좋아요.</p></>}
 {interaction==='paint-top'&&<><MathGrid title="위에서 본 자리" rows={activity.top} floor readOnly={!activity.views.includes('top')} onChange={(r,c,v)=>updateActivity({top:activity.top.map((row,ri)=>row.map((cell,ci)=>ri===r&&ci===c?Boolean(v):cell))})}/><p>먼저 위에서 보기로 확인하세요. 높이는 숫자로 쓰지 않아요.</p></>}
 {interaction==='inspect-columns'&&<>{(['front','side'] as Face[]).map(f=><MathGrid key={f} title={`${FACE_LABELS[f]}에서 본 모양`} rows={baseProjections[f]} readOnly onCell={(_r,c)=>{setPreset(f);setHighlight(LESSON3_MODEL.filter(b=>f==='front'?b.x===c:b.z===LESSON3_GRID.gridDepth-1-c));updateActivity({inspected:[...new Set([...activity.inspected,f])]});}}/>)}<p>누른 열의 블록이 파랑으로 강조됩니다.</p></>}
 {interaction==='match-views'&&<><div className="spatial-grids">{(['side','top','front'] as Face[]).map((f,i)=><section key={f}><MathGrid title={['가','나','다'][i]} rows={baseProjections[f]} readOnly floor={f==='top'}/><fieldset><legend>{['가','나','다'][i]}의 방향</legend>{FACES.map(v=><button className="btn" key={v} aria-pressed={activity.mapping[['가','나','다'][i]]===v} onClick={()=>updateActivity({mapping:{...activity.mapping,[['가','나','다'][i]]:v},compared:false})}>{FACE_LABELS[v]}</button>)}</fieldset></section>)}</div>
 <button className="btn" onClick={()=>{if(mappingCorrect){setMessage('잘 연결했어요. 가 그림을 오른쪽 옆에서 비교해 보세요.');setPreset('side');updateActivity({compared:true});}else setMessage('그림의 자리와 높이를 다시 비교해 보세요.');}}>연결 확인하고 시점 비교</button></>}
 {interaction==='predict-build-compare'&&<><h3>어떤 모습이 달라질까요?</h3><div className="spatial-choices">{FACES.map(f=><button key={f} className="btn" disabled={activity.predictionConfirmed} aria-pressed={activity.prediction.includes(f)} onClick={()=>updateActivity({prediction:activity.prediction.includes(f)?activity.prediction.filter(v=>v!==f):[...activity.prediction,f]})}>{FACE_LABELS[f]}</button>)}</div>
 <button className="btn" disabled={!activity.prediction.length||activity.predictionConfirmed} onClick={()=>updateActivity({predictionConfirmed:true})}>예상했어요 · 쌓기 시작</button>
 <p>앞에서 첫째 줄, 가로 첫째 자리에 한 개를 더 쌓으세요. 파랑으로 표시한 블록 위입니다.</p>
 <button className="btn" onClick={()=>{setHighlight(LESSON3_MODEL.filter(b=>b.x===0&&b.z===0));setPreset('home');}}>쌓을 자리 보기</button>
 <p>블록 수: {activity.blocks.length}</p><div className="spatial-choices"><button className="btn" disabled={!activity.history.length} onClick={()=>updateActivity({blocks:activity.history.at(-1)!,history:activity.history.slice(0,-1),future:[activity.blocks,...activity.future],changeCompared:false})}>Undo · 되돌리기</button><button className="btn" disabled={!activity.future.length} onClick={()=>updateActivity({blocks:activity.future[0],future:activity.future.slice(1),history:[...activity.history,activity.blocks],changeCompared:false})}>Redo · 다시 실행</button></div>
 <div className="spatial-grids">{FACES.map(f=><MathGrid key={f} title={`${FACE_LABELS[f]} · 바뀐 칸 표시`} rows={changedProjections[f]} marked={changedProjections[f].map((row,r)=>row.map((v,c)=>v!==baseProjections[f][r][c]))} floor={f==='top'} readOnly/>)}</div>
 <button className="btn" disabled={!blocksEqual(activity.blocks,target)} onClick={()=>updateActivity({changeCompared:true})}>예상과 실제 변화 비교</button>{activity.changeCompared&&<p role="status">예상: {activity.prediction.map(f=>FACE_LABELS[f]).join('·')} / 실제: 앞. 앞의 높이는 늘었지만 위의 자리와 옆의 최대 높이는 같아요.</p>}</>}
 </section></div>
 <footer><button className="btn" disabled={state.activity===0} onClick={()=>{setState(s=>({...s,activity:s.activity-1}));setPreset('home');setHighlight([]);}}>이전 활동</button><button className="btn btn-primary" disabled={!activityReady} onClick={()=>{setState(s=>({...s,activity:s.activity+1,learnComplete:s.activity===4||s.learnComplete}));setPreset('home');setHighlight([]);setMessage('');}}>다음 활동</button></footer>
 </>}
 {state.section==='learn'&&state.activity===5&&<><h2>개념 정리</h2><div className="spatial-layout">{world(LESSON3_MODEL)}<section><SpatialMaterials materials={FACES.map(face=>({kind:'projection',face,grid:baseProjections[face],caption:FACE_LABELS[face]}))}/><p>위: 바닥에 놓인 위치를 봅니다.</p><p>앞: 앞에서 보이는 모양을 봅니다.</p><p>옆: 오른쪽에서 보이는 모양을 봅니다.</p><button className="btn btn-primary" onClick={()=>go('solve')}>문제 풀기 시작</button></section></div></>}
 {state.section!=='learn'&&problem&&answer&&attempt&&<section key={problem.id} data-problem-id={problem.id} data-answer-kind={problem.answerInput.kind}>
 <h2>{state.section==='solve'?`문제 ${state.solveIndex+1}/10`:`더 풀어보기 ${state.practiceIndex+1}/${state.practiceCount}`} · {problem.prompt}</h2>
 {state.section==='solve'&&state.solveIndex>=6&&<p>{problem.stage==='remediation'?'앞선 풀이에서 다시 살펴볼 개념을 연습해요.':'개념을 잘 이해했어요. 변화와 오류를 더 생각해 봐요.'}</p>}
 <div className={`spatial-layout ${problem.answerInput.kind==='projection-grid'?'grid-primary':'choice-primary'}`}><section className="spatial-model">{problem.presentedMaterials.filter(m=>m.kind==='model').map((m,i)=>m.kind==='model'&&<section key={i}><h3>{m.caption}</h3>{world(m.blocks)}</section>)}</section>
 <section className="spatial-work"><SpatialMaterials materials={problem.presentedMaterials}/><div role="group" aria-label="내 답 입력"><AnswerRenderer problem={problem} answer={answer} onChange={updateAnswer} readOnly={attempt.completed}/></div>
 <button className="btn btn-primary" disabled={attempt.completed||Boolean(problemContractError(problem))} onClick={submit}>정답 확인</button>
 {problemContractError(problem)&&<p role="alert">문제를 표시하지 못했어요. 진단: {problemContractError(problem)}</p>}
 <div className="spatial-feedback" role="status">{attempt.completed?'정답이에요. 잘 살펴보았어요.':attempt.wrong===1?problem.feedbackPolicy.first:attempt.wrong===2?'관련 시점으로 돌아왔어요. 파란 블록과 그림의 높이를 비교해 보세요.':attempt.wrong===3?`힌트: ${problem.feedbackPolicy.hint}`:attempt.revealed?'정답과 내 답을 비교한 뒤 직접 답안을 고쳐 보세요.':'자료를 살펴보고 답해 보세요.'}</div>
 {attempt.revealed&&<AnswerComparison problem={problem} submitted={attempt.submitted}/>}
 {message&&<p role="alert">{message}</p>}
 <footer><button className="btn" disabled={(state.section==='solve'?state.solveIndex:state.practiceIndex)===0} onClick={()=>{setState(s=>({...s,...(s.section==='solve'?{solveIndex:s.solveIndex-1}:{practiceIndex:s.practiceIndex-1})}));setHighlight([]);}}>이전 문제</button>
 {!(state.section==='solve'&&state.solveIndex===9||state.section==='practice'&&state.practiceIndex===state.practiceCount-1)&&<button className="btn" disabled={!attempt.completed} onClick={nextProblem}>다음 문제</button>}</footer>
 </section></div>
 {state.section==='solve'&&solveDone&&state.solveIndex===9&&<section className="panel"><h2>문제 풀기 10문제 완료</h2><p>공통 6문제와 개인 맞춤 4문제를 마쳤어요.</p><button className="btn btn-primary" onClick={()=>go('practice')}>더 풀어보기 시작</button></section>}
 {state.section==='practice'&&practiceBaseDone&&state.practiceIndex>=4&&<section className="panel"><h2>더 풀어보기 기본 5문제 완료</h2><p>3차시의 필수 활동을 모두 마쳤어요.</p>{state.practiceCount===5?<button className="btn" onClick={()=>setState(s=>({...s,practiceCount:10,practiceIndex:5}))}>새 문제 5개 더 풀기</button>:state.practiceIndex===9&&attempt.completed?<p>추가 연습까지 완료했어요.</p>:null}</section>}
 </section>}
 <p className="muted" role="status">{saveMessage}</p>
 </main>;
}
function AnswerComparison({problem,submitted}:{problem:Problem;submitted:AnswerState|null}) {
 const correct=answerForComparison(problem);if(!correct)return <p>정답 비교를 준비하지 못했어요.</p>;
 return <section className="spatial-comparison"><h3>정답과 내 답 비교</h3><p>{problem.revealPolicy.reason}</p><h4>정답</h4><AnswerRenderer problem={problem} answer={correct} onChange={()=>undefined} readOnly/>{submitted&&<><h4>제출한 내 답</h4><AnswerRenderer problem={problem} answer={submitted} onChange={()=>undefined} readOnly/></>}<p>{problem.answerInput.kind==='block-builder'?'작업판에서 직접 고쳐 쌓아 완성하세요.':'위의 답안 입력에서 직접 고쳐 다시 확인하세요.'}</p></section>;
}
