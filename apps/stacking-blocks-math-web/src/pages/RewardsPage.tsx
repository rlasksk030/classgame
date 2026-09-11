import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getStudentHome, getStudentToken, type StudentHomeData } from "../lib/studentApi";

const REWARDS = [
  [1, "기본 블록", "처음부터 사용할 수 있어요."],
  [2, "나무 블록", "100 XP가 되면 열려요."],
  [3, "벽돌 블록", "200 XP가 되면 열려요."],
  [4, "유리 블록", "300 XP가 되면 열려요."],
] as const;

export default function RewardsPage() {
  const navigate = useNavigate();
  const [home, setHome] = useState<StudentHomeData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!getStudentToken()) { navigate("/", { replace: true }); return; }
    void getStudentHome().then(setHome).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "보상을 불러오지 못했어요."));
  }, [navigate]);
  const xp = home?.rewards.totalXp ?? 0;
  const level = Math.max(1, Math.floor(xp / 100) + 1);
  return <main className="screen app-max stack">
    <div className="toolbar-row" style={{ justifyContent: "space-between" }}><div><p className="eyebrow">MY REWARDS</p><h1>내 보상</h1></div><Link className="btn btn-sm" to="/world">월드로</Link></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <section className="panel stack"><h2>LV. {level} 공간 탐험가</h2><p className="summary-number">{xp} XP</p><p className="muted">XP는 학습을 이어 가게 해 주는 게임 성장 보상이에요. 차시 잠금과 성적에는 영향을 주지 않아요.</p><div className="lesson-progress"><span style={{ width: `${xp % 100}%` }} /></div></section>
    <section className="panel stack"><h2>블록 컬렉션</h2><div className="cards-grid">{REWARDS.map(([required, name, description]) => <article className="reward-summary" key={name}><strong>{name}</strong><p className="muted">{required === 1 ? description : `${description} 현재 ${xp} XP`}</p><span className={`status-chip ${xp >= (required - 1) * 100 ? "complete" : "locked"}`}>{xp >= (required - 1) * 100 ? "획득" : "잠김"}</span></article>)}</div></section>
    <section className="panel stack"><h2>배지</h2><p>{home?.rewards.badges.length ? home.rewards.badges.map(String).join(" · ") : "아직 획득한 배지가 없어요. 첫 차시를 완료해 보세요."}</p></section>
  </main>;
}
