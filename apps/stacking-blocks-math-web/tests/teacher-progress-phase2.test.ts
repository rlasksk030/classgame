import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Teacher Page Expansion Phase 2: student progress table (2A), dashboard
// summary extension (2B) and class-wide reset (2C). Server-side aggregation
// correctness is covered by tests/teacher-progress-summary.test.ts (unit,
// imports the real shared/teacherProgress.ts) and
// tests/teacher-class-reset.test.ts (PGlite, exercises the real delete
// rules against real PostgreSQL). This file covers the parts that are only
// meaningfully checkable by reading the actual shipped source: security
// guards, wiring, and non-regression of existing features.

test("B/I. both new teacher:progress actions verify requireTeacher + teacherOwnsClass before touching any data", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const summaryBody = edge.match(/if \(action === "teacher:progress:summary"\) \{[\s\S]*?\n {4}\}/)?.[0];
  const resetBody = edge.match(/if \(action === "teacher:progress:reset-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(summaryBody, "teacher:progress:summary handler must exist");
  assert.ok(resetBody, "teacher:progress:reset-class handler must exist");
  assert.match(summaryBody!, /teacherOwnsClass\(db, teacherId, classId\)/);
  assert.match(resetBody!, /teacherOwnsClass\(db, teacherId, classId\)/);
  // requireTeacher() runs once for the whole `teacher:` prefix block, not
  // per-action -- confirm both handlers live inside that guarded block.
  const teacherBlockStart = edge.indexOf('if (action.startsWith("teacher:"))');
  const summaryHandlerStart = edge.indexOf('if (action === "teacher:progress:summary")');
  assert.ok(teacherBlockStart >= 0 && teacherBlockStart < summaryHandlerStart, "handler must be inside the teacher: block");
});

test("G. class-wide reset derives its student list server-side from classId -- the client can never pass an arbitrary studentId array", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const resetBody = edge.match(/if \(action === "teacher:progress:reset-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(resetBody);
  assert.match(resetBody!, /db\.from\("sb_students"\)\.select\("id"\)\.eq\("class_id", classId\)/, "student ids come from a server-side query keyed on classId");
  assert.doesNotMatch(resetBody!, /body\.studentIds/, "must never read a client-supplied student id list");
});

test("H. class-wide reset accepts an optional lesson scope (1-12) and treats missing/invalid as whole-class", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const resetBody = edge.match(/if \(action === "teacher:progress:reset-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.match(resetBody!, /const lesson = toInt\(body\.lesson\);/);
  assert.match(resetBody!, /lesson === 10 \|\| lesson === 11/, "lesson 10/11 combined-unit special case preserved from sb_reset_progress");
});

test("F. dashboard 'recent activity' is never labeled as live/connected presence", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /최근 활동/);
  assert.doesNotMatch(page, /현재 접속 중/, "must not claim real-time connection status (sb_student_sessions is out of scope for Phase 2)");
});

test("D. the progress table has name search, current-lesson filter, and a not_started/in_progress/complete status filter, all client-side (no server round trip per filter change)", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /placeholder="이름 검색" value=\{progressSearch\}/);
  assert.match(page, /aria-label="현재 차시 필터"/);
  assert.match(page, /aria-label="상태 필터"/);
  const filteredFn = page.match(/const filteredProgressStudents = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[progressStudents, progressSearch, progressLessonFilter, progressStatusFilter, progressSort\]\);/)?.[0];
  assert.ok(filteredFn, "filtering must be a pure client-side useMemo over the single fetched progressStudents array");
});

test("sorting supports name / current lesson / recent activity", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /<option value="name">이름순<\/option>/);
  assert.match(page, /<option value="currentLesson">현재 차시순<\/option>/);
  assert.match(page, /<option value="recentActivity">최근 활동순<\/option>/);
});

test("C. clicking a student's name in the progress table reuses the existing /teacher/students/:id route -- no new detail page", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const progressSection = page.match(/<section className="panel stack" id="progress">[\s\S]*?<\/section>/)?.[0];
  assert.ok(progressSection);
  assert.match(progressSection!, /to=\{`\/teacher\/students\/\$\{row\.studentId\}`\}/);
});

test("E. dashboard summary cards show total/not-started/in-progress/completed/most-common-lesson, derived from the same single progress fetch (no extra request)", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /progressSummary\.notStarted/);
  assert.match(page, /progressSummary\.inProgress/);
  assert.match(page, /progressSummary\.completed/);
  assert.match(page, /progressSummary\.mostCommonLesson/);
  const summaryMemo = page.match(/const progressSummary = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[progressStudents\]\);/)?.[0];
  assert.ok(summaryMemo, "dashboard summary must be derived client-side from progressStudents, not a second server call");
});

test("빠른 액션 (quick actions) link to existing sections/anchors, not new routes", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /<a className="btn btn-sm" href="#progress">학생 진도 보기<\/a>/);
  assert.match(page, /<a className="btn btn-sm" href="#lessons">차시 설정<\/a>/);
  assert.match(page, /<a className="btn btn-sm" href="#students">학생 관리<\/a>/);
});

test("J. class-wide reset requires two confirmation steps: a window.confirm, then typing the literal '초기화' in a window.prompt", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const fnBody = page.match(/const resetClassProgress = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "resetClassProgress must exist");
  assert.match(fnBody!, /window\.confirm\(/);
  assert.match(fnBody!, /window\.prompt\(/);
  assert.match(fnBody!, /if \(typed !== "초기화"\) return;/, "must abort unless the exact confirmation word is typed");
});

test("K. a successful reset refreshes the progress table (and therefore the dashboard summary, which is derived from it) and shows a non-silent success message", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const fnBody = page.match(/const resetClassProgress = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.match(fnBody!, /await loadProgress\(\);/);
  assert.match(fnBody!, /setMessage\(/);
  assert.match(fnBody!, /catch \(err\) \{\s*setError\(/, "failures must surface via setError, never swallowed silently");
});

test("L. existing individual student reset (TeacherStudentRecord.tsx, sb_reset_progress RPC) is untouched by Phase 2", async () => {
  const record = await readSource("../src/pages/TeacherStudentRecord.tsx");
  assert.match(record, /getSupabase\(\)\.rpc\('sb_reset_progress',\{p_student:studentId,p_lesson:resetLesson\|\|null\}\)/);
});

test("M. existing teacher features (PIN management, lesson lock, problem bank) are still present and untouched by the Phase 2 additions", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /<h3>학생 PIN 관리<\/h3>/);
  assert.match(page, /<h3>차시 잠금<\/h3>/);
  assert.match(page, /<h3>문제은행 관리<\/h3>/);
  assert.match(page, /teacherResetStudentPin\(classId, studentId\)/);
  assert.match(page, /teacherSetLessonLock\(classId, lesson, locked\)/);
});

test("N. the progress table is fetched once per class load (Promise.all alongside students/lessons/problems), not once per row/student -- and renders inside the existing horizontal-scroll wrapper", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const loadEffectBody = page.match(/const loadClassData = async \(\) => \{[\s\S]*?\n {4}\};/)?.[0];
  assert.ok(loadEffectBody);
  assert.match(loadEffectBody!, /Promise\.all\(\[[\s\S]*?teacherProgressSummary\(classId\),[\s\S]*?\]\)/);
  const progressSection = page.match(/<section className="panel stack" id="progress">[\s\S]*?<\/section>/)?.[0];
  assert.match(progressSection!, /className="teacher-table-wrap"/);
  assert.match(progressSection!, /className="sticky-col"/);
});
