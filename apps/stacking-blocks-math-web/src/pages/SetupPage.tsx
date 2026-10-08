import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  getAppConfig,
  getRuntimeSupabaseConfig,
  hasInvalidInstallationConfigHash,
  encodeInstallationConfig,
  projectRefFromUrl,
  saveRuntimeSupabaseConfig,
  validateRuntimeSupabaseConfig,
  type RuntimeSupabaseConfig,
} from "../lib/config";
import { clearInstallerProgress, readInstallerClassDraft, getOrCreateInstallerClassDraft, clearInstallerClassDraft, hasInstallerResumeUpdate, clearInstallerResumeUpdate, getOrCreatePendingInstallationId, readInstallerProgress, saveInstallerProgress, type InstallerStep } from "../lib/installer";
import { getConfiguredInstallerClient, InstallerClientError, type InstallerAccessibleProject, type InstallerDataEvidenceReview, type InstallerRecoveryPlanResponse, type InstallerRemoteStatus, type InstallerStatusResponse } from "../lib/installerClient";
import { bindInstallerOAuthProject, completeInstallerReconnect, existingInstallerTarget, verifyInstallerSession, type VerifiedInstallerSession } from "../lib/installerReconnect";
import { getSupabase } from "../lib/supabase";
import {
  loginStudent,
  teacherCreateStudent,
  teacherListClasses,
  teacherListStudents,
  teacherUpsertClass,
  StudentApiError,
  type ClassData,
  type TeacherStudentRow,
} from "../lib/studentApi";

const STEP_TITLES = ["시작", "연결 준비", "연결", "자동 설치", "교사 확인", "학급 생성", "학생 생성", "설치 완료"] as const;

async function checkSupabaseConnection(supabaseUrl: string, publishableKey: string): Promise<void> {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: publishableKey }, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error("주소와 Publishable key를 다시 확인해 주세요.");
}

const DATA_EVIDENCE_LABELS: Array<[keyof InstallerDataEvidenceReview['counts'], string]> = [
  ['seedMissing', '기본 문제 누락'],
  ['seedOutdated', '기본 문제 기준 내용 차이'],
  ['storageMissing', '파일 저장소 준비 누락'],
  ['progressMissing', '필수 진도 보완 대상'],
  ['dataConflict', '데이터 충돌 합계'],
  ['duplicateSeedCount', '기본 문제 중복'],
  ['seedIdentityConflictCount', '기본 문제 식별자 충돌'],
  ['duplicateSeedReferencedCount', '기존 풀이가 연결된 중복 문제'],
  ['storageBucketConflictCount', '파일 저장소 설정 충돌'],
  ['storagePolicyConflictCount', '파일 저장소 접근 정책 충돌'],
  ['customizedSeedCount', '별도로 보존할 수정 문제'],
  ['classProblemCount', '학급별 문제'],
];
const DATA_EVIDENCE_TRIGGERS: Record<string, string> = {
  SEED_IDENTITY_CONFLICT: '기본 문제의 식별자가 학급 문제 또는 다른 문제와 겹칩니다. 기존 문제나 풀이를 덮어쓰지 않고 별도로 검토합니다.',
  DUPLICATE_SEED: '기본 문제 중복을 확인했습니다. 기존 풀이와 연결되어 있을 수 있어 자동 삭제하지 않습니다.',
  STORAGE_BUCKET_CONFLICT: '파일 저장소의 공개 여부 또는 설정이 현재 기준과 다릅니다.',
  STORAGE_POLICY_CONFLICT: '파일 저장소 접근 정책이 현재 기준과 다릅니다. 표현 차이인지 실제 권한 차이인지 확인이 필요합니다.',
  SEED_MISSING_WITH_HISTORY: '기본 문제를 준비한 이력은 있지만 필요한 문제 일부를 확인하지 못했습니다.',
  SEED_OUTDATED_WITH_HISTORY: '문제 내용을 갱신한 이력과 현재 기본 문제 내용이 다릅니다. 기존 풀이와 교사의 수정 내용을 먼저 확인해야 합니다.',
  UNCLASSIFIED_DATA_CONFLICT: '데이터 충돌은 확인했지만 세부 원인을 아직 분류하지 못했습니다.',
  EVIDENCE_UNAVAILABLE: '데이터 검증 결과를 아직 확인하지 못했습니다. 미확인은 0건을 뜻하지 않습니다.',
};
const DATA_EVIDENCE_ACTIONS: Record<InstallerDataEvidenceReview['classification'], string> = {
  SAFE_NO_CHANGE: '데이터 변경 없이 검사 로직을 확인할 수 있는 상태입니다. 서버에서 정상 상태를 확인하기 전에는 다음 단계로 진행하지 않습니다.',
  SAFE_ADDITIVE: '누락 항목을 보완하는 계획이 필요합니다. 기존 자료 보존과 별도 승인 확인 전에는 추가하지 않습니다.',
  REVIEW_REQUIRED: '실제 수정이 필요한지 검토해야 합니다. 문제 내용이나 접근 권한을 자동으로 덮어쓰지 않습니다.',
  UNSAFE: '자동 복구 시 기존 자료에 영향을 줄 수 있어 중단했습니다. 제작자의 검토가 필요합니다.',
};

function DataEvidenceReview({ review }: { review?: InstallerDataEvidenceReview }) {
  return <section className="stack" aria-label="데이터 검증 상세">
    <h3>기존 데이터 확인 결과</h3>
    <p>구조·접근 권한의 객체 차이와 별도로, 기존 문제와 파일 저장소·진도 정보를 대조한 결과입니다. 객체 차이가 0이어도 데이터 검증은 별도로 필요합니다.</p>
    <dl>{DATA_EVIDENCE_LABELS.map(([key, label]) => {
      const value = review?.counts?.[key];
      return <div key={key}><dt>{label}</dt><dd>{Number.isSafeInteger(value) && (value ?? -1) >= 0 ? `${value}건` : '미확인'}</dd></div>;
    })}</dl>
    <ul aria-label="데이터 충돌 원인">{Object.entries(DATA_EVIDENCE_TRIGGERS).filter(([code]) => review?.triggers?.includes(code)).map(([code, text]) => <li key={code}>{text}</li>)}</ul>
    <p>{review && Object.hasOwn(DATA_EVIDENCE_ACTIONS, review.classification) && DATA_EVIDENCE_ACTIONS[review.classification] || '실제 수정이 필요한지 아직 판단하지 못했습니다. 상세 진단을 먼저 확인해야 합니다.'}</p>
    <p>이번 진단은 읽기 전용입니다. 학생·PIN·문제·답안·진도·작품·보상을 변경하지 않습니다.</p>
    <p>‘설치 확인’으로 다시 조회할 수 있습니다. 계속 멈추면 이 진단의 종류와 개수만 제작자에게 알려 주세요. 프로젝트 삭제·초기화나 문제 전체 재등록은 하지 마세요.</p>
  </section>;
}

const RECOVERY_REASON_LABELS: Record<string, string> = {
  NO_PERMISSION_DRIFT: '조정할 접근 권한이 없습니다. 설치 확인으로 현재 상태를 다시 확인해 주세요.',
  UNSAFE_STRUCTURE: '데이터베이스 구조 또는 보호 규칙이 기준과 다릅니다. 접근 권한만 바꾸는 자동 복구는 진행하지 않습니다.',
  UNKNOWN_PERMISSION_CONTEXT: '권한의 적용 범위를 확실히 확인하지 못했습니다. 기존 자료를 보호하기 위해 자동 변경하지 않습니다.',
  MIXED_PERMISSION_DIFFERENCE: '확인한 권한 차이 중 자동 복구할 수 없는 항목이 함께 있습니다. 제작자의 검토가 필요합니다.',
  UNSUPPORTED_ACL: '현재 접근 권한을 안전한 복구 항목으로 확인하지 못했습니다. 자동 변경하지 않습니다.',
  BASELINE_MISMATCH: '복구 기준과 현재 설치 구성이 다릅니다. 기존 설치를 다시 확인해야 합니다.',
  HISTORY_MISMATCH: '설치 이력과 확인된 구성이 일치하지 않습니다. 접근 권한을 변경하지 않고 제작자의 확인을 기다립니다.',
  NO_ACL_CHANGES: '조정할 접근 권한이 없습니다. 설치 확인으로 현재 상태를 다시 확인해 주세요.',
  STRUCTURAL_REVIEW_REQUIRED: '데이터베이스 구조 또는 보호 규칙이 기준과 다릅니다. 접근 권한만 바꾸는 자동 복구는 진행하지 않습니다.',
  PERMISSION_CONTEXT_UNKNOWN: '권한의 적용 범위를 확실히 확인하지 못했습니다. 기존 자료를 보호하기 위해 자동 변경하지 않습니다.',
  DATA_REVIEW_REQUIRED: '기존 문제·파일 저장소·진도 정보에 별도 확인이 필요합니다. 접근 권한 복구로 데이터 충돌을 처리하지 않습니다.',
  RECOVERY_UNAVAILABLE: '현재 상태의 안전한 복구 방법을 확인하지 못했습니다. 진단 결과를 제작자가 검토해야 합니다.',
};

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

function installerStatusLabel(status: InstallerRemoteStatus): string {
  switch (status) {
    case "DRIFT_REQUIRES_REVIEW": return "자동 업데이트로 변경하기 전에 확인이 필요합니다.";
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
  const setupActive = useRef(true);
  useEffect(() => {
    setupActive.current = true;
    return () => { setupActive.current = false; };
  }, []);
  // Concurrent navigation can change the URL before this page unmounts.
  // A late response must not save config, update, or redirect after departure.
  const isSetupActive = () => setupActive.current && /^\/setup\/?$/.test(window.location.pathname);
  const [returnToTeacher] = useState(() => {
    // Exact allowlist; preserve only this route across the existing OAuth redirect.
    const requested = new URLSearchParams(window.location.search).get("returnTo") === "/teacher";
    try {
      if (requested) sessionStorage.setItem("stacking-teacher-return", "/teacher");
      return requested || hasInstallerResumeUpdate() || sessionStorage.getItem("stacking-teacher-return") === "/teacher";
    } catch { return requested; }
  });
  const finishTeacherReconnect = () => {
    if (!returnToTeacher || !isSetupActive()) return false;
    try { sessionStorage.removeItem("stacking-teacher-return"); } catch { /* Storage may be unavailable. */ }
    clearInstallerResumeUpdate();
    navigate("/teacher", { replace: true });
    return true;
  };
  const current = getRuntimeSupabaseConfig();
  const vite = getAppConfig();
  const [installationId] = useState(current?.installationId ?? getOrCreatePendingInstallationId(defaultInstallationId));
  const [supabaseUrl, setSupabaseUrl] = useState(current?.supabaseUrl ?? (vite.configSource === "vite-fallback" ? vite.supabaseUrl ?? "" : ""));
  const [publishableKey, setPublishableKey] = useState(current?.supabasePublishableKey ?? "");
  const [step, setStep] = useState<InstallerStep>(() => returnToTeacher ? 3 : readInstallerProgress(installationId)?.step ?? 1);
  const [connectionVerified, setConnectionVerified] = useState(Boolean(current));
  const [freshInstallerSession, setFreshInstallerSession] = useState<VerifiedInstallerSession | null>(null);
  const oauthDiscoveryStarted = useRef(false);
  const bindInFlight = useRef(false);
  const [teacherSignedIn, setTeacherSignedIn] = useState(false);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [classId, setClassId] = useState(() => readInstallerProgress(installationId)?.classId ?? "");
  const activeClassId = useRef(classId);
  activeClassId.current = classId;
  const resumedStep = useRef(step);
  const actionInFlight = useRef(false);
  const viewRevision = useRef(0);
  const currentView = () => {
    const revision = viewRevision.current;
    const projectUrl = getRuntimeSupabaseConfig()?.supabaseUrl;
    return () => isSetupActive() && revision === viewRevision.current && projectUrl === getRuntimeSupabaseConfig()?.supabaseUrl;
  };
  const [className, setClassName] = useState("");
  const [students, setStudents] = useState<TeacherStudentRow[]>([]);
  const [bulkNames, setBulkNames] = useState("");
  const pendingStudentBatch = useRef<Array<{ name: string; studentNo: number }> | null>(null);
  const [newStudents, setNewStudents] = useState<Array<{ name: string; studentNo: number | null; pin: string }>>([]);
  const [studentSmokeVerified, setStudentSmokeVerified] = useState(false);
  const [installerStatus, setInstallerStatus] = useState<InstallerRemoteStatus | null>(null);
  const [installerStatusError, setInstallerStatusError] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState<"session" | "mismatch" | "revoked" | "network" | null>(null);
  /** Non-secret failing-stage/code/upstream-status text for the "network"
   * branch, shown directly on screen so a 502 can be reported back without
   * anyone needing to open the browser's DevTools Network tab. */
  const [connectionIssueDetail, setConnectionIssueDetail] = useState("");
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [temporaryPat, setTemporaryPat] = useState("");
  const [useTemporaryPat, setUseTemporaryPat] = useState(false);
  const [oauthAuthorized, setOauthAuthorized] = useState(false);
  const [oauthProjects, setOauthProjects] = useState<InstallerAccessibleProject[] | null>(null);
  const [selectedProjectRef, setSelectedProjectRef] = useState("");
  const [boundProjectLabel, setBoundProjectLabel] = useState("");
  /** True from mount until the OAuth grant this page just received has been
   * used to rediscover/rebind a project (or has failed to). While true, the
   * ordinary status-check effect must not run: it would otherwise fire
   * against whatever stale projectRef is still sitting in localStorage from
   * a previous connection and misreport a fresh grant as "session expired". */
  const [oauthCallbackPending, setOauthCallbackPending] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("oauth") === "granted");
  const [teacherAccountMode, setTeacherAccountMode] = useState<"choose" | "create" | "login">("choose");
  const [teacherAccountBusy, setTeacherAccountBusy] = useState(false);
  const [installerDetails, setInstallerDetails] = useState<InstallerStatusResponse | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<InstallerRecoveryPlanResponse | null>(null);
  const [recoveryDetailsOpen, setRecoveryDetailsOpen] = useState(false);
  const [recoveryPlanExpired, setRecoveryPlanExpired] = useState(false);
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

  const clearRecoveryPlan = () => {
    setRecoveryResult(null); setRecoveryDetailsOpen(false); setRecoveryPlanExpired(false);
  };
  useEffect(() => {
    clearRecoveryPlan();
  }, [step, supabaseUrl]);
  useEffect(() => {
    const expiry = recoveryResult?.plan ? Date.parse(recoveryResult.plan.expiresAt) : NaN;
    if (!Number.isFinite(expiry)) return;
    const remaining = expiry - Date.now();
    if (remaining <= 0) { setRecoveryPlanExpired(true); return; }
    const timer = setTimeout(() => setRecoveryPlanExpired(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [recoveryResult]);

  const persistStep = (next: InstallerStep, extra: Partial<{ classId: string; className: string; studentCount: number }> = {}) => {
    viewRevision.current += 1;
    setStep(next);
    if (installationId.trim()) saveInstallerProgress({ installationId: installationId.trim(), step: next, classId: classId || undefined, ...extra, updatedAt: new Date().toISOString() });
  };

  useEffect(() => {
    if (!installerClient || oauthDiscoveryStarted.current) return;
    oauthDiscoveryStarted.current = true;
    const params = new URLSearchParams(window.location.search);
    const justGranted = params.get("oauth") === "granted";
    if (justGranted) {
      console.log("OAUTH_CALLBACK_RETURNED");
      window.history.replaceState(null, "", window.location.pathname);
      persistStep(3);
      console.log("OAUTH_GRANT_AVAILABLE");
      // A fresh grant always supersedes any stale "connected" flag left over
      // from a previous project/session in localStorage -- rediscovering
      // through THIS grant must run regardless of what connectionVerified
      // says, or a fresh OAuth round trip silently does nothing.
      void loadOAuthProjects(true).finally(() => setOauthCallbackPending(false));
      return;
    }
    if (returnToTeacher) {
      // A reload may retain a grant OR an already-bound cookie. Local config
      // alone cannot resume an update or navigate away.
      void loadOAuthProjects(true, true);
      return;
    }
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
    void getSupabase().auth.getSession().then(({ data }) => {
      if (!active) return;
      setTeacherSignedIn(Boolean(data.session));
      if (data.session && step === 6) {
        const pending = readInstallerClassDraft(installationId, data.session.user.id);
        if (pending) setClassName(pending.name);
      }
      if (!data.session && step >= 6) {
        // Keep the saved destination/class, but require teacher authentication
        // before loading their data after a reload or expired session.
        resumedStep.current = step;
        setTeacherAccountMode("login"); setStep(5);
        setMessage("교사 로그인을 다시 확인하면 선택한 학급에서 이어서 진행합니다.");
      }
    }).catch(() => { if (active) setError("교사 로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요."); });
    return () => { active = false; };
  }, [step, connectionVerified]);

  useEffect(() => {
    if (step < 6 || !teacherSignedIn) return;
    let active = true;
    void teacherListClasses().then((payload) => {
      if (!active || !isSetupActive()) return;
      setClasses(payload.classes);
      if (classId && !payload.classes.some(item => item.id === classId)) {
        activeClassId.current = ""; setClassId(""); setStudents([]); setNewStudents([]); setStudentSmokeVerified(false);
        persistStep(6, { classId: "" });
        setError("이전에 선택한 학급을 현재 교사 계정에서 찾을 수 없습니다. 학급을 다시 선택해 주세요.");
      } else if (!classId && payload.classes[0]) {
        activeClassId.current = payload.classes[0].id; setClassId(payload.classes[0].id);
      }
    }).catch(() => { if (active) setError("학급 목록을 불러오지 못했습니다. 교사 권한과 설치 상태를 확인해 주세요."); });
    return () => { active = false; };
  }, [step, teacherSignedIn, classId]);

  useEffect(() => {
    if (!classId || !teacherSignedIn) return;
    let active = true;
    const stillCurrent = currentView();
    void teacherListStudents(classId).then((payload) => {
      if (active && stillCurrent() && activeClassId.current === classId) setStudents(payload.students);
    }).catch(() => { if (active && stillCurrent()) setError("학생 목록을 불러오지 못했습니다. 학급을 다시 선택해 주세요."); });
    return () => { active = false; };
  }, [classId, teacherSignedIn, step]);

  const selectClass = (nextId: string) => {
    viewRevision.current += 1;
    activeClassId.current = nextId; setClassId(nextId);
    setStudents([]); setNewStudents([]); setStudentSmokeVerified(false); setBulkNames(""); pendingStudentBatch.current = null;
    persistStep(6, { classId: nextId });
  };

  useEffect(() => {
    // Also runs on step 3: a persisted "connected" config from a past visit
    // says nothing about whether today's installer session still exists --
    // only the server does. Re-checking here (not just on step 4) is what
    // lets step 3 stop showing a stale "연결 완료" once that session is gone.
    //
    // Suppressed while oauthCallbackPending: a status call against whatever
    // stale projectRef is still in localStorage would otherwise race the
    // grant -> project discovery -> bind flow above and misreport a brand
    // new OAuth grant as an expired session before binding ever gets a
    // chance to run.
    if (oauthCallbackPending || returnToTeacher || (step !== 3 && step !== 4) || !connectionVerified || !installerClient) return;
    let active = true;
    void checkInstallerConnection(() => active);
    return () => { active = false; };
  }, [oauthCallbackPending, returnToTeacher, connectionVerified, installerClient, runtimeConfig?.supabasePublishableKey, step, supabaseUrl, vite.environment]);

  const finishVerifiedReconnect = async (verified: VerifiedInstallerSession) => {
    if (!installerClient || !returnToTeacher || !isSetupActive()) return;
    await completeInstallerReconnect(installerClient, verified);
    finishTeacherReconnect();
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setMessage(null);
    if (actionInFlight.current) return;
    const stillCurrent = currentView();
    const config: RuntimeSupabaseConfig = { installationId: installationId.trim(), supabaseUrl: supabaseUrl.trim(), supabasePublishableKey: publishableKey.trim() };
    if (!validateRuntimeSupabaseConfig(config)) { setError("HTTPS 형식의 Supabase URL, 공개 Publishable Key, 설치 ID를 확인해 주세요."); return; }
    actionInFlight.current = true;
    setBusy(true);
    try { await checkSupabaseConnection(config.supabaseUrl, config.supabasePublishableKey); if (!stillCurrent()) return; saveRuntimeSupabaseConfig(config); if (!hasInstallerResumeUpdate() && finishTeacherReconnect()) return; setConnectionVerified(true); setPublishableKey(""); setMessage("Supabase 연결을 확인했어요."); persistStep(4); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Supabase 연결을 확인하지 못했습니다."); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const installerTarget = () => ({ projectRef: projectRefFromUrl(supabaseUrl) ?? "", projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" });
  /** Server is the source of truth for whether this session's credential
   * still works -- never inferred from a client-only flag. Used both by the
   * step 4 mount effect and by the "연결 다시 확인" button, so a manual
   * retry re-checks the same way instead of just navigating away. */
  const checkInstallerConnection = async (isActive: () => boolean = () => true) => {
    if (!installerClient) return;
    const stillCurrent = currentView();
    const projectRef = projectRefFromUrl(supabaseUrl);
    if (!projectRef) return;
    setInstallerStatusError(false); setConnectionIssue(null); setConnectionIssueDetail("");
    try {
      const result = await installerClient.getStatus({ projectRef, projectUrl: supabaseUrl.trim(), publishableKey: runtimeConfig?.supabasePublishableKey, release: "spatial-math-v1" });
      if (!isActive() || !stillCurrent()) return;
      console.log("STATUS_AFTER_BIND");
      setInstallerStatus(result.status); setInstallerDetails(result); setOauthAuthorized(true);
      if (step === 3) persistStep(4);
    } catch (reason) {
      if (!isActive() || !stillCurrent()) return;
      if (reason instanceof InstallerClientError && reason.code === "INSTALLER_MANUAL_REVIEW_REQUIRED") {
        setInstallerStatus("DRIFT_REQUIRES_REVIEW"); setError("자동 업데이트로 변경하기 전에 확인이 필요합니다."); return;
      }
      setInstallerStatus(null); setInstallerStatusError(true);
      if (reason instanceof InstallerClientError && (reason.code === "INSTALLER_AUTH_REQUIRED" || reason.code === "INSTALLER_SESSION_REQUIRED")) {
        setOauthAuthorized(false); setConnectionIssue("session");
      } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_TARGET_MISMATCH") {
        setConnectionIssue("mismatch");
      } else if (reason instanceof InstallerClientError && reason.upstreamStatus === 401) {
        // The installer session cookie itself is still valid, but the OAuth
        // access token it holds was rejected by Supabase (expired or the
        // teacher revoked the app) -- this is not a transient network blip,
        // and "다시 확인" would just get 401 again forever. Only a fresh
        // OAuth authorize actually fixes it.
        setOauthAuthorized(false); setConnectionIssue("revoked");
      } else {
        setConnectionIssue("network");
        if (reason instanceof InstallerClientError) {
          const parts = [reason.stage ? `단계: ${reason.stage}` : null, reason.upstreamStatus ? `업스트림 상태: ${reason.upstreamStatus}` : null, `코드: ${reason.code}`].filter(Boolean);
          setConnectionIssueDetail(parts.join(" · "));
        }
      }
    }
  };
  const recheckInstallerConnection = async () => {
    if (checkingConnection || actionInFlight.current) return;
    const stillCurrent = currentView();
    setCheckingConnection(true);
    try {
      if (returnToTeacher && installerClient) {
        const verified = await verifyInstallerSession(installerClient, freshInstallerSession?.target ?? installerTarget());
        await checkSupabaseConnection(verified.target.projectUrl, verified.target.publishableKey ?? "");
        if (!stillCurrent()) return;
        setFreshInstallerSession(verified);
        await finishVerifiedReconnect(verified);
      } else await checkInstallerConnection();
    } catch (reason) { if (stillCurrent()) installerFailure(reason); }
    finally { if (isSetupActive()) setCheckingConnection(false); }
  };
  const installerFailure = (reason: unknown) => {
    if (reason instanceof InstallerClientError && reason.code === 'INSTALLER_EXISTING_PROJECT_FORBIDDEN') {
      setError('현재 로그인한 Supabase 계정에서는 기존 프로젝트에 접근할 수 없습니다. 처음 설치할 때 사용한 Supabase 계정으로 다시 로그인해 주세요.');
    } else if (reason instanceof InstallerClientError && reason.code === 'INSTALLER_EXISTING_PROJECT_NOT_FOUND') {
      setError('기존 설치 정보에 해당하는 프로젝트를 확인하지 못했습니다. 기존 프로젝트를 만든 Supabase 계정과 설치 링크를 확인해 주세요.');
    } else if (reason instanceof InstallerClientError && reason.code === 'INSTALLER_EXISTING_CONFIG_INVALID') {
      setError('기존 설치 정보의 프로젝트 주소가 일치하지 않습니다. 기존 설치 링크를 확인해 주세요.');
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_MANUAL_REVIEW_REQUIRED") {
      setInstallerStatus("DRIFT_REQUIRES_REVIEW");
      setError("자동 업데이트로 변경하기 전에 확인이 필요합니다.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_PROJECT_NOT_ALLOWED") {
      setError("선택한 프로젝트에 대한 설치 권한이 없어요. 다른 프로젝트를 선택하거나 다시 연결해 주세요.");
    } else if (reason instanceof InstallerClientError && reason.status === 401) {
      setInstallerStatus(null);
      setInstallerDetails(null); setOauthAuthorized(false); setConnectionIssue("session");
      setError("연결 세션이 저장되지 않았거나 권한이 만료되었습니다. Supabase를 다시 연결해 주세요.");
    } else if (reason instanceof InstallerClientError && (reason.code.startsWith("INSTALLER_PUBLIC_KEY_") || reason.code === "INSTALLER_KEY_RESPONSE_INVALID" || ["INSTALLER_TARGET_MISMATCH", "INSTALLER_PUBLIC_CONFIG_MISSING", "INSTALLER_STATUS_UNVERIFIED", "INSTALLER_UPDATE_INCOMPLETE", "INSTALLER_UPDATE_UNVERIFIED"].includes(reason.code))) {
      setError(reason.message);
    } else if (reason instanceof InstallerClientError && ["INSTALLER_RECOVERY_PLAN_EXPIRED", "INSTALLER_RECOVERY_STATE_CHANGED"].includes(reason.code)) {
      clearRecoveryPlan();
      setError("복구 계획이 만료되었거나 확인한 설치 상태가 달라졌습니다. 기존 자료를 초기화하지 말고 ‘설치 문제 자동 진단’으로 다시 확인해 주세요.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_RECOVERY_VERIFY_REQUIRED") {
      clearRecoveryPlan();
      setError("복구 요청 후 완료 상태를 확인하지 못했습니다. 다시 승인하지 말고 ‘설치 확인’으로 결과를 확인해 주세요. 기존 자료를 삭제하거나 초기화하지 마세요.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_RECOVERY_APPROVAL_REQUIRED") {
      clearRecoveryPlan(); setError("복구 내용을 확인한 뒤 승인해야 합니다. 자동 변경은 하지 않았습니다.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_RECOVERY_BUSY") {
      setError("다른 창에서 복구를 진행하고 있습니다. 다시 실행하지 말고 ‘설치 확인’으로 결과를 확인해 주세요.");
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_REQUEST_TIMEOUT") {
      setError(reason.message);
    } else if (reason instanceof InstallerClientError && reason.code === "INSTALLER_BUSY") {
      setError("다른 창에서 이 프로젝트를 설치 중이에요. 잠시 후 상태를 확인해 주세요.");
    } else setError("설치 요청을 완료하지 못했어요. 상태 확인 후 이어서 복구해 주세요. 진단: " + (reason instanceof InstallerClientError ? reason.code : "INSTALLER_REQUEST_FAILED"));
  };
  const refreshInstallerStatus = async () => {
    if (!installerClient) return;
    const stillCurrent = currentView();
    const result = await installerClient.getStatus(installerTarget());
    if (!stillCurrent()) return;
    setInstallerStatus(result.status); setInstallerDetails(result); setInstallerStatusError(false);
    if (result.status !== "DRIFT_REQUIRES_REVIEW") clearRecoveryPlan();
  };
  const connectInstallerAuthorization = async (event: FormEvent) => {
    event.preventDefault();
    if (!installerClient || authorizing || actionInFlight.current || !temporaryPat.trim()) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setAuthorizing(true); setError(null); setMessage(null);
    const pat = temporaryPat.trim(); setTemporaryPat("");
    try {
      await installerClient.createSession(installerTarget());
      if (!stillCurrent()) return;
      await installerClient.provideTemporaryCredential(pat);
      if (!stillCurrent()) return;
      await refreshInstallerStatus();
      if (!stillCurrent()) return;
      setMessage("설치 권한을 연결했어요. 대상과 상태를 확인하고 설치해 주세요.");
    } catch (reason) { if (stillCurrent()) installerFailure(reason); }
    finally { actionInFlight.current = false; if (isSetupActive()) setAuthorizing(false); }
  };
  const startOAuthConnect = async () => {
    // TEMP diagnostic (no secrets): proves whether a real browser click ever
    // reaches this function at all, independent of whether the authorize
    // network request shows up -- remove once live reconnect is confirmed.
    console.log("RECONNECT_CLICK_HANDLER_ENTERED");
    if (authorizing || actionInFlight.current) return;
    clearRecoveryPlan();
    const stillCurrent = currentView();
    if (!installerClient) { setError("설치 서버 연결 정보를 찾을 수 없어요. 페이지를 새로고침한 뒤 다시 시도해 주세요."); return; }
    setAuthorizing(true); setError(null); setMessage(null);
    try {
      if (current && await restoreExistingSession()) return;
      const { authorizeUrl } = await installerClient.beginAuthorization();
      if (stillCurrent()) window.location.assign(authorizeUrl);
    } catch (reason) {
      if (!stillCurrent()) return;
      if (reason instanceof InstallerClientError && reason.status === 501) { setUseTemporaryPat(true); persistStep(3); }
      else setError("Supabase 연결을 시작하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      // Always clears, even on the success path: if navigation is ever
      // blocked or delayed by the browser, this must not leave the button
      // permanently disabled by a stale authorizing=true for the rest of
      // this page's lifetime.
      setAuthorizing(false);
    }
  };
  /** OAuth grant list is re-fetched on every mount (not just the one-time
   * redirect back) so a plain reload while the grant cookie is still live
   * restores the picker instead of stranding the teacher on a dead screen. */
  const restoreExistingSession = async (): Promise<boolean> => {
    if (!installerClient || !current) return false;
    const target = existingInstallerTarget(current);
    if (!target) return false;
    let verified: VerifiedInstallerSession;
    try { verified = await verifyInstallerSession(installerClient, { ...target, publishableKey: current.supabasePublishableKey }); }
    catch (reason) {
      if (reason instanceof InstallerClientError && (reason.status === 401 || reason.upstreamStatus === 401 || reason.code === 'INSTALLER_TARGET_MISMATCH')) return false;
      throw reason;
    }
    await checkSupabaseConnection(current.supabaseUrl, current.supabasePublishableKey);
    if (!isSetupActive()) return true;
    setFreshInstallerSession(verified); setInstallerStatus(verified.status.status); setInstallerDetails(verified.status);
    setInstallerStatusError(false); setOauthAuthorized(true); setConnectionIssue(null); setOauthProjects(null);
    if (returnToTeacher) await finishVerifiedReconnect(verified);
    else persistStep(4);
    return true;
  };
  const loadOAuthProjects = async (autoBind: boolean, restoreSession = false) => {
    if (!installerClient) return;
    console.log("PROJECTS_LOAD_STARTED");
    setBusy(true); setError(null);
    try {
      if ((restoreSession || !oauthCallbackPending) && current && await restoreExistingSession()) return;
      const result = await installerClient.listAccessibleProjects(existingInstallerTarget(current));
      if (!isSetupActive()) return;
      if (!result.projects.length) {
        setOauthProjects([]);
        if (current) setError('현재 로그인한 Supabase 계정에서는 기존 프로젝트를 확인할 수 없습니다. 처음 설치할 때 사용한 Supabase 계정으로 다시 로그인해 주세요.');
        return;
      }
      console.log("PROJECTS_LOAD_SUCCESS");
      setOauthProjects(result.projects);
      // If the project this browser was previously connected to is still in
      // this grant's accessible list, rebind it automatically instead of
      // making the teacher re-pick something they already chose once.
      const previousRef = projectRefFromUrl(supabaseUrl);
      const previousMatch = previousRef ? result.projects.find((project) => project.ref === previousRef) : undefined;
      const defaultProject = previousMatch ?? result.projects[0];
      setSelectedProjectRef(defaultProject.ref);
      if (autoBind && (previousMatch || result.projects.length === 1)) {
        console.log("PROJECT_AUTO_BIND_STARTED");
        await bindOAuthProject(defaultProject);
      }
    } catch (reason) {
      // A 401 here just means no OAuth grant is active yet (or it expired) --
      // that is the normal state before connecting, not an error to surface.
      if (!isSetupActive()) return;
      if (current || returnToTeacher || oauthCallbackPending) {
        installerFailure(reason);
      } else if (!(reason instanceof InstallerClientError && reason.status === 401)) {
        setError("Supabase 연결은 됐지만 프로젝트 목록을 불러오지 못했습니다. 다시 연결해 주세요.");
      }
    } finally { setBusy(false); }
  };
  const bindOAuthProject = async (project: InstallerAccessibleProject) => {
    // Discovery owns busy=true too: using that flag as a guard here can
    // silently skip auto-bind. A separate ref excludes only duplicate binds.
    if (!installerClient || bindInFlight.current) return;
    bindInFlight.current = true;
    setBusy(true); setError(null); setMessage(null); setFreshInstallerSession(null);
    try {
      const verified = await bindInstallerOAuthProject(installerClient, project, installationId.trim(),
        current ? projectRefFromUrl(current.supabaseUrl) : null, checkSupabaseConnection, current);
      if (!isSetupActive()) return;
      saveRuntimeSupabaseConfig(verified.config);
      setSupabaseUrl(verified.config.supabaseUrl); setConnectionVerified(true); setOauthAuthorized(true); setOauthProjects(null);
      setFreshInstallerSession(verified);
      setInstallerStatus(verified.status.status); setInstallerDetails(verified.status); setInstallerStatusError(false);
      setBoundProjectLabel(project.name ?? project.ref);
      console.log("PROJECT_AUTO_BIND_SUCCESS");
      if (returnToTeacher) {
        await finishVerifiedReconnect(verified);
        return;
      }
      setMessage("선택한 프로젝트에 연결하고 설치 권한도 받았어요.");
      persistStep(4);
    } catch (reason) { installerFailure(reason); }
    finally { bindInFlight.current = false; setBusy(false); }
  };
  const selectOAuthProject = () => {
    const project = oauthProjects?.find((item) => item.ref === selectedProjectRef);
    if (project) void bindOAuthProject(project);
  };
  const runInstallerAction = async (action: "install" | "repair" | "update" | "status" | "revoke") => {
    if (!installerClient || actionInFlight.current || busy) return;
    clearRecoveryPlan();
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setBusy(true); setError(null); setMessage(null);
    try {
      if (action === "revoke") {
        await installerClient.revoke();
        if (!stillCurrent()) return;
        setInstallerStatus(null); setInstallerDetails(null); setOauthAuthorized(false); setFreshInstallerSession(null); setConnectionIssue("session");
        setMessage("설치 서버에 맡긴 권한을 해제했어요. Supabase에서 토큰도 폐기할 수 있어요."); return;
      }
      if (action !== "status") {
        if (installerStatus === "DRIFT_REQUIRES_REVIEW") throw new InstallerClientError("INSTALLER_MANUAL_REVIEW_REQUIRED", 409, "자동 업데이트로 변경하기 전에 확인이 필요합니다.");
        const target = installerTarget();
        await (action === "install" ? installerClient.startInstall(target) : action === "repair" ? installerClient.repair(target) : installerClient.update(target));
      }
      if (stillCurrent()) await refreshInstallerStatus();
    } catch (reason) { if (stillCurrent()) installerFailure(reason); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const diagnoseRecovery = async () => {
    if (!installerClient || actionInFlight.current || busy) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    clearRecoveryPlan(); setBusy(true); setError(null); setMessage(null);
    try {
      const result = await installerClient.getRecoveryPlan(installerTarget());
      if (!stillCurrent()) return;
      const plan = result.plan;
      const validPlan = plan && plan.projectRef === projectRefFromUrl(supabaseUrl) && plan.preservesStudentData === true
        && plan.changes.length > 0 && Number.isFinite(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) > Date.now();
      // A data conflict cannot be relabelled as an ACL repair in the browser.
      if (installerDetails?.databaseReview?.reason.startsWith('DATA_EVIDENCE_')) {
        setRecoveryResult({ recoverable: false, reason: 'DATA_REVIEW_REQUIRED' });
      } else if (result.recoverable && !validPlan) {
        setRecoveryResult({ recoverable: false, reason: 'RECOVERY_UNAVAILABLE' });
      } else setRecoveryResult(result);
    } catch (reason) { if (stillCurrent()) installerFailure(reason); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const approveRecovery = async () => {
    const plan = recoveryResult?.plan;
    if (!installerClient || actionInFlight.current || busy || !recoveryResult?.recoverable || !plan || !recoveryDetailsOpen
      || recoveryPlanExpired || Date.parse(plan.expiresAt) <= Date.now() || plan.projectRef !== projectRefFromUrl(supabaseUrl)
      || installerStatus !== "DRIFT_REQUIRES_REVIEW" || installerDetails?.databaseReview?.reason.startsWith('DATA_EVIDENCE_')) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    // Consume the displayed consent locally too. An uncertain response requires
    // a status read or a newly inspected plan, never an automatic replay.
    clearRecoveryPlan(); setBusy(true); setError(null); setMessage(null);
    try {
      const result = await installerClient.executeRecovery(plan.id);
      if (!stillCurrent()) return;
      if (result.status !== "COMPLETE") throw new InstallerClientError("INSTALLER_RECOVERY_VERIFY_REQUIRED", 409, "복구 후 확인이 필요합니다.");
      await refreshInstallerStatus();
      if (stillCurrent()) setMessage("승인한 접근 권한의 복구를 마쳤습니다. 기존 학급과 학생 기록은 유지했습니다. 설치 확인 결과에 따라 계속 진행해 주세요.");
    } catch (reason) { if (stillCurrent()) installerFailure(reason); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const teacherRequestFailure = (reason: unknown, message: string) => {
    if (reason instanceof StudentApiError && reason.status === 401) {
      resumedStep.current = step;
      viewRevision.current += 1;
      setTeacherSignedIn(false); setClasses([]); setStudents([]); setNewStudents([]); setStudentSmokeVerified(false);
      setTeacherAccountMode("login"); setStep(5);
      setError("교사 로그인이 만료되었습니다. 다시 로그인하면 기존 학급에서 이어서 진행합니다.");
    } else setError(message);
  };

  const loginTeacher = async (event: FormEvent) => {
    event.preventDefault();
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setBusy(true); setError(null);
    try {
      const { data, error: authError } = await getSupabase().auth.signInWithPassword({ email: teacherEmail.trim(), password: teacherPassword });
      if (!stillCurrent()) return;
      if (authError || !data.session) throw authError ?? new Error("session missing");
      setTeacherSignedIn(true); setTeacherPassword(""); setMessage("교사 로그인이 확인됐어요.");
      persistStep(resumedStep.current >= 6 ? resumedStep.current : 6);
    } catch (reason) { if (stillCurrent()) setError(friendlyAuthError(reason)); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const createTeacherAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!installerClient || actionInFlight.current) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setTeacherAccountBusy(true); setError(null); setMessage(null);
    try {
      const result = await installerClient.createTeacherAccount(teacherEmail.trim(), teacherPassword);
      if (!stillCurrent()) return;
      if (result.alreadyExists) { setMessage("이미 있는 계정이에요. 아래에서 로그인해 주세요."); setTeacherAccountMode("login"); return; }
      setMessage("교사 계정을 만들었어요. 이제 같은 정보로 로그인해 주세요.");
      setTeacherAccountMode("login");
    } catch (reason) {
      if (!stillCurrent()) return;
      if (reason instanceof InstallerClientError && (reason.status === 401 || reason.code === "INSTALLER_REQUEST_TIMEOUT")) installerFailure(reason);
      else setError("교사 계정을 만들지 못했어요. 이메일 형식과 8자 이상 비밀번호를 확인해 주세요.");
    } finally { actionInFlight.current = false; if (isSetupActive()) setTeacherAccountBusy(false); }
  };

  const loadClasses = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setBusy(true); setError(null);
    try {
      const payload = await teacherListClasses();
      if (!stillCurrent()) return;
      setClasses(payload.classes);
      if (!classId && payload.classes[0]) { activeClassId.current = payload.classes[0].id; setClassId(payload.classes[0].id); }
    } catch (reason) { if (stillCurrent()) teacherRequestFailure(reason, "학급 목록을 불러오지 못했습니다."); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const createClass = async (event: FormEvent) => {
    event.preventDefault(); if (!className.trim() || actionInFlight.current) return;
    actionInFlight.current = true;
    const stillCurrent = currentView();
    setBusy(true); setError(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      if (!stillCurrent()) return;
      if (!data.session) throw new StudentApiError("TEACHER_AUTH", "교사 로그인이 필요합니다.", 401);
      const teacherId = data.session.user.id;
      const draft = getOrCreateInstallerClassDraft(installationId, teacherId, className, () =>
        Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join(""));
      const owned = await teacherListClasses();
      if (!stillCurrent()) return;
      const prior = owned.classes.find(item => item.class_code === draft.classCode);
      if (prior && prior.name !== draft.name) throw new Error("INSTALLER_CLASS_DRAFT_CONFLICT");
      const result = prior ? { class: prior } : await teacherUpsertClass({ name: draft.name, classCode: draft.classCode });
      if (!stillCurrent()) return;
      if (!result.class || result.class.class_code !== draft.classCode || result.class.name !== draft.name) throw new Error("INSTALLER_CLASS_RESULT_UNVERIFIED");
      clearInstallerClassDraft(installationId, teacherId, draft.classCode);
      setClasses((items) => [...items.filter(item => item.id !== result.class!.id), result.class!]);
      activeClassId.current = result.class.id; setClassId(result.class.id);
      setStudents([]); setNewStudents([]); setStudentSmokeVerified(false);
      setMessage(`“${result.class.name}” 학급을 만들었어요. 학급 코드: ${result.class.class_code}`); setClassName("");
      persistStep(7, { classId: result.class.id, className: result.class.name, studentCount: 0 });
    } catch (reason) { if (stillCurrent()) teacherRequestFailure(reason, "학급 생성 결과를 확인하지 못했습니다. 같은 학급 이름으로 다시 누르면 생성된 학급부터 확인합니다. 이름을 바꾸지 말고 학급 목록도 확인해 주세요."); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const createStudents = async () => {
    if (!classId || !namesPreview.length || actionInFlight.current) return;
    actionInFlight.current = true;
    const viewIsCurrent = currentView();
    const stillCurrent = () => viewIsCurrent() && activeClassId.current === classId;
    setBusy(true); setError(null); setMessage(null); setStudentSmokeVerified(false);
    try {
      // Keep the original name+number pair across partial retries. Names alone
      // are not identities: two pupils may share a name with different numbers.
      const batch = pendingStudentBatch.current ?? namesPreview.map((name, index) => ({ name, studentNo: index + 1 }));
      pendingStudentBatch.current = batch;
      // Re-read after an interrupted/unknown request before sending a create.
      const before = await teacherListStudents(classId);
      if (!stillCurrent()) return;
      setStudents(before.students);
      const remaining = batch.filter(candidate => !before.students.some(student => student.name === candidate.name && student.student_no === candidate.studentNo));
      pendingStudentBatch.current = remaining;
      setBulkNames(remaining.map(student => student.name).join("\n"));
      let createdCount = 0;
      for (const candidate of remaining) {
        if (!stillCurrent()) return;
        const result = await teacherCreateStudent(classId, candidate.name, candidate.studentNo);
        if (!stillCurrent()) return;
        createdCount++;
        setNewStudents(items => [...items, { name: result.student.name, studentNo: result.student.studentNo, pin: result.pinPlain }]);
        // Preserve each successful result immediately; a later failure must
        // not lose its PIN or leave this name in the pending submission.
        pendingStudentBatch.current = pendingStudentBatch.current!.filter(item => item !== candidate);
        setBulkNames(pendingStudentBatch.current.map(student => student.name).join("\n"));
      }
      const refreshed = await teacherListStudents(classId);
      if (!stillCurrent()) return;
      setStudents(refreshed.students);
      pendingStudentBatch.current = null;
      setMessage(`${createdCount}명의 학생을 추가했어요. 이미 등록된 같은 이름·번호의 학생은 보존했습니다.`);
      persistStep(7, { classId, className: selectedClass?.name, studentCount: refreshed.students.length });
    } catch (reason) { if (stillCurrent()) teacherRequestFailure(reason, "명단 추가가 중단됐습니다. 이미 만든 학생은 보존했습니다. 다시 누르면 현재 명단을 확인하고 남은 이름·번호만 추가합니다."); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
  };

  const verifyStudentSmoke = async () => {
    if (actionInFlight.current) return;
    const createdCandidate = newStudents[0];
    const existingCandidate = students.find((student) => student.pinPlain);
    const candidateName = createdCandidate?.name ?? existingCandidate?.name;
    const candidatePin = createdCandidate?.pin ?? existingCandidate?.pinPlain;
    const candidateNo = createdCandidate?.studentNo ?? existingCandidate?.student_no;
    if (!candidateName || !candidatePin || !selectedClass) { setError("학생 한 명을 먼저 준비해 주세요."); return; }
    actionInFlight.current = true;
    const viewIsCurrent = currentView();
    const stillCurrent = () => viewIsCurrent() && activeClassId.current === classId;
    setBusy(true); setError(null);
    try {
      const result = await loginStudent({ classCode: selectedClass.class_code, name: candidateName, pin: candidatePin, studentNo: candidateNo });
      if (!stillCurrent()) return;
      if (!("token" in result)) throw new Error("학생 로그인 확인에 번호 선택이 필요합니다.");
      // The smoke token is never persisted: a shared-device student's session
      // must not be overwritten or cleared by the teacher's setup check.
      setStudentSmokeVerified(true); setMessage("학생 로그인 확인이 끝났어요. PIN은 저장하지 않았습니다.");
    } catch { if (stillCurrent()) setError("학생 로그인 확인에 실패했습니다. 학생 PIN과 학급 코드를 확인해 주세요."); }
    finally { actionInFlight.current = false; if (isSetupActive()) setBusy(false); }
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
          {oauthProjects ? <>
            <p>설치할 Supabase 프로젝트를 선택하세요.</p>
            {oauthProjects.length ? <>
              <label className="label" htmlFor="installer-project-select">내 Supabase 프로젝트<select id="installer-project-select" className="field" value={selectedProjectRef} onChange={event => setSelectedProjectRef(event.target.value)}>{oauthProjects.map(project => <option value={project.ref} key={project.ref}>{project.name ?? project.ref}{project.region ? ` · ${project.region}` : ""}</option>)}</select></label>
              <button className="btn btn-primary" disabled={busy || !selectedProjectRef} onClick={() => selectOAuthProject()}>{busy ? "연결 중…" : "이 프로젝트 사용"}</button>
            </> : !current && <p className="notice">선택할 수 있는 프로젝트가 없어요. Supabase에서 먼저 프로젝트를 만든 뒤 다시 연결해 주세요.</p>}
          </> : connectionVerified ? (
            // A persisted "connected" config says nothing about whether
            // today's installer session still exists on the server -- only
            // checkInstallerConnection's live result does. Never show
            // "완료" from local state alone.
            oauthAuthorized ? <>
              <p className="success" role="status">Supabase 연결 완료{boundProjectLabel ? ` · ${boundProjectLabel}` : ""}</p>
              <button className="btn btn-primary" onClick={() => persistStep(4)}>자동 설치로 계속</button>
            </> : connectionIssue === "session" ? <>
              <p className="notice">설치 연결이 만료되었습니다. Supabase에 다시 연결하면 완료된 설치 내용은 그대로 유지됩니다.</p>
              <button type="button" className="btn btn-primary" disabled={authorizing} onClick={startOAuthConnect}>Supabase 다시 연결</button>
              {authorizing && <p className="muted" role="status">Supabase 연결을 시작하는 중...</p>}
            </> : connectionIssue === "revoked" ? <>
              <p className="notice">Supabase 연결 권한이 만료되었거나 해제되었습니다. 다시 연결하면 기존 설치 내용은 그대로 유지됩니다.</p>
              <button type="button" className="btn btn-primary" disabled={authorizing} onClick={startOAuthConnect}>Supabase 다시 연결</button>
              {authorizing && <p className="muted" role="status">Supabase 연결을 시작하는 중...</p>}
            </> : connectionIssue === "network" ? <>
              <p className="notice">설치 서버에 연결하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
              {connectionIssueDetail && <p className="muted">{connectionIssueDetail}</p>}
              <button type="button" className="btn" disabled={busy || checkingConnection} onClick={() => void recheckInstallerConnection()}>{checkingConnection ? "확인 중…" : "다시 확인"}</button>
            </> : connectionIssue === "mismatch" ? <>
              <p className="notice">선택한 프로젝트 정보가 서버와 일치하지 않아요. Supabase를 다시 연결해 주세요.</p>
              <button type="button" className="btn btn-primary" disabled={authorizing} onClick={startOAuthConnect}>Supabase 다시 연결</button>
              {authorizing && <p className="muted" role="status">Supabase 연결을 시작하는 중...</p>}
            </> : <p className="muted">설치 연결 상태를 확인하는 중이에요…</p>
          ) : <>
            <p>버튼 한 번으로 선생님의 Supabase 계정에 연결합니다. Project URL이나 키를 직접 입력하지 않아도 됩니다.</p>
            {installerClient ? <div className="stack">
              <button type="button" className="btn btn-primary" disabled={authorizing} onClick={startOAuthConnect}>Supabase 연결</button>
              {authorizing && <p className="muted" role="status">Supabase 연결을 시작하는 중...</p>}
              <p className="muted">버튼을 누르면 Supabase 로그인 화면으로 이동합니다. 이 앱은 토큰을 직접 보거나 저장하지 않습니다.</p>
            </div> : <p className="notice">이 화면에 설치 서버가 연결되지 않았습니다. 아래 개발자용 수동 연결을 사용해 주세요.</p>}
          </>}
          {error && <p className="error" role="alert">{error}</p>}
          {returnToTeacher && error && <div className="toolbar-row">
            <button type="button" className="btn" disabled={busy || checkingConnection} onClick={() => void recheckInstallerConnection()}>연결 세션 다시 확인</button>
            <button type="button" className="btn" disabled={busy || authorizing} onClick={startOAuthConnect}>Supabase 다시 연결</button>
          </div>}
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
            {oauthAuthorized ? <p className="success" role="status">설치 준비가 완료되었습니다. 별도 토큰 입력이 필요 없어요.</p> : connectionVerified && <p className="notice">
              {connectionIssue === "session" ? "설치 세션을 확인하지 못했어요. 아래 \"연결 다시 확인\"으로 재시도하고, 계속 안 되면 3단계에서 Supabase 연결을 다시 진행해 주세요."
                : connectionIssue === "revoked" ? "Supabase 연결 권한이 만료되었거나 해제되었습니다. 3단계에서 다시 연결하면 기존 설치 내용은 그대로 유지됩니다."
                : connectionIssue === "mismatch" ? "선택한 프로젝트 정보가 서버와 일치하지 않아요. 3단계에서 프로젝트를 다시 선택해 주세요."
                : connectionIssue === "network" ? "설치 서버에 연결하지 못했어요. 네트워크 상태를 확인한 뒤 아래 \"연결 다시 확인\"으로 재시도해 주세요."
                : "설치 권한을 확인하는 중이에요…"}
            </p>}
            {connectionIssue === "network" && connectionIssueDetail && <p className="muted">{connectionIssueDetail}</p>}
            {!oauthAuthorized && (connectionIssue === "session" || connectionIssue === "revoked") && <button type="button" className="btn" disabled={authorizing || busy} onClick={startOAuthConnect}>Supabase 다시 연결</button>}
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
                {installerStatus === "DRIFT_REQUIRES_REVIEW" ? <>
                  {installerDetails?.databaseReview?.reason.startsWith('DATA_EVIDENCE_') ? <>
                    <p>기존 데이터 확인이 필요합니다.</p>
                    <DataEvidenceReview review={installerDetails.databaseReview.dataEvidence} />
                  </> : <>
                    <p>기존 설치 구조 확인이 필요합니다.</p>
                    <p className="muted">설치 이력이나 데이터베이스 구조를 현재 버전의 기준과 대조하지 못해 자동 변경을 멈췄습니다. 데이터가 없다는 뜻은 아니며, 이 확인 과정에서 기존 자료를 삭제하지 않습니다.</p>
                  </>}
                  <p className="muted">프로젝트를 삭제하거나 새로 만들지 마세요. 이 화면의 진단 정보로 확인할 수 있습니다. 키·비밀번호·PIN은 보내지 마세요. 아래 ‘설치 확인’으로 다시 조회할 수 있습니다.</p>
                {installerDetails?.databaseReview && <dl aria-label="설치 진단 정보">
                    <dt>프로젝트</dt><dd>{installerDetails.project?.ref}</dd>
                    <dt>진단</dt><dd>{installerDetails.databaseReview.reason}</dd>
                    <dt>기준</dt><dd>{installerDetails.databaseReview.baseline}</dd>
                    <dt>비교 기준</dt><dd>{installerDetails.databaseReview.comparisonBaseline}</dd>
                    <dt>객체 차이</dt><dd>{installerDetails.databaseReview.objects.length}</dd>
                    <dt>진단 코드</dt><dd>DBR-{installerDetails.databaseReview.reason}</dd>
                  </dl>}
                {installerDetails?.databaseReview && installerDetails.databaseReview.objects.length > 0 && <details>
                  <summary>진단 상세</summary>
                  <ul aria-label="차이 객체 목록">{installerDetails.databaseReview.objects.map((object, index) => <li key={`${object.key}-${index}`}><code>{object.key}</code> · {object.change}{object.attributes && <span> · {object.attributes.map(attribute => `${attribute.name}: ${attribute.state === "SAME" ? "일치" : "다름"}`).join(", ")}</span>}</li>)}</ul>
                </details>}
                </> : installerDetails?.requiredMigrationCount !== undefined && <p>데이터베이스 준비: {(installerDetails.appliedMigrationCount ?? 0) + (installerDetails.satisfiedMigrationCount ?? 0)}/{installerDetails.requiredMigrationCount}</p>}
                {installerDetails?.legacyRecovery && <p>기존 설치를 확인했습니다. 기존 자료를 그대로 유지하고 최신 버전으로 준비합니다.</p>}
                {installerDetails?.functions?.map(item => <p key={item.slug}>학생 로그인 기능 ({item.slug === "student-auth" ? "인증" : "학습"}): {item.status}</p>)}
              </div>
              {installerStatus === "DRIFT_REQUIRES_REVIEW" && <section className="stack" aria-label="기존 설치 안전 복구">
                <h3>기존 설치 안전 복구</h3>
                <p>현재 프로젝트를 읽기 전용으로 확인하고, 안전하게 조정할 수 있는 접근 권한만 복구 계획으로 제시합니다. 승인 전에는 변경하지 않습니다.</p>
                <button type="button" className="btn" disabled={busy || authorizing} onClick={() => void diagnoseRecovery()}>설치 문제 자동 진단</button>
                {recoveryResult && !recoveryResult.recoverable && <p role="status">{Object.hasOwn(RECOVERY_REASON_LABELS, recoveryResult.reason) ? RECOVERY_REASON_LABELS[recoveryResult.reason] : RECOVERY_REASON_LABELS.RECOVERY_UNAVAILABLE}</p>}
                {recoveryResult?.recoverable && recoveryResult.plan && <>
                  {!recoveryPlanExpired && <p>안전하게 복구할 수 있는 접근 권한 항목을 확인했습니다. 기존 학급과 학생 기록은 유지됩니다.</p>}
                  <button type="button" className="btn" disabled={busy || recoveryPlanExpired} onClick={() => setRecoveryDetailsOpen(true)}>복구 내용 확인</button>
                  {recoveryDetailsOpen && <div className="stack" aria-label="승인할 복구 내용">
                    <p>대상 프로젝트: <strong>{recoveryResult.plan.projectRef}</strong></p>
                    <p>변경 범위: {new Set(recoveryResult.plan.changes.map(change => change.object)).size}개 항목의 접근 권한 {recoveryResult.plan.changes.length}건. 문제 내용·학생·PIN·답안·진도·작품·보상·학급 코드는 변경하지 않습니다.</p>
                    <ul>{recoveryResult.plan.changes.map((change, index) => <li key={index}>{change.kind === 'table' ? '자료' : '앱 기능'} <code>{change.object}</code> · {change.role} · {change.action === 'REVOKE' ? '불필요한 권한 회수' : '필요한 권한 복원'} ({change.privileges.join(', ')})</li>)}</ul>
                    <p>아래 버튼은 이 프로젝트의 표시된 접근 권한 변경에 동의하는 것입니다. 실행 직전에 상태를 다시 확인하며 계획과 다르면 중단합니다.</p>
                    <button type="button" className="btn btn-primary" disabled={busy || recoveryPlanExpired} onClick={() => void approveRecovery()}>복구 승인 및 진행</button>
                  </div>}
                  {recoveryPlanExpired && <p role="status">복구 계획이 만료되었습니다. ‘설치 문제 자동 진단’으로 새 계획을 확인해 주세요.</p>}
                </>}
              </section>}
              <div className="toolbar-row">
                <button className="btn btn-primary" disabled={busy || authorizing || !installerStatus || installerStatus === "DRIFT_REQUIRES_REVIEW"} onClick={() => void runInstallerAction("install")}>{busy ? "처리 중…" : installerDetails?.legacyRecovery ? "기존 설치 계속하기" : "수학 앱 설치"}</button>
                <button className="btn" disabled={busy || !installerStatus || installerStatus === "DRIFT_REQUIRES_REVIEW"} onClick={() => void runInstallerAction("repair")}>이어서 복구</button>
                <button className="btn" disabled={busy || !installerStatus || installerStatus === "DRIFT_REQUIRES_REVIEW"} onClick={() => void runInstallerAction("update")}>업데이트</button>
                <button className="btn" disabled={busy || authorizing} onClick={() => void runInstallerAction("status")}>설치 확인</button>
                <button className="btn" disabled={busy || authorizing} onClick={() => void runInstallerAction("revoke")}>설치 권한 해제</button>
              </div>
            </>}
          </> : <p className="notice">이 화면에 설치 서버가 연결되지 않았습니다. 공개 URL과 키만으로 설치를 완료할 수 없습니다.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="toolbar-row"><button className="btn" disabled={busy || checkingConnection} onClick={() => void recheckInstallerConnection()}>{checkingConnection ? "확인 중…" : "연결 다시 확인"}</button><button className="btn btn-primary" disabled={busy || installerStatus !== "INSTALLED"} onClick={() => persistStep(5)}>교사 확인으로 계속</button></div>
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
              <button className="btn btn-sm" type="button" disabled={teacherAccountBusy} onClick={() => setTeacherAccountMode("choose")}>취소</button>
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
              {installerClient && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => setTeacherAccountMode("create")}>계정이 없어요, 새로 만들기</button>}
            </div>
          </form>}
          <p className="muted">비밀번호는 저장하거나 로그에 남기지 않습니다.</p>
        </div>}

        {step === 6 && <div className="installer-card stack"><h2>우리 반 만들기</h2><p>학급 이름을 입력하면 학급 코드가 자동으로 만들어집니다.</p>{classes.length > 0 && <label className="label" htmlFor="installer-class-select">기존 학급 선택<select id="installer-class-select" className="field" value={classId} onChange={(event) => selectClass(event.target.value)} disabled={busy}>{classes.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.class_code})</option>)}</select></label>}<form className="toolbar-row" onSubmit={createClass}><input className="field" aria-label="새 학급 이름" placeholder="예: 6학년 1반" value={className} onChange={(event) => setClassName(event.target.value)} /><button className="btn btn-primary" type="submit" disabled={busy || !className.trim()}>학급 만들기</button></form>{selectedClass && <p className="success" role="status">선택한 학급: {selectedClass.name} · 코드 {selectedClass.class_code}</p>}{error && <p className="error" role="alert">{error}</p>}<button className="btn" disabled={!classId || busy} onClick={() => persistStep(7, { classId, className: selectedClass?.name, studentCount: students.length })}>학생 만들기로 계속</button><button className="btn btn-sm" onClick={() => void loadClasses()} disabled={busy}>학급 목록 새로고침</button></div>}

        {step === 7 && <div className="installer-card stack"><h2>학생 만들기</h2><p>{selectedClass ? `${selectedClass.name} 학생 명단을 붙여 넣어 주세요.` : "먼저 학급을 선택해 주세요."}</p><textarea disabled={busy} className="field installer-textarea" aria-label="학생 명단" placeholder="한 줄에 한 명씩 또는 쉼표로 입력" value={bulkNames} onChange={(event) => { pendingStudentBatch.current = null; setBulkNames(event.target.value); }} />{namesPreview.length > 0 && <p className="muted">{namesPreview.length}명 준비: {namesPreview.join(", ")}</p>}<button className="btn btn-primary" disabled={busy || !classId || !namesPreview.length} onClick={() => void createStudents()}>학생 계정 만들기</button>{students.length > 0 && <p className="success" role="status">현재 학급 학생 {students.length}명</p>}{error && <p className="error" role="alert">{error}</p>}<div className="toolbar-row"><button className="btn" disabled={busy} onClick={() => persistStep(6)}>학급 다시 선택</button><button className="btn btn-sm" disabled={busy || (!newStudents.length && !students.some((student) => student.pinPlain))} onClick={() => void verifyStudentSmoke()}>학생 로그인 확인</button>{(newStudents.length > 0 || students.length > 0) && <button className="btn btn-primary" disabled={!studentSmokeVerified} onClick={() => persistStep(8, { classId, className: selectedClass?.name, studentCount: students.length })}>완료 화면으로</button>}</div>{newStudents.length > 0 && <div className="pin-list" aria-label="새 학생 PIN 목록"><h3>이번에 만든 학생 PIN</h3>{newStudents.map((student) => <p key={`${student.name}-${student.studentNo}`}><strong>{student.studentNo ?? ""}번 {student.name}</strong><code>{student.pin}</code></p>)}<p className="muted">이 목록을 필요한 곳에 안전하게 전달한 뒤, 창을 닫으면 다시 표시되지 않습니다.</p></div>}</div>}

        {step === 8 && <div className="installer-card stack"><h2>설치 준비가 끝났어요</h2><div className="installer-checks"><p>✓ Supabase 연결</p><p>✓ 교사 로그인</p><p>✓ 학급 {selectedClass?.name ?? "선택됨"}</p><p>✓ 학생 계정 {students.length}명</p><p>{studentSmokeVerified ? "✓ 학생 로그인 확인" : "○ 학생 로그인 확인 필요"}</p></div>{classLink && <div className="class-link-card"><strong>학생 접속 링크</strong><a href={classLink}>{classLink}</a><button className="btn btn-sm" onClick={() => void copyClassLink()}>링크 복사</button><p className="muted">이 링크를 QR 생성기에 넣어 학급 QR로 배부할 수 있습니다.</p></div>}<p className="notice">이 웹앱에서 확인한 것은 연결·교사 인증·학급·학생 준비입니다. 자동 설치 상태와 별도로 학생의 첫 학습 저장·재접속 복원을 확인해야 수업 준비가 끝납니다.</p><div className="toolbar-row"><button className="btn btn-primary" onClick={() => navigate("/teacher")}>교사 화면 열기</button><Link className="btn" to="/">학생 화면 미리보기</Link><button className="btn btn-sm" onClick={() => persistStep(7)}>학생 로그인 확인으로 돌아가기</button><button className="btn btn-sm" onClick={resetWizard}>설정 상태 다시 확인</button></div><p className="muted">학생은 학급 링크 또는 QR로 접속해 이름과 PIN만 입력하면 됩니다.</p></div>}

        {message && <p className="success" role="status">{message}</p>}
        <footer className="installer-footer"><Link to="/teacher">교사 화면</Link><span>·</span><button className="link-button" disabled={busy || teacherAccountBusy || authorizing} onClick={() => persistStep(3)}>설정 확인 / 복구</button></footer>
      </section>
    </main>
  );
}
