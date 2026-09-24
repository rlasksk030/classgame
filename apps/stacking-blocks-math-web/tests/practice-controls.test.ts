import { test } from "node:test";
import assert from "node:assert/strict";
import testUnit from "node:test";
import assertUnit from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Teacher Page Expansion Phase 4C: per-lesson allow_similar/allow_retry.

test("migration is backward compatible: existing sb_lesson_settings rows (and brand-new ones) default both flags to true, matching pre-migration behavior exactly", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      grant usage on schema auth,public to anon,authenticated,service_role;`);
    await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
    // Replay every migration EXCEPT the new one first, to simulate an
    // already-existing row created before this migration ever ran.
    const files = readdirSync("supabase/migrations").sort();
    for (const file of files) {
      if (file === "202609240001_practice_controls.sql") continue;
      await db.exec(readFileSync("supabase/migrations/" + file, "utf8").replace('create extension if not exists "pgcrypto";', ""));
    }
    const teacher = "11111111-1111-4111-8111-111111111111";
    const klass = "33333333-3333-4333-8333-333333333333";
    await db.exec(`insert into auth.users values('${teacher}');`);
    await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A','AAAA')", [klass, teacher]);
    await db.query("insert into sb_lesson_settings(class_id,lesson,locked) values($1,1,false)", [klass]);

    // Now apply the new migration -- this is the actual backward-compat moment.
    await db.exec(readFileSync("supabase/migrations/202609240001_practice_controls.sql", "utf8"));

    const preExisting = await db.query<{ allow_similar: boolean; allow_retry: boolean }>(
      "select allow_similar, allow_retry from sb_lesson_settings where class_id=$1 and lesson=1", [klass],
    );
    assert.deepEqual(preExisting.rows[0], { allow_similar: true, allow_retry: true }, "pre-existing row backfilled to true, not null/false");

    await db.query("insert into sb_lesson_settings(class_id,lesson,locked) values($1,2,true)", [klass]);
    const freshRow = await db.query<{ allow_similar: boolean; allow_retry: boolean }>(
      "select allow_similar, allow_retry from sb_lesson_settings where class_id=$1 and lesson=2", [klass],
    );
    assert.deepEqual(freshRow.rows[0], { allow_similar: true, allow_retry: true }, "a brand new row omitting the columns also defaults to true");
  } finally { await db.close(); }
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

testUnit("edge: teacher:lessons:set-lock only changes allow_similar/allow_retry when explicitly given a boolean -- omitting them (undefined) leaves the existing value untouched", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:lessons:set-lock"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assertUnit.ok(body);
  assertUnit.match(body!, /typeof body\.allowSimilar === "boolean" \? body\.allowSimilar : undefined/);
  assertUnit.match(body!, /typeof body\.allowRetry === "boolean" \? body\.allowRetry : undefined/);
  assertUnit.match(body!, /const finalAllowSimilar = allowSimilar \?\? existing\?\.allow_similar \?\? true;/);
  assertUnit.match(body!, /allow_similar: finalAllowSimilar/);
  assertUnit.match(body!, /if \(upsertErr\) \{[\s\S]*?return fail\(500, "LESSON_SETTING_SAVE_FAILED"/, "upsert errors must not be swallowed");
});

testUnit("edge: teacher:lessons:list checks its select() error instead of silently returning an empty list on failure (regression found live on TEST: missing columns made every class's lesson-lock list render blank with no error)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:lessons:list"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assertUnit.ok(body);
  assertUnit.match(body!, /if \(listErr\) \{[\s\S]*?return fail\(500, "LESSON_SETTINGS_LOAD_FAILED"/, "select errors must not be swallowed into an empty array");
});

testUnit("edge: lessonProblems returns allowSimilar/allowRetry sourced from sb_lesson_settings, defaulting to true when no row exists", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const lessonProblemsBody = edge.match(/if \(action === "lessonProblems"\) \{[\s\S]*?\n {4}\}\n\n {4}if \(action === "practice:new-set"\)/)?.[0]
    ?? edge.slice(edge.indexOf('if (action === "lessonProblems")'), edge.indexOf('if (action === "lessonProblems")') + 6000);
  assertUnit.match(lessonProblemsBody, /select\("practice_count,allow_similar,allow_retry"\)/);
  assertUnit.match(lessonProblemsBody, /allowSimilar: lessonSetting\?\.allow_similar \?\? true/);
  assertUnit.match(lessonProblemsBody, /allowRetry: lessonSetting\?\.allow_retry \?\? true/);
});

testUnit("student UI: 유사 문제 풀기 / 틀린 문제 다시 풀기 buttons are gated on allowSimilar/allowRetry from the server, not lesson-number hardcoding", async () => {
  const page = await readSource("../src/pages/LessonPage.tsx");
  assertUnit.match(page, /setAllowSimilar\(list\.allowSimilar \?\? true\);/);
  assertUnit.match(page, /setAllowRetry\(list\.allowRetry \?\? true\);/);
  assertUnit.match(page, /\{allowRetry && <button className="btn btn-sm" disabled=\{!wrongProblemIds\.length\}/);
  assertUnit.match(page, /\{allowSimilar && <button className="btn btn-sm" onClick=\{\(\) => \{[\s\S]*?유사 문제 풀기<\/button>\}/);
});

testUnit("teacher UI: per-lesson toggle buttons for both controls exist and call the shared togglePracticeControl handler, reusing teacherSetLessonLock (no new action)", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const fnBody = page.match(/const togglePracticeControl = async \(lesson: number, field: "allow_similar" \| "allow_retry"\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assertUnit.ok(fnBody, "togglePracticeControl must exist");
  assertUnit.match(fnBody!, /teacherSetLessonLock\(/);
  assertUnit.doesNotMatch(fnBody!, /action: "teacher:practice/, "must not introduce a new dedicated action");
  assertUnit.match(page, /유사 문제 풀기 \{row\.allow_similar \?\? true \? "허용" : "비허용"\}/);
  assertUnit.match(page, /틀린 문제 다시 풀기 \{row\.allow_retry \?\? true \? "허용" : "비허용"\}/);
});
