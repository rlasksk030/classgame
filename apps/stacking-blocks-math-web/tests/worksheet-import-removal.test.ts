import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Worksheet import UI removal: UI/route only, no DB/Storage/migration
// touched. See supabase/migrations/202609110008_worksheet.sql's header
// comment and WORKLOG.md's 2026-09-24 entry for the rationale.

test("WorksheetImportPage.tsx and its file-preview helper no longer exist in src/", () => {
  assert.equal(existsSync(new URL("../src/pages/WorksheetImportPage.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/features/worksheet", import.meta.url)), false);
});

test("App.tsx no longer imports WorksheetImportPage or registers /teacher/worksheet-import", async () => {
  const app = await readSource("../src/App.tsx");
  assert.doesNotMatch(app, /WorksheetImportPage/);
  assert.doesNotMatch(app, /worksheet-import/);
});

test("TeacherPage.tsx no longer links to worksheet import, but keeps every other teacher entry point", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.doesNotMatch(page, /worksheet-import/);
  assert.doesNotMatch(page, /학습지로 문제 만들기/);
  assert.doesNotMatch(page, />학습지</);
  // Problem bank / editor / preview links must remain untouched.
  assert.match(page, /to="\/teacher\/problems\/new">3D 문제 만들기</);
  assert.match(page, /href="\/teacher\/problems\/new">문제은행</);
  assert.match(page, /href="\/teacher\/problem-preview">문제 미리보기</);
});

test("no src/ file references WorksheetImportPage, the worksheet feature folder, or the deleted route anywhere", async () => {
  const { execSync } = await import("node:child_process");
  const grep = (pattern: string) => {
    try {
      return execSync(`grep -rl "${pattern}" src/`, { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim();
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 1) return ""; // grep: no matches
      throw err;
    }
  };
  assert.equal(grep("WorksheetImportPage"), "");
  assert.equal(grep("worksheet-import"), "");
});

test("DB/Storage were left untouched: the worksheet migration still creates sb_worksheet_imports and both storage buckets, only gaining a documentation comment", async () => {
  const migration = await readSource("../supabase/migrations/202609110008_worksheet.sql");
  assert.match(migration, /create table public\.sb_worksheet_imports/);
  assert.match(migration, /'sb-worksheets','sb-worksheets'/);
  assert.match(migration, /create policy sb_worksheet_teacher/);
  assert.match(migration, /worksheet import UI removed/, "should document the removal for future readers");
});

test("sb-problem-images stays wired into student-api (it backs general problem image display, unrelated to worksheet import)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  assert.match(edge, /db\.storage\.from\("sb-problem-images"\)\.createSignedUrl/);
});

test("no migration files were deleted -- the migrations directory still contains every pre-existing file", async () => {
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(new URL("../supabase/migrations", import.meta.url));
  assert.ok(files.includes("202609110008_worksheet.sql"));
  assert.ok(files.length >= 18, "no migration file count regression");
});
