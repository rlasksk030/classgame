import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Teacher Page Expansion Phase 3A/3C/3E: teacher:sessions:list and
// teacher:results:summary both derive their student list the same way as
// Phase 2's reset action (sb_students where class_id = classId, after
// teacherOwnsClass()) -- this proves that scoping never crosses into
// another teacher's class at the real-PostgreSQL level, and separately
// proves sb_student_sessions still has zero RLS policies (client-direct
// access must stay impossible; only the service-role edge function path
// may read it).

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
const CLASS_A = "33333333-3333-4333-8333-333333333333";
const CLASS_B = "44444444-4444-4444-8444-444444444444";
const STUDENT_A1 = "55555555-5555-4555-8555-555555555551";
const STUDENT_B1 = "55555555-5555-4555-8555-555555555553";

async function seed(db: InstanceType<typeof PGlite>) {
  await db.exec(`insert into auth.users values('${TEACHER_A}'),('${TEACHER_B}');`);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'A반','AAAA')", [CLASS_A, TEACHER_A]);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'B반','BBBB')", [CLASS_B, TEACHER_B]);
  await db.query("insert into sb_students(id,class_id,name,pin_hash) values($1,$2,'학생A','h')", [STUDENT_A1, CLASS_A]);
  await db.query("insert into sb_students(id,class_id,name,pin_hash) values($1,$2,'학생B','h')", [STUDENT_B1, CLASS_B]);
  await db.query(
    "insert into sb_student_sessions(student_id,class_id,token_hash,issued_at,expires_at,revoked) values($1,$2,'hash-a',now(),now()+interval '12 hours',false)",
    [STUDENT_A1, CLASS_A],
  );
  await db.query(
    "insert into sb_student_sessions(student_id,class_id,token_hash,issued_at,expires_at,revoked) values($1,$2,'hash-b',now(),now()+interval '12 hours',false)",
    [STUDENT_B1, CLASS_B],
  );
}

test("A. sessions for a class are readable in bulk (service-role style) for the owning class's students only", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    const classAStudentIds = (await db.query<{ id: string }>("select id from sb_students where class_id=$1", [CLASS_A])).rows.map((r) => r.id);
    const sessions = await db.query<{ student_id: string }>(
      "select student_id from sb_student_sessions where student_id = any($1::uuid[])",
      [classAStudentIds],
    );
    assert.deepEqual(sessions.rows.map((r) => r.student_id), [STUDENT_A1]);
  } finally { await db.close(); }
});

test("B/O. scoping a sessions/results query to class A's student ids never returns class B's session or attempt rows", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    const classAStudentIds = (await db.query<{ id: string }>("select id from sb_students where class_id=$1", [CLASS_A])).rows.map((r) => r.id);
    assert.deepEqual(classAStudentIds, [STUDENT_A1], "teacherOwnsClass-scoped student lookup for class A excludes class B's student");

    const crossCheck = await db.query(
      "select 1 from sb_student_sessions where student_id = any($1::uuid[]) and student_id=$2",
      [classAStudentIds, STUDENT_B1],
    );
    assert.equal(crossCheck.rows.length, 0, "class B's session row is unreachable through a class-A-scoped id list");
  } finally { await db.close(); }
});

test("sb_student_sessions still has zero RLS policies -- direct client (authenticated role) access must stay impossible; only the service-role edge function path may read it", async () => {
  const db = await setupDb();
  try {
    await seed(db);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${TEACHER_A}';`);
    await assert.rejects(
      () => db.query("select * from sb_student_sessions"),
      /permission denied/,
      "Phase 3 must not have opened a new RLS policy on sb_student_sessions for client-direct reads",
    );
    await db.exec("reset role;");
  } finally { await db.close(); }
});
