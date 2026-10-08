import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { emptyLegacyDb, legacyBackend, readCatalog, seedProtectedRows, storageStub } from './support/installer-legacy-db.ts';
import { createFixture } from '../qa/live-required-progress/installer-fixture.mjs';
import { inspectMigrationState, type DataEvidence } from '../scripts/installer/database-state.ts';
import { buildPermissionRecovery, prepareEquivalentLegacyTransition } from '../scripts/installer/permission-recovery.ts';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';
import { compileKnownSeedCorrection, type CapturedProfile } from '../scripts/installer/legacy-generation.ts';

test('single reviewed seed correction fails closed if shipped identity or any reviewed content changes',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()), expected=plan.legacyRecovery!.knownSeedCorrection!;
  assert.equal(expected.code,'L1-03');
  const db=await emptyLegacyDb();
  const catalog=await readCatalog(db);await db.close();
  const profile=(prefix:number,data:Record<string,unknown>):CapturedProfile=>({name:`history-prefix-${prefix}`,prefix,catalog,digest:'synthetic',storagePolicies:[],seeds:[{...data,id:expected.id,code:expected.code,class_id:null}]});
  const before=profile(2,expected.before), after=profile(24,expected.after);
  assert.deepEqual(compileKnownSeedCorrection([before,after],after),expected);
  const reject=(old:CapturedProfile,next:CapturedProfile)=>assert.throws(()=>compileKnownSeedCorrection([old,next],next),/KNOWN_SEED_CORRECTION_SOURCE_CHANGED/);
  const changed=(source:CapturedProfile,patch:Record<string,unknown>)=>({...source,seeds:[{...source.seeds[0],...patch}]});
  reject(changed(before,{answer:{kind:'count',value:7}}),after);
  reject(before,changed(after,{prompt:'changed current instructions'}));
  reject(changed(before,{prompt:'same but unreviewed instructions'}),changed(after,{prompt:'same but unreviewed instructions'}));
  reject(changed(before,{problem_type:'COUNT'}),changed(after,{problem_type:'COUNT'}));
  reject(changed(before,{id:'11111111-1111-4111-8111-111111111111'}),after);
  reject(changed(before,{id:'11111111-1111-4111-8111-111111111111'}),changed(after,{id:'11111111-1111-4111-8111-111111111111'}));
  reject(before,{...after,seeds:[]});
  reject(before,{...after,seeds:[...after.seeds,...after.seeds]});
  assert.throws(()=>compileKnownSeedCorrection([before,changed(before,{answer:{kind:'count',value:5}}),after],after),/KNOWN_SEED_CORRECTION_SOURCE_CHANGED/);
});

const target={environment:'TEST' as const,projectRef:'synthetic-evidence',projectUrl:'https://synthetic-evidence.supabase.co',publishableKey:'sb_publishable_synthetic',release:'test'};
async function fixture(prefix=24) {
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  for(const m of plan.migrations.slice(0,prefix)) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
  const transition=plan.legacyRecovery!.transitions.find(t=>t.from===`history-prefix-${prefix}`)!;
  const evidence=async()=> (await db.query<{evidence:DataEvidence}>(transition.evidenceQuery)).rows[0].evidence;
  return {plan,db,evidence};
}
test('teacher-added nested data is not an exact historical seed and survives recovery',async()=>{
  const {plan,db,evidence}=await fixture(11);
  try {
    const before=await evidence();assert.ok(before.seedOutdated>0);
    await db.exec(`update sb_problems set given=given||'{"teacher_extension":{"instruction":"keep this local fixture"}}'::jsonb where code='L2-01'`);
    const changed=(await db.query<{given:unknown}>("select given from sb_problems where code='L2-01'")).rows[0].given;
    assert.equal((await evidence()).seedOutdated,before.seedOutdated-1,'JSON containment must not treat extra teacher data as exact old content');
    assert.equal((await evidence()).customizedSeedCount,1);
    const backend=legacyBackend(db,plan,[]);
    assert.equal((await runInstaller({target,plan,backend})).status,'COMPLETE');
    assert.deepEqual((await db.query<{given:unknown}>("select given from sb_problems where code='L2-01'")).rows[0].given,changed);
  }finally{await db.close();}
});

test('duplicate defaults are counted separately from referenced attempts and never auto-deleted',async()=>{
  const {plan,db,evidence}=await fixture();
  try {
    await seedProtectedRows(db);
    await db.exec(`insert into sb_problems(code,lesson,order_index,problem_type,title,answer) select code,lesson,order_index,problem_type,title,answer from sb_problems where code='L1-01';
insert into sb_problem_attempts(student_id,problem_id,lesson) select '33333333-3333-4333-8333-333333333333',id,1 from sb_problems where code='L1-01';`);
    const result=await evidence();assert.equal(result.duplicateSeedCount,1);assert.equal(result.duplicateSeedReferencedCount,2);assert.equal(result.dataConflict,1);
    assert.equal(result.storageBucketConflictCount,0);assert.equal(result.storagePolicyConflictCount,0);
    const before=(await db.query<{hash:string}>("select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) hash from sb_problems p")).rows[0].hash;
    const backend=legacyBackend(db,plan,[]);
    await assert.rejects(runInstaller({target,plan,backend}),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'});
    assert.equal((await db.query<{hash:string}>("select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) hash from sb_problems p")).rows[0].hash,before);
    assert.equal(backend.calls.some(c=>/^(apply|setSecrets|deploy)/.test(c)),false);
  }finally{await db.close();}
});

test('missing seeds/history conflict remain separate and additive recovery is idempotent',async()=>{
  const {plan,db,evidence}=await fixture();
  try {
    // Synthetic unreferenced row only. Real student data must never be deleted.
    await db.exec("delete from sb_problems where code='L1-01'");
    assert.equal((await evidence()).seedMissing,1);assert.equal((await evidence()).dataConflict,0);
    const history=legacyBackend(db,plan,plan.migrations.map(m=>m.name));
    assert.equal((await inspectMigrationState(history,target,plan)).review!.reason,'DATA_EVIDENCE_CONFLICT');
    const missingHistory=legacyBackend(db,plan,[]);
    assert.equal((await runInstaller({target,plan,backend:missingHistory})).status,'COMPLETE');
    assert.equal((await evidence()).seedMissing,0);
    const writes=missingHistory.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length;
    await runInstaller({target,plan,backend:missingHistory});
    assert.equal(missingHistory.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length,writes);
  }finally{await db.close();}
});

test('reserved seed UUID assigned to another code or class is never overwritten or treated as safe additive',async()=>{
  const {plan,db,evidence}=await fixture();
  try {
    await seedProtectedRows(db);
    await db.exec("update sb_problems set code='TEACHER-RENAMED' where code='L1-01'");
    assert.equal((await evidence()).seedIdentityConflictCount,1);assert.equal((await evidence()).dataConflict,1);assert.equal((await evidence()).seedMissing,0);
    await db.exec("update sb_problems set class_id='22222222-2222-4222-8222-222222222222' where code='TEACHER-RENAMED'");
    assert.equal((await evidence()).seedIdentityConflictCount,1);assert.equal((await evidence()).seedMissing,1);
    const backend=legacyBackend(db,plan,[]);
    await assert.rejects(runInstaller({target,plan,backend}),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'});
    assert.equal(backend.calls.some(c=>/^(apply|setSecrets|deploy)/.test(c)),false);
    assert.equal((await db.query<{count:number}>("select count(*)::int count from sb_problems where code='TEACHER-RENAMED' and class_id is not null")).rows[0].count,1);
  }finally{await db.close();}
});

test('public storage buckets and actual permissive policy differences are distinct conflicts',async()=>{
  const {plan,db,evidence}=await fixture();
  try {
    assert.equal((await evidence()).storageBucketConflictCount,0);assert.equal((await evidence()).storagePolicyConflictCount,0);
    await db.exec("update storage.buckets set public=true where id='sb-problem-images';alter policy sb_problem_crops on storage.objects using(true)");
    const result=await evidence();assert.equal(result.storageBucketConflictCount,1);assert.equal(result.storagePolicyConflictCount,1);assert.equal(result.dataConflict,2);assert.equal(result.storageMissing,0);
    const backend=legacyBackend(db,plan,[]);
    await assert.rejects(runInstaller({target,plan,backend}),{code:'INSTALLER_MANUAL_REVIEW_REQUIRED'});
    assert.equal(backend.calls.some(c=>/^(apply|setSecrets|deploy)/.test(c)),false);
  }finally{await db.close();}
});

test('identical storage policy deparses differently with search_path; canonical read-only inspection keeps rights and session unchanged',async()=>{
  const {plan,db,evidence}=await fixture();
  try {
    const original=(await db.query<{policies:unknown}>("select jsonb_agg(to_jsonb(p) order by policyname) policies from pg_policies p where schemaname='storage'")).rows[0].policies;
    assert.equal((await evidence()).storagePolicyConflictCount,0);
    await db.exec('set search_path=public,auth,storage');
    assert.equal((await evidence()).storagePolicyConflictCount,2,'raw deparser strings cause false conflict without any policy DDL');
    const backend=legacyBackend(db,plan,[]),q=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-24')!.evidenceQuery;
    const safe=await backend.inspectDataEvidence!(target,q);assert.equal(safe.storagePolicyConflictCount,0);assert.equal(safe.dataConflict,0);
    assert.equal((await db.query<{search_path:string}>('show search_path')).rows[0].search_path,'public, auth, storage','transaction-local setting does not leak into next request');
    await db.exec('set search_path=public');
    assert.deepEqual((await db.query<{policies:unknown}>("select jsonb_agg(to_jsonb(p) order by policyname) policies from pg_policies p where schemaname='storage'")).rows[0].policies,original);
    assert.equal(backend.calls.some(c=>/^(apply|setSecrets|deploy)/.test(c)),false);
  }finally{await db.close();}
});

test('13 synthetic students in the manual contract retain PIN/answers/completion/projects/rewards; normal revisit writes zero',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await createFixture();
  try {
    await db.exec(storageStub);await seedProtectedRows(db);
    await db.exec(`insert into sb_students(class_id,name,student_no,pin_hash) select '22222222-2222-4222-8222-222222222222','합성 학생 '||n,n,'synthetic-hash-'||n from generate_series(2,13) n;`);
    const studentHash=async()=> (await db.query<{hash:string}>('select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) hash from sb_students s')).rows[0].hash;
    const before=await studentHash();
    await db.exec(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
    const backend=legacyBackend(db,plan,[]);
    await runInstaller({target,plan,backend});
    const assessment=await inspectMigrationState(backend,target,plan);
    assert.equal(assessment.baseline,'manual-required-progress-contract');assert.equal(assessment.drift,false);assert.equal(assessment.evidence!.classProblemCount,1);assert.equal(assessment.evidence!.dataConflict,0);
    assert.equal((await db.query<{count:number}>('select count(*)::int count from sb_students')).rows[0].count,13);assert.equal(await studentHash(),before);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where lesson=1')).rows[0].completed,true);
    assert.equal((await db.query<{total_xp:number}>('select total_xp from sb_student_rewards')).rows[0].total_xp,999);
    for(const table of ['sb_student_pin_vault','sb_problem_attempts','sb_projects','sb_student_sessions']) assert.equal((await db.query<{count:number}>(`select count(*)::int count from ${table}`)).rows[0].count,1);
    const writes=backend.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length;
    await runInstaller({target,plan,backend});assert.equal(backend.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length,writes);
  }finally{await db.close();}
});


test('consented ACL recovery then pending progress repair reaches COMPLETE and revisit writes zero',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    await db.exec('alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;');
    for(const m of plan.migrations) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    await seedProtectedRows(db);
    const permissions=async()=> (await db.query<{snapshot:PermissionSnapshot}>(readFileSync('scripts/installer/permission-audit.sql','utf8'))).rows[0].snapshot;
    const history=plan.migrations.map(m=>m.name);
    const recovery=buildPermissionRecovery(plan,history,await readCatalog(db),await permissions());
    assert.equal(recovery.recoverable,true);if(!recovery.recoverable) throw new Error(recovery.reason);
    await db.exec(recovery.query);
    const beforeRights=await permissions(),beforeCatalog=await readCatalog(db);
    const studentsBefore=(await db.query('select to_jsonb(t) row_data from sb_students t')).rows;
    const backend=legacyBackend(db,plan,history);backend.inspectDatabasePermissions=permissions;
    const state=await inspectMigrationState(backend,target,plan);
    assert.equal(state.drift,false);assert.equal(state.recovery,'LEGACY_RESUME_CANDIDATE');assert.equal(state.evidence!.progressMissing,2);
    const transition=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-24')!;
    const guarded=prepareEquivalentLegacyTransition(plan,transition,beforeCatalog,beforeRights);assert.ok(guarded);
    await db.exec('grant truncate on sb_students to anon');
    assert.equal(prepareEquivalentLegacyTransition(plan,transition,await readCatalog(db),await permissions()),undefined,'broader privilege cannot enter the equivalent wrapper');
    await assert.rejects(db.exec(guarded),/INSTALLER_PERMISSION_PLAN_STALE/);await db.exec('rollback');
    await db.exec('revoke truncate on sb_students from anon');
    const finalGuard=guarded.lastIndexOf('do $acl_legacy$ begin');assert.ok(finalGuard>0);
    await assert.rejects(db.exec(guarded.slice(0,finalGuard)+'grant truncate on sb_students to anon;\n'+guarded.slice(finalGuard)),/INSTALLER_PERMISSION_PLAN_STALE/);await db.exec('rollback');
    assert.deepEqual(await permissions(),beforeRights,'mid-transaction permission change rolls back');
    assert.equal((await inspectMigrationState(backend,target,plan)).evidence!.progressMissing,2,'failed transaction must roll progress changes back too');
    assert.equal((await runInstaller({target,plan,backend})).status,'COMPLETE');
    assert.deepEqual(await permissions(),beforeRights,'data-only continuation cannot grant or revoke rights');
    assert.deepEqual(await readCatalog(db),beforeCatalog,'explicit equivalent ACLs stay intact');
    assert.deepEqual((await db.query('select to_jsonb(t) row_data from sb_students t')).rows,studentsBefore);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where lesson=1')).rows[0].completed,true);
    assert.equal((await db.query<{total_xp:number}>('select total_xp from sb_student_rewards')).rows[0].total_xp,999);
    const final=await inspectMigrationState(backend,target,plan);assert.equal(final.drift,false);assert.equal(final.recovery,undefined);assert.equal(final.evidence!.progressMissing,0);
    const writes=backend.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length;
    await runInstaller({target,plan,backend});assert.equal(backend.calls.filter(c=>/^(apply|setSecrets|deploy)/.test(c)).length,writes);
  }finally{await db.close();}
});


test('outdated seed details expose only known codes and exact FK/non-FK reference counts; diagnostics never modify data',async()=>{
  const {plan,db,evidence}=await fixture(11);
  type Detail={code:string,attemptCount:number,snapshotCount:number,progressCount:number,lessonProgressCount:number,practiceAssignmentCount:number};
  const details=async()=> ((await evidence()) as DataEvidence & {outdatedSeedDetails:Detail[]}).outdatedSeedDetails;
  try {
    const known=['L1-03','L2-01','L2-03','L5-01','L12-04'];
    const first=await details();assert.equal(first.length,(await evidence()).seedOutdated);
    assert.ok(first.length>0&&first.length<=5);
    for(const d of first) {assert.ok(known.includes(d.code));assert.deepEqual(Object.keys(d).sort(),['code','attemptCount','snapshotCount','progressCount','lessonProgressCount','practiceAssignmentCount'].sort());assert.deepEqual(Object.values(d).filter(v=>typeof v==='number'),[0,0,0,0,0]);}
    const fk=(await db.query<{source:string}>("select conrelid::regclass::text source from pg_constraint where contype='f' and confrelid='public.sb_problems'::regclass order by source")).rows.map(r=>r.source);
    assert.deepEqual(fk,['sb_block_snapshots','sb_problem_attempts','sb_student_progress']);
    const old=(await db.query<{row:Record<string,unknown>}>("select to_jsonb(p) row from sb_problems p where code='L2-01'")).rows[0].row;
    await seedProtectedRows(db);
    await db.exec(`insert into sb_problem_attempts(student_id,problem_id,lesson) select '33333333-3333-4333-8333-333333333333',id,lesson from sb_problems where code='L2-01';
insert into sb_block_snapshots(student_id,problem_id,lesson) select '33333333-3333-4333-8333-333333333333',id,lesson from sb_problems where code='L2-01';
insert into sb_student_progress(student_id,lesson,last_problem_id) select '33333333-3333-4333-8333-333333333333',lesson,id from sb_problems where code='L2-01';`);
    assert.deepEqual((await details()).find(d=>d.code==='L2-01'),{code:'L2-01',attemptCount:1,snapshotCount:1,progressCount:1,lessonProgressCount:0,practiceAssignmentCount:0});
    await db.exec("update sb_problems set code='REMOTE-PRIVATE-TEXT-NEVER-RETURN' where code='L2-01'");
    assert.ok((await details()).some(d=>d.code==='L2-01'));assert.doesNotMatch(JSON.stringify(await details()),/REMOTE-PRIVATE|33333333|blocks|answer|prompt|title/);
    await db.exec("update sb_problems set code='L2-01' where code='REMOTE-PRIVATE-TEXT-NEVER-RETURN'");
    for(const m of plan.migrations.slice(11)) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    // Reproduce an applied-history DB retaining one exact historical row. This
    // is disposable fixture setup, never a recommended remote mutation.
    await db.query(`update sb_problems p set problem_type=s.problem_type,prompt=s.prompt,choices=s.choices,answer=s.answer,given_blocks=s.given_blocks,given=s.given from jsonb_populate_record(null::sb_problems,$1::jsonb) s where p.id=s.id`,[JSON.stringify(old)]);
    const references=[String(old.id),'L2-01','seed:L2-01'];
    for(const [i,reference] of references.entries()) {
      await db.query(`insert into sb_lesson_progress_records(installation_id,class_id,student_id,curriculum_version,lesson,stage,set_id,problem_id,question_index) values('synthetic-evidence','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','synthetic',2,'solve',$1,$2,0)`,[`local-${i}`,reference]);
      const ids=i===2?{nested:[{problemId:reference}]}:[reference];
      await db.query(`insert into sb_practice_assignments(installation_id,class_id,student_id,lesson,curriculum_version,set_id,seed,problem_ids,target_total,active) values('synthetic-evidence','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',2,'synthetic',$1,1,$2::jsonb,5,false)`,[`local-${i}`,JSON.stringify(ids)]);
    }
    const latestQuery=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-24')!.evidenceQuery;
    const latest=async()=> (await db.query<{evidence:DataEvidence & {outdatedSeedDetails:Detail[]}}>(latestQuery)).rows[0].evidence;
    const snapshots=async()=> Promise.all(['sb_students','sb_problems','sb_problem_attempts','sb_block_snapshots','sb_student_progress','sb_lesson_progress_records','sb_practice_assignments'].map(async table=>(await db.query<{hash:string}>(`select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) hash from ${table} t`)).rows[0].hash));
    const before=await snapshots();const result=await latest();
    assert.equal(result.seedOutdated,1);assert.deepEqual(result.outdatedSeedDetails,[{code:'L2-01',attemptCount:1,snapshotCount:1,progressCount:1,lessonProgressCount:3,practiceAssignmentCount:3}]);
    assert.deepEqual(await snapshots(),before,'read-only diagnosis leaves all students, questions and referenced records unchanged');
    await db.exec(`update sb_problems set given=given||'{"teacher_extension":true}'::jsonb where code='L2-01'`);
    assert.equal((await latest()).seedOutdated,0);assert.deepEqual((await latest()).outdatedSeedDetails,[]);
  }finally{await db.close();}
});
