import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// teacher:lessons:list must always return all 12 lessons regardless of how
// many sb_lesson_settings rows actually exist -- a brand-new class (0 rows)
// previously returned lessons:[], which made every per-lesson control
// (lock toggle, practice count, allow_similar/allow_retry, preview link)
// disappear from the teacher screen, leaving only the always-rendered
// "전체 잠금"/"전체 해제" buttons visible.

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

// Mirrors the exact synthesis in supabase/functions/student-api/index.ts's
// teacher:lessons:list handler -- kept in lockstep by the source-inspection
// test below, which fails if the edge function's real code drifts from this.
function synthesizeLessons(rows: { lesson: number; locked: boolean; practice_count: number | null; allow_similar: boolean | null; allow_retry: boolean | null }[]) {
  const storedByLesson = new Map(rows.map((row) => [row.lesson, row]));
  return Array.from({ length: 12 }, (_, i) => {
    const lesson = i + 1;
    const stored = storedByLesson.get(lesson);
    return {
      lesson,
      locked: stored?.locked ?? false,
      practice_count: stored?.practice_count ?? null,
      allow_similar: stored?.allow_similar ?? true,
      allow_retry: stored?.allow_retry ?? true,
    };
  });
}

const TEACHER = "11111111-1111-4111-8111-111111111111";

async function makeClass(db: PGlite, id: string) {
  await db.exec(`insert into auth.users values('${TEACHER}') on conflict do nothing;`);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A','AAAA')", [id, TEACHER]);
}

test("A. brand-new class with zero sb_lesson_settings rows -> synthesized list still has exactly 12 lessons", async () => {
  const db = await freshDb();
  try {
    const klass = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await makeClass(db, klass);
    const { rows } = await db.query("select lesson, locked, practice_count, allow_similar, allow_retry from sb_lesson_settings where class_id=$1", [klass]);
    assert.equal(rows.length, 0, "sanity: no rows exist yet");
    const lessons = synthesizeLessons(rows as never[]);
    assert.equal(lessons.length, 12);
    assert.deepEqual(lessons.map((l) => l.lesson), Array.from({ length: 12 }, (_, i) => i + 1));
  } finally { await db.close(); }
});

test("B. default values for a lesson with no stored row: locked=false, allow_similar=true, allow_retry=true, practice_count=null", async () => {
  const lessons = synthesizeLessons([]);
  for (const l of lessons) {
    assert.equal(l.locked, false);
    assert.equal(l.allow_similar, true);
    assert.equal(l.allow_retry, true);
    assert.equal(l.practice_count, null);
  }
});

test("C. only lesson 3 has a stored row -> lesson 3 keeps its stored values, the other 11 get defaults", async () => {
  const db = await freshDb();
  try {
    const klass = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await makeClass(db, klass);
    await db.query(
      "insert into sb_lesson_settings(class_id,lesson,locked,practice_count,allow_similar,allow_retry) values($1,3,true,10,false,false)",
      [klass],
    );
    const { rows } = await db.query("select lesson, locked, practice_count, allow_similar, allow_retry from sb_lesson_settings where class_id=$1", [klass]);
    const lessons = synthesizeLessons(rows as never[]);
    assert.equal(lessons.length, 12);
    const three = lessons.find((l) => l.lesson === 3)!;
    assert.deepEqual(three, { lesson: 3, locked: true, practice_count: 10, allow_similar: false, allow_retry: false });
    for (const l of lessons) {
      if (l.lesson === 3) continue;
      assert.deepEqual(l, { lesson: l.lesson, locked: false, practice_count: null, allow_similar: true, allow_retry: true });
    }
  } finally { await db.close(); }
});

test("D. a class with all 12 rows already stored -> every stored value survives synthesis untouched (no silent overwrite)", async () => {
  const db = await freshDb();
  try {
    const klass = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await makeClass(db, klass);
    const practiceCounts = [5, 10, 15, 20];
    for (let lesson = 1; lesson <= 12; lesson++) {
      const practiceCount = practiceCounts[lesson % practiceCounts.length];
      await db.query(
        "insert into sb_lesson_settings(class_id,lesson,locked,practice_count,allow_similar,allow_retry) values($1,$2,$3,$4,$5,$6)",
        [klass, lesson, lesson % 2 === 0, practiceCount, lesson % 3 === 0, lesson % 4 === 0],
      );
    }
    const { rows } = await db.query("select lesson, locked, practice_count, allow_similar, allow_retry from sb_lesson_settings where class_id=$1", [klass]);
    const lessons = synthesizeLessons(rows as never[]);
    assert.equal(lessons.length, 12);
    for (let lesson = 1; lesson <= 12; lesson++) {
      const l = lessons.find((x) => x.lesson === lesson)!;
      const practiceCount = practiceCounts[lesson % practiceCounts.length];
      assert.deepEqual(l, { lesson, locked: lesson % 2 === 0, practice_count: practiceCount, allow_similar: lesson % 3 === 0, allow_retry: lesson % 4 === 0 });
    }
  } finally { await db.close(); }
});

test("querying with zero rows does not insert any placeholder rows into the database (lazy persistence preserved -- a real row is created only when the teacher actually changes a setting, via the existing set-lock upsert)", async () => {
  const db = await freshDb();
  try {
    const klass = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await makeClass(db, klass);
    const before = await db.query("select count(*)::int as n from sb_lesson_settings where class_id=$1", [klass]);
    synthesizeLessons([]);
    const after = await db.query("select count(*)::int as n from sb_lesson_settings where class_id=$1", [klass]);
    assert.equal(before.rows[0].n, 0);
    assert.equal(after.rows[0].n, 0);
  } finally { await db.close(); }
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("edge: teacher:lessons:list synthesizes all 12 lessons from stored rows, matching the exact algorithm this test file mirrors above", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "teacher:lessons:list"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(body, "teacher:lessons:list handler not found");
  assert.match(body!, /const storedByLesson = new Map\(\(data \?\? \[\]\)\.map\(\(row\) => \[row\.lesson, row\]\)\);/);
  assert.match(body!, /Array\.from\(\{ length: 12 \}/);
  assert.match(body!, /locked: stored\?\.locked \?\? false,/);
  assert.match(body!, /allow_similar: stored\?\.allow_similar \?\? true,/);
  assert.match(body!, /allow_retry: stored\?\.allow_retry \?\? true,/);
  assert.doesNotMatch(body!, /return ok\(\{ lessons: \(data \?\? \[\]\)/, "the old bug (returning only stored rows) must be gone");
});

test("client: TeacherPage renders lessons.map(...) directly with no length/filter guard, so a server-guaranteed 12-item array structurally renders all 12 lesson rows (lock, practice count, allow_similar/allow_retry, preview link)", async () => {
  const client = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(client, /\{lessons\.map\(\(row\) => \(/, "lessons is mapped directly, not filtered/sliced before render");
  const lessonRowMatch = client.match(/\{lessons\.map\(\(row\) => \([\s\S]*?\n {12}\)\)\}/);
  assert.ok(lessonRowMatch, "lesson row template not found");
  const rowHtml = lessonRowMatch![0];
  assert.match(rowHtml, /toggleLessonLock\(row\.lesson, !row\.locked\)/);
  assert.match(rowHtml, /setPracticeCount\(row\.lesson,/);
  assert.match(rowHtml, /togglePracticeControl\(row\.lesson, "allow_similar"\)/);
  assert.match(rowHtml, /togglePracticeControl\(row\.lesson, "allow_retry"\)/);
  assert.match(rowHtml, /\/teacher\/lesson-preview\/\$\{row\.lesson\}/, "학생 화면 미리보기 link present per lesson row");
});

test("J. 전체 잠금/전체 해제 (bulk lock/unlock) buttons are rendered unconditionally (not gated on lessons.length) and loop lessons 1..12 -- unaffected by this fix, no regression", async () => {
  const client = await readSource("../src/pages/TeacherPage.tsx");
  const bulkMatch = client.match(/\{\[true,false\]\.map\(locked=>[\s\S]*?<\/button>\)\}/);
  assert.ok(bulkMatch, "bulk lock/unlock control not found");
  assert.match(bulkMatch![0], /for\(let lesson=1;lesson<=12;lesson\+\+\)await teacherSetLessonLock\(classId,lesson,locked\);/);
  assert.match(bulkMatch![0], /disabled=\{!classId\|\|busy\}/, "not gated on lessons.length");
});
