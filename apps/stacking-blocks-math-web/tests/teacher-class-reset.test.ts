import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Teacher Page Expansion Phase 2C: teacher:progress:reset-class cannot call
// the existing sb_reset_progress() RPC (202609110007_teacher_reset.sql),
// because that function checks sb_owns_student() via auth.uid(), which is
// always null under the edge function's service-role context -- so it
// would reject every student with FORBIDDEN_STUDENT. The handler instead
// re-implements the SAME delete rules directly, batched across the whole
// class (one query per table, not one per student). This test runs those
// exact statements against a real PostgreSQL (via PGlite) with the actual
// migrations applied, to prove the batched rules are equivalent to
// sb_reset_progress()'s rules and that class scoping never crosses into
// another teacher's students.

async function setupDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role;`);
  await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
  for (const file of readdirSync("supabase/migrations").sort()) {
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8").replace('create extension if not exists "pgcrypto";', ""));
  }
  return db;
}

const TEACHER_A = "11111111-1111-4111-8111-111111111111";
const TEACHER_B = "22222222-2222-4222-8222-222222222222";
const CLASS_A = "33333333-3333-4333-8333-333333333333";
const CLASS_B = "44444444-4444-4444-8444-444444444444";
const STUDENT_A1 = "55555555-5555-4555-8555-555555555551";
const STUDENT_A2 = "55555555-5555-4555-8555-555555555552";
const STUDENT_B1 = "55555555-5555-4555-8555-555555555553";

async function seed(db: InstanceType<typeof PGlite>) {
  await db.exec(`insert into auth.users values('${TEACHER_A}'),('${TEACHER_B}');`);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A반','AAAA')", [CLASS_A, TEACHER_A]);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'B반','BBBB')", [CLASS_B, TEACHER_B]);
  for (const [id, classId] of [[STUDENT_A1, CLASS_A], [STUDENT_A2, CLASS_A], [STUDENT_B1, CLASS_B]] as const) {
    await db.query("insert into sb_students(id,class_id,name,pin_hash) values($1,$2,'학생','hashed')", [id, classId]);
  }
  const problem1 = "66666666-6666-4666-8666-666666666661";
  const problem3 = "66666666-6666-4666-8666-666666666663";
  const problem10 = "66666666-6666-4666-8666-666666666664";
  const problem11 = "66666666-6666-4666-8666-666666666665";
  for (const [id, lesson] of [[problem1, 1], [problem3, 3], [problem10, 10], [problem11, 11]] as const) {
    await db.query(
      "insert into sb_problems(id,lesson,problem_type,title,answer) values($1,$2,'COUNT','QA',$3)",
      [id, lesson, JSON.stringify({ kind: "count", value: 1 })],
    );
  }
  // Every student (both classes) gets attempts/progress on lesson 1 and lesson 3.
  for (const studentId of [STUDENT_A1, STUDENT_A2, STUDENT_B1]) {
    for (const [problemId, lesson] of [[problem1, 1], [problem3, 3]] as const) {
      await db.query(
        "insert into sb_problem_attempts(student_id,problem_id,lesson,wrong_count,completed,xp_earned,stars) values($1,$2,$3,2,true,30,3)",
        [studentId, problemId, lesson],
      );
    }
    await db.query("insert into sb_student_progress(student_id,lesson,completed,stars) values($1,1,true,3)", [studentId]);
    await db.query("insert into sb_student_progress(student_id,lesson,completed,stars) values($1,3,true,3)", [studentId]);
    await db.query("insert into sb_student_progress(student_id,lesson,completed,stars) values($1,10,true,3),($1,11,true,3)", [studentId]);
    await db.query(
      "insert into sb_student_rewards(student_id,total_xp,total_stars) values($1,60,6)",
      [studentId],
    );
  }
}

/** Mirrors the exact batched delete rules in teacher:progress:reset-class. */
async function resetClass(db: InstanceType<typeof PGlite>, studentIds: string[], lesson: number | null) {
  const inClause = (col: string) => `${col} = any($1::uuid[])`;
  await db.query(`delete from sb_problem_attempts where ${inClause("student_id")}${lesson !== null ? " and lesson=$2" : ""}`, lesson !== null ? [studentIds, lesson] : [studentIds]);
  await db.query(`delete from sb_block_snapshots where ${inClause("student_id")}${lesson !== null ? " and lesson=$2" : ""}`, lesson !== null ? [studentIds, lesson] : [studentIds]);
  if (lesson === null) {
    await db.query(`delete from sb_student_progress where ${inClause("student_id")}`, [studentIds]);
  } else if (lesson === 10 || lesson === 11) {
    await db.query(`delete from sb_student_progress where ${inClause("student_id")} and lesson = any($2::int[])`, [studentIds, [10, 11]]);
  } else {
    await db.query(`delete from sb_student_progress where ${inClause("student_id")} and lesson=$2`, [studentIds, lesson]);
  }
  if (lesson === null || lesson === 9) await db.query(`delete from sb_challenge_solves where ${inClause("student_id")}`, [studentIds]);
  if (lesson === null || lesson === 10 || lesson === 11) await db.query(`delete from sb_projects where ${inClause("student_id")}`, [studentIds]);
  if (lesson === null || lesson === 12) await db.query(`delete from sb_self_evaluations where ${inClause("student_id")}`, [studentIds]);

  const remaining = await db.query<{ student_id: string; xp_earned: number; stars: number }>(
    `select student_id, xp_earned, stars from sb_problem_attempts where ${inClause("student_id")}`,
    [studentIds],
  );
  const totals = new Map(studentIds.map((id) => [id, { xp: 0, stars: 0 }]));
  for (const row of remaining.rows) {
    const t = totals.get(row.student_id)!;
    t.xp += Number(row.xp_earned ?? 0);
    t.stars += Number(row.stars ?? 0);
  }
  for (const [studentId, t] of totals) {
    await db.query(
      "insert into sb_student_rewards(student_id,total_xp,total_stars,badges,streak) values($1,$2,$3,'[]',0) on conflict(student_id) do update set total_xp=excluded.total_xp,total_stars=excluded.total_stars,badges=excluded.badges,streak=excluded.streak",
      [studentId, t.xp, t.stars],
    );
  }
}

test("A. full class reset (lesson=null) clears every table for the targeted students only, resets rewards to 0", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await resetClass(db, [STUDENT_A1, STUDENT_A2], null);

    assert.equal((await db.query("select 1 from sb_problem_attempts where student_id=any($1::uuid[])", [[STUDENT_A1, STUDENT_A2]])).rows.length, 0, "A반 attempts all cleared");
    assert.equal((await db.query("select 1 from sb_student_progress where student_id=any($1::uuid[])", [[STUDENT_A1, STUDENT_A2]])).rows.length, 0, "A반 progress all cleared");
    const rewardsA = await db.query<{ total_xp: number; total_stars: number }>("select total_xp,total_stars from sb_student_rewards where student_id=$1", [STUDENT_A1]);
    assert.deepEqual(rewardsA.rows[0], { total_xp: 0, total_stars: 0 }, "reward recomputed to 0 after full reset");

    // B반 학생은 전혀 건드리지 않는다 -- classId 소유권 스코프 확인.
    assert.equal((await db.query("select 1 from sb_problem_attempts where student_id=$1", [STUDENT_B1])).rows.length, 2, "B반 attempts untouched");
    const rewardsB = await db.query<{ total_xp: number }>("select total_xp from sb_student_rewards where student_id=$1", [STUDENT_B1]);
    assert.equal(rewardsB.rows[0].total_xp, 60, "B반 reward untouched");
  } finally { await db.close(); }
});

test("B. single-lesson reset (lesson=3) only clears lesson 3, leaves lesson 1 intact", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await resetClass(db, [STUDENT_A1, STUDENT_A2], 3);

    const lesson3 = await db.query("select 1 from sb_problem_attempts where student_id=$1 and lesson=3", [STUDENT_A1]);
    assert.equal(lesson3.rows.length, 0, "lesson 3 attempts cleared");
    const lesson1 = await db.query("select 1 from sb_problem_attempts where student_id=$1 and lesson=1", [STUDENT_A1]);
    assert.equal(lesson1.rows.length, 1, "lesson 1 attempts untouched");
    const progress1 = await db.query("select completed from sb_student_progress where student_id=$1 and lesson=1", [STUDENT_A1]);
    assert.equal(progress1.rows[0].completed, true, "lesson 1 progress row untouched");
    const progress3 = await db.query("select 1 from sb_student_progress where student_id=$1 and lesson=3", [STUDENT_A1]);
    assert.equal(progress3.rows.length, 0, "lesson 3 progress row cleared");

    // Reward recomputed from the one remaining attempt (lesson 1).
    const reward = await db.query<{ total_xp: number }>("select total_xp from sb_student_rewards where student_id=$1", [STUDENT_A1]);
    assert.equal(reward.rows[0].total_xp, 30, "reward reflects only the remaining lesson-1 attempt");
  } finally { await db.close(); }
});

test("C. resetting lesson 10 also clears lesson 11 progress (combined project unit), matching sb_reset_progress's special case, but leaves lesson 1/3 alone", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await resetClass(db, [STUDENT_A1, STUDENT_A2], 10);

    const progress10 = await db.query("select 1 from sb_student_progress where student_id=$1 and lesson=10", [STUDENT_A1]);
    assert.equal(progress10.rows.length, 0, "lesson 10 progress cleared");
    const progress11 = await db.query("select 1 from sb_student_progress where student_id=$1 and lesson=11", [STUDENT_A1]);
    assert.equal(progress11.rows.length, 0, "lesson 11 progress also cleared (combined unit)");
    const progress1 = await db.query("select 1 from sb_student_progress where student_id=$1 and lesson=1", [STUDENT_A1]);
    assert.equal(progress1.rows.length, 1, "lesson 1 progress untouched");
  } finally { await db.close(); }
});

test("D. reset targets only the students belonging to the given class -- passing a class's own student ids never reaches another class's rows even if ids were (hypothetically) mixed", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    // Deliberately reset using ONLY class A's ids (as the real handler
    // would compute from `sb_students where class_id = classId`).
    const classAStudents = (await db.query<{ id: string }>("select id from sb_students where class_id=$1", [CLASS_A])).rows.map((r) => r.id);
    assert.deepEqual(new Set(classAStudents), new Set([STUDENT_A1, STUDENT_A2]));
    await resetClass(db, classAStudents, null);
    const bRows = await db.query("select 1 from sb_problem_attempts where student_id=$1", [STUDENT_B1]);
    assert.equal(bRows.rows.length, 2, "class B rows never touched by a class A reset");
  } finally { await db.close(); }
});
