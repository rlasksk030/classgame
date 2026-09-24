import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Teacher Page Expansion Phase 4 B2: moving a student between the
// teacher's own classes. Mirrors the edge function's exact statements
// (student_id preserved, only class_id changes; PIN vault/projects moved
// along since they're class_id-scoped; progress/attempts/rewards need no
// migration since their RLS is keyed on sb_owns_student(), which follows
// the student's CURRENT class_id dynamically) against real PostgreSQL.

async function setupDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
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
const CLASS_A1 = "33333333-3333-4333-8333-333333333331";
const CLASS_A2 = "33333333-3333-4333-8333-333333333332";
const CLASS_B1 = "44444444-4444-4444-8444-444444444441";
const STUDENT = "55555555-5555-4555-8555-555555555551";

async function seed(db: InstanceType<typeof PGlite>) {
  await db.exec(`insert into auth.users values('${TEACHER_A}'),('${TEACHER_B}');`);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A1','AAA1')", [CLASS_A1, TEACHER_A]);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A2','AAA2')", [CLASS_A2, TEACHER_A]);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'B1','BBB1')", [CLASS_B1, TEACHER_B]);
  await db.query("insert into sb_students(id,class_id,name,student_no,pin_hash) values($1,$2,'학생',1,'h')", [STUDENT, CLASS_A1]);
  await db.query("insert into sb_student_pin_vault(student_id,class_id,pin_plain) values($1,$2,'1234')", [STUDENT, CLASS_A1]);
  await db.query(
    "insert into sb_problems(id,lesson,problem_type,title,answer) values('66666666-6666-4666-8666-666666666661',1,'COUNT','QA',$1)",
    [JSON.stringify({ kind: "count", value: 1 })],
  );
  await db.query(
    "insert into sb_problem_attempts(student_id,problem_id,lesson,wrong_count,completed,xp_earned,stars) values($1,'66666666-6666-4666-8666-666666666661',1,2,true,30,3)",
    [STUDENT],
  );
  await db.query("insert into sb_student_progress(student_id,lesson,completed,stars) values($1,1,true,3)", [STUDENT]);
}

/** Mirrors the exact statements in teacher:students:move-class. */
async function moveStudent(db: InstanceType<typeof PGlite>, studentId: string, targetClassId: string) {
  await db.query("update sb_students set class_id=$2 where id=$1", [studentId, targetClassId]);
  await db.query("update sb_student_pin_vault set class_id=$2 where student_id=$1", [studentId, targetClassId]);
  await db.query("update sb_projects set class_id=$2 where student_id=$1", [studentId, targetClassId]);
}

test("A. moving a student preserves the student id, PIN, and progress/attempt data -- only class_id changes", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await moveStudent(db, STUDENT, CLASS_A2);

    const student = await db.query<{ id: string; class_id: string; name: string }>("select id,class_id,name from sb_students where id=$1", [STUDENT]);
    assert.equal(student.rows[0].id, STUDENT, "student id unchanged");
    assert.equal(student.rows[0].class_id, CLASS_A2, "class_id moved");
    assert.equal(student.rows[0].name, "학생", "name preserved");

    const pin = await db.query<{ pin_plain: string; class_id: string }>("select pin_plain,class_id from sb_student_pin_vault where student_id=$1", [STUDENT]);
    assert.equal(pin.rows[0].pin_plain, "1234", "PIN preserved");
    assert.equal(pin.rows[0].class_id, CLASS_A2, "PIN vault moved with the student");

    const attempts = await db.query("select * from sb_problem_attempts where student_id=$1", [STUDENT]);
    assert.equal(attempts.rows.length, 1, "attempt record preserved, not deleted/recreated");
    const progress = await db.query<{ completed: boolean }>("select completed from sb_student_progress where student_id=$1", [STUDENT]);
    assert.equal(progress.rows[0].completed, true, "progress preserved");
  } finally { await db.close(); }
});

test("B. after moving, the NEW teacher (still teacher A, owner of both classes) can read the student's progress/attempts via sb_owns_student, which follows the student's current class_id", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await moveStudent(db, STUDENT, CLASS_A2);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${TEACHER_A}';`);
    const attempts = await db.query("select * from sb_problem_attempts where student_id=$1", [STUDENT]);
    assert.equal(attempts.rows.length, 1, "teacher A (owns both A1 and A2) still sees the attempt after the move");
    const pin = await db.query("select * from sb_student_pin_vault where student_id=$1", [STUDENT]);
    assert.equal(pin.rows.length, 1, "teacher A still sees the PIN vault row scoped to the new class");
    await db.exec("reset role;");
  } finally { await db.close(); }
});

test("C. a student moved out of class A1 is no longer visible to teacher A's OLD class-scoped queries -- data isolation holds both ways", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await moveStudent(db, STUDENT, CLASS_A2);
    const stillInA1 = await db.query("select id from sb_students where class_id=$1", [CLASS_A1]);
    assert.equal(stillInA1.rows.length, 0, "class A1 has no students left after the move");
    const nowInA2 = await db.query("select id from sb_students where class_id=$1", [CLASS_A2]);
    assert.deepEqual(nowInA2.rows.map((r) => r.id), [STUDENT]);
  } finally { await db.close(); }
});

test("D. the (class_id,name,student_no) unique constraint would reject a move into a class that already has a same-named student -- the edge function must check this itself before attempting the move (source-inspection, see teacher-move-student-source.test.ts)", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await db.query("insert into sb_students(class_id,name,student_no,pin_hash) values($1,'학생',1,'h2')", [CLASS_A2]);
    await assert.rejects(
      () => moveStudent(db, STUDENT, CLASS_A2),
      /duplicate key|unique/i,
      "the DB constraint itself blocks a blind move into a name-colliding class",
    );
  } finally { await db.close(); }
});
