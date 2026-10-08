import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLegacyDb, readCatalog, legacyBackend } from './support/installer-legacy-db.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { catalogAttributeFingerprints, catalogFingerprints, inspectMigrationState } from '../scripts/installer/database-state.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';

// Supabase historically grants these defaults before app migrations. This is
// a reproducible SQL fixture, NOT evidence of any inaccessible teacher's ACL.
const supabaseDefaults = `alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`;
const tables=['sb_block_snapshots','sb_challenge_solves','sb_classes','sb_lesson_settings','sb_problem_attempts','sb_problems','sb_projects','sb_self_evaluations','sb_shared_challenges','sb_student_pin_vault','sb_student_progress','sb_student_rewards','sb_student_sessions','sb_students','sb_teacher_settings','sb_worksheet_imports'];
const rpcs=['sb_owns_class','sb_owns_student','sb_public_class_info','sb_reset_progress','sb_touch_updated_at','sb_track_challenge_author'];

test('Supabase defaults reproduce all 22 reported object names: ACL only; real broader privileges remain BLOCKED',async()=>{
  const plan=await readMathInstallerPlan(process.cwd());const db=await emptyLegacyDb();
  try {
    await db.exec(supabaseDefaults);
    for(const m of plan.migrations) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    const backend=legacyBackend(db,plan,[]),target={environment:'TEST' as const,projectRef:'synthetic-catalog',projectUrl:'https://synthetic-catalog.supabase.co',release:'test'};
    const state=await inspectMigrationState(backend,target,plan);
    assert.equal(state.drift,true);assert.equal(state.review?.comparisonBaseline,'history-prefix-24');
    assert.deepEqual(state.review!.objects.map(o=>o.key.split(':')[0]+':'+o.key.split(':')[2]).sort(),[...tables.map(t=>'tables:'+t),...rpcs.map(r=>'rpcs:'+r)].sort());
    for(const object of state.review!.objects) {
      assert.deepEqual(object.attributes!.filter(a=>a.state==='DIFFERENT').map(a=>a.name),['acl'],object.key);
      assert.ok(object.attributes!.filter(a=>a.name!=='acl').every(a=>a.state==='SAME'));
    }
    const privileges=(await db.query<{anon_read:boolean;anon_truncate:boolean;authenticated_truncate:boolean;service_execute:boolean;rls:boolean}>(`select has_table_privilege('anon','sb_student_pin_vault','SELECT') anon_read,
      has_table_privilege('anon','sb_students','TRUNCATE') anon_truncate,
      has_table_privilege('authenticated','sb_students','TRUNCATE') authenticated_truncate,
      has_function_privilege('service_role','sb_reset_progress(uuid,integer)','EXECUTE') service_execute,
      (select relrowsecurity from pg_class where oid='sb_students'::regclass) rls`)).rows[0];
    assert.deepEqual(privileges,{anon_read:true,anon_truncate:true,authenticated_truncate:true,service_execute:true,rls:true});
    // RLS does not make TRUNCATE harmless; do not normalize ALL to CRUD.
    await assert.rejects(runInstaller({target,plan,backend}),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'});
    assert.equal(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c)),false);
    // NULL default and explicit PUBLIC X are equivalent here, but the other
    // RPC grants are NOT. Prove the distinction using the SQL engine.
    await db.exec('create function public.synthetic_default() returns boolean language sql as $$select true$$;');
    const before=(await db.query("select has_function_privilege('anon','sb_owns_class(uuid)','EXECUTE') permitted")).rows;
    await db.exec('revoke execute on function sb_owns_class(uuid) from anon,authenticated,service_role');
    assert.deepEqual((await db.query("select has_function_privilege('anon','sb_owns_class(uuid)','EXECUTE') permitted")).rows,before);
    await db.exec('revoke execute on function sb_owns_class(uuid) from public');
    assert.equal((await db.query<{permitted:boolean}>("select has_function_privilege('anon','sb_owns_class(uuid)','EXECUTE') permitted")).rows[0].permitted,false);
  }finally{await db.close();}
});

test('generated attribute data matches all 27 profiles and only stores digests',async()=>{
  const plan=await readMathInstallerPlan(process.cwd());assert.equal(plan.databaseBaseline!.profiles.length,27);
  for(const profile of plan.databaseBaseline!.profiles){
    assert.deepEqual(Object.keys(profile.attributes!).sort(),Object.keys(profile.objects).sort());
    for(const attrs of Object.values(profile.attributes!)) for(const hash of Object.values(attrs)) assert.match(hash,/^[a-f0-9]{64}$/);
  }
  const db=await emptyLegacyDb();
  try{
    for(const [i,m] of plan.migrations.entries()){
      await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
      const catalog=await readCatalog(db),profile=plan.databaseBaseline!.profiles.find(p=>p.name===`history-prefix-${i+1}`)!;
      assert.deepEqual(catalogFingerprints(catalog),profile.objects);
      assert.deepEqual(catalogAttributeFingerprints(catalog),profile.attributes);
    }
  }finally{await db.close();}
  assert.equal(readFileSync('scripts/installer/database-baseline.json','utf8').includes('CREATE OR REPLACE FUNCTION'),false);
});
