import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  getAppConfig,
  getRuntimeSupabaseConfig,
  hasInvalidInstallationConfigHash,
  encodeInstallationConfig,
  saveRuntimeSupabaseConfig,
  validateRuntimeSupabaseConfig,
  type RuntimeSupabaseConfig,
} from "../lib/config";
import { clearInstallerProgress, readInstallerProgress, saveInstallerProgress, type InstallerStep } from "../lib/installer";
import { getConfiguredInstallerClient, type InstallerRemoteStatus } from "../lib/installerClient";
import { getSupabase } from "../lib/supabase";
import {
  clearStudentToken,
  loginStudent,
  setStudentToken,
  teacherCreateStudent,
  teacherListClasses,
  teacherListStudents,
  teacherUpsertClass,
  type ClassData,
  type TeacherStudentRow,
} from "../lib/studentApi";

const STEP_TITLES = ["시작", "Supabase 준비", "연결", "자동 설치", "교사 확인", "학급 만들기", "학생 만들기", "설치 완료"] as const;

async function checkSupabaseConnection(supabaseUrl: string, publishableKey: string): Promise<void> {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: publishableKey } });
  if (!response.ok) throw new Error("주소와 Publishable key를 다시 확인해 주세요.");
}

function defaultInstallationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `install-${Date.now()}`;
}

function namesFromText(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function friendlyAuthError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "invalid_credentials") return "이메일 또는 비밀번호를 확인해 주세요.";
  if (code === "email_not_confirmed") return "교사 이메일 확인이 아직 필요합니다.";
  return "교사 로그인을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

function projectRefFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function installerStatusLabel(status: InstallerRemoteStatus): string {
  switch (status) {
    case "INSTALLED": return "설치가 완료된 프로젝트입니다.";
    case "UPDATE_REQUIRED": return "업데이트가 필요한 프로젝트입니다.";
    case "PARTIAL": return "일부 단계만 설치된 프로젝트입니다. 이어서 진행할 수 있어요.";
    case "BROKEN": return "설치 상태를 복구해야 합니다.";
    case "NEW": return "아직 앱 데이터 구조가 준비되지 않았습니다.";
    default: return "설치 상태를 확인할 수 없습니다.";
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
  const current = getRuntimeSupabaseConfig();
  const vite = getAppConfig();
  const [installationId] = useState(current?.installationId ?? defaultInstallationId());
  const [supabaseUrl, setSupabaseUrl] = useState(current?.supabaseUrl ?? (vite.configSource === "vite-fallback" ? vite.supabaseUrl ?? "" : ""));
  const [publishableKey, setPublishableKey] = useState(current?.supabasePublishableKey ?? "");
  const [step, setStep] = useState<InstallerStep>(() => readInstallerProgress(current?.installationId ?? "")?.step ?? 1);
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [teacherSignedIn, setTeacherSignedIn] = useState(false);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [classId, setClassId] = useState("");
  const [className, setClassName] = useState("");
  const [students, setStudents] = useState<TeacherStudentRow[]>([]);
  const [bulkNames, setBulkNames] = useState("");
  const [newStudents, setNewStudents] = useState<Array<{ name: string; studentNo: number | null; pin: string }>>([]);
  const [studentSmokeVerified, setStudentSmokeVerified] = useState(false);
  const [installerStatus, setInstallerStatus] = useState<InstallerRemoteStatus | null>(null);
  const [installerStatusError, setInstallerStatusError] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const installerClient = useMemo(() => getConfiguredInstallerClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => hasInvalidInstallationConfigHash() ? "설치 링크가 손상되었거나 공개 연결 설정이 올바르지 않습니다." : null);

  const selectedClass = useMemo(() => classes.find((item) => item.id === classId) ?? null, [classes, classId]);
  const namesPreview = useMemo(() => namesFromText(bulkNames), [bulkNames]);
  const runtimeConfig = getRuntimeSupabaseConfig();
  const classLink = selectedClass && connectionVerified && runtimeConfig
    ? `${window.location.origin}/?class=${encodeURIComponent(selectedClass.class_code)}#install=${encodeInstallationConfig(runtimeConfig)}`
    : "";

  const persistStep = (next: InstallerStep, extra: Partial<{ classId: string; className: string; studentCount: number }> = {}) => {
    setStep(next);
    if (installationId.trim()) saveInstallerProgress({ installationId: installationId.trim(), step: next, ...extra, updatedAt: new Date().toISOString() });
  };

  useEffect(() => {
    if (step < 5 || !connectionVerified) return;
    let active = true;
    void getSupabase().auth.getSession().then(({ data }) => { if (active) setTeacherSignedIn(Boolean(data.session)); }).catch(() => undefined);
    return () => { active = false; };
  }, [step, connectionVerified]);

  useEffect(() => {
    if (step < 6 || !teacherSignedIn) return;
    void teacherListClasses().then((payload) => {
      setClasses(payload.classes);
      if (!classId && payload.classes[0]) setClassId(payload.classes[0].id);
    }).catch(() => setError("학급 목록을 불러오지 못했습니다. 교사 권한과 설치 상태를 확인해 주세요."));
  }, [step, teacherSignedIn, classId]);

  useEffect(() => {
    if (!classId || !teacherSignedIn) return;
    void teacherListStudents(classId).then((payload) => setStudents(payload.students)).catch(() => undefined);
  }, [classId, teacherSignedIn]);

  useEffect(() => {
    if (step !== 4 || !connectionVerified || !installerClient) return;
    const projectRef = projectRefFromUrl(supabaseUrl);
    if (!projectRef) return;
    let active = true;
    setInstallerStatusError(false);
    void installerClient.getStatus({ projectRef, projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" }).then((result) => {
      if (active) setInstallerStatus(result.status);
    }).catch(() => { if (active) setInstallerStatusError(true); });
    return () => { active = false; };
  }, [connectionVerified, installerClient, runtimeConfig?.supabasePublishableKey, step, supabaseUrl, vite.environment]);

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setMessage(null);
    const config: RuntimeSupabaseConfig = { installationId: installationId.trim(), supabaseUrl: supabaseUrl.trim(), supabasePublishableKey: publishableKey.trim() };
    if (!validateRuntimeSupabaseConfig(config)) { setError("HTTPS 형식의 Supabase URL, 공개 Publishable Key, 설치 ID를 확인해 주세요."); return; }
    setBusy(true);
    try { await checkSupabaseConnection(config.supabaseUrl, config.supabasePublishableKey); saveRuntimeSupabaseConfig(config); setConnectionVerified(true); setPublishableKey(""); setMessage("Supabase 연결을 확인했어요."); persistStep(4); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Supabase 연결을 확인하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const connectInstallerAuthorization = async () => {
    if (!installerClient) return;
    const projectRef = projectRefFromUrl(supabaseUrl);
    if (!projectRef) { setError("프로젝트 주소를 먼저 확인해 주세요."); return; }
    setAuthorizing(true); setError(null);
    try {
      const result = await installerClient.beginAuthorization({ projectRef, projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" });
      window.location.assign(result.authorizeUrl);
    } catch { setError("Supabase 설치 권한 연결을 시작하지 못했습니다."); setAuthorizing(false); }
  };

  const loginTeacher = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const { data, error: authError } = await getSupabase().auth.signInWithPassword({ email: teacherEmail.trim(), password: teacherPassword });
      if (authError || !data.session) throw authError ?? new Error("session missing");
      setTeacherSignedIn(true); setTeacherPassword(""); setMessage("교사 로그인이 확인됐어요."); persistStep(6);
    } catch (reason) { setError(friendlyAuthError(reason)); }
    finally { setBusy(false); }
  };

  const loadClasses = async () => {
    setBusy(true); setError(null);
    try { const payload = await teacherListClasses(); setClasses(payload.classes); if (!classId && payload.classes[0]) setClassId(payload.classes[0].id); }
    catch { setError("학급 목록을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  };

  const createClass = async (event: FormEvent) => {
    event.preventDefault(); if (!className.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await teacherUpsertClass({ name: className.trim() });
      if (!result.class) throw new Error("학급 생성 응답이 없습니다.");
      setClasses((items) => [...items, result.class!]); setClassId(result.class.id); setMessage(`“${result.class.name}” 학급을 만들었어요. 학급 코드: ${result.class.class_code}`); setClassName("");
      persistStep(7, { classId: result.class.id, className: result.class.name, studentCount: 0 });
    } catch { setError("학급을 만들지 못했습니다. 설치 상태와 교사 권한을 확인해 주세요."); }
    finally { setBusy(false); }
  };

  const createStudents = async () => {
    if (!classId || !namesPreview.length) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const created: Array<{ name: string; studentNo: number | null; pin: string }> = [];
      for (const [index, studentName] of namesPreview.entries()) {
        const result = await teacherCreateStudent(classId, studentName, index + 1);
        created.push({ name: result.student.name, studentNo: result.student.studentNo, pin: result.pinPlain });
      }
      setNewStudents(created); setBulkNames(""); setMessage(`${created.length}명의 학생을 준비했어요. PIN은 이 화면에서만 확인할 수 있습니다.`);
      const refreshed = await teacherListStudents(classId); setStudents(refreshed.students); persistStep(7, { classId, className: selectedClass?.name, studentCount: refreshed.students.length });
    } catch { setError("학생 명단을 추가하지 못했습니다. 이미 등록된 이름·번호가 있는지 확인해 주세요."); }
    finally { setBusy(false); }
  };

  const verifyStudentSmoke = async () => {
    const createdCandidate = newStudents[0];
    const existingCandidate = students.find((student) => student.pinPlain);
    const candidateName = createdCandidate?.name ?? existingCandidate?.name;
    const candidatePin = createdCandidate?.pin ?? existingCandidate?.pinPlain;
    const candidateNo = createdCandidate?.studentNo ?? existingCandidate?.student_no;
    if (!candidateName || !candidatePin || !selectedClass) { setError("학생 한 명을 먼저 준비해 주세요."); return; }
    setBusy(true); setError(null);
    try {
      const result = await loginStudent({ classCode: selectedClass.class_code, name: candidateName, pin: candidatePin, studentNo: candidateNo });
      if (!("token" in result)) throw new Error("학생 로그인 확인에 번호 선택이 필요합니다.");
      setStudentToken(result.token); clearStudentToken(); setStudentSmokeVerified(true); setMessage("학생 로그인 확인이 끝났어요. PIN은 저장하지 않았습니다.");
    } catch { setError("학생 로그인 확인에 실패했습니다. 학생 PIN과 학급 코드를 확인해 주세요."); }
    finally { setBusy(false); }
  };

  const copyClassLink = async () => {
    if (!classLink) return;
    try { await navigator.clipboard.writeText(classLink); setMessage("학생 접속 링크를 복사했어요."); }
    catch { setError("링크를 복사하지 못했습니다."); }
  };

  const resetWizard = () => { clearInstallerProgress(); setStep(1); setMessage("설치를 다시 시작할 준비가 됐어요."); setError(null); };

  return (
    <main className="screen app-max">
      <section className="panel stack installer-wizard" aria-label="교사용 설치 마법사">
        <header className="installer-header"><div><p className="eyebrow">TEACHER SETUP</p><h1>공간과 입체 수업앱 설치</h1><p className="muted">몇 단계만 진행하면 우리 반에서 바로 사용할 수 있어요.</p></div><span className="status-chip">{step}/8</span></header>
        <nav className="installer-steps" aria-label="설치 단계">{STEP_TITLES.map((title, index) => <span className={index + 1 === step ? "active" : index + 1 < step ? "done" : ""} key={title}>{index + 1}. {title}</span>)}</nav>

        {step === 1 && <div className="installer-card stack"><h2>처음 시작하기</h2><p>선생님의 Supabase에 학생 계정과 학습 기록을 연결합니다. 학생에게는 Supabase 정보가 보이지 않아요.</p><button className="btn btn-primary" onClick={() => persistStep(2)}>설치 시작하기</button>{readInstallerProgress(installationId)?.step && <button className="btn" onClick={() => persistStep(readInstallerProgress(installationId)!.step)}>이어서 설치하기</button>}<p className="muted">이미 설치했나요? 아래에서 연결 상태를 다시 확인할 수 있어요.</p><button className="btn btn-sm" onClick={() => persistStep(3)}>설치 상태 확인 / 복구</button></div>}

        {step === 2 && <div className="installer-card stack"><h2>Supabase 준비</h2><p>학생 로그인과 학습 기록을 선생님의 Supabase에 저장합니다. Free 요금제로 시작할 수 있어요.</p><a className="btn" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase 열기</a><p className="muted">새 프로젝트를 만들었다면 Project Settings → API에서 공개 연결 정보를 확인해 주세요. DB 비밀번호·관리 토큰은 입력하지 않습니다.</p><div className="toolbar-row"><button className="btn" onClick={() => persistStep(1)}>이전</button><button className="btn btn-primary" onClick={() => persistStep(3)}>연결 화면으로</button></div></div>}

        {step === 3 && <form className="installer-card stack" onSubmit={connect}><h2>Supabase 연결</h2><label className="label" htmlFor="installer-url">Project URL <button type="button" className="help-link" title="Supabase → Project Settings → API">어디서 찾나요?</button></label><input id="installer-url" className="field" type="url" placeholder="https://your-project.supabase.co" value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} required /><label className="label" htmlFor="installer-key">Publishable key <button type="button" className="help-link" title="Supabase → Project Settings → API Keys">어디서 찾나요?</button></label><input id="installer-key" className="field" type="password" placeholder="sb_publishable_…" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} required />{connectionVerified && <p className="success" role="status">Supabase 연결 완료</p>}{error && <p className="error" role="alert">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "연결 확인 중…" : "연결 확인"}</button><p className="muted">공개 키는 이 기기의 설치 설정에만 저장됩니다. service_role·관리 토큰은 입력하지 마세요.</p></form>}

        {step === 4 && <div className="installer-card stack"><h2>설치 권한 연결</h2><p>{installerClient ? "Supabase 관리 권한을 안전한 서버 세션으로 연결해 현재 프로젝트 상태를 확인합니다." : "현재 정적 웹앱은 공개 URL·Publishable key로 연결만 확인할 수 있습니다."}</p><div className="installer-checks"><p>✓ Supabase 연결 확인</p>{installerStatus ? <p>✓ {installerStatusLabel(installerStatus)}</p> : <p>○ 데이터 구조·17개 migration — {installerClient ? installerStatusError ? "상태를 확인하지 못했어요" : "관리용 설치 실행부 상태 확인 중…" : "관리용 설치 실행부 연결 필요"}</p>}<p>○ student-auth / student-api 배포 — 관리용 설치 실행부 연결 필요</p><p>○ APP_SESSION_SECRET — 서버 Secret이라 브라우저에서 설정하지 않음</p></div>{installerClient && <button className="btn btn-primary" onClick={() => void connectInstallerAuthorization()} disabled={authorizing}>{authorizing ? "Supabase로 이동 중…" : "Supabase 설치 권한 연결"}</button>}<p className="notice">브라우저에 관리 토큰이나 service_role을 넣어 자동 설치하는 방식은 지원하지 않습니다. 안전한 관리용 실행부가 연결된 뒤에만 schema·함수·Secret 설치를 자동화할 수 있습니다.</p><div className="toolbar-row"><button className="btn" onClick={() => persistStep(3)}>연결 다시 확인</button><button className="btn btn-primary" onClick={() => persistStep(5)}>교사 확인으로 계속</button></div></div>}

        {step === 5 && <form className="installer-card stack" onSubmit={loginTeacher}><h2>교사 계정 확인</h2><p>Supabase Authentication에 만든 교사 계정으로 로그인합니다.</p><label className="label" htmlFor="installer-email">이메일</label><input id="installer-email" className="field" type="email" autoComplete="username" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} required /><label className="label" htmlFor="installer-password">비밀번호</label><input id="installer-password" className="field" type="password" autoComplete="current-password" value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />{error && <p className="error" role="alert">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "확인 중…" : "교사 로그인"}</button><p className="muted">비밀번호는 저장하거나 로그에 남기지 않습니다.</p></form>}

        {step === 6 && <div className="installer-card stack"><h2>우리 반 만들기</h2><p>학급 이름을 입력하면 학급 코드가 자동으로 만들어집니다.</p>{classes.length > 0 && <label className="label" htmlFor="installer-class-select">기존 학급 선택<select id="installer-class-select" className="field" value={classId} onChange={(event) => setClassId(event.target.value)}>{classes.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.class_code})</option>)}</select></label>}<form className="toolbar-row" onSubmit={createClass}><input className="field" aria-label="새 학급 이름" placeholder="예: 6학년 1반" value={className} onChange={(event) => setClassName(event.target.value)} /><button className="btn btn-primary" type="submit" disabled={busy || !className.trim()}>학급 만들기</button></form>{selectedClass && <p className="success" role="status">선택한 학급: {selectedClass.name} · 코드 {selectedClass.class_code}</p>}{error && <p className="error" role="alert">{error}</p>}<button className="btn" disabled={!classId || busy} onClick={() => persistStep(7, { classId, className: selectedClass?.name, studentCount: students.length })}>학생 만들기로 계속</button><button className="btn btn-sm" onClick={() => void loadClasses()} disabled={busy}>학급 목록 새로고침</button></div>}

        {step === 7 && <div className="installer-card stack"><h2>학생 만들기</h2><p>{selectedClass ? `${selectedClass.name} 학생 명단을 붙여 넣어 주세요.` : "먼저 학급을 선택해 주세요."}</p><textarea className="field installer-textarea" aria-label="학생 명단" placeholder="한 줄에 한 명씩 또는 쉼표로 입력" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} />{namesPreview.length > 0 && <p className="muted">{namesPreview.length}명 준비: {namesPreview.join(", ")}</p>}<button className="btn btn-primary" disabled={busy || !classId || !namesPreview.length} onClick={() => void createStudents()}>학생 계정 만들기</button>{students.length > 0 && <p className="success" role="status">현재 학급 학생 {students.length}명</p>}{error && <p className="error" role="alert">{error}</p>}<div className="toolbar-row"><button className="btn" onClick={() => persistStep(6)}>학급 다시 선택</button><button className="btn btn-sm" disabled={busy || (!newStudents.length && !students.some((student) => student.pinPlain))} onClick={() => void verifyStudentSmoke()}>학생 로그인 확인</button>{(newStudents.length > 0 || students.length > 0) && <button className="btn btn-primary" disabled={!studentSmokeVerified} onClick={() => persistStep(8, { classId, className: selectedClass?.name, studentCount: students.length })}>완료 화면으로</button>}</div>{newStudents.length > 0 && <div className="pin-list" aria-label="새 학생 PIN 목록"><h3>이번에 만든 학생 PIN</h3>{newStudents.map((student) => <p key={`${student.name}-${student.studentNo}`}><strong>{student.studentNo ?? ""}번 {student.name}</strong><code>{student.pin}</code></p>)}<p className="muted">이 목록을 필요한 곳에 안전하게 전달한 뒤, 창을 닫으면 다시 표시되지 않습니다.</p></div>}</div>}

        {step === 8 && <div className="installer-card stack"><h2>설치 준비가 끝났어요</h2><div className="installer-checks"><p>✓ Supabase 연결</p><p>✓ 교사 로그인</p><p>✓ 학급 {selectedClass?.name ?? "선택됨"}</p><p>✓ 학생 계정 {students.length}명</p><p>{studentSmokeVerified ? "✓ 학생 로그인 확인" : "○ 학생 로그인 확인 필요"}</p></div>{classLink && <div className="class-link-card"><strong>학생 접속 링크</strong><a href={classLink}>{classLink}</a><button className="btn btn-sm" onClick={() => void copyClassLink()}>링크 복사</button><p className="muted">이 링크를 QR 생성기에 넣어 학급 QR로 배부할 수 있습니다.</p></div>}<p className="notice">이 웹앱에서 확인한 것은 연결·교사 인증·학급·학생 준비입니다. migration·Edge Function·Secret의 자동 설치는 안전한 관리용 실행부가 연결되기 전까지 완료로 표시하지 않습니다.</p><div className="toolbar-row"><button className="btn btn-primary" onClick={() => navigate("/teacher")}>교사 화면 열기</button><Link className="btn" to="/">학생 화면 미리보기</Link><button className="btn btn-sm" onClick={() => persistStep(7)}>학생 로그인 확인으로 돌아가기</button><button className="btn btn-sm" onClick={resetWizard}>설정 상태 다시 확인</button></div><p className="muted">학생은 학급 링크 또는 QR로 접속해 이름과 PIN만 입력하면 됩니다.</p></div>}

        {message && <p className="success" role="status">{message}</p>}
        <footer className="installer-footer"><Link to="/teacher">교사 화면</Link><span>·</span><button className="link-button" onClick={() => persistStep(3)}>설정 확인 / 복구</button></footer>
      </section>
    </main>
  );
}
