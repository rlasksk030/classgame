import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { LESSONS } from "@shared/lessons.ts";
import { clearStudentToken, getStudentToken, getStudentHome, type StudentHomeData } from "../lib/studentApi";
import { LESSON_COUNT } from "@shared/lessons.ts";

export default function StudentWorld() {
  const navigate = useNavigate();
  const [home, setHome] = useState<StudentHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      setError(null);
      if (!quiet) setLoading(true);
      const payload = await getStudentHome();
      setHome(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getStudentToken()) {
      navigate("/", { replace: true });
      return;
    }

    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15000);
    return () => window.clearInterval(timer);
  }, [load, navigate]);

  const logout = () => {
    clearStudentToken();
    navigate("/", { replace: true });
  };

  const completedLessons = home?.lessons.filter((lesson) => lesson.completed).length ?? 0;
  const totalProgress = home?.lessons.reduce((sum, lesson) => sum + (lesson.totalProblems ? lesson.completedProblems / lesson.totalProblems : 0), 0) ?? 0;
  const progressPercent = Math.round(totalProgress / LESSON_COUNT * 100);
  const groups = [
    { label: "기초 탐험", lessons: [1, 2, 3, 4] },
    { label: "공간 추리", lessons: [5, 6, 7, 8] },
    { label: "친구와 놀이", lessons: [9] },
    { label: "건축 프로젝트", lessons: [10, 11] },
    { label: "단원 마무리", lessons: [12] },
  ];

  if (loading) {
    return <div className="screen app-max"><p className="muted">학생 화면을 불러오는 중…</p></div>;
  }

  return (
    <div className="screen app-max">
      <div className="stack" style={{ paddingBottom: 16 }}>
        <div className="student-world-heading">
          <div>
            <p className="eyebrow">BLOCK MATH WORLD</p>
            <h1>공간과 입체 월드</h1>
            <p className="muted">오늘은 어느 공간을 탐험해 볼까요?</p>
          </div>
          <div className="toolbar-row">
            <button className="btn btn-sm" onClick={() => void load()}>
              새로고침
            </button>
            <button className="btn btn-sm" onClick={logout}>
              나가기
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <section className="student-summary-grid">
          <div className="panel reward-summary">
            <div className="summary-label">나의 성장</div>
            <strong className="level-title">LV. {Math.max(1, Math.floor((home?.rewards.totalXp ?? 0) / 100) + 1)} 공간 탐험가</strong>
            <p className="summary-number">{home?.rewards.totalXp ?? 0} XP <span className="muted">· 다음 레벨까지 {100 - ((home?.rewards.totalXp ?? 0) % 100)} XP</span></p>
            <p className="muted">XP는 문제를 풀고 다시 도전할 때 받는 게임 성장 보상이에요.</p>
          </div>
          <div className="panel reward-summary">
            <div className="summary-label">학습 성취</div>
            <strong className="summary-number">⭐ {home?.rewards.totalStars ?? 0}</strong>
            <p className="muted">별은 개념 익히기·개념 확인·추가 문제를 완성하면 모아요.</p>
            <div className="lesson-progress" aria-label={`전체 진행률 ${progressPercent}%`}><span style={{ width: `${progressPercent}%` }} /></div>
            <p className="muted">전체 진행률 {progressPercent}% · 완료 {completedLessons}/{LESSON_COUNT}차시</p>
          </div>
          <div className="panel reward-summary">
            <div className="summary-label">내 배지</div>
            <p className="badge-list">{home?.rewards.badges.length ? home.rewards.badges.map(String).join(" · ") : "첫 탐험을 시작해 보세요."}</p>
            <Link className="btn btn-sm" to="/world/rewards">내 보상 보기</Link>
          </div>
        </section>
        {groups.map((group) => <section className="lesson-group" key={group.label}>
          <div className="lesson-group-heading"><h2>{group.label}</h2><span className="muted">{group.lessons.length}개 차시</span></div>
          <div className="cards-grid">
          {group.lessons.map((lesson) => {
            const info = home?.lessons.find((row) => row.lesson === lesson);
            const meta = LESSONS.find((l) => l.lesson === lesson);
            const locked = info?.locked ?? true;
            const total = info?.totalProblems ?? 0;
            const done = info?.completedProblems ?? 0;
            const completed = info?.completed ?? false;
            return (
              <Link key={lesson} className="lesson-card" to={locked ? "#" : `/lesson/${lesson}${lesson===10||lesson===11?"/project":""}`} onClick={event => { if (locked) { event.preventDefault(); setError("선생님이 아직 열지 않은 차시예요."); } }}>
                <div className="lesson-number" aria-hidden>{String(lesson).padStart(2, "0")}</div>
                <div className="lesson-body">
                  <h3 style={{ margin: 0 }}>
                    {lesson}차시 · {meta?.title ?? `차시 ${lesson}`}
                    {locked ? " 🔒" : ""}
                  </h3>
                  <p className="muted">{meta?.summary ?? "준비 중입니다."}</p>
                  <div className="lesson-card-meta"><span>{done}/{total}문제</span><span>⭐ {info?.stars ?? 0}</span><span className={`status-chip ${locked ? "locked" : completed ? "complete" : "ready"}`}>{locked ? "잠김" : completed ? "완료" : "이어하기"}</span></div>
                  <div className="lesson-progress" aria-label={`${lesson}차시 진행률 ${total ? Math.round(done / total * 100) : 0}%`}><span style={{ width: `${total ? Math.round(done / total * 100) : 0}%` }} /></div>
                </div>
              </Link>
            );
          })}
          </div>
        </section>)}
      </div>
    </div>
  );
}
