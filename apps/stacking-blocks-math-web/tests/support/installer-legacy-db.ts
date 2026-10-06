import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { Catalog, DataEvidence } from '../../scripts/installer/database-state.ts';
import type { InstallerPlan } from '../../scripts/installer/orchestrator.ts';
import { createFakeInstallerBackend } from '../../scripts/installer/fake-backend.ts';

export const storageStub = `create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`;
export async function emptyLegacyDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated,service_role;${storageStub}`);
  return db;
}
export async function readCatalog(db: PGlite): Promise<Catalog> {
  return (await db.query<{snapshot: Catalog}>(readFileSync('scripts/installer/catalog.sql','utf8'))).rows[0].snapshot;
}
export function legacyBackend(db: PGlite, plan: InstallerPlan, history: string[] = []) {
  const backend = createFakeInstallerBackend({ migrations: history, secrets:['APP_SESSION_SECRET'], functions:plan.functions.map(f => ({slug:f.slug,hash:f.hash,status:'ACTIVE',verifyJwt:false,version:543})) });
  backend.inspectDatabaseCatalog = () => readCatalog(db);
  backend.inspectDataEvidence = async (_target,query) => {
    backend.calls.push('inspectDataEvidence');
    return (await db.query<{evidence:DataEvidence}>(query)).rows[0].evidence;
  };
  backend.applyLegacyTransition = async (_target, query) => { backend.calls.push('applyLegacyTransition'); await db.exec(query); };
  const apply = backend.applyMigration.bind(backend);
  backend.applyMigration = async (t,m) => { await db.exec(m.query.replace('create extension if not exists "pgcrypto";', '')); await apply(t,m); };
  return backend;
}

/** Deliberately includes an earned completion without reconstructable attempts:
 * an upgrade must preserve it, not demote it during a blanket backfill. */
export async function seedProtectedRows(db: PGlite) {
  await db.exec(`insert into auth.users values('11111111-1111-4111-8111-111111111111');
insert into sb_classes(id,teacher_id,name,class_code) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','합성 보존반','PRESERVE');
insert into sb_students(id,class_id,name,student_no,pin_hash) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','합성 학생',1,'synthetic-hash');
insert into sb_student_pin_vault(student_id,class_id,pin_plain) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','synthetic');
insert into sb_student_sessions(student_id,class_id,token_hash,expires_at) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','synthetic-session-hash','2099-01-01');
insert into sb_problems(id,class_id,code,lesson,order_index,problem_type,title,answer) values('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','SYNTHETIC-PRESERVE',2,2,'COUNT','합성 문항','{"kind":"count","value":1}');
insert into sb_problem_attempts(student_id,problem_id,lesson,completed,completed_at,stars,xp_earned) values('33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555',2,true,'2026-01-01',2,30);
insert into sb_student_progress(student_id,lesson,completed,completed_at,stars) values('33333333-3333-4333-8333-333333333333',1,true,'2026-01-01',3);
insert into sb_projects(student_id,class_id,building_name,blocks,submitted) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','합성 작품','[{"x":0,"y":0,"z":0}]',true);
insert into sb_student_rewards(student_id,total_xp,total_stars) values('33333333-3333-4333-8333-333333333333',999,3) on conflict(student_id) do update set total_xp=999;
insert into sb_shared_challenges(id,class_id,author_id,share_code) values('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','PRESERVEC');
insert into sb_challenge_solves(challenge_id,student_id,correct) values('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',true);`);
}
