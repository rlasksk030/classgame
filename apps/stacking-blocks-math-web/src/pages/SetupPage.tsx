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
import { clearInstallerProgress, getOrCreatePendingInstallationId, readInstallerProgress, saveInstallerProgress, type InstallerStep } from "../lib/installer";
import { getConfiguredInstallerClient, InstallerClientError, type InstallerAccessibleProject, type InstallerRemoteStatus, type InstallerStatusResponse } from "../lib/installerClient";
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

const STEP_TITLES = ["시작", "연결 준비", "연결", "자동 설치", "교사 확인", "학급 생성", "학생 생성", "설치 완료"] as const;

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
  const [installationId] = useState(current?.installationId ?? getOrCreatePendingInstallationId(defaultInstallationId));
  const [supabaseUrl, setSupabaseUrl] = useState(current?.supabaseUrl ?? (vite.configSource === "vite-fallback" ? vite.supabaseUrl ?? "" : ""));
  const [publishableKey, setPublishableKey] = useState(current?.supabasePublishableKey ?? "");
  const [step, setStep] = useState<InstallerStep>(() => readInstallerProgress(installationId)?.step ?? 1);
  const [connectionVerified, setConnectionVerified] = useState(Boolean(current));
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
  const [temporaryPat, setTemporaryPat] = useState("");
  const [useTemporaryPat, setUseTemporaryPat] = useState(false);
  const [oauthAuthorized, setOauthAuthorized] = useState(false);
  const [oauthProjects, setOauthProjects] = useState<InstallerAccessibleProject[] | null>(null);
  const [selectedProjectRef, setSelectedProjectRef] = useState("");
  const [boundProjectLabel, setBoundProjectLabel] = useState("");
  const [teacherAccountMode, setTeacherAccountMode] = useState<"choose" | "create" | "login">("choose");
  const [teacherAccountBusy, setTeacherAccountBusy] = useState(false);
  const [installerDetails, setInstallerDetails] = useState<InstallerStatusResponse | null>(null);
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
    if (!installerClient) return;
    const params = new URLSearchParams(window.location.search);
    const justGranted = params.get("oauth") === "granted";
    if (justGranted) { window.history.replaceState(null, "", window.location.pathname); persistStep(3); }
    if (connectionVerified || useTemporaryPat) return;
    void loadOAuthProjects(true);
    // Runs once on mount: covers both the redirect back from Supabase's
    // consent screen (a real page navigation, so no React state survives it)
    // and a plain reload while an OAuth grant cookie (HttpOnly, short TTL) is
    // still live but no project has been picked yet.
  }, []);

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
    setInstallerStatusError(false); setInstallerStatus(null); setInstallerDetails(null);
    void installerClient.getStatus({ projectRef, projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" }).then((result) => {
      // A successful status call proves the session already has a working
      // credential -- whether that came from this page load's OAuth binding
      // or one from before a reload -- so PAT prompts stay hidden either way.
      if (active) { setInstallerStatus(result.status); setInstallerDetails(result); setOauthAuthorized(true); }
    }).catch((reason) => {
      if (!active) return;
      setInstallerStatus(null); setInstallerStatusError(true);
      if (reason instanceof InstallerClientError && (reason.code === "INSTALLER_AUTH_REQUIRED" || reason.code === "INSTALLER_SESSION_REQUIRED")) setOauthAuthorized(false);
    });
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

  const installerTarget = () => ({ projectRef: projectRefFromUrl(supabaseUrl) ?? "", projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" });
  const installerFailure = (reason: unknown) => {
    if (reason instanceof InstallerClientError && reason.code === "INSTALLER_PROJECT_NOT_ALLOWED") {
      setError("선택한 프로젝트에 대한 설치 권한이 없어요. 다른 프로젝트를 선택하거나 다시 연결해 주세요.");
    } else if (reason instanceof InstallerClientError && reason.status === 401) {
      setInstallerStatus(null);
      setError("설치 권한이 없거나 만료되었어요. 다시 연결하면 완료된 단계부터 이어갑니다.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_BUSY") {
      setError("다른 창에서 이 프로젝트를 설치 중이에요. 잠시 후 상태를 확인해 주세요.");
    } else setError("설치 요청을 완료하지 못했어요. 상태 확인 후 이어서 복구해 주세요. 진단: " + (reason instanceof InstallerClientError ? reason.code : "INSTALLER_REQUEST_FAILED"));
  };
  const refreshInstallerStatus = async () => {
    if (!installerClient) return;
    const result = await installerClient.getStatus(installerTarget());
    setInstallerStatus(result.status); setInstallerDetails(result); setInstallerStatusError(false);
  };
  const connectInstallerAuthorization = async (event: FormEvent) => {
    event.preventDefault();
    if (!installerClient || authorizing || !temporaryPat.trim()) return;
    setAuthorizing(true); setError(null); setMessage(null);
    const pat = temporaryPat.trim(); setTemporaryPat("");
    try {
      await installerClient.createSession(installerTarget());
      await installerClient.provideTemporaryCredential(pat);
      await refreshInstallerStatus();
      setMessage("설치 권한을 연결했어요. 대상과 상태를 확인하고 설치해 주세요.");
    } catch (reason) { installerFailure(reason); }
    finally { setAuthorizing(false); }
  };
  const startOAuthConnect = async () => {
    if (!installerClient || authorizing) return;
    setAuthorizing(true); setError(null); setMessage(null);
    try {
      const { authorizeUrl } = await installerClient.beginAuthorization();
      window.location.href = authorizeUrl;
    } catch (reason) {
      if (reason instanceof InstallerClientError && reason.status === 501) { setUseTemporaryPat(true); persistStep(3); }
      else setError("Supabase 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setAuthorizing(false);
    }
  };
  /** OAuth grant list is re-fetched on every mount (not just the one-time
   * redirect back) so a plain reload while the grant cookie is still live
   * restores the picker instead of stranding the teacher on a dead screen. */
  const loadOAuthProjects = async (autoBindSingle: boolean) => {
    if (!installerClient) return;
    setBusy(true); setError(null);
    try {
      const result = await installerClient.listAccessibleProjects();
      if (!result.projects.length) {
        setOauthProjects([]);
        setError("선택할 수 있는 프로젝트가 없어요. Supabase에서 먼저 프로젝트를 만든 뒤 다시 연결해 주세요.");
        return;
      }
      setOauthProjects(result.projects);
      setSelectedProjectRef(result.projects[0].ref);
      if (autoBindSingle && result.projects.length === 1) await bindOAuthProject(result.projects[0]);
    } catch (reason) {
      // A 401 here just means no OAuth grant is active yet (or it expired) --
      // that is the normal state before connecting, not an error to surface.
      if (!(reason instanceof InstallerClientError && reason.status === 401)) {
        setError("Supabase 연결은 됐지만 프로젝트 목록을 불러오지 못했습니다. 다시 연결해 주세요.");
      }
    } finally { setBusy(false); }
  };
  const bindOAuthProject = async (project: InstallerAccessibleProject) => {
    if (!installerClient || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const projectUrl = `https://${project.ref}.supabase.co`;
      const result = await installerClient.createSession({ projectRef: project.ref, projectUrl, release: "spatial-math-v1" });
      const config: RuntimeSupabaseConfig = { installationId: installationId.trim(), supabaseUrl: projectUrl, supabasePublishableKey: result.publishableKey ?? "" };
      saveRuntimeSupabaseConfig(config);
      setSupabaseUrl(projectUrl); setConnectionVerified(true); setOauthAuthorized(true); setOauthProjects(null);
      setBoundProjectLabel(project.name ?? project.ref);
      setMessage(result.publishableKey ? "선택한 프로젝트에 연결하고 설치 권한도 받았어요." : "선택한 프로젝트에 연결했지만 공개 키는 자동으로 받지 못했어요. 학생 접속에 필요하니 연결 화면에서 직접 입력해 주세요.");
      persistStep(4);
    } catch (reason) { installerFailure(reason); }
    finally { setBusy(false); }
  };
  const selectOAuthProject = () => {
    const project = oauthProjects?.find((item) => item.ref === selectedProjectRef);
    if (project) void bindOAuthProject(project);
  };
  const runInstallerAction = async (action: "install" | "repair" | "update" | "status" | "revoke") => {
    if (!installerClient || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      if (action === "revoke") {
        await installerClient.revoke(); setInstallerStatus(null); setInstallerDetails(null);
        setMessage("설치 서버에 맡긴 권한을 해제했어요. Supabase에서 토큰도 폐기할 수 있어요."); return;
      }
      if (action !== "status") {
        const target = installerTarget();
        await (action === "install" ? installerClient.startInstall(target) : action === "repair" ? installerClient.repair(target) : installerClient.update(target));
      }
      await refreshInstallerStatus();
    } catch (reason) { installerFailure(reason); }
    finally { setBusy(false); }
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

  const createTeacherAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!installerClient || teacherAccountBusy) return;
    setTeacherAccountBusy(true); setError(null); setMessage(null);
    try {
      const result = await installerClient.createTeacherAccount(teacherEmail.trim(), teacherPassword);
      if (result.alreadyExists) { setMessage("이미 있는 계정이에요. 아래에서 로그인해 주세요."); setTeacherAccountMode("login"); return; }
      setMessage("교사 계정을 만들었어요. 이제 같은 정보로 로그인해 주세요.");
      setTeacherAccountMode("login");
    } catch {
      setError("교사 계정을 만들지 못했어요. 이메일 형식과 8자 이상 비밀번호를 확인해 주세요.");
    } finally { setTeacherAccountBusy(false); }
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

  const resetWizard = () => { clearInstallerProgress(); setStep(1); setBoundProjectLabel(""); setMessage("설치를 다시 시작할 준비가 됐어요."); setError(null); };

  return (
    <main className="screen app-max">
      <section className="panel stack installer-wizard" aria-label="교사용 설치 마법사">
        <header className="installer-header"><div><p className="eyebrow">TEACHER SETUP</p><h1>공간과 입체 수업앱 설치</h1><p className="muted">몇 단계만 진행하면 우리 반에서 바로 사용할 수 있어요.</p></div><span className="status-chip">{step}/8</span></header>
        <nav className="installer-steps" aria-label="설치 단계">{STEP_TITLES.map((title, index) => <span className={index + 1 === step ? "active" : index + 1 < step ? "done" : ""} key={title}>{index + 1}. {title}</span>)}</nav>

        {step === 1 && <div className="installer-card stack"><h2>처음 시작하기</h2><p>선생님의 Supabase에 학생 계정과 학습 기록을 연결합니다. 학생에게는 Supabase 정보가 보이지 않아요.</p><button className="btn btn-primary" onClick={() => persistStep(2)}>설치 시작하기</button>{readInstallerProgress(installationId)?.step && <button className="btn" onClick={() => persistStep(readInstallerProgress(installationId)!.step)}>이어서 설치하기</button>}<p className="muted">이미 설치했나요? 아래에서 연결 상태를 다시 확인할 수 있어요.</p><button className="btn btn-sm" onClick={() => persistStep(3)}>설치 상태 확인 / 복구</button></div>}

        {step === 2 && <div className="installer-card stack"><h2>Supabase 준비</h2><p>학생 로그인과 학습 기록을 선생님의 Supabase에 저장합니다. Free 요금제로 시작할 수 있어요.</p><a className="btn" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase 열기</a><p className="muted">새 프로젝트를 만들었다면 Project Settings → API에서 공개 연결 정보를 확인해 주세요. 이 연결 단계에서는 공개 URL과 Publishable key만 사용합니다.</p><div className="toolbar-row"><button className="btn" onClick={() => persistStep(1)}>이전</button><button className="btn btn-primary" onClick={() => persistStep(3)}>연결 화면으로</button></div></div>}

        {step === 3 && <div className="installer-card stack">
          <h2>Supabase 연결</h2>
          {connectionVerified ? <>
            <p className="success" role="status">Supabase 연결 완료{boundProjectLabel ? ` · ${boundProjectLabel}` : ""}</p>
            <button className="btn btn-primary" onClick={() => persistStep(4)}>자동 설치로 계속</button>
          </> : oauthProjects ? <>
            <p>설치할 Supabase 프로젝트를 선택하세요.</p>
            {oauthProjects.length ? <>
              <label className="label" htmlFor="installer-project-select">내 Supabase 프로젝트<select id="installer-project-select" className="field" value={selectedProjectRef} onChange={event => setSelectedProjectRef(event.target.value)}>{oauthProjects.map(project => <option value={project.ref} key={project.ref}>{project.name ?? project.ref}{project.region ? ` · ${project.region}` : ""}</option>)}</select></label>
              <button className="btn btn-primary" disabled={busy || !selectedProjectRef} onClick={() => selectOAuthProject()}>{busy ? "연결 중…" : "이 프로젝트 사용"}</button>
            </> : <p className="notice">선택할 수 있는 프로젝트가 없어요. Supabase에서 먼저 프로젝트를 만든 뒤 다시 연결해 주세요.</p>}
          </> : <>
            <p>버튼 한 번으로 선생님의 Supabase 계정에 연결합니다. Project URL이나 키를 직접 입력하지 않아도 됩니다.</p>
            {installerClient ? <div className="stack">
              <button className="btn btn-primary" disabled={authorizing || busy} onClick={() => void startOAuthConnect()}>{authorizing ? "연결 이동 중…" : "Supabase 연결"}</button>
              <p className="muted">버튼을 누르면 Supabase 로그인 화면으로 이동합니다. 이 앱은 토큰을 직접 보거나 저장하지 않습니다.</p>
            </div> : <p className="notice">이 화면에 설치 서버가 연결되지 않았습니다. 아래 개발자용 수동 연결을 사용해 주세요.</p>}
          </>}
          {error && <p className="error" role="alert">{error}</p>}
          <details className="installer-advanced" open={useTemporaryPat}>
            <summary>개발자용 수동 연결</summary>
            <form className="stack" onSubmit={connect}>
              <label className="label" htmlFor="installer-url">Project URL <button type="button" className="help-link" title="Supabase → Project Settings → API">어디서 찾나요?</button></label>
              <input id="installer-url" className="field" type="url" placeholder="https://your-project.supabase.co" value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} required />
              <label className="label" htmlFor="installer-key">Publishable key <button type="button" className="help-link" title="Supabase → Project Settings → API Keys">어디서 찾나요?</button></label>
              <input id="installer-key" className="field" type="password" placeholder="sb_publishable_…" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} required />
              <button className="btn btn-primary" type="submit" disabled={busy} onClick={() => setUseTemporaryPat(true)}>{busy ? "연결 확인 중…" : "연결 확인"}</button>
              <p className="muted">공개 키는 이 기기의 설치 설정에만 저장됩니다. service_role·관리 토큰은 입력하지 마세요.</p>
            </form>
          </details>
        </div>}

        {step === 4 && <div className="installer-card stack">
          <h2>데이터베이스 준비</h2>
          <p>학생 로그인 기능과 학습 기록을 저장할 준비를 합니다. 기존 기록과 서버 비밀값은 보존합니다.</p>
          {connectionVerified && <p>설치 대상: <strong>{boundProjectLabel || projectRefFromUrl(supabaseUrl)}</strong></p>}
          {installerClient ? <>
            {oauthAuthorized ? <p className="success" role="status">설치 준비가 완료되었습니다. 별도 토큰 입력이 필요 없어요.</p> : connectionVerified && <p className="notice">설치 권한을 아직 확인하지 못했어요. Supabase 연결이 끊겼다면 3단계에서 다시 연결하거나, 아래 개발자용 수동 연결을 사용해 주세요.</p>}
            {connectionVerified && <details className="installer-advanced" open={useTemporaryPat && !oauthAuthorized}>
              <summary>개발자용 수동 연결</summary>
              <form className="stack" onSubmit={connectInstallerAuthorization}>
                <label className="label" htmlFor="installer-pat">개발자용 임시 설치 권한 토큰</label>
                <input id="installer-pat" className="field" type="password" autoComplete="off" spellCheck={false} value={temporaryPat} onChange={event => setTemporaryPat(event.target.value)} required />
                <p className="muted"><a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noreferrer">Supabase에서 TEST 설치용 토큰 만들기</a> → 여기에 붙여 넣어 주세요. 관리자 비밀 키나 DB 비밀번호는 입력하지 않습니다.</p>
                <p className="muted">토큰은 입력 후 지우며, 설치 서버 메모리에서 최대 15분 동안만 사용합니다. 그동안 새로고침 후에도 이어서 확인할 수 있습니다. 서버 재시작이나 만료 후에는 다시 연결하세요.</p>
                <button className="btn btn-primary" type="submit" disabled={authorizing || busy || !temporaryPat.trim()}>{authorizing ? "권한 확인 중…" : "설치 권한 연결"}</button>
              </form>
            </details>}
            {(oauthAuthorized || (connectionVerified && (installerStatus || installerStatusError))) && <>
              <div className="installer-checks" aria-live="polite">
                <p>{installerStatus ? installerStatusLabel(installerStatus) : installerStatusError ? "설치 권한을 연결한 후 상태를 확인해 주세요." : "설치 상태 확인 중…"}</p>
                {installerDetails?.requiredMigrationCount !== undefined && <p>데이터베이스 준비: {installerDetails.appliedMigrationCount ?? 0}/{installerDetails.requiredMigrationCount}</p>}
                {installerDetails?.functions?.map(item => <p key={item.slug}>학생 로그인 기능 ({item.slug === "student-auth" ? "인증" : "학습"}): {item.status}</p>)}
              </div>
              <div className="toolbar-row">
                <button className="btn btn-primary" disabled={busy || authorizing || !installerStatus} onClick={() => void runInstallerAction("install")}>{busy ? "처리 중…" : "수학 앱 설치"}</button>
                <button className="btn" disabled={busy || !installerStatus} onClick={() => void runInstallerAction("repair")}>이어서 복구</button>
                <button className="btn" disabled={busy || !installerStatus} onClick={() => void runInstallerAction("update")}>업데이트</button>
                <button className="btn" disabled={busy || authorizing} onClick={() => void runInstallerAction("status")}>설치 확인</button>
                <button className="btn" disabled={busy || authorizing} onClick={() => void runInstallerAction("revoke")}>설치 권한 해제</button>
              </div>
            </>}
          </> : <p className="notice">이 화면에 설치 서버가 연결되지 않았습니다. 공개 URL과 키만으로 설치를 완료할 수 없습니다.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="toolbar-row"><button className="btn" disabled={busy} onClick={() => persistStep(3)}>연결 다시 확인</button><button className="btn btn-primary" disabled={busy || installerStatus !== "INSTALLED"} onClick={() => persistStep(5)}>교사 확인으로 계속</button></div>
        </div>}

        {step === 5 && <div className="installer-card stack">
          <h2>교사 계정</h2>
          {installerClient && teacherAccountMode === "choose" && <>
            <p>이 수업앱에 로그인할 교사 계정이 필요합니다. Supabase Dashboard를 열지 않아도 여기서 바로 만들 수 있어요.</p>
            <div className="toolbar-row">
              <button className="btn btn-primary" onClick={() => setTeacherAccountMode("create")}>교사 계정 만들기</button>
              <button className="btn" onClick={() => setTeacherAccountMode("login")}>이미 계정이 있어요</button>
            </div>
          </>}
          {installerClient && teacherAccountMode === "create" && <form className="stack" onSubmit={createTeacherAccount}>
            <p>새 교사 계정을 만듭니다. 이 정보로 앞으로 교사 화면에 로그인합니다.</p>
            <label className="label" htmlFor="installer-new-email">이메일</label>
            <input id="installer-new-email" className="field" type="email" autoComplete="username" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} required />
            <label className="label" htmlFor="installer-new-password">비밀번호 (8자 이상)</label>
            <input id="installer-new-password" className="field" type="password" autoComplete="new-password" minLength={8} value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="toolbar-row">
              <button className="btn btn-primary" type="submit" disabled={teacherAccountBusy}>{teacherAccountBusy ? "만드는 중…" : "계정 만들기"}</button>
              <button className="btn btn-sm" type="button" onClick={() => setTeacherAccountMode("choose")}>취소</button>
            </div>
          </form>}
          {(!installerClient || teacherAccountMode === "login") && <form className="stack" onSubmit={loginTeacher}>
            <p>가지고 있는 교사 계정으로 로그인합니다.</p>
            <label className="label" htmlFor="installer-email">이메일</label>
            <input id="installer-email" className="field" type="email" autoComplete="username" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} required />
            <label className="label" htmlFor="installer-password">비밀번호</label>
            <input id="installer-password" className="field" type="password" autoComplete="current-password" value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} required />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="toolbar-row">
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "확인 중…" : "교사 로그인"}</button>
              {installerClient && <button className="btn btn-sm" type="button" onClick={() => setTeacherAccountMode("create")}>계정이 없어요, 새로 만들기</button>}
            </div>
          </form>}
          <p className="muted">비밀번호는 저장하거나 로그에 남기지 않습니다.</p>
        </div>}

        {step === 6 && <div className="installer-card stack"><h2>우리 반 만들기</h2><p>학급 이름을 입력하면 학급 코드가 자동으로 만들어집니다.</p>{classes.length > 0 && <label className="label" htmlFor="installer-class-select">기존 학급 선택<select id="installer-class-select" className="field" value={classId} onChange={(event) => setClassId(event.target.value)}>{classes.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.class_code})</option>)}</select></label>}<form className="toolbar-row" onSubmit={createClass}><input className="field" aria-label="새 학급 이름" placeholder="예: 6학년 1반" value={className} onChange={(event) => setClassName(event.target.value)} /><button className="btn btn-primary" type="submit" disabled={busy || !className.trim()}>학급 만들기</button></form>{selectedClass && <p className="success" role="status">선택한 학급: {selectedClass.name} · 코드 {selectedClass.class_code}</p>}{error && <p className="error" role="alert">{error}</p>}<button className="btn" disabled={!classId || busy} onClick={() => persistStep(7, { classId, className: selectedClass?.name, studentCount: students.length })}>학생 만들기로 계속</button><button className="btn btn-sm" onClick={() => void loadClasses()} disabled={busy}>학급 목록 새로고침</button></div>}

        {step === 7 && <div className="installer-card stack"><h2>학생 만들기</h2><p>{selectedClass ? `${selectedClass.name} 학생 명단을 붙여 넣어 주세요.` : "먼저 학급을 선택해 주세요."}</p><textarea className="field installer-textarea" aria-label="학생 명단" placeholder="한 줄에 한 명씩 또는 쉼표로 입력" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} />{namesPreview.length > 0 && <p className="muted">{namesPreview.length}명 준비: {namesPreview.join(", ")}</p>}<button className="btn btn-primary" disabled={busy || !classId || !namesPreview.length} onClick={() => void createStudents()}>학생 계정 만들기</button>{students.length > 0 && <p className="success" role="status">현재 학급 학생 {students.length}명</p>}{error && <p className="error" role="alert">{error}</p>}<div className="toolbar-row"><button className="btn" onClick={() => persistStep(6)}>학급 다시 선택</button><button className="btn btn-sm" disabled={busy || (!newStudents.length && !students.some((student) => student.pinPlain))} onClick={() => void verifyStudentSmoke()}>학생 로그인 확인</button>{(newStudents.length > 0 || students.length > 0) && <button className="btn btn-primary" disabled={!studentSmokeVerified} onClick={() => persistStep(8, { classId, className: selectedClass?.name, studentCount: students.length })}>완료 화면으로</button>}</div>{newStudents.length > 0 && <div className="pin-list" aria-label="새 학생 PIN 목록"><h3>이번에 만든 학생 PIN</h3>{newStudents.map((student) => <p key={`${student.name}-${student.studentNo}`}><strong>{student.studentNo ?? ""}번 {student.name}</strong><code>{student.pin}</code></p>)}<p className="muted">이 목록을 필요한 곳에 안전하게 전달한 뒤, 창을 닫으면 다시 표시되지 않습니다.</p></div>}</div>}

        {step === 8 && <div className="installer-card stack"><h2>설치 준비가 끝났어요</h2><div className="installer-checks"><p>✓ Supabase 연결</p><p>✓ 교사 로그인</p><p>✓ 학급 {selectedClass?.name ?? "선택됨"}</p><p>✓ 학생 계정 {students.length}명</p><p>{studentSmokeVerified ? "✓ 학생 로그인 확인" : "○ 학생 로그인 확인 필요"}</p></div>{classLink && <div className="class-link-card"><strong>학생 접속 링크</strong><a href={classLink}>{classLink}</a><button className="btn btn-sm" onClick={() => void copyClassLink()}>링크 복사</button><p className="muted">이 링크를 QR 생성기에 넣어 학급 QR로 배부할 수 있습니다.</p></div>}<p className="notice">이 웹앱에서 확인한 것은 연결·교사 인증·학급·학생 준비입니다. 자동 설치 상태와 별도로 학생의 첫 학습 저장·재접속 복원을 확인해야 수업 준비가 끝납니다.</p><div className="toolbar-row"><button className="btn btn-primary" onClick={() => navigate("/teacher")}>교사 화면 열기</button><Link className="btn" to="/">학생 화면 미리보기</Link><button className="btn btn-sm" onClick={() => persistStep(7)}>학생 로그인 확인으로 돌아가기</button><button className="btn btn-sm" onClick={resetWizard}>설정 상태 다시 확인</button></div><p className="muted">학생은 학급 링크 또는 QR로 접속해 이름과 PIN만 입력하면 됩니다.</p></div>}

        {message && <p className="success" role="status">{message}</p>}
        <footer className="installer-footer"><Link to="/teacher">교사 화면</Link><span>·</span><button className="link-button" onClick={() => persistStep(3)}>설정 확인 / 복구</button></footer>
      </section>
    </main>
  );
}
