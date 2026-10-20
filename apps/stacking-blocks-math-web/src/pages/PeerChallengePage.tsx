import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { activityApi, getStudentToken } from "../lib/studentApi";
import { challengeGiven, type ChallengeType } from "../../shared/activities.ts";
import { INITIAL_ATTEMPT, type AttemptState, type AttemptOutcome } from "../../shared/attempts.ts";
import type { BlockCoord, ProblemGiven } from "../../shared/types.ts";
import { draftKey } from '../lib/snapshotDraft';
import { canonicalize } from '../../shared/blocks.ts';
import { SAVE_TEXT, saveErrorText } from '../features/activities/buildingSave';
import ActivityBuilder from "../features/activities/ActivityBuilder";
import Representations from "../features/activities/Representations";

const CHALLENGE_CARDS: Array<{ type: ChallengeType; title: string; description: string }> = [
  { type: "views", title: "위·앞·옆에서 본 모양", description: "세 방향에서 본 모습을 보여 주고 친구가 원래 모양을 쌓게 해요." },
  { type: "top", title: "위에서 본 모양", description: "위에서 내려다본 바닥 모양만 보여 주고 친구가 숨은 높이를 추리하게 해요." },
  { type: "heightMap", title: "위에서 본 모양에 수 쓰기", description: "자리마다 쌓인 높이를 숫자로 보여 주고 친구가 모양을 만들게 해요." },
  { type: "layers", title: "층별로 나타낸 모양", description: "1층, 2층, 3층의 모양을 보여 주고 친구가 다시 쌓게 해요." },
];

type OwnChallenge={code:string;requestId:string;created_at:string;blocks:BlockCoord[];type:ChallengeType;hintType:ChallengeType};
type ChallengeDraft=Omit<OwnChallenge,'code'|'created_at'>&{pending:boolean};
function sameChallenge(a:ChallengeDraft,b:OwnChallenge){return a.requestId===b.requestId&&a.type===b.type&&a.hintType===b.hintType&&JSON.stringify(canonicalize(a.blocks))===JSON.stringify(canonicalize(b.blocks));}
export default function PeerChallengePage() {
  const [challenges,setChallenges]=useState<Array<{code:string;source:'student'|'system';title:string;completed:boolean}>>([]);
  const [activeCode,setActiveCode]=useState('');
  const loadSequence=useRef(0);
  useEffect(()=>{let active=true;void activityApi<{challenges:typeof challenges}>('challenge:list',{}).then(r=>{if(active)setChallenges(r.challenges);}).catch(()=>{if(active)setMessage('문제 목록을 불러오지 못했어요. 친구 코드로 열거나 다시 접속해 주세요.');});return()=>{active=false;loadSequence.current++;};},[]);
  const [blocks, setBlocks] = useState<BlockCoord[]>([]);
  const [type, setType] = useState<ChallengeType>("views");
  const [hintType, setHintType] = useState<ChallengeType>("heightMap");
  const [code, setCode] = useState("");
  const [shared, setShared] = useState("");
  const [own,setOwn]=useState<OwnChallenge[]>([]);
  const [ownReady,setOwnReady]=useState(false);
  const [savedAt,setSavedAt]=useState('');
  const [pending,setPending]=useState(false);
  const requestId=useRef<string>(crypto.randomUUID());
  const [draftLoaded,setDraftLoaded]=useState(false);
  const running=useRef(false);
  const draftStorage=draftKey(getStudentToken(),'challenge-create');
  const [given, setGiven] = useState<ProblemGiven | null>(null);
  const [hintGiven, setHintGiven] = useState<ProblemGiven | null>(null);
  const [state, setState] = useState<AttemptState & { score?: number }>(INITIAL_ATTEMPT);
  const [answer, setAnswer] = useState<BlockCoord[] | undefined>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const run = async (fn: () => Promise<void>) => {
    if(running.current)return;running.current=true;setBusy(true);
    try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : "연결하지 못했습니다."); }
    finally { running.current=false;setBusy(false); }
  };
  const load = (selectedCode=code) => run(async () => {
    const sequence=++loadSequence.current;
    const result = await activityApi<{ given: ProblemGiven; hintGiven?: ProblemGiven; state: AttemptState & { score?: number }; revealedAnswer?: BlockCoord[] }>("challenge:get", { code:selectedCode });
    if(sequence!==loadSequence.current)return;
    setCode(selectedCode);setActiveCode(selectedCode);
    setGiven(result.given); setHintGiven(result.hintGiven ?? null); setState(result.state); setAnswer(result.revealedAnswer ?? undefined); setBlocks([]); setMessage("친구가 만든 조건을 보고 쌓아 보세요.");
  });
  const startNew = () => { loadSequence.current++;setActiveCode(''); setGiven(null); setHintGiven(null); setBlocks([]); setAnswer(undefined); setState(INITIAL_ATTEMPT); setShared(""); setType("views"); setHintType("heightMap"); setStep(1); setMessage(SAVE_TEXT.dirty);setPending(false);setSavedAt('');requestId.current=crypto.randomUUID();try{if(draftStorage)localStorage.removeItem(draftStorage);}catch{/* New request remains in memory. */} };
  const showOwn=(item:OwnChallenge)=>{loadSequence.current++;setGiven(null);setBlocks(item.blocks);setType(item.type);setHintType(item.hintType);setShared(item.code);setSavedAt(item.created_at);setPending(false);setStep(4);requestId.current=item.requestId;setMessage(SAVE_TEXT.saved);};
  useEffect(()=>{
    let active=true;
    let draft:ChallengeDraft|null=null;
    try{draft=draftStorage?JSON.parse(localStorage.getItem(draftStorage)??'null'):null;}catch{/* Existing server problems remain available. */}
    if(draft&&Array.isArray(draft.blocks)){setBlocks(draft.blocks);setType(draft.type);setHintType(draft.hintType);requestId.current=draft.requestId;setPending(draft.pending);if(draft.pending)setStep(4);setMessage(SAVE_TEXT.local);}
    setDraftLoaded(true);
    void activityApi<{challenges:OwnChallenge[]}>('challenge:mine').then(result=>{
      if(!active)return;setOwn(result.challenges);setOwnReady(true);
      const recovered=draft&&result.challenges.find(item=>sameChallenge(draft!,item));
      if(recovered){showOwn(recovered);try{if(draftStorage)localStorage.removeItem(draftStorage);}catch{/* Safe to retry with same key. */}}
    }).catch(()=>{if(active&&!draft)setMessage('내 문제를 불러오지 못했어요. 선생님이 연결 업데이트를 확인해 주세요.');});
    return()=>{active=false;};
  },[draftStorage]);
  useEffect(()=>{
    if(!draftLoaded||given||shared)return;
    try{if(draftStorage)localStorage.setItem(draftStorage,JSON.stringify({requestId:requestId.current,blocks,type,hintType,pending}));if(!pending)setMessage(draftStorage?SAVE_TEXT.local:SAVE_TEXT.dirty);}catch{setMessage(SAVE_TEXT.dirty);}
  },[blocks,type,hintType,pending,given,shared,draftStorage,draftLoaded]);
  const saveChallenge=()=>run(async()=>{
    if(shared)return;
    if(!ownReady){setMessage('내 문제 저장 확인을 준비하지 못했어요. 다시 접속하거나 선생님께 연결 업데이트를 부탁해 주세요.');return;}
    const draft:ChallengeDraft={requestId:requestId.current,blocks,type,hintType,pending:true};
    setPending(true);setMessage(SAVE_TEXT.saving);
    try{if(draftStorage)localStorage.setItem(draftStorage,JSON.stringify(draft));}catch{/* Request key remains stable in memory. */}
    let response:{code:string}|null=null,writeError:unknown;
    try{response=await activityApi('challenge:create',draft);}catch(error){writeError=error;}
    try{
      const check=await activityApi<{challenges:OwnChallenge[]}>('challenge:mine');
      const stored=check.challenges.find(item=>sameChallenge(draft,item));
      if(!stored||!stored.created_at||(response&&response.code!==stored.code))throw writeError??Error('SAVE_NOT_CONFIRMED');
      setOwn(check.challenges);showOwn(stored);try{if(draftStorage)localStorage.removeItem(draftStorage);}catch{/* Confirmed server copy remains available. */}
    }catch(error){setMessage(`${SAVE_TEXT.failed} ${saveErrorText(writeError??error)}`);}
  });
  const previewGiven = challengeGiven(blocks, type);

  return <main className="screen app-max stack">
    <h1>9차시 · 친구 문제 놀이터</h1>
    <Link to="/world">월드로</Link>
    <p>내가 만든 모양을 친구가 풀 수 있는 문제로 바꾸어 보세요.</p>
    <div className="toolbar-row">
      <label>친구 문제 코드<input className="field" value={code} maxLength={12} onChange={e => setCode(e.target.value.toUpperCase())} /></label>
      <button className="btn" disabled={busy || !code} onClick={() => void load()}>친구 문제 열기</button>
      <button className="btn" disabled={busy} onClick={startNew}>내 문제 만들기</button>
    </div>

    {own.length>0&&<section className="panel stack" aria-label="내가 만든 문제"><h2>내가 만든 문제</h2><div className="toolbar-row">{own.map(item=><button className="btn" key={item.code} disabled={busy} onClick={()=>showOwn(item)}>내 문제 {item.code}</button>)}</div></section>}
    <section className="panel stack" aria-label="우리 반 문제 목록">
      <h2>풀어 볼 문제</h2>
      {challenges.length===0&&<p>친구 코드로 문제를 열거나 내 문제를 만들어 보세요.</p>}
      <div className="toolbar-row">{challenges.map((c,i)=><button className="btn" key={c.code} disabled={busy} onClick={()=>void load(c.code)}>{c.source==='system'?'기본 연습':'친구 문제'} {i+1}{c.completed?' · 완료':''}</button>)}</div>
    </section>
    {given ? <div className="world-layout">
      <ActivityBuilder key={activeCode} blocks={blocks} onChange={setBlocks} answer={answer} disabled={busy || Boolean(state.completed)} />
      <section className="panel stack">
        <h2>{challenges.find(c=>c.code===activeCode)?.source==='system'?'기본 연습 문제':'친구의 문제'}</h2><p>공개된 조건에 맞게 쌓기나무 10개를 쌓아 보세요.</p><Representations given={given} />
        <p>오답 {state.wrongCount}회 · 놀이 점수 {state.score ?? 0} / 2점</p>
        {state.hintShown && <><p>힌트: 친구가 만든 힌트 카드를 확인해 보세요.</p>{hintGiven && <Representations given={hintGiven} />}</>}
        <button className="btn btn-sm" disabled={busy || state.completed || state.hintShown} onClick={() => void run(async () => { const result = await activityApi<{ state: AttemptState & { score?: number }; hint: string; hintGiven?: ProblemGiven }>("challenge:hint", { code:activeCode }); setState(result.state); setHintGiven(result.hintGiven ?? null); setMessage(result.hint); })}>힌트 보기 (보상 1점)</button>
        <button className="btn btn-primary" disabled={busy || state.completed} onClick={() => void run(async () => { const result = await activityApi<{ outcome: AttemptOutcome; state: AttemptState & { score?: number }; revealedAnswer?: BlockCoord[]; hintGiven?: ProblemGiven }>("challenge:attempt", { code:activeCode, blocks }); setState(result.state); setHintGiven(result.hintGiven ?? null); setAnswer(result.revealedAnswer ?? undefined); setMessage(result.outcome.message + (result.state.score ? ` ${result.state.score}점` : "")); })}>정답 확인</button>
        {state.answerRevealed && !state.completed && <button className="btn" onClick={() => setBlocks([])}>정답 모양대로 다시 쌓기</button>}
        <p role="status">{message}</p>
      </section>
    </div> : <>
      <section className="panel stack" aria-label="문제 만들기 단계">
        {!ownReady&&<p className="notice">내 문제 목록과 저장 확인을 준비하고 있어요. 계속 기다려도 나타나지 않으면 다시 접속하거나 선생님께 연결 업데이트를 부탁해 주세요.</p>}
        <div className="toolbar-row"><strong>STEP {step} / 4</strong><span className="muted">{["10개로 모양 만들기", "문제 카드 고르기", "힌트 카드 고르기", "저장 전 확인"][step - 1]}</span></div>
        {step === 1 && <>
          <h2>1. 쌓기나무 10개로 나만의 모양 만들기</h2>
          <p>블록을 정확히 10개 사용해야 다음 단계로 갈 수 있어요. 친구는 이 모양을 직접 보지 않고, 다음 단계에서 고른 정보만 보게 됩니다.</p>
          <ActivityBuilder blocks={blocks} onChange={setBlocks} />
          <button className="btn btn-primary" disabled={blocks.length !== 10} onClick={() => setStep(2)}>10개 완성 → 문제 카드 고르기</button>
          {blocks.length !== 10 && <p className="muted">현재 {blocks.length}개 · 정확히 10개를 쌓아 주세요.</p>}
        </>}
        {step === 2 && <>
          <h2>2. 친구에게 보여줄 문제 카드 고르기</h2>
          <div className="toolbar-row" style={{ alignItems: "stretch" }}>{CHALLENGE_CARDS.map(card => <button key={card.type} type="button" className={`panel stack ${type === card.type ? "selected-card" : ""}`} onClick={() => {setType(card.type);if(hintType===card.type)setHintType(CHALLENGE_CARDS.find(hint=>hint.type!==card.type)!.type);}}><strong>{card.title}</strong><span>{card.description}</span></button>)}</div>
          <div className="panel"><h3>문제 카드 미리보기</h3><Representations given={previewGiven} /></div>
          <div className="toolbar-row"><button className="btn" onClick={() => setStep(1)}>← 다시 쌓기</button><button className="btn btn-primary" onClick={() => setStep(3)}>이 카드로 정하기 →</button></div>
        </>}
        {step === 3 && <>
          <h2>3. 틀렸을 때 보여줄 힌트 카드 고르기</h2>
          <p>문제 카드와 다른 정보를 힌트로 골라 친구가 스스로 생각할 수 있게 해요.</p>
          <div className="toolbar-row" style={{ alignItems: "stretch" }}>{CHALLENGE_CARDS.filter(card => card.type !== type).map(card => <button key={card.type} type="button" className={`panel stack ${hintType === card.type ? "selected-card" : ""}`} onClick={() => setHintType(card.type)}><strong>힌트: {card.title}</strong><span>{card.description}</span><Representations given={challengeGiven(blocks, card.type)} /></button>)}</div>
          <div className="toolbar-row"><button className="btn" onClick={() => setStep(2)}>← 문제 카드 바꾸기</button><button className="btn btn-primary" onClick={() => setStep(4)}>힌트 카드 확인 →</button></div>
        </>}
        {step === 4 && <>
          <h2>4. 저장 전 최종 확인</h2>
          <div className="world-layout"><div className="panel"><h3>내가 만든 3D 모양</h3><ActivityBuilder blocks={blocks} onChange={() => undefined} disabled /></div><div className="panel stack"><h3>친구가 보는 문제 카드</h3><Representations given={previewGiven} /><h3>힌트 카드</h3><Representations given={challengeGiven(blocks, hintType)} /></div></div>
          <div className="toolbar-row"><button className="btn" disabled={busy||pending||Boolean(shared)} onClick={() => setStep(3)}>← 다시 고르기</button><button className="btn btn-primary" disabled={busy||Boolean(shared)||!ownReady} onClick={() => void saveChallenge()}>{pending?"저장 다시 확인":"이 문제 저장"}</button></div>
          {shared&&<section className="panel success" aria-label="내 문제 저장 완료"><h2>내 문제가 저장됐어요!</h2><p>공유 코드: <strong>{shared}</strong></p><p>저장 완료 · {new Date(savedAt).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'})}</p><div className="toolbar-row"><button className="btn" onClick={()=>void navigator.clipboard.writeText(shared).then(()=>setMessage('코드를 복사했어요.')).catch(()=>setMessage('코드를 길게 눌러 복사해 주세요.'))}>코드 복사</button><button className="btn" onClick={()=>{if(navigator.share)void navigator.share({title:'친구 문제',text:`공간과 입체 친구 문제 코드: ${shared}`}).catch(()=>setMessage('공유 창을 닫았어요. 코드 복사도 사용할 수 있어요.'));else void navigator.clipboard.writeText(shared).then(()=>setMessage('공유 코드를 복사했어요.')).catch(()=>setMessage('코드를 길게 눌러 복사해 주세요.'));}}>친구에게 공유</button><button className="btn" onClick={()=>setMessage('위의 저장된 3D 모양과 문제·힌트 카드가 내가 만든 문제예요.')}>내가 만든 문제 보기</button><button className="btn" onClick={startNew}>새 문제 만들기</button></div></section>}
        </>}
        <p role="status">{message}</p>
      </section>
    </>}
  </main>;
}
