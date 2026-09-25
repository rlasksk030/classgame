import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// src/lib/studentApi.ts uses TS constructor-parameter-property syntax elsewhere
// in the file, which Node's strip-only TS loader can't parse, so it can't be
// imported directly here (same constraint as every other client-side test in
// this repo -- see the source-inspection pattern used throughout). stageRedirectPath
// itself is trivial enough to mirror exactly and cross-check against the real
// source text (test F2 below).
function stageRedirectPath(lessonNumber: number, stage: "guided" | "required" | "optional" | "completed" | undefined): string | null {
  if (stage === "required") return `/lesson/${lessonNumber}/solve`;
  if (stage === "optional" || stage === "completed") return `/lesson/${lessonNumber}/practice`;
  return null;
}

// Stage-level lesson resume (안내된 탐구 -> 문제풀기 -> 선택 문제): on top of the
// existing within-stage "first unfinished problem" resume (tests/lesson-resume.test.ts),
// a student who already finished guided exploration and/or the required problem must
// never be shown that section again -- they land directly in the next unfinished
// section. Server-tracked only (sb_student_progress.guided_completed), never
// localStorage, so a new device/browser resumes identically.

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role;`);
  await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
  const files = readdirSync("supabase/migrations").sort();
  for (const file of files) {
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8").replace('create extension if not exists "pgcrypto";', ""));
  }
  return db;
}

const TEACHER = "11111111-1111-4111-8111-111111111111";

async function makeClassAndStudent(db: PGlite, classId: string, studentId: string) {
  await db.exec(`insert into auth.users values('${TEACHER}') on conflict do nothing;`);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A',substr(md5(random()::text),1,5))", [classId, TEACHER]);
  await db.query("insert into sb_students(id,class_id,name,student_no,pin_hash) values($1,$2,'S',1,'x')", [studentId, classId]);
}

test("migration: sb_student_progress.guided_completed exists, defaults to false, and is additive/backward-compatible for pre-existing rows", async () => {
  const db = await freshDb();
  try {
    const classId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
    const studentId = "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb";
    await makeClassAndStudent(db, classId, studentId);
    // A row inserted the way it always has been (no guided_completed provided) must still get false, not null/error.
    await db.query("insert into sb_student_progress(student_id,lesson,practice_seed) values($1,1,7)", [studentId]);
    const { rows } = await db.query("select guided_completed from sb_student_progress where student_id=$1 and lesson=1", [studentId]);
    assert.equal(rows[0].guided_completed, false);
  } finally { await db.close(); }
});

// Mirrors the exact currentStage formula added to the "lessonProblems" handler
// in supabase/functions/student-api/index.ts (kept in lockstep by the
// source-inspection test below).
function computeStage(
  guidedCompleted: boolean,
  requiredComplete: boolean,
  moreProblems: { id: string }[],
  moreCompletedIds: Set<string>,
): "guided" | "required" | "optional" | "completed" {
  const allMoreComplete = moreProblems.length > 0 && moreProblems.every((p) => moreCompletedIds.has(p.id));
  return !guidedCompleted ? "guided" : !requiredComplete ? "required" : !allMoreComplete ? "optional" : "completed";
}

test("A. guided not yet completed -> stage is 'guided', regardless of how much of required/optional is already done", () => {
  assert.equal(computeStage(false, true, [{ id: "m1" }], new Set(["m1"])), "guided");
  assert.equal(computeStage(false, false, [], new Set()), "guided");
});

test("B. guided completed, required not yet complete -> stage is 'required'", () => {
  assert.equal(computeStage(true, false, [{ id: "m1" }], new Set()), "required");
});

test("C. guided + required complete, practice set not fully solved -> stage is 'optional'", () => {
  assert.equal(computeStage(true, true, [{ id: "m1" }, { id: "m2" }], new Set(["m1"])), "optional");
});

test("D. guided + required + every practice problem complete -> stage is 'completed'", () => {
  assert.equal(computeStage(true, true, [{ id: "m1" }, { id: "m2" }], new Set(["m1", "m2"])), "completed");
});

test("E. a lesson with no practice-set problems at all never falsely reports 'completed' just because the (empty) set is vacuously solved -- it stays 'optional'", () => {
  assert.equal(computeStage(true, true, [], new Set()), "optional");
});

test("F. stageRedirectPath: 'required' sends to /solve, 'optional'/'completed' send to /practice, 'guided'/undefined stay on /learn (no redirect)", () => {
  assert.equal(stageRedirectPath(3, "required"), "/lesson/3/solve");
  assert.equal(stageRedirectPath(3, "optional"), "/lesson/3/practice");
  assert.equal(stageRedirectPath(3, "completed"), "/lesson/3/practice");
  assert.equal(stageRedirectPath(3, "guided"), null);
  assert.equal(stageRedirectPath(3, undefined), null);
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("G. lessonProblems only marks guided_completed=true when markGuidedComplete isn't explicitly false -- /learn's read-only stage check never marks it complete just by looking", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  assert.match(edge, /const markGuidedComplete = body\.markGuidedComplete !== false;/);
  assert.match(edge, /if \(markGuidedComplete && !guidedCompleted\) \{/);
});

test("H. guided_completed is written with an explicit UPDATE, not folded into the ignoreDuplicates practice_seed upsert (which never touches existing rows)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  assert.match(edge, /await db\.from\("sb_student_progress"\)\.update\(\{guided_completed:true\}\)\.eq\("student_id",studentSession\.studentId\)\.eq\("lesson",lesson\);/);
});

test("I. currentStage is computed from the real formula and returned alongside currentProblemId, not replacing it", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  assert.match(edge, /const allMoreComplete = moreProblems\.length > 0 && moreProblems\.every\(p => moreCompletedIds\.has\(p\.id\)\);/);
  assert.match(edge, /const currentStage: "guided" \| "required" \| "optional" \| "completed" =\s*\n\s*!guidedCompleted \? "guided" : !requiredComplete \? "required" : !allMoreComplete \? "optional" : "completed";/);
  assert.match(edge, /currentProblemId: resumeProblemId,\s*\n\s*currentStage,/);
});

test("J. LessonLearnPage checks the server-tracked stage read-only (markGuidedComplete:false) before showing guided content, and redirects via stageRedirectPath -- never decides from localStorage", async () => {
  const page = await readSource("../src/pages/LessonLearnPage.tsx");
  assert.match(page, /getLessonProblems\(lessonNumber,\{markGuidedComplete:false\}\)/);
  assert.match(page, /stageRedirectPath\(lessonNumber,data\.currentStage\)/);
  assert.doesNotMatch(page, /localStorage\.(get|set)Item/, "stage-skip decision must never read from localStorage");
});

test("K. LessonLearnPage does not run the stage check for peer (9차시) or project-based (10/11차시) lessons -- those have their own flow outside guided/required/optional staging", async () => {
  const page = await readSource("../src/pages/LessonLearnPage.tsx");
  assert.match(page, /if\(project\|\|guide\?\.kind==='peer'\|\|!guide\)\{setStageChecked\(true\);return;\}/);
});

test("L. getLessonProblems only sends markGuidedComplete in the request body when explicitly set to false -- the default (undefined) preserves the existing /solve and /practice behavior of marking guided complete on entry", async () => {
  const api = await readSource("../src/lib/studentApi.ts");
  assert.match(api, /options\?\.markGuidedComplete === false \? \{ markGuidedComplete: false \} : \{\}/);
});

test("F2. the real stageRedirectPath implementation in src/lib/studentApi.ts matches the mirrored version tested in F above", async () => {
  const api = await readSource("../src/lib/studentApi.ts");
  assert.match(api, /export function stageRedirectPath\(lessonNumber: number, stage: LessonStage \| undefined\): string \| null \{/);
  assert.match(api, /if \(stage === "required"\) return `\/lesson\/\$\{lessonNumber\}\/solve`;/);
  assert.match(api, /if \(stage === "optional" \|\| stage === "completed"\) return `\/lesson\/\$\{lessonNumber\}\/practice`;/);
  assert.match(api, /return null;\n\}/);
});
