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

  if (loading) {
    return <div className="screen app-max"><p className="muted">학생 화면을 불러오는 중…</p></div>;
  }

  return (
    <div className="screen app-max">
      <div className="stack" style={{ paddingBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1>🧱 공간과 입체 월드</h1>
            <p className="muted">차시를 선택해 시작하세요.</p>
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

        <div className="cards-grid">
        {Array.from({ length: LESSON_COUNT }, (_, index) => {
            const lesson = index + 1;
            const info = home?.lessons.find((row) => row.lesson === lesson);
            const meta = LESSONS.find((l) => l.lesson === lesson);
            const locked = info?.locked ?? true;
            const total = info?.totalProblems ?? 0;
            const done = info?.completedProblems ?? 0;
            const completed = info?.completed ?? false;
            return (
              <Link key={lesson} className="lesson-card" to={locked ? "#" : `/lesson/${lesson}`} onClick={event => { if (locked) { event.preventDefault(); setError("선생님이 아직 열지 않은 차시예요."); } }}>
                <div className="lesson-emoji" aria-hidden>
                  {meta?.emoji ?? "🧱"}
                </div>
                <div className="lesson-body">
                  <h3 style={{ margin: 0 }}>
                    {lesson}차시 · {meta?.title ?? `차시 ${lesson}`}
                    {locked ? " 🔒" : ""}
                  </h3>
                  <p className="muted">{meta?.summary ?? "준비 중입니다."}</p>
                  <p>
                    진행률 {done}/{total} | ⭐ {info?.stars ?? 0}
                  </p>
                  <p>{completed ? "완료" : "진행 중"}</p>
                  <p className="muted">{locked ? "교사가 잠금을 해제하면 이용 가능합니다." : "입장 가능"}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
