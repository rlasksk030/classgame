import TeacherActivities from "../features/activities/TeacherActivities";
import { getSupabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { classifyTeacherError } from "../lib/teacherErrors";
import { classifyClassCreateError } from "../lib/classCreateErrors";
import { encodeInstallationConfig, getResolvedSupabaseConfig } from "../lib/config";
import { summarizeClassLiveStatus, type LiveStatus } from "../../shared/teacherSessions.ts";

import {
  teacherCreateStudent,
  teacherUpsertClass,
  teacherUpdateStudent,
  teacherListClasses,
  teacherListLessonSettings,
  teacherListProblems,
  teacherListStudents,
  teacherProgressSummary,
  teacherResetClassProgress,
  teacherResetStudentPin,
  teacherResultsSummary,
  teacherSessionsList,
  teacherSetLessonLock,
  teacherSetProblemActive,
  teacherToggleStudent,
  type ClassData,
  type LessonProgressState,
  type LessonResultSummary,
  type LessonSettingRow,
  type StudentLiveStatus,
  type TeacherProblem,
  type TeacherProgressStudentRow,
  type TeacherStudentRow,
} from "../lib/studentApi";

const LESSON_STATE_LABEL: Record<LessonProgressState, string> = {
  not_started: "미시작",
  in_progress: "진행 중",
  complete: "완료",
};

const LIVE_STATUS_LABEL: Record<LiveStatus, string> = {
  active: "접속 중 추정",
  recent: "최근 활동",
  session_only: "로그인 세션 있음",
  offline: "로그인 세션 없음",
};

const STALE_ACTIVITY_MIN = 15;

/** 학생 1명의 전체 진행 상태를 3단계로 요약한다 (12차시 완료 = 전체 과정 완료로 간주). */
function studentOverallStatus(row: TeacherProgressStudentRow): LessonProgressState {
  const anyProgress = row.lessonStates.some((s) => s !== "not_started");
  if (!anyProgress) return "not_started";
  if (row.lessonStates[11] === "complete") return "complete";
  return "in_progress";
}

function formatLastActivity(iso: string | null): string {
  if (!iso) return "기록 없음";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 교사용 관리자 최소 화면(핵심 기능): 반 조회 + 반별 학생/차시 잠금 관리.
 * 나머지 고급 편집은 다음 단계로 이어질 수 있습니다.
 */
export default function TeacherPage() {
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<TeacherStudentRow[]>([]);
  const [lessons, setLessons] = useState<LessonSettingRow[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classCreateError, setClassCreateError] = useState<{ code: string; message: string } | null>(null);
  const [bulkNames, setBulkNames] = useState("");
  const [bulkPreview, setBulkPreview] = useState<string[]>([]);
  const [problems, setProblems] = useState<TeacherProblem[]>([]);
  const [builtinCount, setBuiltinCount] = useState(0);
  const [problemLessonFilter, setProblemLessonFilter] = useState<number | "all">("all");
  const [problemStatusFilter, setProblemStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [problemSearch, setProblemSearch] = useState("");
  const [progressStudents, setProgressStudents] = useState<TeacherProgressStudentRow[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressSearch, setProgressSearch] = useState("");
  const [progressLessonFilter, setProgressLessonFilter] = useState<number | "all">("all");
  const [progressStatusFilter, setProgressStatusFilter] = useState<"all" | LessonProgressState>("all");
  const [progressSort, setProgressSort] = useState<"name" | "currentLesson" | "recentActivity">("name");
  const [resetLessonScope, setResetLessonScope] = useState<"all" | number>("all");
  const [resetBusy, setResetBusy] = useState(false);
  const [sessionsStudents, setSessionsStudents] = useState<StudentLiveStatus[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [serverHealthy, setServerHealthy] = useState<boolean | null>(null);
  const [resultsLesson, setResultsLesson] = useState<number | null>(null);
  const [resultsSummary, setResultsSummary] = useState<LessonResultSummary | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const selectedClass = useMemo(() => classes.find((row) => row.id === classId) ?? null, [classes, classId]);
  const filteredProblems = useMemo(() => {
    const search = problemSearch.trim().toLowerCase();
    return problems.filter((problem) => {
      if (problemLessonFilter !== "all" && problem.lesson !== problemLessonFilter) return false;
      if (problemStatusFilter === "active" && !problem.active) return false;
      if (problemStatusFilter === "inactive" && problem.active) return false;
      if (search && !problem.title.toLowerCase().includes(search) && !problem.prompt.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [problems, problemLessonFilter, problemStatusFilter, problemSearch]);

  const progressSummary = useMemo(() => {
    let notStarted = 0, inProgress = 0, completed = 0;
    const lessonCounts = new Map<number, number>();
    let recentActivity = 0;
    let lastActivityAt: string | null = null;
    const now = Date.now();
    for (const row of progressStudents) {
      const status = studentOverallStatus(row);
      if (status === "not_started") notStarted++;
      else if (status === "complete") completed++;
      else inProgress++;
      lessonCounts.set(row.currentLesson, (lessonCounts.get(row.currentLesson) ?? 0) + 1);
      if (row.lastActivityAt) {
        if (now - new Date(row.lastActivityAt).getTime() <= 10 * 60 * 1000) recentActivity++;
        if (!lastActivityAt || row.lastActivityAt > lastActivityAt) lastActivityAt = row.lastActivityAt;
      }
    }
    let mostCommonLesson: number | null = null, mostCommonCount = 0;
    for (const [lesson, count] of lessonCounts) {
      if (count > mostCommonCount) { mostCommonCount = count; mostCommonLesson = lesson; }
    }
    return { total: progressStudents.length, notStarted, inProgress, completed, mostCommonLesson, recentActivity, lastActivityAt };
  }, [progressStudents]);

  const filteredProgressStudents = useMemo(() => {
    const search = progressSearch.trim().toLowerCase();
    const rows = progressStudents.filter((row) => {
      if (search && !row.name.toLowerCase().includes(search)) return false;
      if (progressLessonFilter !== "all" && row.currentLesson !== progressLessonFilter) return false;
      if (progressStatusFilter !== "all" && studentOverallStatus(row) !== progressStatusFilter) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      if (progressSort === "currentLesson") return b.currentLesson - a.currentLesson;
      if (progressSort === "recentActivity") return (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "");
      return a.name.localeCompare(b.name, "ko");
    });
  }, [progressStudents, progressSearch, progressLessonFilter, progressStatusFilter, progressSort]);

  const liveStatusById = useMemo(() => new Map(sessionsStudents.map((row) => [row.studentId, row])), [sessionsStudents]);
  const liveStatusSummary = useMemo(() => summarizeClassLiveStatus(sessionsStudents), [sessionsStudents]);
  const staleActivityStudents = useMemo(() => {
    const now = Date.now();
    return sessionsStudents.filter((row) => {
      if (!row.hasActiveSession) return false;
      if (!row.lastActivityAt) return true;
      return (now - new Date(row.lastActivityAt).getTime()) / 60000 > STALE_ACTIVITY_MIN;
    }).map((row) => students.find((s) => s.id === row.studentId)?.name ?? row.studentId);
  }, [sessionsStudents, students]);

  const load = async () => {
    try {
      setError(null);
      const payload = await teacherListClasses();
      setClasses(payload.classes);
      if (!classId && payload.classes.length > 0) {
        setClassId(payload.classes[0].id);
      }
    } catch (err) {
      const info = classifyTeacherError(err);
      setError(`${info.code}: ${info.message}`);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setResultsLesson(null);
    setResultsSummary(null);
  }, [classId]);

  useEffect(() => {
    if (!classId) return;

    let cancelled = false;

    const loadClassData = async () => {
      try {
        setBusy(true);
        setProgressLoading(true);
        const [studentsPayload, lessonPayload, problemPayload, progressPayload] = await Promise.all([
          teacherListStudents(classId),
          teacherListLessonSettings(classId),
          teacherListProblems(classId),
          teacherProgressSummary(classId),
        ]);
        if (cancelled) return;
        setStudents(studentsPayload.students);
        setLessons(lessonPayload.lessons);
        setProblems(problemPayload.customProblems);
        setBuiltinCount(problemPayload.builtinCount);
        setProgressStudents(progressPayload.students);
      } catch (err) {
        if (!cancelled) { const info = classifyTeacherError(err); setError(`${info.code}: ${info.message}`); }
      } finally {
        if (!cancelled) { setBusy(false); setProgressLoading(false); }
      }
    };

    loadClassData();

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const createStudent = async (event: FormEvent) => {
    event.preventDefault();
    if (!classId || !name.trim()) return;
    try {
      setBusy(true);
      const data = await teacherCreateStudent(classId, name.trim());
      setMessage(`"${data.student.name}" 학생 PIN: ${data.pinPlain}`);
      setName("");
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const resetPin = async (studentId: string) => {
    try {
      const result = await teacherResetStudentPin(classId, studentId);
      setMessage(`새 PIN: ${result.pinPlain}`);
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN 재발급 실패");
    }
  };

  const toggleStudent = async (student: TeacherStudentRow) => {
    const shouldDisable = student.status === "active";
    try {
      await teacherToggleStudent(classId, student.id, shouldDisable);
      const studentsPayload = await teacherListStudents(classId);
      setStudents(studentsPayload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 변경 실패");
    }
  };

  const toggleProblemActive = async (problem: TeacherProblem) => {
    try {
      await teacherSetProblemActive(problem.id, !problem.active);
      setProblems((await teacherListProblems(classId)).customProblems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제 상태를 변경하지 못했습니다.");
    }
  };

  const loadProgress = async () => {
    if (!classId) return;
    setProgressLoading(true);
    try {
      const payload = await teacherProgressSummary(classId);
      setProgressStudents(payload.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "진도 정보를 불러오지 못했습니다.");
    } finally {
      setProgressLoading(false);
    }
  };

  const resetClassProgress = async () => {
    if (!classId || !progressStudents.length) return;
    const lesson = resetLessonScope === "all" ? undefined : resetLessonScope;
    const scopeWarning = lesson ? `${lesson}차시 진도만 초기화됩니다.` : "모든 차시 진도와 관련 학습 기록이 초기화됩니다.";
    if (!window.confirm(`이 학급의 모든 학생 진도를 초기화할까요?\n${scopeWarning}`)) return;
    const typed = window.prompt(`학생 ${progressStudents.length}명의 학습 기록이 초기화됩니다.\n계속하려면 '초기화'를 입력하세요.`);
    if (typed !== "초기화") return;
    setResetBusy(true);
    setError(null);
    try {
      const result = await teacherResetClassProgress(classId, lesson);
      setMessage(`학생 ${result.targetedCount}명의 ${lesson ? `${lesson}차시` : "전체"} 진도를 초기화했습니다.`);
      await loadProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "학급 진도 초기화에 실패했습니다. 진도표를 새로고침해 확인해 주세요.");
    } finally {
      setResetBusy(false);
    }
  };

  // 수업 현황(Phase 3A) 전용 오류/헬스 상태 -- 이 fetch 가 실패해도 기존
  // 진도표(progressStudents)는 별도 상태이므로 함께 깨지지 않는다.
  const loadSessions = useCallback(async (targetClassId: string) => {
    try {
      const payload = await teacherSessionsList(targetClassId);
      setSessionsStudents(payload.students);
      setSessionsError(null);
      setServerHealthy(true);
      setLastSyncAt(Date.now());
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : "수업 현황을 불러오지 못했습니다.");
      setServerHealthy(false);
    }
  }, []);

  useEffect(() => {
    if (!classId) { setSessionsStudents([]); return; }
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return; // 백그라운드 탭에서는 polling을 쉰다.
      if (!cancelled) await loadSessions(classId);
    };
    void poll();
    const intervalId = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [classId, loadSessions]);

  // 수업 결과(Phase 3C)는 polling하지 않는다 -- 학급/차시 변경 또는 수동
  // 새로고침 때만 가져온다.
  const loadResults = useCallback(async (targetClassId: string, lesson: number) => {
    setResultsLoading(true);
    try {
      const payload = await teacherResultsSummary(targetClassId, lesson);
      setResultsSummary(payload.summary);
      setResultsError(null);
    } catch (err) {
      setResultsError(err instanceof Error ? err.message : "수업 결과를 불러오지 못했습니다.");
    } finally {
      setResultsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!classId || !progressStudents.length) return;
    if (resultsLesson === null) setResultsLesson(progressSummary.mostCommonLesson ?? 1);
  }, [classId, progressStudents.length, progressSummary.mostCommonLesson, resultsLesson]);

  useEffect(() => {
    if (!classId || resultsLesson === null) return;
    void loadResults(classId, resultsLesson);
  }, [classId, resultsLesson, loadResults]);

  const toggleLessonLock = async (lesson: number, locked: boolean) => {
    try {
      await teacherSetLessonLock(classId, lesson, locked);
      const lessonPayload = await teacherListLessonSettings(classId);
      setLessons(lessonPayload.lessons);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠금 변경 실패");
    }
  };
  const createClass = async () => {
    const name = window.prompt("새 학급 이름");
    if (!name?.trim()) return;
    setClassCreateError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await teacherUpsertClass({ name: name.trim() });
      if (!result.class) throw new Error("학급 생성 응답이 비어 있습니다.");
      setClassId(result.class.id);
      setMessage(`"${result.class.name}" 학급을 만들었습니다. (${result.class.class_code})`);
      await load();
    } catch (reason) {
      setClassCreateError(classifyClassCreateError(reason));
    } finally {
      setBusy(false);
    }
  };
  const setPracticeCount = async (lesson:number, count:5|10|15|20) => {
    try { const row=lessons.find(item=>item.lesson===lesson); await teacherSetLessonLock(classId,lesson,row?.locked??(lesson!==1),count); setLessons((await teacherListLessonSettings(classId)).lessons); }
    catch (err) { setError(err instanceof Error ? err.message : "추가 문제 수를 저장하지 못했습니다."); }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("클립보드에 복사했습니다.");
    } catch {
      setMessage("클립보드 복사에 실패했습니다.");
    }
  };

  const previewBulkStudents = () => {
    const names = bulkNames.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    setBulkPreview([...new Set(names)]);
  };

  const createBulkStudents = async () => {
    if (!classId || !bulkPreview.length) return;
    setBusy(true);
    try {
      for (const studentName of bulkPreview) await teacherCreateStudent(classId, studentName);
      setMessage(`${bulkPreview.length}명의 학생을 추가했습니다. PIN은 목록에서 확인할 수 있어요.`);
      setBulkNames(""); setBulkPreview([]);
      setStudents((await teacherListStudents(classId)).students);
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생 명단을 추가하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const runtimeConfig = getResolvedSupabaseConfig();
  const classLink = selectedClass && runtimeConfig
    ? `${window.location.origin}/?class=${encodeURIComponent(selectedClass.class_code)}#install=${encodeInstallationConfig(runtimeConfig)}`
    : "";

  return (
    <div className="screen app-max">
      <div className="stack" style={{ gap: 16 }}>
        <div className="student-world-heading"><div><p className="eyebrow">TEACHER CONSOLE</p><h1>교사 관리</h1><p className="muted">학급의 학습 흐름과 활동을 한곳에서 관리합니다.</p></div><div className="toolbar-row"><Link className="btn btn-sm" to="/teacher/problems/new">3D 문제 만들기</Link><Link className="btn btn-sm" to="/teacher/worksheet-import">학습지로 문제 만들기</Link></div></div>
        <nav className="teacher-nav" aria-label="교사 메뉴"><a href="#classes">대시보드</a><a href="#students">학생 관리</a><a href="#live-status">수업 현황</a><a href="#progress">학생 진도</a><a href="#results">수업 결과</a><a href="#lessons">차시 관리</a><a href="#problem-bank">문제은행 관리</a><a href="/teacher/problems/new">문제은행</a><a href="/teacher/problem-preview">문제 미리보기</a><a href="/teacher/worksheet-import">학습지</a><a href="#activities">놀이·친구 문제</a></nav>

        <section className="teacher-summary-grid" aria-label="학급 요약">
          <div className="panel"><span className="summary-label">학생 수</span><strong className="summary-number">{students.length}명</strong><p className="muted">선택한 학급</p></div>
          <div className="panel"><span className="summary-label">차시 잠금</span><strong className="summary-number">{lessons.filter((row) => row.locked).length}/12</strong><p className="muted">잠긴 차시</p></div>
          <div className="panel"><span className="summary-label">현재 학급</span><strong className="summary-number">{selectedClass?.name ?? "선택 전"}</strong><p className="muted">{selectedClass?.class_code ?? "학급을 만들어 주세요."}</p></div>
          <div className="panel"><span className="summary-label">미시작</span><strong className="summary-number">{progressSummary.notStarted}명</strong><p className="muted">아직 시작 전</p></div>
          <div className="panel"><span className="summary-label">진행 중</span><strong className="summary-number">{progressSummary.inProgress}명</strong><p className="muted">학습 진행 중</p></div>
          <div className="panel"><span className="summary-label">완료</span><strong className="summary-number">{progressSummary.completed}명</strong><p className="muted">12차시까지 완료</p></div>
          <div className="panel"><span className="summary-label">가장 많이 학습 중인 차시</span><strong className="summary-number">{progressSummary.mostCommonLesson ? `${progressSummary.mostCommonLesson}차시` : "—"}</strong><p className="muted">학생 수 기준</p></div>
          <div className="panel"><span className="summary-label">최근 활동</span><strong className="summary-number">{progressSummary.recentActivity}명</strong><p className="muted">최근 10분 이내 학습 기록{progressSummary.lastActivityAt ? ` · 마지막 ${formatLastActivity(progressSummary.lastActivityAt)}` : ""}</p></div>
        </section>

        <div className="toolbar-row"><a className="btn btn-sm" href="#live-status">수업 현황 보기</a><a className="btn btn-sm" href="#progress">학생 진도 보기</a><a className="btn btn-sm" href="#results">수업 결과 보기</a><a className="btn btn-sm" href="#lessons">차시 설정</a><a className="btn btn-sm" href="#students">학생 관리</a></div>

        <section className="panel stack" id="live-status">
          <h3>수업 현황</h3>
          <div className="toolbar-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span className={`server-health-dot ${serverHealthy === false ? "bad" : serverHealthy === true ? "ok" : ""}`}>
              {serverHealthy === false ? "상태 확인 실패" : serverHealthy === true ? "서버 연결 정상" : "확인 중…"}
            </span>
            <span className="muted">{lastSyncAt ? `마지막 갱신 ${formatLastActivity(new Date(lastSyncAt).toISOString())}` : "아직 갱신 전"}</span>
            <button className="btn btn-sm" type="button" onClick={() => classId && void loadSessions(classId)}>상태 새로고침</button>
          </div>
          {sessionsError ? <p className="error" role="alert">수업 현황을 불러오지 못했습니다.</p> : (
            <div className="teacher-summary-grid" aria-label="수업 현황 요약">
              <div className="panel"><span className="summary-label">접속 중 추정</span><strong className="summary-number">{liveStatusSummary.estimatedActive}명</strong><p className="muted">세션 + 최근 5분 활동</p></div>
              <div className="panel"><span className="summary-label">최근 5분 활동</span><strong className="summary-number">{liveStatusSummary.activeWithin5Min}명</strong><p className="muted">최근 학습 기록 기준</p></div>
              <div className="panel"><span className="summary-label">최근 10분 활동</span><strong className="summary-number">{liveStatusSummary.activeWithin10Min}명</strong><p className="muted">최근 학습 기록 기준</p></div>
              <div className="panel"><span className="summary-label">로그인 세션 없음</span><strong className="summary-number">{liveStatusSummary.noSession}명</strong><p className="muted">로그아웃 또는 세션 만료</p></div>
            </div>
          )}
          {staleActivityStudents.length > 0 ? (
            <p className="muted">상태 확인이 필요한 학생: {staleActivityStudents.join(", ")} — 최근 저장 기록이 없습니다.</p>
          ) : null}
        </section>

        <section className="panel stack" id="classes">
          <h3>반 선택</h3>
          <button className="btn" disabled={busy} onClick={() => void createClass()}>새 학급 만들기</button>
          {classCreateError ? <p className="error" role="alert">{classCreateError.code}: {classCreateError.message}</p> : null}
          <div className="toolbar-row" style={{ alignItems: "center" }}>
            <select
              className="field"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              aria-label="반 선택"
            >
              {classes.length === 0 ? (
                <option value="">반 없음</option>
              ) : (
                classes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.class_code})
                  </option>
                ))
              )}
            </select>
            <button className="btn btn-sm" type="button" onClick={load}>
              새로고침
            </button>
          </div>
          {selectedClass ? <>
            <p className="muted">선택 반: {selectedClass.name} · 학급 코드 {selectedClass.class_code}</p>
            {classLink ? <div className="class-link-box"><code>{classLink}</code><button className="btn btn-sm" type="button" onClick={() => void copyText(classLink)}>학생 링크 복사</button><p className="muted">링크를 누르면 설치 설정과 학급 코드가 함께 열립니다. QR 이미지는 별도 생성 도구에서 추가할 수 있어요.</p></div> : null}
          </> : <p className="muted">반을 선택해 주세요.</p>}
        </section>

        <section className="panel stack" id="students">
          <h3>학생 PIN 관리</h3>
          <div className="toolbar-row"><button className="btn" disabled={!students.length} onClick={()=>void copyText(students.map(s=>`${s.name}\t${s.pinPlain}`).join("\n"))}>전체 PIN 복사</button><button className="btn btn-sm" type="button" disabled={!students.length} onClick={() => window.print()}>학생 로그인표 인쇄</button></div>
          <form className="toolbar-row" onSubmit={createStudent}>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 학생 이름"
              required
            />
            <button className="btn" type="submit" disabled={busy || !classId || !name.trim()}>
              학생 추가
            </button>
          </form>

          <div className="teacher-table-wrap">
            <table className="teacher-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>PIN</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td><Link to={`/teacher/students/${student.id}`}>{student.name} · 기록 보기</Link></td>
                    <td>
                      <button className="btn btn-sm" type="button" onClick={() => copyText(student.pinPlain)}>
                        {student.pinPlain || "(준비중)"}
                      </button>
                    </td>
            <td>{student.status === "active" ? "사용 중" : "사용 중지"}</td>
                    <td className="toolbar-row">
                      <button className="btn btn-sm" onClick={async()=>{const name=window.prompt("학생 이름",student.name);if(!name?.trim())return;try{await teacherUpdateStudent(classId,student.id,{name:name.trim()});setStudents((await teacherListStudents(classId)).students);}catch{setError("이름을 수정하지 못했습니다.");}}}>이름 수정</button>
                      <button className="btn btn-sm" onClick={async()=>{if(!window.confirm(`${student.name} 학생을 삭제할까요?\n학생을 삭제하면 이 학생의 진도, 문제 풀이 기록, 저장된 활동 기록도 함께 삭제됩니다.`))return;const {error}=await getSupabase().from("sb_students").delete().eq("id",student.id).eq("class_id",classId);if(error){setError("삭제하지 못했습니다.");return;}setStudents(students.filter(s=>s.id!==student.id));}}>삭제</button>
                      <button className="btn btn-sm" type="button" onClick={() => resetPin(student.id)}>
                        PIN 재발급
                      </button>
                <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => toggleStudent(student)}
                        disabled={busy}
                      >
                        {student.status === "active" ? "비활성" : "활성"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="bulk-students">
            <summary>학생 여러 명 한 번에 추가</summary>
            <p className="muted">이름을 한 줄에 하나씩 붙여 넣으세요. 같은 명단의 중복 이름은 자동으로 한 번만 추가합니다.</p>
            <textarea className="field" rows={4} value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} placeholder="김민수\n이서윤\n박지호" />
            <div className="toolbar-row"><button className="btn btn-sm" type="button" onClick={previewBulkStudents} disabled={!bulkNames.trim()}>명단 미리보기</button>{bulkPreview.length ? <button className="btn btn-sm btn-primary" type="button" onClick={() => void createBulkStudents()} disabled={busy}>{bulkPreview.length}명 생성</button> : null}</div>
            {bulkPreview.length ? <p className="muted">추가할 학생: {bulkPreview.join(", ")}</p> : null}
          </details>
        </section>

        <section className="panel stack" id="progress">
          <h3>학생 진도</h3>
          <p className="muted">한 화면에서 학생별 1~12차시 상태를 확인합니다. 오답/문제 기록 등 세부 내용은 학생 이름을 눌러 기존 학생 상세에서 확인하세요.</p>
          <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
            <input className="field" placeholder="이름 검색" value={progressSearch} onChange={(e) => setProgressSearch(e.target.value)} />
            <select className="field" aria-label="현재 차시 필터" value={progressLessonFilter} onChange={(e) => setProgressLessonFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">전체 차시</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((lesson) => <option key={lesson} value={lesson}>{lesson}차시</option>)}
            </select>
            <select className="field" aria-label="상태 필터" value={progressStatusFilter} onChange={(e) => setProgressStatusFilter(e.target.value as "all" | LessonProgressState)}>
              <option value="all">전체 상태</option>
              <option value="not_started">미시작</option>
              <option value="in_progress">진행 중</option>
              <option value="complete">완료</option>
            </select>
            <select className="field" aria-label="정렬" value={progressSort} onChange={(e) => setProgressSort(e.target.value as "name" | "currentLesson" | "recentActivity")}>
              <option value="name">이름순</option>
              <option value="currentLesson">현재 차시순</option>
              <option value="recentActivity">최근 활동순</option>
            </select>
          </div>

          {progressLoading ? (
            <p className="muted">불러오는 중…</p>
          ) : filteredProgressStudents.length === 0 ? (
            <p className="muted">{progressStudents.length === 0 ? "학생이 없습니다." : "필터에 맞는 학생이 없습니다."}</p>
          ) : (
            <div className="teacher-table-wrap">
              <table className="teacher-table">
                <thead>
                  <tr>
                    <th className="sticky-col">이름</th>
                    <th>상태</th>
                    <th className="sticky-col">현재 차시</th>
                    <th>1~12차시</th>
                    <th>필수 진행</th>
                    <th>오답 수</th>
                    <th>선택 연습</th>
                    <th>최근 활동</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProgressStudents.map((row) => {
                    const live = liveStatusById.get(row.studentId);
                    return (
                    <tr key={row.studentId}>
                      <td className="sticky-col"><Link to={`/teacher/students/${row.studentId}`}>{row.name}</Link></td>
                      <td>
                        <span className="live-dot" data-state={live?.indicator ?? "off"} title={live ? LIVE_STATUS_LABEL[live.status] : "확인 중"}>
                          {live?.indicator === "on" ? "●" : "○"}
                        </span>
                      </td>
                      <td className="sticky-col">{row.currentLesson}차시</td>
                      <td>
                        <div className="lesson-state-row">
                          {row.lessonStates.map((state, index) => (
                            <span key={index} className="lesson-state-cell" data-state={state} title={`${index + 1}차시 · ${LESSON_STATE_LABEL[state]}`}>
                              {index + 1}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{row.requiredProgress.completedLessons}/{row.requiredProgress.totalLessons}</td>
                      <td>{row.wrongCount}</td>
                      <td>{row.optionalPracticeCount}</td>
                      <td>{formatLastActivity(row.lastActivityAt)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="stack" style={{ marginTop: 12, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
            <h4>학급 전체 진도 초기화</h4>
            <p className="muted">이 학급 학생 전원의 진도를 한 번에 초기화합니다. 되돌릴 수 없으니 운영 중인 실제 학급에서는 신중하게 사용하세요.</p>
            <div className="toolbar-row">
              <select className="field" aria-label="초기화 범위" value={resetLessonScope} onChange={(e) => setResetLessonScope(e.target.value === "all" ? "all" : Number(e.target.value))}>
                <option value="all">전체 차시</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((lesson) => <option key={lesson} value={lesson}>{lesson}차시만</option>)}
              </select>
              <button className="btn btn-danger" disabled={resetBusy || !progressStudents.length} onClick={() => void resetClassProgress()}>
                {resetBusy ? "초기화 중…" : "학급 전체 초기화"}
              </button>
            </div>
          </div>
        </section>

        <section className="panel stack" id="results">
          <h3>수업 결과</h3>
          <div className="toolbar-row" style={{ alignItems: "center" }}>
            <label className="muted">차시 선택
              <select className="field" aria-label="결과 차시 선택" value={resultsLesson ?? ""} onChange={(e) => setResultsLesson(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((lesson) => <option key={lesson} value={lesson}>{lesson}차시</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="button" disabled={resultsLoading || resultsLesson === null} onClick={() => classId && resultsLesson !== null && void loadResults(classId, resultsLesson)}>
              결과 새로고침
            </button>
          </div>

          {resultsError ? <p className="error" role="alert">수업 결과를 불러오지 못했습니다.</p> : resultsLoading ? (
            <p className="muted">불러오는 중…</p>
          ) : resultsSummary ? (
            <div className="stack">
              <div className="teacher-summary-grid" aria-label="수업 결과 요약">
                <div className="panel"><span className="summary-label">참여 학생</span><strong className="summary-number">{resultsSummary.participatedStudents}/{resultsSummary.totalStudents}</strong><p className="muted">이 차시를 시도한 학생</p></div>
                <div className="panel"><span className="summary-label">완료</span><strong className="summary-number">{resultsSummary.completedStudents}명</strong><p className="muted">완료율 {resultsSummary.completionRate}%</p></div>
                <div className="panel"><span className="summary-label">평균 오답</span><strong className="summary-number">{resultsSummary.averageWrongCount}회</strong><p className="muted">참여 학생 기준</p></div>
                <div className="panel"><span className="summary-label">선택 연습 참여</span><strong className="summary-number">{resultsSummary.optionalPracticeParticipants}명</strong><p className="muted">{resultsSummary.optionalPracticeAttempts}회 시도</p></div>
              </div>
              {resultsSummary.problemTypeStats.length > 0 ? (
                <div className="stack">
                  <h4>많이 어려워한 유형</h4>
                  <ol>
                    {resultsSummary.problemTypeStats.slice(0, 3).map((stat) => (
                      <li key={stat.problemType}>{stat.label} — 오답률 {stat.wrongRate}% ({stat.wrongAttempts}/{stat.attempts}회)</li>
                    ))}
                  </ol>
                </div>
              ) : <p className="muted">아직 이 차시를 시도한 기록이 없습니다.</p>}
            </div>
          ) : <p className="muted">차시를 선택하면 결과가 표시됩니다.</p>}
        </section>

        <section className="panel stack" id="lessons">
          <h3>차시 잠금</h3><div className="toolbar-row">{[true,false].map(locked=><button className="btn" key={String(locked)} disabled={!classId||busy} onClick={async()=>{setBusy(true);try{for(let lesson=1;lesson<=12;lesson++)await teacherSetLessonLock(classId,lesson,locked);setLessons((await teacherListLessonSettings(classId)).lessons);}catch{setError("일부 차시 설정에 실패했습니다. 새로고침해 확인해 주세요.");}finally{setBusy(false);}}}>{locked?"전체 잠금":"전체 해제"}</button>)}</div>
          <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
            {lessons.map((row) => (
              <span key={`${row.lesson}`} className="toolbar-row">
              <button
                className={`btn btn-sm ${row.locked ? "btn-danger" : "btn-primary"}`}
                onClick={() => toggleLessonLock(row.lesson, !row.locked)}
              >
                {row.lesson}차시 {row.locked ? "잠금" : "해제"}
                </button>
                <label className="muted">추가 문제 <select className="field" aria-label={`${row.lesson}차시 추가 문제 수`} value={row.practice_count??''} onChange={e=>{const value=Number(e.target.value);if([5,10,15,20].includes(value))void setPracticeCount(row.lesson,value as 5|10|15|20);}}><option value="">권장</option>{[5,10,15,20].map(n=><option key={n} value={n}>{n}문제</option>)}</select></label>
              </span>
            ))}
          </div>
        </section>

        <section className="panel stack" id="problem-bank">
          <h3>문제은행 관리</h3>
          <p className="muted">직접 만든 문제를 켜고 끌 수 있어요. 기본 제공 문제 {builtinCount}개는 여기서 관리하지 않습니다.</p>
          <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
            <select className="field" aria-label="차시 필터" value={problemLessonFilter} onChange={(e) => setProblemLessonFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">전체 차시</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((lesson) => <option key={lesson} value={lesson}>{lesson}차시</option>)}
            </select>
            <select className="field" aria-label="상태 필터" value={problemStatusFilter} onChange={(e) => setProblemStatusFilter(e.target.value as "all" | "active" | "inactive")}>
              <option value="all">전체 상태</option>
              <option value="active">사용 중</option>
              <option value="inactive">사용 안 함</option>
            </select>
            <input className="field" placeholder="제목/내용 검색" value={problemSearch} onChange={(e) => setProblemSearch(e.target.value)} />
          </div>
          {problems.length === 0 ? (
            <p className="muted">아직 직접 만든 문제가 없습니다. "문제은행" 메뉴에서 새 문제를 만들 수 있어요.</p>
          ) : (
            <div className="teacher-table-wrap">
              <table className="teacher-table">
                <thead><tr><th>제목</th><th>차시</th><th>유형</th><th>상태</th><th>작업</th></tr></thead>
                <tbody>
                  {filteredProblems.map((problem) => (
                    <tr key={problem.id}>
                      <td>{problem.title || "(제목 없음)"}</td>
                      <td>{problem.lesson}차시</td>
                      <td>{problem.problemType}</td>
                      <td>{problem.active ? "사용 중" : "사용 안 함"}</td>
                      <td>
                        <button className="btn btn-sm" type="button" onClick={() => void toggleProblemActive(problem)}>
                          {problem.active ? "비활성으로 전환" : "활성으로 전환"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProblems.length === 0 ? <p className="muted">필터에 맞는 문제가 없습니다.</p> : null}
            </div>
          )}
        </section>

        <TeacherActivities classId={classId} students={students}/>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </div>
  );
}
