import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixture } from '../qa/live-required-progress/installer-fixture.mjs';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { assessDatabaseState, catalogFingerprints, type Catalog } from '../scripts/installer/database-state.ts';

const profile = 'manual-live-v4-contract';
test('the four shipped October migrations reproduce exactly the eight operating catalog differences; recognize without RPC/ACL writes', async () => {
  const plan=await readMathInstallerPlan(process.cwd()), db=await createFixture();
  const query=readFileSync('scripts/installer/catalog.sql','utf8');
  const snapshot=async()=>(await db.query<{snapshot:Catalog}>(query)).rows[0].snapshot;
  const history=plan.migrations.map(m=>m.name);
  const evidence={seedMissing:0,seedOutdated:1,storageMissing:0,progressMissing:0,dataConflict:0};
  try {
    await db.exec(readFileSync('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql','utf8'));
    const before=await snapshot();
    assert.equal(assessDatabaseState(plan,history,before,evidence).review?.reason,'DATA_EVIDENCE_CONFLICT');
    assert.equal(assessDatabaseState(plan,history,before,evidence).differences.length,0);
    for(const migration of plan.migrations.slice(20)) await db.exec(migration.query);
    const after=await snapshot(), a=catalogFingerprints(before), b=catalogFingerprints(after);
    assert.deepEqual(Object.keys(b).filter(k=>a[k]!==b[k]).sort(),[
      ...['sb_lesson_progress_records','sb_peer_problem_attempts','sb_practice_assignments','sb_project_exports','sb_student_created_problems','sb_student_lesson_reflections'].map(n=>`tables::${n}:`),
      ...['rpc_definitions','rpcs'].map(n=>`${n}::sb_save_building:p_student uuid, p_class uuid, p_version integer, p_data jsonb`),
    ].sort());
    const rpc=String(after.rpc_definitions.find(f=>f.name==='sb_save_building')!.definition);
    assert.equal(createHash('md5').update(rpc).digest('hex'),'a3d50f55b3a825e5c45824b028f67e15','read-only operating definition, byte-for-byte shipped SQL');
    const previousRpc=String(before.rpc_definitions.find(f=>f.name==='sb_save_building')!.definition);
    assert.equal(rpc,previousRpc.replace('prior.grid_width,10','prior.grid_width,5').replace('prior.grid_depth,10','prior.grid_depth,5'),'only omitted new-project dimensions differ; ownership/version/progress code is unchanged');
    for(const name of ['sb_lesson_progress_records','sb_peer_problem_attempts','sb_practice_assignments','sb_project_exports','sb_student_created_problems','sb_student_lesson_reflections']) {
      const rights=(await db.query<{can_read:boolean;can_truncate:boolean;can_reference:boolean;can_trigger:boolean;can_maintain:boolean}>(`select has_table_privilege('authenticated',$1,'SELECT') can_read,has_table_privilege('authenticated',$1,'TRUNCATE') can_truncate,has_table_privilege('authenticated',$1,'REFERENCES') can_reference,has_table_privilege('authenticated',$1,'TRIGGER') can_trigger,has_table_privilege('authenticated',$1,'MAINTAIN') can_maintain`,[name])).rows[0];
      assert.deepEqual(rights,{can_read:true,can_truncate:false,can_reference:false,can_trigger:false,can_maintain:false});
    }
    const oldPlan=structuredClone(plan);
    oldPlan.databaseBaseline!.profiles=oldPlan.databaseBaseline!.profiles.filter(p=>p.name!==profile);
    assert.equal(assessDatabaseState(oldPlan,history,after,evidence).differences.length,8);
    assert.equal(assessDatabaseState(oldPlan,history,after,evidence).review?.reason,'UNRECOGNIZED_SCHEMA');
    const state=assessDatabaseState(plan,history,after,evidence);
    assert.equal(state.baseline,profile);
    assert.equal(state.review?.reason,'DATA_EVIDENCE_CONFLICT','L1-03 remains separately approval-gated');
    assert.equal(state.differences.length,0);
    const healthy=assessDatabaseState(plan,history,after,{...evidence,seedOutdated:0});
    assert.equal(healthy.drift,false);
    assert.equal(healthy.recovery,undefined,'no automatic schema/permission restoration');
    assert.ok(healthy.migrations.every(m=>m.status==='APPLIED_BY_HISTORY'));
    const altered=structuredClone(after);
    altered.rpc_definitions.find(f=>f.name==='sb_save_building')!.definition=rpc.replace("status='active'","true");
    assert.equal(assessDatabaseState(plan,history,altered,evidence).review?.reason,'UNRECOGNIZED_SCHEMA');
    for(const mutation of [
      "alter function sb_save_building(uuid,uuid,integer,jsonb) set search_path=public,auth",
      "grant execute on function sb_save_building(uuid,uuid,integer,jsonb) to anon",
      "grant truncate on sb_lesson_progress_records to authenticated",
      "revoke select on sb_lesson_progress_records from authenticated",
      "alter table sb_lesson_progress_records disable row level security",
      rpc.replace("status='active'","true"),
    ]) {
      await db.exec('begin');
      try {
        await db.exec(mutation);
        assert.equal(assessDatabaseState(plan,history,await snapshot(),evidence).review?.reason,'UNRECOGNIZED_SCHEMA','unknown function or ACL/RLS changes remain blocked');
      } finally { await db.exec('rollback'); }
    }
    assert.deepEqual(await snapshot(),after,'recognition is read-only');
  } finally { await db.close(); }
});
