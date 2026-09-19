import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { activityApi } from "../lib/studentApi";
import { challengeGiven, type ChallengeType } from "../../shared/activities.ts";
import { INITIAL_ATTEMPT, type AttemptState, type AttemptOutcome } from "../../shared/attempts.ts";
import type { BlockCoord, ProblemGiven } from "../../shared/types.ts";
import ActivityBuilder from "../features/activities/ActivityBuilder";
import Representations from "../features/activities/Representations";

const CHALLENGE_CARDS: Array<{ type: ChallengeType; title: string; description: string }> = [
  { type: "views", title: "위·앞·옆에서 본 모양", description: "세 방향에서 본 모습을 보여 주고 친구가 원래 모양을 쌓게 해요." },
  { type: "top", title: "위에서 본 모양", description: "위에서 내려다본 바닥 모양만 보여 주고 친구가 숨은 높이를 추리하게 해요." },
  { type: "heightMap", title: "위에서 본 모양에 수 쓰기", description: "자리마다 쌓인 높이를 숫자로 보여 주고 친구가 모양을 만들게 해요." },
  { type: "layers", title: "층별로 나타낸 모양", description: "1층, 2층, 3층의 모양을 보여 주고 친구가 다시 쌓게 해요." },
];

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
  const [given, setGiven] = useState<ProblemGiven | null>(null);
  const [hintGiven, setHintGiven] = useState<ProblemGiven | null>(null);
  const [state, setState] = useState<AttemptState & { score?: number }>(INITIAL_ATTEMPT);
  const [answer, setAnswer] = useState<BlockCoord[] | undefined>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : "연결하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const load = (selectedCode=code) => run(async () => {
    const sequence=++loadSequence.current;
    const result = await activityApi<{ given: ProblemGiven; hintGiven?: ProblemGiven; state: AttemptState & { score?: number }; revealedAnswer?: BlockCoord[] }>("challenge:get", { code:selectedCode });
    if(sequence!==loadSequence.current)return;
    setCode(selectedCode);setActiveCode(selectedCode);
    setGiven(result.given); setHintGiven(result.hintGiven ?? null); setState(result.state); setAnswer(result.revealedAnswer ?? undefined); setBlocks([]); setMessage("친구가 만든 조건을 보고 쌓아 보세요.");
  });
  const startNew = () => { loadSequence.current++;setActiveCode(''); setGiven(null); setHintGiven(null); setBlocks([]); setAnswer(undefined); setState(INITIAL_ATTEMPT); setShared(""); setHintType("heightMap"); setStep(1); setMessage(""); };
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
          <div className="toolbar-row" style={{ alignItems: "stretch" }}>{CHALLENGE_CARDS.map(card => <button key={card.type} type="button" className={`panel stack ${type === card.type ? "selected-card" : ""}`} onClick={() => setType(card.type)}><strong>{card.title}</strong><span>{card.description}</span></button>)}</div>
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
          <div className="toolbar-row"><button className="btn" onClick={() => setStep(3)}>← 다시 고르기</button><button className="btn btn-primary" disabled={busy} onClick={() => void run(async () => { const result = await activityApi<{ code: string }>("challenge:create", { blocks, type, hintType }); setShared(result.code); setMessage("문제를 저장했어요. 같은 반 친구에게 코드를 알려 주세요."); })}>이 문제 저장</button></div>
          {shared && <p className="success">공유 코드: <strong>{shared}</strong></p>}
        </>}
        <p role="status">{message}</p>
      </section>
    </>}
  </main>;
}
