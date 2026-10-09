import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDataRecovery } from '../scripts/installer/data-recovery.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';
import type { DataEvidence } from '../scripts/installer/data-evidence.ts';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { emptyLegacyDb, legacyBackend, readCatalog, seedProtectedRows, storageStub } from './support/installer-legacy-db.ts';
import { createFixture } from '../qa/live-required-progress/installer-fixture.mjs';
import { grade } from '../shared/grading.ts';
import { applyAttempt } from '../shared/attempts.ts';

const target={environment:'TEST' as const,projectRef:'synthetic-data-consent',projectUrl:'https://synthetic-data-consent.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',release:'test'};
const permissionSql=readFileSync('scripts/installer/permission-audit.sql','utf8');
async function fixture(manual: boolean | 'live-v4'=false) {
  const plan=await readMathInstallerPlan(process.cwd()),db=await (manual ? createFixture() : emptyLegacyDb());
  if(manual) {
    await db.exec(storageStub);
    await db.exec(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
    if(manual==='live-v4') for(const m of plan.migrations.slice(20)) await db.exec(m.query);
  } else for(const m of plan.migrations) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
  await seedProtectedRows(db);
  const profile=manual==='live-v4' ? 'manual-live-v4-contract' : manual ? 'manual-required-progress-contract' : `history-prefix-${plan.migrations.length}`;
  const history=manual ? [] : plan.migrations.map(m=>m.name),backend=legacyBackend(db,plan,history);
  await runInstaller({target,plan,backend});
  await db.exec(`insert into sb_students(id,class_id,name,student_no,pin_hash) select gen_random_uuid(),'22222222-2222-4222-8222-222222222222','합성보존학생'||n,10+n,'synthetic-hash-'||n from generate_series(1,12) n;
insert into sb_problem_attempts(student_id,problem_id,lesson,completed,attempt_count,stars,xp_earned) select id,'95dd8f12-9215-430b-893c-d830c0368798',1,true,2,2,20 from sb_students;
insert into sb_block_snapshots(student_id,problem_id,lesson,blocks) select id,'95dd8f12-9215-430b-893c-d830c0368798',1,'[{"x":0,"y":0,"z":0}]'::jsonb from sb_students;
insert into sb_student_progress(student_id,lesson,last_problem_id) select id,1,'95dd8f12-9215-430b-893c-d830c0368798' from sb_students on conflict(student_id,lesson) do update set last_problem_id=excluded.last_problem_id;
update sb_problems set answer='{"kind":"count","value":6}' where code='L1-03';`);
  const transition=plan.legacyRecovery!.transitions.find(t=>t.from===profile && t.to===profile)!;
  const evidence=async()=>await backend.inspectDataEvidence!(target,transition.evidenceQuery) as DataEvidence;
  const permissions=async()=>(await db.query<{snapshot:PermissionSnapshot}>(permissionSql)).rows[0].snapshot;
  const build=async()=>buildDataRecovery(plan,history,await readCatalog(db),await permissions(),await evidence());
  const catalog=await readCatalog(db);
  const rowsSql=catalog.tables.map(t=>`select '${t.name}' table_name,to_jsonb(t) row_data from public."${t.name}" t`).join(' union all ');
  const rows=async()=>(await db.query<{table_name:string;row_data:Record<string,unknown>}>(rowsSql)).rows;
  return {plan,db,history,profile,evidence,permissions,build,rows};
}

for(const manual of [false,true,'live-v4'] as const) test(`${manual==='live-v4' ? 'manual-live-v4' : manual ? 'manual' : 'latest'} explicit historical-answer correction preserves 13 students and every related row; replay is no-op`,async()=>{
  const f=await fixture(manual);
  try {
    const before=await f.rows(),catalog=await readCatalog(f.db),permissions=await f.permissions();
    assert.equal(before.filter(r=>r.table_name==='sb_students').length,13);
    const evidence=await f.evidence(); assert.equal(evidence.seedOutdated,1);assert.equal(evidence.dataConflict,0);assert.equal(evidence.progressMissing,0);
    const recovery=await f.build();assert.equal(recovery.recoverable,true);if(!recovery.recoverable) throw new Error(recovery.reason);
    assert.equal(recovery.profile,f.profile);
    assert.deepEqual(recovery.changes,[{code:'L1-03',fields:['answer','updated_at'],historicalFeedbackChanges:true,referenceCounts:{attemptCount:13,snapshotCount:13,progressCount:13,lessonProgressCount:0,practiceAssignmentCount:0}}]);
    assert.equal(JSON.stringify(recovery.changes).includes(f.plan.legacyRecovery!.knownSeedCorrection!.id),false);
    assert.deepEqual(await f.rows(),before,'planning is read-only and cannot alter a student record');
    await f.db.exec(recovery.query);
    const after=await f.rows(),id=f.plan.legacyRecovery!.knownSeedCorrection!.id;
    const old=before.find(r=>r.table_name==='sb_problems' && r.row_data.id===id)!;
    const changed=after.find(r=>r.table_name==='sb_problems' && r.row_data.id===id)!;
    assert.deepEqual(changed.row_data.answer,{kind:'blocks',blocks:[]});
    const normalize=(rows:typeof before)=>rows.map(row=>row.table_name==='sb_problems' && row.row_data.id===id ? {...row,row_data:{...row.row_data,answer:old.row_data.answer,updated_at:old.row_data.updated_at}} : row);
    assert.deepEqual(normalize(after),before,'all students/PINs/attempts/snapshots/progress/projects/rewards and all other seed fields byte-for-byte identical');
    assert.deepEqual(await readCatalog(f.db),catalog);assert.deepEqual(await f.permissions(),permissions);
    assert.equal((await f.evidence()).seedOutdated,0);
    assert.deepEqual(await f.build(),{recoverable:false,reason:'NO_DATA_REPAIR_REQUIRED'});
    await assert.rejects(f.db.exec(recovery.query),/INSTALLER_DATA_PLAN_STALE/);await f.db.exec('rollback');
    assert.deepEqual(await f.rows(),after,'replaying an old approved query cannot touch the answer again');
  }finally{await f.db.close();}
});

for(const manual of [false,true,'live-v4'] as const) test(`${manual==='live-v4' ? 'manual-live-v4' : manual ? 'manual' : 'latest'} data correction refuses unrelated conflicts, RLS/ACL drift and tampered shipped content; stale references/rows rollback`,async()=>{
  const f=await fixture(manual);
  try {
    const catalog=await readCatalog(f.db),permissions=await f.permissions(),evidence=await f.evidence(),before=await f.rows();
    for(const changed of [{...evidence,seedOutdated:2},{...evidence,seedMissing:1},{...evidence,progressMissing:1},{...evidence,outdatedSeedDetails:[{...evidence.outdatedSeedDetails![0],code:'L2-03'}]},{...evidence,outdatedSeedDetails:undefined}]) {
      assert.equal(buildDataRecovery(f.plan,f.history,catalog,permissions,changed).recoverable,false);
    }
    const alteredPlan=structuredClone(f.plan);alteredPlan.legacyRecovery!.knownSeedCorrection!.after.answer={kind:'count',value:7};
    assert.equal(buildDataRecovery(alteredPlan,f.history,catalog,permissions,evidence).recoverable,false);
    const noSelfTransition=structuredClone(f.plan);
    noSelfTransition.legacyRecovery!.transitions=noSelfTransition.legacyRecovery!.transitions.filter(t=>t.from!==f.profile || t.to!==f.profile);
    assert.equal(buildDataRecovery(noSelfTransition,f.history,catalog,permissions,evidence).recoverable,false,'a known catalog is insufficient without its exact self-transition');
    const wrongDestination=structuredClone(f.plan);
    wrongDestination.legacyRecovery!.transitions.find(t=>t.from===f.profile && t.to===f.profile)!.to='manual-previous-contract';
    assert.equal(buildDataRecovery(wrongDestination,f.history,catalog,permissions,evidence).recoverable,false,'a transition to another structure cannot authorize data-only correction');
    for(const change of [{kind:'RESUME' as const},{prefix:1},{name:'unreviewed-release'}]) {
      const unsupportedProfile=structuredClone(f.plan);
      Object.assign(unsupportedProfile.databaseBaseline!.profiles.find(p=>p.name===f.profile)!,change);
      assert.equal(buildDataRecovery(unsupportedProfile,f.history,catalog,permissions,evidence).recoverable,false,'only the exact complete latest/manual profile is accepted');
    }
    const wrongRls=structuredClone(catalog);wrongRls.tables[0].rls=!wrongRls.tables[0].rls;
    assert.equal(buildDataRecovery(f.plan,f.history,wrongRls,permissions,evidence).recoverable,false);
    const wrongPermission=structuredClone(permissions);wrongPermission.objects['tables::sb_students:'].roles.anon.privileges.push('TRUNCATE');
    assert.equal(buildDataRecovery(f.plan,f.history,catalog,wrongPermission,evidence).recoverable,false);
    assert.equal(buildDataRecovery(f.plan,['209901010001_unknown.sql'],catalog,permissions,evidence).recoverable,false);
    const recovery=await f.build();if(!recovery.recoverable) throw new Error(recovery.reason);
    await assert.rejects(f.db.exec(recovery.query.replace('COMMIT;',"DO $synthetic$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AFTER_DATA_APPLY'; END $synthetic$; COMMIT;")),/SYNTHETIC_AFTER_DATA_APPLY/);await f.db.exec('rollback');
    assert.deepEqual(await f.rows(),before,'answer and students roll back after an error following the update');
    await assert.rejects(f.db.exec(recovery.query.replace('-- Account only for', 'UPDATE public.sb_student_progress SET completed=false;\n-- Account only for')),/INSTALLER_DATA_POSTCONDITION_FAILED|INSTALLER_DATA_PRESERVATION_FAILED/);await f.db.exec('rollback');
    assert.deepEqual(await f.rows(),before);
    await f.db.exec(`insert into sb_lesson_progress_records(installation_id,class_id,student_id,curriculum_version,lesson,stage,set_id,problem_id,question_index) values('synthetic','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','v1',1,'practice','synthetic-set','95dd8f12-9215-430b-893c-d830c0368798',0)`);
    const afterReference=await f.rows();
    await assert.rejects(f.db.exec(recovery.query),/INSTALLER_DATA_PLAN_STALE/);await f.db.exec('rollback');
    assert.deepEqual(await f.rows(),afterReference,'new reference invalidates approval without deleting or changing it');
  }finally{await f.db.close();}
});

test('old/new L1-03 use identical real FREE_BUILD grade and reward outcomes; public plan still warns feedback changes',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),correction=plan.legacyRecovery!.knownSeedCorrection!;
  assert.notDeepEqual(correction.before.answer,correction.after.answer,'answer disclosure representation is explicitly not equivalent');
  for(let n=0;n<=8;n++) {
    const blocks=Array.from({length:n},(_,i)=>({x:i%3,y:0,z:Math.floor(i/3)}));
    const input={problemType:'FREE_BUILD' as const,gradingMode:'constraint' as const,submission:{kind:'blocks' as const,blocks},given:{minBlocks:6},grid:{gridWidth:3,gridDepth:3,maxHeight:3}};
    const old=grade({...input,answer:{kind:'count',value:6}}),fixed=grade({...input,answer:{kind:'blocks',blocks:[]}});
    assert.deepEqual(old,fixed);assert.equal(old.correct,n>=6);
    for(const completed of [false,true]) for(const wrongCount of [0,1,2,3]) {
      const previous={wrongCount,hintShown:wrongCount>=2,answerRevealed:wrongCount>=3,completed};
      assert.deepEqual(applyAttempt(previous,old.correct,true),applyAttempt(previous,fixed.correct,true));
    }
  }
});
