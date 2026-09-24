import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Teacher Page Expansion Phase 3A (실시간 수업 현황) + 3B (저장/연결 상태).
// Aggregation correctness is covered by tests/teacher-sessions.test.ts
// (unit) and tests/teacher-live-status-db.test.ts (PGlite, real ownership
// scoping + RLS boundary). This file covers what's only checkable by
// reading the actual shipped source: privacy of the select(), polling
// lifecycle, and conservative wording.

test("teacher:sessions:list verifies teacherOwnsClass before touching any data", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const sessionsBody = edge.match(/if \(action === "teacher:sessions:list"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(sessionsBody, "teacher:sessions:list handler must exist");
  assert.match(sessionsBody!, /teacherOwnsClass\(db, teacherId, classId\)/);
});

test("sb_student_sessions is selected with an explicit column list that excludes token_hash and id (never leak session credentials)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const sessionsBody = edge.match(/if \(action === "teacher:sessions:list"\) \{[\s\S]*?\n {4}\}/)?.[0];
  const selectCall = sessionsBody!.match(/\.from\("sb_student_sessions"\)\.select\("([^"]*)"\)/)?.[1];
  assert.equal(selectCall, "student_id,issued_at,expires_at,revoked", "must select exactly these columns, no token_hash/id");
});

test("P. teacher:sessions:list doesn't loop per-student -- one bulk .in(studentIds) query per table", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const sessionsBody = edge.match(/if \(action === "teacher:sessions:list"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.match(sessionsBody!, /\.in\("student_id", studentIds\)/);
  assert.doesNotMatch(sessionsBody!, /studentIds\.map\(async/, "must not fire one request per student");
});

test("E. the sessions polling effect returns a cleanup that clears the interval and guards against setting state after unmount", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const effectBody = page.match(/useEffect\(\(\) => \{\s*if \(!classId\) \{ setSessionsStudents\(\[\]\); return; \}[\s\S]*?\n {2}\}, \[classId, loadSessions\]\);/)?.[0];
  assert.ok(effectBody, "sessions polling effect must exist");
  assert.match(effectBody!, /const intervalId = setInterval\(poll, 10000\);/, "must poll at 10s per spec");
  assert.match(effectBody!, /return \(\) => \{ cancelled = true; clearInterval\(intervalId\); \};/, "cleanup must clear the interval on unmount/classId change");
  assert.match(effectBody!, /if \(document\.hidden\) return;/, "must skip fetching while the tab is backgrounded");
});

test("F. a compact server-connection indicator is derived from the sessions poll's own success/failure -- no separate new health endpoint", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const loadSessionsBody = page.match(/const loadSessions = useCallback\(async \(targetClassId: string\) => \{[\s\S]*?\n {2}\}, \[\]\);/)?.[0];
  assert.ok(loadSessionsBody);
  assert.match(loadSessionsBody!, /setServerHealthy\(true\);/);
  assert.match(loadSessionsBody!, /setServerHealthy\(false\);/);
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  assert.doesNotMatch(edge, /"teacher:health"|"teacher:ping"/, "no separate new health/ping action was added");
});

test("G. a manual 상태 새로고침 button re-triggers the sessions fetch immediately (not just waiting for the next 10s tick)", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /상태 새로고침/);
  const liveStatusSection = page.match(/<section className="panel stack" id="live-status">[\s\S]*?<\/section>/)?.[0];
  assert.ok(liveStatusSection);
  assert.match(liveStatusSection!, /onClick=\{\(\) => classId && void loadSessions\(classId\)\}/);
});

test("H. stale-activity wording is conservative -- '저장 실패' is never asserted outright, only '상태 확인'/'저장 기록이 없습니다' style language", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /최근 저장 기록이 없습니다/);
  assert.doesNotMatch(page, /저장 실패/, "must never assert save failure outright, per the conservative-wording requirement");
  assert.doesNotMatch(page, /"?접속 중"?(?!\s*추정)/, "raw '접속 중' without '추정' would overclaim live presence");
});

test("sessions failures render inside the live-status section only, via their own error state -- never the shared page-level error", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /const \[sessionsError, setSessionsError\]/);
  const liveStatusSection = page.match(/<section className="panel stack" id="live-status">[\s\S]*?<\/section>/)?.[0];
  assert.match(liveStatusSection!, /\{sessionsError \? <p className="error" role="alert">/);
  const loadSessionsBody = page.match(/const loadSessions = useCallback\(async \(targetClassId: string\) => \{[\s\S]*?\n {2}\}, \[\]\);/)?.[0];
  assert.doesNotMatch(loadSessionsBody!, /setError\(/);
});

test("R. Phase 1/2 features remain present and untouched: problem bank toggle, peer moderation, progress table, class-wide reset", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /<h3>문제은행 관리<\/h3>/);
  assert.match(page, /<h3>학생 진도<\/h3>/);
  assert.match(page, /<h4>학급 전체 진도 초기화<\/h4>/);
  assert.match(page, /teacherSetProblemActive\(problem\.id, !problem\.active\)/);
  assert.match(page, /teacherResetClassProgress\(classId, lesson\)/);
  const activities = await readSource("../src/features/activities/TeacherActivities.tsx");
  assert.match(activities, /<h3>친구 문제 관리<\/h3>/);
});
