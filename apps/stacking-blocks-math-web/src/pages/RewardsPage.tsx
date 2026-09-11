import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { equipReward, getRewardWorkshop, getStudentToken, type RewardWorkshopData } from "../lib/studentApi";
import { levelForXp, type RewardMaterial, type RewardTheme } from "@shared/rewards.ts";

export default function RewardsPage() {
  const navigate = useNavigate();
  const [workshop, setWorkshop] = useState<RewardWorkshopData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!getStudentToken()) { navigate("/", { replace: true }); return; }
    void getRewardWorkshop().then(setWorkshop).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "보상을 불러오지 못했어요."));
  }, [navigate]);
  const xp = workshop?.xp ?? 0;
  const equip = async (item: RewardWorkshopData["catalog"][number]) => {
    if (!item.unlocked) return;
    const material = item.material as RewardMaterial | undefined;
    const theme = item.theme as RewardTheme | undefined;
    try {
      const next = await equipReward(material ?? workshop?.equippedMaterial ?? "wood", theme ?? workshop?.introTheme ?? "blueprint");
      setWorkshop(next); setMessage(`${item.label} 보상을 작품에 사용하도록 저장했어요.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "보상을 사용할 수 없어요."); }
  };
  return <main className="screen app-max stack">
    <div className="toolbar-row" style={{ justifyContent: "space-between" }}><div><p className="eyebrow">REWARD WORKSHOP</p><h1>보상 공방</h1></div><Link className="btn btn-sm" to="/world">월드로</Link></div>
    {error ? <p className="error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <section className="panel stack"><h2>LV. {levelForXp(xp)} 공간 탐험가</h2><p className="summary-number">{xp} XP</p><p className="muted">XP로 작품에 쓸 재료와 소개서 테마를 열어요. 별과 XP는 학습 점수에서 차감되지 않아요.</p><div className="lesson-progress"><span style={{ width: `${xp % 100}%` }} /></div><p className="muted">다음 레벨까지 {100 - (xp % 100)} XP</p></section>
    <section className="panel stack"><h2>작품 재료와 테마</h2><p className="muted">카드를 눌러 실제 건축물에 사용할 보상을 장착할 수 있어요.</p><div className="cards-grid">{workshop?.catalog.map(item => <article className={`reward-summary reward-card ${item.unlocked ? "unlocked" : "locked"}`} key={item.id}><div className={`reward-preview ${item.material ? `material-${item.material}` : `theme-${item.theme}`}`} aria-hidden="true">{item.material ? "▣" : "✦"}</div><strong>{item.label}</strong><p className="muted">{item.description}</p><small>{item.useIn} · {item.unlockXp === 0 ? "처음부터 사용 가능" : `${item.unlockXp} XP에서 해금`}</small><button type="button" className="btn btn-sm" disabled={!item.unlocked} onClick={() => void equip(item)}>{item.unlocked ? "사용하기" : "잠김"}</button></article>)}</div></section>
    <section className="panel"><h2>사용 방법</h2><p>10차시 건축물 설계에서 블록 재료를 고르고, 11차시 소개서에서 테마를 선택해 저장하세요. 새로고침하거나 다시 로그인해도 장착 상태가 유지돼요.</p></section>
  </main>;
}
