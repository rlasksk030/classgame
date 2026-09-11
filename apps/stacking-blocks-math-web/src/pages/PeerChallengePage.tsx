import { useState } from 'react';
import { Link } from 'react-router-dom';
import { activityApi } from '../lib/studentApi';
import { validChallenge,type ChallengeType } from '../../shared/activities.ts';
import { INITIAL_ATTEMPT,type AttemptState,type AttemptOutcome } from '../../shared/attempts.ts';
import type { BlockCoord,ProblemGiven } from '../../shared/types.ts';
import ActivityBuilder from '../features/activities/ActivityBuilder';
import Representations from '../features/activities/Representations';
export default function PeerChallengePage(){
 const [blocks,setBlocks]=useState<BlockCoord[]>([]),[type,setType]=useState<ChallengeType>('views'),[code,setCode]=useState(''),[shared,setShared]=useState('');
 const [given,setGiven]=useState<ProblemGiven|null>(null),[state,setState]=useState<AttemptState & {score?:number}>(INITIAL_ATTEMPT),[answer,setAnswer]=useState<BlockCoord[]|undefined>(),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}catch(error){setMessage(error instanceof Error?error.message:'연결하지 못했습니다.');}finally{setBusy(false);}};
 const load=()=>run(async()=>{const result=await activityApi<{given:ProblemGiven;state:AttemptState & {score?:number};answer:BlockCoord[]|null}>('challenge:get',{code});setGiven(result.given);setState(result.state);setAnswer(result.answer??undefined);setBlocks([]);setMessage('쌓기나무 10개로 조건에 맞게 쌓아 보세요.');});
 return <main className="screen app-max stack"><h1>9차시 · 친구에게 쌓기나무 문제 내기</h1><Link to="/world">월드로</Link><p>10개의 쌓기나무로 문제를 만들고 같은 반 친구에게 코드를 알려 주세요.</p>
 <div className="toolbar-row"><label>친구 문제 코드<input className="field" value={code} maxLength={12} onChange={e=>setCode(e.target.value.toUpperCase())}/></label><button className="btn" disabled={busy||!code} onClick={()=>void load()}>친구 문제 열기</button><button className="btn" onClick={()=>{setGiven(null);setBlocks([]);setAnswer(undefined);setState(INITIAL_ATTEMPT);}}>내 문제 만들기</button></div>
 <div className="world-layout"><ActivityBuilder key={given?code:'author'} blocks={blocks} onChange={setBlocks} answer={answer} disabled={busy||Boolean(given&&state.completed)}/><section className="panel stack">
 {given?<><Representations given={given}/><p>오답 {state.wrongCount}회 · 놀이 점수 {state.score??0} / 2점</p>{state.hintShown&&<p>힌트: 자리별 높이와 보이지 않는 블록을 살펴보세요.</p>}
 <button className="btn btn-sm" disabled={busy||state.completed||state.hintShown} onClick={()=>void run(async()=>{const result=await activityApi<{state:AttemptState & {score?:number};hint:string}>('challenge:hint',{code});setState(result.state);setMessage(result.hint);})}>힌트 보기 (보상 1점)</button>
 <button className="btn btn-primary" disabled={busy||state.completed} onClick={()=>void run(async()=>{const result=await activityApi<{outcome:AttemptOutcome;state:AttemptState & {score?:number};answer:BlockCoord[]|null}>('challenge:attempt',{code,blocks});setState(result.state);setAnswer(result.answer??undefined);setMessage(result.outcome.message+(result.state.score?` ${result.state.score}점`:''));})}>정답 확인</button>
 {state.answerRevealed&&!state.completed&&<button className="btn" onClick={()=>setBlocks([])}>정답 모양대로 다시 쌓기</button>}
 </>:<><label>문제 카드<select className="field" value={type} onChange={e=>setType(e.target.value as ChallengeType)}><option value="views">위·앞·옆</option><option value="heightMap">숫자 지도</option><option value="layers">층별 모양</option></select></label>
 <button className="btn btn-primary" disabled={busy||!validChallenge(blocks,type)} onClick={()=>void run(async()=>{const result=await activityApi<{code:string}>('challenge:create',{blocks,type});setShared(result.code);setMessage('문제를 저장했어요. 같은 반 친구에게 코드를 알려 주세요.');})}>10개로 만든 문제 저장</button>{shared&&<p>공유 코드: <strong>{shared}</strong></p>}</>}
 <p role="status">{message}</p></section></div></main>;
}
