import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { StudentApiError, teacherListClasses, teacherListStudents, type ClassData, type TeacherStudentRow } from "../lib/studentApi";
import "./PrintStudentLoginSheet.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; classInfo: ClassData; students: TeacherStudentRow[] };

/**
 * Print-only view of one class's student login cards (name + PIN + student
 * URL), reachable at /teacher/print-logins?classId=... . Deliberately a
 * separate route/component from TeacherPage -- not a CSS-hidden overlay on
 * top of it -- so the teacher dashboard nav/cards/tables never enter the DOM
 * here and can never leak onto a printed page.
 */
export default function PrintStudentLoginSheet() {
  const [params] = useSearchParams();
  const classId = params.get("classId") ?? "";
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [qrDataUrl, setQrDataUrl] = useState("");

  // Root path only, no ?class= deep link -- matches the printed card format
  // exactly, and always resolves to whichever origin actually served this
  // page (production or TEST), never a hardcoded host.
  const studentUrl = useMemo(() => `${window.location.origin}/`, []);

  // The teacher nav is rendered by TeacherGate, a sibling of this component
  // (never a parent it can reach through props/CSS scoping), so hiding it
  // for print needs a body-level flag that exists only while this page is
  // mounted -- see the body.print-login-sheet-active rules in the CSS file.
  useEffect(() => {
    document.body.classList.add("print-login-sheet-active");
    return () => { document.body.classList.remove("print-login-sheet-active"); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!classId) { setState({ kind: "error", message: "인쇄할 학급이 지정되지 않았습니다." }); return; }
    setState({ kind: "loading" });
    (async () => {
      try {
        // teacherListClasses() only ever returns classes this signed-in
        // teacher owns; teacherListStudents(classId) is separately
        // ownership-checked server-side (teacherOwnsClass in student-api).
        // Together they mean a classId for another teacher's class can
        // never reach this page's PIN table, regardless of what the URL
        // query string says.
        const [{ classes }, { students }] = await Promise.all([
          teacherListClasses(),
          teacherListStudents(classId),
        ]);
        if (!active) return;
        const classInfo = classes.find((row) => row.id === classId);
        if (!classInfo) { setState({ kind: "error", message: "해당 학급에 접근할 수 없습니다." }); return; }
        setState({ kind: "ready", classInfo, students: students.filter((row) => row.status === "active") });
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof StudentApiError ? reason.message : "학생 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
        setState({ kind: "error", message });
      }
    })();
    return () => { active = false; };
  }, [classId]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(studentUrl, { width: 200, margin: 1 })
      .then((url) => { if (active) setQrDataUrl(url); })
      .catch(() => { /* QR is a convenience, not required -- the printed URL text still works */ });
    return () => { active = false; };
  }, [studentUrl]);

  return (
    <div className="print-sheet-page">
      <div className="print-sheet-toolbar no-print">
        <button type="button" className="btn btn-primary" disabled={state.kind !== "ready"} onClick={() => window.print()}>인쇄</button>
        <Link className="btn" to="/teacher">교사 화면으로 돌아가기</Link>
      </div>

      {state.kind === "loading" && <p className="no-print" role="status">불러오는 중…</p>}
      {state.kind === "error" && <p className="no-print error" role="alert">{state.message}</p>}

      {state.kind === "ready" && (
        <div className="print-sheet-sheet">
          <header className="print-sheet-header">
            <h1>학생 로그인표</h1>
            <p>{state.classInfo.name} · 학급 코드 {state.classInfo.class_code}</p>
            {qrDataUrl ? <img className="print-sheet-header-qr" src={qrDataUrl} alt="" /> : null}
          </header>
          {state.students.length === 0 ? (
            <p className="muted">이 학급에는 인쇄할 활성 학생이 없습니다.</p>
          ) : (
            <div className="print-sheet-grid">
              {state.students.map((student) => (
                <div className="print-sheet-card" key={student.id}>
                  <p className="print-sheet-name">학생 이름: {student.name}</p>
                  <p className="print-sheet-pin">PIN: {student.pinPlain}</p>
                  <p className="print-sheet-url-label">학생 접속:</p>
                  <p className="print-sheet-url">{studentUrl}</p>
                  <p className="print-sheet-code">학급 코드: {state.classInfo.class_code}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
