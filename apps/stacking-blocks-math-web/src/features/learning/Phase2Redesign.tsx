import { useEffect,useState } from 'react';
import { Link,Navigate,useParams } from 'react-router-dom';
import { getResolvedSupabaseConfig } from '../../lib/config';
import { getStudentToken } from '../../lib/studentApi';
import BlockWorld from '../../components/world/BlockWorld';
import type { BlockCoord,ViewPreset } from '../../../shared/types.ts';
import type { AnswerState,Problem } from '../../../shared/problems/contracts/spatial.ts';
import { phase2Definitions,explorationCompleted,type Phase2Lesson } from '../../../shared/curriculum/phase2.ts';
import { phase2Model,PHASE2_GRID,OBSERVERS,OBSERVER_LABELS,countEvidence,phase2Practice,type Observer } from '../../../shared/problems/templates/phase2.ts';
import { phase2Activity,phase2Active,phase2Solve,phase2Restore,phase2EnsureAdaptive,initialLesson } from '../../../shared/progress/phase2.ts';
import { localProgressKey,type LessonState } from '../../../shared/progress/spatial.ts';
import { emptyAnswer,gradeSpatial,applyLearningAttempt,initialAttempt,answerForComparison } from '../../../shared/problems/grading/spatial.ts';
import { problemContractError } from '../../../shared/problems/contracts/validate.ts';
import AnswerRenderer from '../answers/AnswerRenderer';
import SpatialMaterials from '../representations/SpatialMaterials';
import MathGrid from '../answers/MathGrid';
import './spatial.css';
function identityFor(id:Phase2Lesson){const config=getResolvedSupabaseConfig(),token=getStudentToken();if(!config||!token)return null;try{const {sid,cid}=JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));return typeof sid==='string'&&typeof cid==='string'?localProgressKey(config.supabaseUrl,config.installationId,sid,cid).replace(/lesson3$/,`lesson${id}`):null;}catch{return null;}}
export default function Phase2Redesign(){const id=Number(useParams().lessonId);if(id!==1&&id!==2&&id!==4)return <Navigate to="/world" replace/>;const identity=identityFor(id);return identity?<Session key={identity} id={id} identity={identity}/>:<Navigate to={getResolvedSupabaseConfig()?'/':'/setup'} replace/>;}
function Session({id,identity}:{id:Phase2Lesson;identity:string}){
 const d=phase2Definitions[id];const [s,setS]=useState<LessonState>(()=>{try{return phase2Restore(id,localStorage.getItem(identity))??initialLesson(314159);}catch{return initialLesson(314159);}});
 const [save,setSave]=useState(''),[notice,setNotice]=useState(''),[view,setView]=useState<ViewPreset>('home'),[selected,setSelected]=useState<BlockCoord|null>(null),[highlight,setHighlight]=useState<BlockCoord[]>([]);
 useEffect(()=>{try{localStorage.setItem(identity,JSON.stringify(s));setSave('현재 위치와 답안을 이 기기에 저장했어요.');}catch{setSave('기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.');}},[s,identity]);
 const a=s.activities[s.activity]??phase2Activity(id), def=d.activities[s.activity],kind=def?.interaction,model=phase2Model(id),counts=countEvidence(model);
 const p=phase2Active(id,s),answer=p?(s.answers[p.id]??emptyAnswer(p)):null,attempt=p?(s.attempts[p.id]??initialAttempt()):null;
 const allSolve=phase2Solve(id,s),solveDone=allSolve.length===6+d.assessment.adaptiveCount&&allSolve.every(p=>s.attempts[p.id]?.completed),practiceDone=phase2Practice(id,s.seed).every(p=>s.attempts[p.id]?.completed);
 const mapping=(patch:Record<string,string>)=>setS(prev=>{const activity=prev.activities[prev.activity]??phase2Activity(id);return {...prev,activities:{...prev.activities,[prev.activity]:{...activity,mapping:{...activity.mapping,...patch}}}};});
 const resetView=()=>{setView('home');setHighlight([]);setSelected(null);setNotice('');};
 function stage(section:LessonState['section']){setS(prev=>({...prev,section}));resetView();}
 function observe(v:ViewPreset){setView(v);if(s.section==='learn'){mapping({[v]:'yes',observed:'yes',...(a.mapping.matched==='yes'&&v===(kind==='observer'?'back':'left')?{viewCompared:'yes'}:{})});}}
 function select(b:BlockCoord|null){setSelected(b);if(!b)return;
  if(s.section==='learn'&&kind==='position'){const right=b.x===1&&b.y===0&&b.z===0,up=b.x===0&&b.y===1&&b.z===0;if(right||up){mapping({[right?'right':'up']:'yes'});setNotice(`${right?'오른쪽':'위'} 블록을 찾았어요.`);}else setNotice('파란 기준 블록과 같은 줄의 오른쪽 또는 바로 위를 살펴보세요.');}
  if(s.section==='learn'&&kind==='columns'){setHighlight(model.filter(c=>c.x===b.x&&c.z===b.z));mapping({modelSelected:'yes',column:`${b.z},${b.x}`});}
 }
 const world=(blocks:BlockCoord[],fixed?:Observer,inspect=false)=><div className={fixed?'observer-photo':''}><BlockWorld grid={PHASE2_GRID} blocks={blocks} selected={fixed?null:selected} highlightedBlocks={fixed?[]:s.section==='learn'&&kind==='position'?[{x:0,y:0,z:0}]:highlight} layerMax={null} preset={fixed??view} onPreset={observe} onBlocksChange={()=>undefined} onSelect={select} onMessage={m=>setNotice(m??'')} disabled inspectable={inspect} allowRotate={!fixed} allowedViews={fixed?[]:id===2?['home','front','back','left','right']:id===1?['home','front']:['home','top','front','side']}/></div>;
 const layerButtons=<div className="spatial-choices" aria-label="층 선택">{[1,2,3].map(n=><button className="btn" key={n} aria-pressed={a.mapping.activeLayer===String(n)} onClick={()=>{mapping({[`layer${n}`]:'yes',activeLayer:String(n)});setHighlight(model.filter(b=>b.y===n-1));}}>{n}층</button>)}</div>;
 function submit(){if(!p||!answer||gradeSpatial(p,answer)==='unsupported')return;const next=applyLearningAttempt(p,answer,attempt??initialAttempt());setS(prev=>phase2EnsureAdaptive(id,{...prev,attempts:{...prev.attempts,[p.id]:next}}));if(next.wrong===2&&!next.completed){setHighlight(p.presentedMaterials.flatMap(m=>m.kind==='model'?m.blocks.filter(b=>b.y===0):[]));setNotice('파란 1층과 위쪽 층을 구분하며 자료를 다시 살펴보세요.');}}
 const answerChange=(value:AnswerState)=>{if(p)setS(prev=>({...prev,answers:{...prev.answers,[p.id]:value}}));};
 const photoDirection:Observer=kind==='observer'?'back':'left';
 return <main className="spatial-app"><header><div><p className="eyebrow">{id}차시 · 공간과 입체</p><h1>{d.title}</h1></div><Link className="btn" to="/world">학생 홈</Link></header>
 <p className="spatial-local">새 교육과정 확인 화면 · 기록은 현재 기기에만 저장됩니다. 기존 학습 기록은 바뀌지 않습니다.</p>
 <p className="direction-note">{id===2?'모형의 앞을 기준으로 앞·뒤·왼쪽·오른쪽을 구별해요.':id===4?'이 단원에서 옆은 오른쪽에서 본 모양이에요.':'앞 표시는 모형을 살펴보는 기준이에요.'}</p>
 <nav aria-label="학습 단계">{(['learn','solve','practice'] as const).map((v,i)=><button className="btn" key={v} aria-current={s.section===v?'step':undefined} disabled={v==='solve'&&!s.learnComplete||v==='practice'&&!solveDone} onClick={()=>stage(v)}>{['① 개념 배우기','② 문제 풀기','③ 더 풀어보기'][i]}</button>)}</nav>
 {s.section==='learn'&&def&&<section data-activity-id={def.activityId}><h2>활동 {s.activity+1}/{d.activities.length} · {def.title}</h2><p>{def.shortInstruction}</p>
 <div className="spatial-layout"><section className="spatial-model">{world(model,undefined,kind==='position'||kind==='columns')}</section><section className="spatial-work">
 {kind==='building'&&<><h3>어떤 건축물로 쓰고 싶나요?</h3><div className="spatial-choices">{['도서관','전시관','놀이터'].map(space=><button className="btn" key={space} aria-pressed={a.mapping.space===space} onClick={()=>mapping({space})}>{space}</button>)}</div><p>관찰 버튼으로 모형도 살펴보세요.</p></>}
 {(kind==='count-plan'||kind==='estimate')&&<><h3>나의 예상 방법</h3><div className="spatial-choices">{['한 층씩 나누어 세기','자리마다 쌓인 수 세기','한 개씩 차례로 세기'].map(strategy=><button className="btn" key={strategy} aria-pressed={a.mapping.strategy===strategy} onClick={()=>mapping({strategy})}>{strategy}</button>)}</div><p>지금은 방법을 예상하는 활동이에요. 점수로 채점하지 않아요.</p></>}
 {kind==='position'&&<><p>기준: 앞 첫째 줄, 가로 첫째 자리의 파란 1층 블록</p><p>오른쪽 찾기: {a.mapping.right==='yes'?'확인했어요':'블록을 직접 눌러요'}</p><p>위 찾기: {a.mapping.up==='yes'?'확인했어요':'블록을 직접 눌러요'}</p></>}
 {(kind==='layers'||kind==='layer-counting')&&<>{layerButtons}<p>선택한 층의 블록이 파랑으로 강조됩니다.</p>{kind==='layer-counting'&&<><SpatialMaterials materials={[{kind:'layer-map',grids:counts.layers,caption:'층별 모양'}]}/><p>{counts.layerCounts.join(' + ')} = {model.length}개</p></>}</>}
 {kind==='directions'&&<><h3>확인한 관찰 위치</h3>{OBSERVERS.map(o=><p key={o}>{OBSERVER_LABELS[o]}: {a.mapping[o]==='yes'?'확인했어요':'아직 살펴보지 않았어요'}</p>)}</>}
 {(kind==='observer'||kind==='camera-find')&&<><h3>방향을 찾을 사진</h3>{world(model,photoDirection)}<div className="spatial-choices">{OBSERVERS.map(o=><button className="btn" key={o} aria-pressed={a.mapping.guess===o} onClick={()=>{mapping({guess:o,matched:o===photoDirection?'yes':'no',viewCompared:'no'});setNotice(o===photoDirection?'같은 위치의 보기 버튼으로 비교해 보세요.':'높은 기둥의 위치를 다시 비교해 보세요.');}}>{OBSERVER_LABELS[o]}</button>)}</div></>}
 {kind==='direction-match'&&<><ObserverMap/><p>모형의 앞을 기준으로 각 관찰자의 위치를 연결하세요.</p>{['뒤','왼쪽','오른쪽'].map(label=><fieldset key={label}><legend>{{뒤:'나',왼쪽:'다',오른쪽:'라'}[label]} 관찰자의 위치</legend>{OBSERVERS.map(o=><button className="btn" key={o} aria-pressed={a.mapping[label]===o} onClick={()=>mapping({[label]:o})}>{OBSERVER_LABELS[o]}</button>)}</fieldset>)}</>}
 {kind==='columns'&&<><MathGrid title="자리별 높이" rows={counts.heights} floor numeric readOnly marked={counts.heights.map((r,z)=>r.map((_v,x)=>a.mapping.column===`${z},${x}`))} onCell={(z,x)=>{mapping({mapSelected:'yes',column:`${z},${x}`});setHighlight(model.filter(b=>b.x===x&&b.z===z));}}/><p>지도와 3D를 각각 누르면 같은 기둥이 강조됩니다.</p><p>지도 선택: {a.mapping.mapSelected==='yes'?'확인':'대기'} · 3D 선택: {a.mapping.modelSelected==='yes'?'확인':'대기'}</p></>}
 {kind==='height-sum'&&<><MathGrid title="자리별 높이" rows={counts.heights} floor numeric readOnly/><label>높이 숫자의 합 <input className="field" type="number" value={a.mapping.sum??''} onChange={e=>mapping({sum:e.target.value,sumChecked:'no'})}/></label><button className="btn" onClick={()=>{const correct=Number(a.mapping.sum)===model.length;mapping({sumChecked:correct?'yes':'no'});setNotice(correct?'모든 자리의 높이를 더했어요.':'0인 자리도 포함해 차례로 다시 더해 보세요.');}}>합 비교하기</button></>}
 {kind==='compare-strategies'&&<><MathGrid title="높이 숫자 지도" rows={counts.heights} floor numeric readOnly/><SpatialMaterials materials={[{kind:'layer-map',grids:counts.layers,caption:'층별 모양'}]}/><p>높이의 합: {counts.heightSum}개</p><p>층별 개수의 합: {counts.layerCounts.join(' + ')} = {model.length}개</p><button className="btn" onClick={()=>mapping({compared:'yes'})}>같은 전체 개수를 확인했어요</button></>}
 <details><summary>도움말</summary><p>{def.optionalHelp}</p></details>{notice&&<p role="status">{notice}</p>}</section></div>
 <footer><button className="btn" disabled={s.activity===0} onClick={()=>{setS(prev=>({...prev,activity:prev.activity-1}));resetView();}}>이전 활동</button><button className="btn btn-primary" disabled={!explorationCompleted(kind,a)} onClick={()=>{setS(prev=>({...prev,activity:prev.activity+1,learnComplete:prev.activity===d.activities.length-1||prev.learnComplete}));resetView();}}>다음 활동</button></footer></section>}
 {s.section==='learn'&&!def&&<section className="panel"><h2>개념 배우기 완료</h2><p>{d.objective}</p><button className="btn btn-primary" onClick={()=>stage('solve')}>문제 풀기 시작</button></section>}
 {s.section!=='learn'&&p&&answer&&attempt&&<section key={p.id} data-problem-id={p.id} data-answer-kind={p.answerInput.kind}><h2>{s.section==='solve'?`문제 ${s.solveIndex+1}/${6+d.assessment.adaptiveCount}`:`더 풀어보기 ${s.practiceIndex+1}/5`} · {p.prompt}</h2>
 <div className="spatial-layout choice-primary"><section className="spatial-model">{p.presentedMaterials.filter(m=>m.kind==='model').map((m,i)=>m.kind==='model'&&<section key={i}><h3>{m.caption}</h3>{world(m.blocks,m.view)}</section>)}</section><section className="spatial-work"><SpatialMaterials materials={p.presentedMaterials}/><div role="group" aria-label="내 답 입력"><AnswerRenderer problem={p} answer={answer} onChange={answerChange} readOnly={attempt.completed}/></div>
 <button className="btn btn-primary" disabled={attempt.completed||Boolean(problemContractError(p))} onClick={submit}>정답 확인</button>
 <p role="status" className="spatial-feedback">{attempt.completed?'정답이에요. 잘 살펴보았어요.':attempt.wrong===1?p.feedbackPolicy.first:attempt.wrong===2?'파란 블록과 제시한 자료를 다시 비교해 보세요.':attempt.wrong===3?`힌트: ${p.feedbackPolicy.hint}`:attempt.revealed?'정답과 내 답을 비교하고 직접 고쳐 보세요.':'자료를 살펴보고 답해 보세요.'}</p>
 {attempt.revealed&&<Comparison problem={p} submitted={attempt.submitted}/>}
 <footer><button className="btn" disabled={(s.section==='solve'?s.solveIndex:s.practiceIndex)===0} onClick={()=>{setS(prev=>({...prev,...(prev.section==='solve'?{solveIndex:prev.solveIndex-1}:{practiceIndex:prev.practiceIndex-1})}));resetView();}}>이전 문제</button>
 {(s.section==='solve'?s.solveIndex<5+d.assessment.adaptiveCount:s.practiceIndex<4)&&<button className="btn" disabled={!attempt.completed} onClick={()=>{setS(prev=>({...prev,...(prev.section==='solve'?{solveIndex:prev.solveIndex+1}:{practiceIndex:prev.practiceIndex+1})}));resetView();}}>다음 문제</button>}</footer></section></div>
 {s.section==='solve'&&solveDone&&<section className="panel"><h2>문제 풀기 {6+d.assessment.adaptiveCount}문제 완료</h2><button className="btn btn-primary" onClick={()=>stage('practice')}>더 풀어보기 시작</button></section>}
 {s.section==='practice'&&practiceDone&&<section className="panel"><h2>더 풀어보기 기본 5문제 완료</h2><p>{id}차시의 필수 학습을 마쳤어요.</p></section>}
 </section>}
 <p role="status" className="spatial-local">{save}</p></main>;
}
function Comparison({problem,submitted}:{problem:Problem;submitted:AnswerState|null}){const answer=answerForComparison(problem);return <section className="spatial-comparison"><h3>정답과 내 답 비교</h3><p>{problem.revealPolicy.reason}</p><div className="comparison-pair"><section><h4>정답</h4>{answer&&<AnswerRenderer problem={problem} answer={answer} readOnly onChange={()=>undefined}/>}</section><section><h4>내 답</h4>{submitted&&<AnswerRenderer problem={problem} answer={submitted} readOnly onChange={()=>undefined}/>}</section></div><p>입력한 답을 직접 고쳐 다시 확인하세요.</p></section>;}

function ObserverMap(){return <figure className="observer-map" aria-label="관찰 위치 지도"><span className="observer-back">나</span><span className="observer-left">다</span><span className="observer-building">건축물<br/>앞</span><span className="observer-right">라</span><span className="observer-front">가</span></figure>;}
