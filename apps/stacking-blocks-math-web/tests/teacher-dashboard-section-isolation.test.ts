import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Reported live: AC8YU (14 real students) showed 0 students, 0 progress,
// and a separate 수업 현황 failure. Root cause found by source inspection:
// TeacherPage's class-data boot effect combined 4 independent fetches
// (students/lessons/problems/progress) into a single Promise.all. If ANY
// one rejected, the whole try/catch's setStudents/setLessons/setProblems/
// setProgressStudents calls were skipped entirely -- a successful
// students:list fetch with 14 real rows was silently discarded because,
// say, progress:summary failed, leaving `students` at its initial []
// forever. This file verifies (via source inspection, since this repo has
// no jsdom/RTL harness -- see tests/teacher-live-status-source.test.ts for
// the same pattern) that each section now loads and fails independently.

async function readSource(): Promise<string> {
  return readFile(new URL("../src/pages/TeacherPage.tsx", import.meta.url), "utf8");
}

function loadClassDataEffect(source: string): string {
  const m = source.match(/useEffect\(\(\) => \{\s*if \(!classId\) return;[\s\S]*?\n {2}\}, \[classId\]\);/);
  assert.ok(m, "class-data boot effect not found");
  return m![0];
}

test("A/B/C. the four class-data fetches (students/lessons/problems/progress) are combined with Promise.allSettled, not Promise.all -- one rejection can never discard another section's successful data", async () => {
  const effect = loadClassDataEffect(await readSource());
  assert.match(effect, /Promise\.allSettled\(\[/);
  assert.doesNotMatch(effect, /await Promise\.all\(\[/, "the old all-or-nothing Promise.all must be gone");
});

test("A/B/C. each of the 4 results is checked independently (fulfilled -> set data, rejected -> set that section's own error only)", async () => {
  const effect = loadClassDataEffect(await readSource());
  assert.match(effect, /if \(studentsResult\.status === "fulfilled"\) setStudents\(studentsResult\.value\.students\);/);
  assert.match(effect, /else setStudentsError\(classifyTeacherError\(studentsResult\.reason\)\);/);
  assert.match(effect, /if \(lessonsResult\.status === "fulfilled"\) setLessons\(lessonsResult\.value\.lessons\);/);
  assert.match(effect, /else setLessonsError\(classifyTeacherError\(lessonsResult\.reason\)\);/);
  assert.match(effect, /setProblems\(problemsResult\.value\.customProblems\);/);
  assert.match(effect, /else setProblemsError\(classifyTeacherError\(problemsResult\.reason\)\);/);
  assert.match(effect, /if \(progressResult\.status === "fulfilled"\) setProgressStudents\(progressResult\.value\.students\);/);
  assert.match(effect, /else setProgressSummaryError\(classifyTeacherError\(progressResult\.reason\)\);/);
});

test("D. teacher:sessions:list (수업 현황) lives in its own separate useEffect (loadSessions/serverHealthy), never touched by or coupled to the class-data load -- a students/progress/etc failure structurally cannot affect it and vice versa", async () => {
  const source = await readSource();
  const sessionsEffect = source.match(/useEffect\(\(\) => \{\s*if \(!classId\) \{ setSessionsStudents\(\[\]\); return; \}[\s\S]*?\n {2}\}, \[classId, loadSessions\]\);/);
  assert.ok(sessionsEffect, "sessions polling effect not found");
  assert.doesNotMatch(sessionsEffect![0], /setStudents\(|setProgressStudents\(|setLessons\(|setProblems\(/, "sessions effect must not touch dashboard data state");
  const classDataEffect = loadClassDataEffect(source);
  assert.doesNotMatch(classDataEffect, /setSessionsStudents|setServerHealthy|loadSessions/, "class-data effect must not touch sessions state");
});

test("E/F. the dashboard summary reads students.length directly with no floor/fallback that would hide a real 0 or a real 14 -- whatever teacher:students:list actually returned is what renders", async () => {
  const source = await readSource();
  assert.match(source, /\{studentsError \? "확인 실패" : classDataLoading \? "불러오는 중…" : `\$\{students\.length\}명`\}/);
});

test("G. while the class-data load is in flight (classDataLoading), the summary cards show a loading label, never a bare 0/empty value that could be mistaken for a real zero", async () => {
  const source = await readSource();
  assert.match(source, /const \[classDataLoading, setClassDataLoading\] = useState\(false\);/);
  assert.match(source, /setClassDataLoading\(true\);/);
  assert.match(source, /setClassDataLoading\(false\);/);
  // every one of the 4-section-dependent summary cards checks classDataLoading before falling through to a number
  const summarySection = source.match(/<section className="teacher-summary-grid" aria-label="학급 요약">[\s\S]*?<\/section>/)?.[0];
  assert.ok(summarySection);
  const loadingChecks = summarySection!.match(/classDataLoading \? "불러오는 중…"/g) ?? [];
  assert.ok(loadingChecks.length >= 6, `expected the loading label on at least the 6 data-dependent cards, found ${loadingChecks.length}`);
});

test("H. selecting a class resets all 4 sections' data AND error state synchronously before the new fetch starts, so a previous class's numbers (or a previous failure) never bleed into the newly selected class's view", async () => {
  const effect = loadClassDataEffect(await readSource());
  assert.match(effect, /setStudents\(\[\]\); setLessons\(\[\]\); setProblems\(\[\]\); setBuiltinCount\(0\); setProgressStudents\(\[\]\);/);
  assert.match(effect, /setStudentsError\(null\); setLessonsError\(null\); setProblemsError\(null\); setProgressSummaryError\(null\);/);
});

test("each section's error is also surfaced inline in that section (학생 관리/학생 진도/차시 잠금/문제은행), not only in the summary cards", async () => {
  const source = await readSource();
  const studentsSection = source.match(/<section className="panel stack" id="students">[\s\S]*?학생 로그인표 인쇄/)?.[0];
  assert.match(studentsSection!, /\{studentsError && <p className="error" role="alert">학생 목록을 불러오지 못했습니다: \{studentsError\.message\}<\/p>\}/);
  const progressSection = source.match(/<section className="panel stack" id="progress">[\s\S]*?오답\/문제 기록/)?.[0];
  assert.match(progressSection!, /\{progressSummaryError && <p className="error" role="alert">진도 정보를 불러오지 못했습니다: \{progressSummaryError\.message\}<\/p>\}/);
  const lessonsSection = source.match(/<section className="panel stack" id="lessons">[\s\S]*?전체 잠금/)?.[0];
  assert.match(lessonsSection!, /\{lessonsError && <p className="error" role="alert">차시 설정을 불러오지 못했습니다: \{lessonsError\.message\}<\/p>\}/);
  const bankSection = source.match(/<section className="panel stack" id="problem-bank">[\s\S]*?기본 제공 문제/)?.[0];
  assert.match(bankSection!, /\{problemsError && <p className="error" role="alert">문제은행 정보를 불러오지 못했습니다: \{problemsError\.message\}<\/p>\}/);
});
