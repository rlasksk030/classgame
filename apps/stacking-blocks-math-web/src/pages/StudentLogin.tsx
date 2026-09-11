import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { classCodeFromUrl, isConfigured } from "@/lib/config";
import {
  fetchClassInfo,
  loginStudent,
  setStudentToken,
  StudentApiError,
  type LoginNeedsStudentNo,
  type LoginSuccess,
} from "@/lib/studentApi";

/**
 * 학생 로그인 (명세 5).
 * 반은 접속 링크(?class=XXXX)로 정해지고, 학생은 이름과 4자리 PIN 만 입력한다.
 * Supabase 주소나 키 같은 기술 정보는 절대 학생에게 묻지 않는다.
 */
export default function StudentLogin() {
  const navigate = useNavigate();
  const [classCode] = useState(classCodeFromUrl);
  const [className, setClassName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [studentNo, setStudentNo] = useState<number | null>(null);
  const [numberOptions, setNumberOptions] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!classCode || !isConfigured()) return;
    fetchClassInfo(classCode)
      .then((info) => setClassName(info.className))
      .catch(() => setError("반을 찾지 못했어요. 선생님이 주신 링크가 맞는지 확인해 주세요."));
  }, [classCode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await loginStudent({ classCode, name: name.trim(), pin, studentNo });

      if ("needStudentNo" in result) {
        const needs = result as LoginNeedsStudentNo;
        setNumberOptions(needs.options);
        setError("같은 이름이 있어요. 번호를 골라 주세요.");
        return;
      }

      const success = result as LoginSuccess;
      setStudentToken(success.token);
      navigate("/world", { replace: true });
    } catch (err) {
      setError(
        err instanceof StudentApiError ? err.message : "로그인하지 못했어요. 다시 해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isConfigured()) {
    return (
      <div className="center-screen">
        <div className="panel stack" style={{ maxWidth: 520 }}>
          <h1>설정이 필요해요</h1>
          <p className="muted">
            <code>.env.local</code> 에 <code>VITE_SUPABASE_URL</code> 과{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> 를 넣은 뒤 다시 실행해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (!classCode) {
    return (
      <div className="center-screen">
        <div className="panel stack" style={{ maxWidth: 520 }}>
          <h1>🧱 공간과 입체 월드</h1>
          <p>선생님이 주신 수업 링크로 들어와 주세요.</p>
          <p className="muted" style={{ fontSize: 14 }}>
            링크 끝에 <code>?class=</code> 와 반 코드가 붙어 있어야 해요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <form className="panel stack" style={{ width: "min(440px, 100%)" }} onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 28 }}>🧱 공간과 입체 월드</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {className ?? "반 정보를 불러오는 중…"}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="student-name">
            이름
          </label>
          <input
            id="student-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            required
          />
        </div>

        {numberOptions.length > 0 && (
          <div>
            <span className="label">번호</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {numberOptions.map((no) => (
                <button
                  key={no}
                  type="button"
                  className={`btn btn-sm ${studentNo === no ? "btn-sky" : ""}`}
                  onClick={() => setStudentNo(no)}
                >
                  {no}번
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="student-pin">
            PIN 4자리
          </label>
          <input
            id="student-pin"
            className="field"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            style={{ letterSpacing: "0.5em", fontSize: 22, textAlign: "center" }}
            required
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy || pin.length !== 4}>
          {busy ? "들어가는 중…" : "들어가기"}
        </button>
      </form>
    </div>
  );
}
