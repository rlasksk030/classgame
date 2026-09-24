import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Global lesson resume: a student re-entering a lesson must land on the
// first problem they have NOT actually completed, computed from
// sb_problem_attempts.completed (the server's real record), never from
// the client's last-visited problem (sb_student_progress.last_problem_id)
// or browser localStorage -- so it works identically after a reload, a
// logout/login, or a fresh browser/device with no local state at all.
//
// This mirrors the exact algorithm added to the "lessonProblems" handler
// in supabase/functions/student-api/index.ts (kept in lockstep by the
// source-inspection test below).

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

async function makeProblem(db: PGlite, id: string, lesson: number, orderIndex: number) {
  // sb_problems has no stage column -- stage is always derived from
  // order_index (<=1 concept, ===2 check, else more), exactly matching
  // parseProblemRow() in the real edge function.
  await db.query(
    `insert into sb_problems(id,class_id,lesson,order_index,problem_type,title,prompt,grid_width,grid_depth,max_height,given_blocks,start_blocks,given,choices,answer,grading_mode,active,code)
     values($1,null,$2,$3,'COUNT','t','p',3,3,3,'[]','[]','{}','[]','{"kind":"count","value":1}','exact',true,$4)`,
    [id, lesson, orderIndex, `TEST-${id}`],
  );
}

async function markAttempt(db: PGlite, studentId: string, problemId: string, lesson: number, completed: boolean) {
  await db.query(
    `insert into sb_problem_attempts(student_id,problem_id,lesson,completed,attempt_count) values($1,$2,$3,$4,1)
     on conflict (student_id,problem_id) do update set completed=excluded.completed`,
    [studentId, problemId, lesson, completed],
  );
}

// Mirrors the resume calculation added to teacher:lessons:list's sibling,
// the "lessonProblems" student action.
function computeResume(
  nonMore: { id: string }[],
  more: { id: string }[],
  completedIds: Set<string>,
  moreCompletedIds: Set<string>,
  lastProblemId: string | null,
) {
  const firstUnfinishedRequired = nonMore.find((p) => !completedIds.has(p.id));
  const firstUnfinishedMore = more.find((p) => !moreCompletedIds.has(p.id));
  return firstUnfinishedRequired?.id ?? firstUnfinishedMore?.id ?? lastProblemId ?? null;
}

test("A/B/C. practice problems 1-4 completed (stage='more'), required already done -> resume lands on problem 5, regardless of reload/relogin/new-device (all server-side, no client state involved)", async () => {
  const db = await freshDb();
  try {
    const classId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const studentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await makeClassAndStudent(db, classId, studentId);
    const checkId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await makeProblem(db, checkId, 1, 2);
    await markAttempt(db, studentId, checkId, 1, true); // required already complete

    const moreIds = Array.from({ length: 6 }, (_, i) => `dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`);
    for (let i = 0; i < moreIds.length; i++) await makeProblem(db, moreIds[i], 1, 100 + i);
    for (let i = 0; i < 4; i++) await markAttempt(db, studentId, moreIds[i], 1, true); // problems 1-4 done

    const { rows: nonMore } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index<=2 order by order_index", []);
    const { rows: more } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index>2 order by order_index", []);
    const { rows: completedRows } = await db.query("select problem_id from sb_problem_attempts where student_id=$1 and completed=true", [studentId]);
    const completedIds = new Set(completedRows.map((r: { problem_id: string }) => r.problem_id));

    const resumeId = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, null);
    assert.equal(resumeId, moreIds[4], "resume must be problem 5 (index 4), not problem 1");

    // "new device" = re-running the exact same server-side query with no
    // client state at all reproduces the identical result -- there is no
    // separate code path that could diverge.
    const resumeIdAgain = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, null);
    assert.equal(resumeIdAgain, moreIds[4]);
  } finally { await db.close(); }
});

test("D. problem 5 left mid-attempt (wrong twice, not completed) -> resume returns to problem 5, not problem 6", async () => {
  const db = await freshDb();
  try {
    const classId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const studentId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await makeClassAndStudent(db, classId, studentId);
    const checkId = "11111111-2222-4333-8444-555555555555";
    await makeProblem(db, checkId, 1, 2);
    await markAttempt(db, studentId, checkId, 1, true);

    const moreIds = Array.from({ length: 6 }, (_, i) => `22222222-3333-4444-8555-66666666660${i}`);
    for (let i = 0; i < moreIds.length; i++) await makeProblem(db, moreIds[i], 1, 100 + i);
    for (let i = 0; i < 4; i++) await markAttempt(db, studentId, moreIds[i], 1, true);
    // problem 5 (index 4): an attempt row exists but completed=false (2 wrong tries, not finished)
    await db.query(
      `insert into sb_problem_attempts(student_id,problem_id,lesson,completed,wrong_count,attempt_count) values($1,$2,1,false,2,2)`,
      [studentId, moreIds[4]],
    );

    const { rows: nonMore } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index<=2 order by order_index", []);
    const { rows: more } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index>2 order by order_index", []);
    const { rows: completedRows } = await db.query("select problem_id from sb_problem_attempts where student_id=$1 and completed=true", [studentId]);
    const completedIds = new Set(completedRows.map((r: { problem_id: string }) => r.problem_id));

    const resumeId = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, null);
    assert.equal(resumeId, moreIds[4], "an in-progress (not completed) problem must be returned to, not skipped");
  } finally { await db.close(); }
});

test("E. problem 5 completed -> resume advances to problem 6", async () => {
  const db = await freshDb();
  try {
    const classId = "77777777-7777-4777-8777-777777777777";
    const studentId = "88888888-8888-4888-8888-888888888888";
    await makeClassAndStudent(db, classId, studentId);
    const checkId = "99999999-9999-4999-8999-999999999999";
    await makeProblem(db, checkId, 1, 2);
    await markAttempt(db, studentId, checkId, 1, true);

    const moreIds = Array.from({ length: 6 }, (_, i) => `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0${i}`);
    for (let i = 0; i < moreIds.length; i++) await makeProblem(db, moreIds[i], 1, 100 + i);
    for (let i = 0; i < 5; i++) await markAttempt(db, studentId, moreIds[i], 1, true); // 1-5 done

    const { rows: nonMore } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index<=2 order by order_index", []);
    const { rows: more } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index>2 order by order_index", []);
    const { rows: completedRows } = await db.query("select problem_id from sb_problem_attempts where student_id=$1 and completed=true", [studentId]);
    const completedIds = new Set(completedRows.map((r: { problem_id: string }) => r.problem_id));

    const resumeId = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, null);
    assert.equal(resumeId, moreIds[5]);
  } finally { await db.close(); }
});

test("F. all required + all practice problems completed -> falls back to last_problem_id (existing 완료/선택 연습 behavior for a fully-done lesson)", async () => {
  const db = await freshDb();
  try {
    const classId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const studentId = "cccccccc-dddd-4eee-8fff-000000000000";
    await makeClassAndStudent(db, classId, studentId);
    const checkId = "dddddddd-eeee-4fff-8000-111111111111";
    await makeProblem(db, checkId, 1, 2);
    await markAttempt(db, studentId, checkId, 1, true);
    const moreId = "eeeeeeee-ffff-4000-8111-222222222222";
    await makeProblem(db, moreId, 1, 100);
    await markAttempt(db, studentId, moreId, 1, true);

    const { rows: nonMore } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index<=2 order by order_index", []);
    const { rows: more } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index>2 order by order_index", []);
    const { rows: completedRows } = await db.query("select problem_id from sb_problem_attempts where student_id=$1 and completed=true", [studentId]);
    const completedIds = new Set(completedRows.map((r: { problem_id: string }) => r.problem_id));

    const resumeId = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, "SOME_LAST_ID");
    assert.equal(resumeId, "SOME_LAST_ID", "nothing left unfinished -> falls back cleanly, no crash/null-everything");
  } finally { await db.close(); }
});

test("G. a since-deactivated problem is excluded from the resume calculation entirely -- an inactive problem the student already skipped past never blocks progress", async () => {
  const db = await freshDb();
  try {
    const classId = "ffffffff-0000-4111-8222-333333333333";
    const studentId = "00000000-1111-4222-8333-444444444444";
    await makeClassAndStudent(db, classId, studentId);
    const checkId = "11111111-2222-4333-8555-666666666666";
    await makeProblem(db, checkId, 1, 2);
    await markAttempt(db, studentId, checkId, 1, true);

    const activeId = "22222222-3333-4444-8666-777777777777";
    const inactiveId = "33333333-4444-4555-8777-888888888888";
    await makeProblem(db, activeId, 1, 100);
    await makeProblem(db, inactiveId, 1, 101);
    await db.query("update sb_problems set active=false where id=$1", [inactiveId]);
    // neither has been attempted

    // The real handler only ever loads active=true rows into `parsed` (see
    // the .eq("active", true) filter in lessonProblems) -- mirrored here.
    const { rows: nonMore } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index<=2 and active=true order by order_index", []);
    const { rows: more } = await db.query("select id from sb_problems where lesson=1 and code like 'TEST-%' and order_index>2 and active=true order by order_index", []);
    const { rows: completedRows } = await db.query("select problem_id from sb_problem_attempts where student_id=$1 and completed=true", [studentId]);
    const completedIds = new Set(completedRows.map((r: { problem_id: string }) => r.problem_id));

    const resumeId = computeResume(nonMore as { id: string }[], more as { id: string }[], completedIds, completedIds, null);
    assert.equal(resumeId, activeId, "the inactive problem must never be selected, and must not block reaching the active one");
  } finally { await db.close(); }
});

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("edge: lessonProblems computes currentProblemId from real sb_problem_attempts completion (required, then practice-set), never from last_problem_id alone -- catches the reported bug (resume always restarted at problem 1)", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "lessonProblems"\) \{[\s\S]*?\n {6}\}\);\n {4}\}/)?.[0];
  assert.ok(body, "lessonProblems handler not found");
  assert.match(body!, /const firstUnfinishedRequired=nonMoreProblems\.find\(p=>!completedIds\.has\(p\.id\)\);/);
  assert.match(body!, /const firstUnfinishedMore=moreProblems\.find\(p=>!moreCompletedIds\.has\(p\.id\)\);/);
  assert.match(body!, /const resumeProblemId=firstUnfinishedRequired\?\.id \?\? firstUnfinishedMore\?\.id \?\? progressPosition\?\.last_problem_id \?\? null;/);
  assert.match(body!, /currentProblemId: resumeProblemId,/);
  assert.doesNotMatch(body!, /currentProblemId: progressPosition\?\.last_problem_id \?\? null,/, "the old last-visited-only value must be gone");
});

test("H/I. existing lessonProblems response shape (problems, requiredComplete, practiceSet, stages, allowSimilar, allowRetry) is unchanged -- only currentProblemId's computation changed, nothing removed", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const body = edge.match(/if \(action === "lessonProblems"\) \{[\s\S]*?\n {6}\}\);\n {4}\}/)?.[0];
  assert.ok(body);
  assert.match(body!, /problems,/);
  assert.match(body!, /seedFallback: false,/);
  assert.match(body!, /requiredComplete,/);
  assert.match(body!, /practiceSet: practiceSetStatus\(/);
  assert.match(body!, /stages,/);
  assert.match(body!, /allowSimilar: lessonSetting\?\.allow_similar \?\? true,/);
  assert.match(body!, /allowRetry: lessonSetting\?\.allow_retry \?\? true,/);
});
