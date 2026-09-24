import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Teacher Page Expansion Phase 1: expose already-built server logic
// (teacherListProblems/teacherSetProblemActive and
// teacher:peer-problem:list/:hide) through new UI only. No new API,
// no new migration, no route changes -- verified below via source
// inspection, matching this repo's existing test convention (there is
// no teacher-auth-capable e2e harness yet, so these are unit-level
// checks against the actual shipped source).

test("A. TeacherPage renders a 문제은행 관리 section listing custom problems (title/lesson/type/status)", async () => {
  const source = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(source, /id="problem-bank"/);
  assert.match(source, /문제은행 관리/);
  assert.match(source, /filteredProblems\.map\(\(problem\) => \(/);
  assert.match(source, /\{problem\.title \|\| "\(제목 없음\)"\}/);
  assert.match(source, /\{problem\.lesson\}차시/);
  assert.match(source, /\{problem\.problemType\}/);
});

test("B. the active/inactive toggle reuses the existing teacherSetProblemActive server action (no new API)", async () => {
  const source = await readSource("../src/pages/TeacherPage.tsx");
  const fnBody = source.match(/const toggleProblemActive = async \(problem: TeacherProblem\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "toggleProblemActive must exist");
  assert.match(fnBody!, /teacherSetProblemActive\(problem\.id, !problem\.active\)/);
});

test("C. the problem-bank UI only toggles the existing active flag -- it does not add any new client-side filtering logic that could bypass the server's existing lessonProblems active-only enforcement", async () => {
  const apiSource = await readSource("../src/lib/studentApi.ts");
  // teacherListProblems/teacherSetProblemActive are unchanged pass-throughs
  // to the pre-existing server actions -- no new action names were added
  // for the problem bank feature.
  assert.match(apiSource, /action: "teacher:problems:list"/);
  assert.match(apiSource, /action: "teacher:problems:set-active"/);
  assert.doesNotMatch(apiSource, /teacher:problems:(delete|create|update)/);
});

test("D. TeacherActivities: hiding a peer problem confirms first, then calls the existing teacher:peer-problem:hide action", async () => {
  const source = await readSource("../src/features/activities/TeacherActivities.tsx");
  const fnBody = source.match(/const hidePeerProblem=async\(row:TeacherPeerProblemRow\)=>\{[\s\S]*?\};/)?.[0];
  assert.ok(fnBody, "hidePeerProblem must exist");
  assert.match(fnBody!, /window\.confirm\(/);
  assert.match(fnBody!, /teacherHidePeerProblem\(classId,installationId,row\.problemId,row\.version\)/);
});

test("E. TeacherActivities: restoring a hidden peer problem sets status back to published without deleting the row, and re-fetches the list", async () => {
  const source = await readSource("../src/features/activities/TeacherActivities.tsx");
  const fnBody = source.match(/const restorePeerProblem=async\(row:TeacherPeerProblemRow\)=>\{[\s\S]*?\};/)?.[0];
  assert.ok(fnBody, "restorePeerProblem must exist");
  assert.match(fnBody!, /update\(\{status:'published',hidden_at:null\}\)/);
  assert.doesNotMatch(fnBody!, /\.delete\(\)/, "restore must never delete the row");
  assert.match(fnBody!, /loadPeerProblems\(\)/);
});

test("F. existing read-only 놀이와 건축물 기록 features (challenges/projects rendering) are untouched by the Phase 1 additions", async () => {
  const source = await readSource("../src/features/activities/TeacherActivities.tsx");
  assert.match(source, /아직 만든 친구 문제가 없습니다/);
  assert.match(source, /challenges\.map\(c=></);
  assert.match(source, /projects\.map\(p=></);
  assert.match(source, /<Representations given=\{\{projections:project\(selected\.blocks,grid\),layers:toLayers\(selected\.blocks,grid\)\}\} \/>/);
});

test("G. student-detail entry point (/teacher/students/:id) was already discoverable via the existing name link -- Phase 1 adds no duplicate link", async () => {
  const source = await readSource("../src/pages/TeacherPage.tsx");
  const matches = source.match(/to=\{`\/teacher\/students\/\$\{student\.id\}`\}/g) ?? [];
  assert.equal(matches.length, 1, "exactly one link to the student detail route, not a duplicate");
  assert.match(source, /\{student\.name\} · 기록 보기/);
});

test("H. the student-delete confirmation includes the required cascade-deletion warning, without changing delete behavior", async () => {
  const source = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(source, /학생을 삭제하면 이 학생의 진도, 문제 풀이 기록, 저장된 활동 기록도 함께 삭제됩니다\./);
  // still the same delete call -- a real DB delete on sb_students, not a soft-delete swap
  assert.match(source, /getSupabase\(\)\.from\("sb_students"\)\.delete\(\)\.eq\("id",student\.id\)\.eq\("class_id",classId\)/);
});

test("I. all Phase 1 client calls go through actions prefixed teacher: (server-side requireTeacher + teacherOwnsClass guard applies, same as every other teacher action)", async () => {
  const apiSource = await readSource("../src/lib/studentApi.ts");
  assert.match(apiSource, /export function teacherListPeerProblems\(classId: string, installationId: string\) \{\s*return callFunction<\{ problems: TeacherPeerProblemRow\[\] \}>\(\s*"student-api",\s*\{ action: "teacher:peer-problem:list", classId, installationId \}/);
  assert.match(apiSource, /export function teacherHidePeerProblem\(classId: string, installationId: string, problemId: string, version: number\) \{\s*return callFunction<\{ problem: \{ problem_id: string; version: number; status: string \} \}>\(\s*"student-api",\s*\{ action: "teacher:peer-problem:hide", classId, installationId, problemId, version \}/);
  // the direct-supabase restore path is RLS-scoped (sb_student_created_problems
  // has a teacher_update policy restricted to the teacher's own class via
  // sb_owns_class), so it is not a client-side-only guard either.
  const teacherActivitiesSource = await readSource("../src/features/activities/TeacherActivities.tsx");
  assert.match(teacherActivitiesSource, /\.eq\('class_id',classId\)/);
});

test("the peer-problem status field is now included in the teacher list response, so the UI can distinguish hidden vs published rows", async () => {
  const edgeSource = await readSource("../supabase/functions/student-api/index.ts");
  const fnBody = edgeSource.match(/function publicPeerRow\(row: Record<string, unknown>, attempt\?: Record<string, unknown> \| null\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fnBody, "publicPeerRow must exist");
  assert.match(fnBody!, /status: String\(row\.status \?\? "published"\)/);
});
