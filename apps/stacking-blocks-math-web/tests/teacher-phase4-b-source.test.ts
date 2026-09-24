import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Teacher Page Expansion Phase 4 B1 (search/filter), B2 (class move),
// B3 (lesson preview), B4 (help), B5 (nav polish). B2's DB-level
// correctness/safety is covered by tests/teacher-move-student.test.ts
// (PGlite). This file covers the server guard + client wiring.

test("B2 security: teacher:students:move-class verifies ownership of BOTH the source and target class before moving anything", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:students:move-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(body, "handler must exist");
  assert.match(body!, /teacherOwnsClass\(db, teacherId, student\.class_id\)/, "source class ownership checked");
  assert.match(body!, /teacherOwnsClass\(db, teacherId, targetClassId\)/, "target class ownership checked");
  assert.match(body!, /if \(!ownsSource \|\| !ownsTarget\) return fail\(403/);
});

test("B2 safety: move-class checks for a (class_id,name,student_no) collision in the target class before writing, instead of surfacing a raw DB constraint error", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:students:move-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.match(body!, /eq\("class_id", targetClassId\)\s*\.eq\("name", student\.name\)\s*\.eq\("student_no", student\.student_no\)/);
  assert.match(body!, /if \(collision\) return fail\(409, "STUDENT_NAME_CONFLICT"/);
});

test("B2 safety: move-class also moves the class_id-scoped PIN vault and project rows (student_id-scoped tables like progress/attempts/rewards need no migration since their RLS already follows the student's current class_id)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:students:move-class"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.match(body!, /\.from\("sb_student_pin_vault"\)\.update\(\{ class_id: targetClassId \}\)\.eq\("student_id", studentId\)/);
  assert.match(body!, /\.from\("sb_projects"\)\.update\(\{ class_id: targetClassId \}\)\.eq\("student_id", studentId\)/);
  assert.doesNotMatch(body!, /\.delete\(\)/, "must never delete/recreate the student -- only class_id changes");
});

test("B2 UI: a confirmation naming the destination class appears before moving, and the client warns nothing is lost", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const fnBody = page.match(/const moveStudent = async \(student: TeacherStudentRow\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody);
  assert.match(fnBody!, /window\.confirm\(`\$\{student\.name\} 학생을 \$\{targetClass\?\.name/);
  assert.match(fnBody!, /ID·PIN·진도·문제 풀이 기록은 그대로 유지/);
});

test("B1: student management gets name/active/current-lesson/progress-status filters, reusing progressStudents (Phase 2) and studentOverallStatus -- no duplicate filter logic", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const memoBody = page.match(/const filteredStudents = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[students, studentSearch, studentActiveFilter, studentLessonFilter, studentStatusFilter, progressById\]\);/)?.[0];
  assert.ok(memoBody, "filteredStudents memo must exist with exactly this dependency list");
  assert.match(memoBody!, /studentOverallStatus\(progress\)/, "reuses the existing Phase 2 status classifier, not a new one");
  const studentsSection = page.match(/<section className="panel stack" id="students">[\s\S]*?<\/section>/)?.[0];
  assert.match(studentsSection!, /filteredStudents\.map\(\(student\)/, "table renders the filtered list");
});

test("B3: a dedicated lesson-level preview page exists, is entirely read-only (no student-api / write-table calls), and opens in a new tab from the teacher page", async () => {
  assert.ok(existsSync(new URL("../src/pages/TeacherLessonPreview.tsx", import.meta.url)), "TeacherLessonPreview.tsx must exist");
  const preview = await readSource("../src/pages/TeacherLessonPreview.tsx");
  assert.doesNotMatch(preview, /studentApi|callFunction|getSupabase/, "must never call the API or DB directly -- pure client-side curriculum data only (this alone rules out touching any student write-table, e.g. sb_student_progress/sb_problem_attempts/sb_student_rewards/sb_projects)");
  assert.match(preview, /disabled\s*$/m, "BlockWorld must be rendered disabled (read-only)");
  assert.match(preview, /onBlocksChange=\{\(\) => undefined\}/, "edits must be no-ops");

  const app = await readSource("../src/App.tsx");
  assert.match(app, /path="\/teacher\/lesson-preview\/:lesson"/);

  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /href=\{`\/teacher\/lesson-preview\/\$\{row\.lesson\}`\} target="_blank"/, "opens in a new tab per-lesson");
});

test("B3 existing preview untouched: TeacherProblemPreview.tsx (per-template preview) still exists and is not replaced by the new lesson-level one", async () => {
  assert.ok(existsSync(new URL("../src/pages/TeacherProblemPreview.tsx", import.meta.url)));
  const app = await readSource("../src/App.tsx");
  assert.match(app, /path="\/teacher\/problem-preview"/);
});

test("B4: a help drawer exists with all 11 required topics, opened from a nav button, closable, and adds no new route", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /const \[helpOpen, setHelpOpen\] = useState\(false\);/);
  assert.match(page, /onClick=\{\(\) => setHelpOpen\(true\)\}>도움말<\/button>/);
  assert.match(page, /onClick=\{\(\) => setHelpOpen\(false\)\}>닫기<\/button>/);
  for (const topic of ["처음 시작", "학생 접속", "진도표 보기", "차시 잠금", "PIN 재발급", "진도 초기화", "문제은행", "친구 문제", "수업 결과", "서버/저장 상태", "업데이트"]) {
    assert.match(page, new RegExp(`title: "${topic}"`), `help item missing: ${topic}`);
  }
  const app = await readSource("../src/App.tsx");
  assert.doesNotMatch(app, /help/i, "help is a drawer inside TeacherPage, not a new route");
});

test("B5: nav order follows the recommended flow (dashboard -> live status -> progress -> student mgmt -> lessons -> problem bank -> results -> activities), with every pre-existing anchor still present and none renamed", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const nav = page.match(/<nav className="teacher-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  const order = ["#classes", "#live-status", "#progress", "#students", "#lessons", "#problem-bank", "#results", "#activities"];
  let lastIdx = -1;
  for (const anchor of order) {
    const idx = nav!.indexOf(anchor);
    assert.ok(idx > lastIdx, `${anchor} must appear, in order, after the previous anchor`);
    lastIdx = idx;
  }
  for (const label of ["대시보드", "수업 현황", "학생 진도", "학생 관리", "차시 관리", "문제은행 관리", "문제은행", "문제 미리보기", "수업 결과", "놀이·친구 문제", "도움말"]) {
    assert.match(nav!, new RegExp(label), `nav label must be unchanged/present: ${label}`);
  }
});
