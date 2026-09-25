import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// "학생 로그인표 인쇄" used to call window.print() directly on TeacherPage,
// which printed the whole teacher dashboard. This moves it to its own
// route/component so print output is ever only the selected class's name/PIN
// cards -- never the teacher nav, dashboard cards, tables, or any other
// TeacherPage UI.

async function readPrintSheet(): Promise<string> {
  return readFile(new URL("../src/pages/PrintStudentLoginSheet.tsx", import.meta.url), "utf8");
}
async function readPrintSheetCss(): Promise<string> {
  return readFile(new URL("../src/pages/PrintStudentLoginSheet.css", import.meta.url), "utf8");
}
async function readTeacherPage(): Promise<string> {
  return readFile(new URL("../src/pages/TeacherPage.tsx", import.meta.url), "utf8");
}
async function readApp(): Promise<string> {
  return readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
}

test("route: /teacher/print-logins is registered, gated by TeacherGate like every other teacher route", async () => {
  const app = await readApp();
  assert.match(app, /const PrintStudentLoginSheet = lazy\(\(\) => import\('\.\/pages\/PrintStudentLoginSheet'\)\);/);
  assert.match(app, /<Route path="\/teacher\/print-logins" element=\{<TeacherGate><PrintStudentLoginSheet \/><\/TeacherGate>\} \/>/);
});

test("TeacherPage no longer calls window.print() directly -- the button navigates to the dedicated print route with the selected classId", async () => {
  const page = await readTeacherPage();
  assert.doesNotMatch(page, /onClick=\{\(\) => window\.print\(\)\}/, "must not print the whole TeacherPage anymore");
  assert.match(page, /onClick=\{\(\) => window\.location\.assign\(`\/teacher\/print-logins\?classId=\$\{encodeURIComponent\(classId\)\}`\)\}/);
  // still disabled with no students, same as before
  assert.match(page, /disabled=\{!students\.length\} onClick=\{\(\) => window\.location\.assign/);
});

test("A/I. class scope comes only from the classId route param, never from any shared/global state -- switching class and re-opening this page always re-fetches for the new classId", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /const \[params\] = useSearchParams\(\);/);
  assert.match(sheet, /const classId = params\.get\("classId"\) \?\? "";/);
  assert.match(sheet, /\}, \[classId\]\);/, "the data-loading effect must depend on classId so a different classId always refetches");
});

test("B/ownership. a classId not owned by the signed-in teacher is rejected client-side too (defense in depth on top of the server-side teacherOwnsClass check already enforced by teacherListStudents)", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /const \[\{ classes \}, \{ students \}\] = await Promise\.all\(\[\s*teacherListClasses\(\),\s*teacherListStudents\(classId\),\s*\]\);/);
  assert.match(sheet, /const classInfo = classes\.find\(\(row\) => row\.id === classId\);/);
  assert.match(sheet, /if \(!classInfo\) \{ setState\(\{ kind: "error", message: "해당 학급에 접근할 수 없습니다\." \}\); return; \}/);
});

test("C. each card shows the student's name and PIN in plain text", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /학생 이름: \{student\.name\}/);
  assert.match(sheet, /PIN: \{student\.pinPlain\}/);
});

test("D. this component never renders any TeacherPage dashboard/nav content -- it does not import TeacherPage and contains none of its section labels", async () => {
  const sheet = await readPrintSheet();
  assert.doesNotMatch(sheet, /from ["']\.\/TeacherPage["']/);
  assert.doesNotMatch(sheet, /수업 현황|학생 진도|차시 관리|문제은행 관리|놀이·친구 문제|반 선택/);
});

test("E/F. the student URL is always this deploy's own origin (production when served from production, TEST when served from TEST) -- never a hardcoded host of either kind", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /const studentUrl = useMemo\(\(\) => `\$\{window\.location\.origin\}\/`, \[\]\);/);
  assert.doesNotMatch(sheet, /onrender\.com|-test\./i, "must never hardcode any TEST or production hostname");
});

test("G. print CSS sets an explicit A4 page size", async () => {
  const css = await readPrintSheetCss();
  assert.match(css, /@media print \{/);
  assert.match(css, /@page \{\s*size: A4;/);
});

test("H. inactive (disabled) students are excluded from the printed sheet", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /students: students\.filter\(\(row\) => row\.status === "active"\)/);
});

test("nav isolation: this page toggles a body-level flag on mount/unmount so the teacher nav (rendered by a sibling, TeacherGate, that this component cannot otherwise reach) is hidden only while this page is open, and only for print", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /document\.body\.classList\.add\("print-login-sheet-active"\);/);
  assert.match(sheet, /document\.body\.classList\.remove\("print-login-sheet-active"\);/);
  const css = await readPrintSheetCss();
  assert.match(css, /body\.print-login-sheet-active nav\.toolbar-row\.app-max,\s*body\.print-login-sheet-active \.installation-switch \{\s*display: none !important;/);
});

test("print-only buttons (the 인쇄/돌아가기 toolbar) are marked no-print, so they never appear on the printed page itself", async () => {
  const sheet = await readPrintSheet();
  assert.match(sheet, /className="print-sheet-toolbar no-print"/);
  const css = await readPrintSheetCss();
  assert.match(css, /\.no-print \{\s*display: none !important;/);
});

test("cards never split across a page break", async () => {
  const css = await readPrintSheetCss();
  assert.match(css, /\.print-sheet-card \{\s*page-break-inside: avoid;\s*break-inside: avoid;/);
});
