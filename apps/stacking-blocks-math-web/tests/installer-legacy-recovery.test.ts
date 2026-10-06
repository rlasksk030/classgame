import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { inspectMigrationState, catalogFingerprints } from '../scripts/installer/database-state.ts';
import { runInstaller } from '../scripts/installer/orchestrator.ts';
import { emptyLegacyDb, legacyBackend, readCatalog, seedProtectedRows, storageStub } from './support/installer-legacy-db.ts';
import { createFixture } from '../qa/live-required-progress/installer-fixture.mjs';
import { PROTECTED_TABLES } from '../scripts/installer/legacy-sql.ts';

const target={environment:'TEST' as const,projectRef:'synthetic-legacy',projectUrl:'https://synthetic-legacy.supabase.co',publishableKey:'sb_publishable_synthetic',release:'spatial-math-v1'};
test('Every known prefix: full/missing/holey history safely upgrades without historical replay and preserves data', async t => {
  const plan=await readMathInstallerPlan(process.cwd());
  const source=await emptyLegacyDb();
  try {
    for(let n=0;n<=24;n++) {
      if(n) await source.exec(plan.migrations[n-1].query.replace('create extension if not exists "pgcrypto";', ''));
      const archive=await source.dumpDataDir();
      await t.test(`profile ${n}`,async()=>{
        const db=new PGlite({loadDataDir:archive});
        try {
          if(n) await seedProtectedRows(db);
          const before = new Map<string, Record<string,unknown>[]>();
          if(n) for(const name of PROTECTED_TABLES) {
            const rows=(await db.query<Record<string,unknown>>(`select to_jsonb(t) as row from ${name} t`)).rows.map(r=>r.row as Record<string,unknown>);
            assert.ok(rows.length>0,`populated protection fixture ${name}`); before.set(name,rows);
          }
          const history=plan.migrations.slice(0,n).map(m=>m.name);
          // All history variants are evaluated against the actual same SQL DB.
          for(const rows of [history,[],history.slice(0,3),history.filter((_,i)=>i%2===0)]) {
            const state=await inspectMigrationState(legacyBackend(db,plan,rows),target,plan);
            assert.equal(state.drift,false,JSON.stringify({n,rows:rows.length,state}));
            assert.equal(state.migrations.slice(0,n).some(m=>m.status==='DRIFT_REQUIRES_REVIEW'),false);
          }
          const backend=legacyBackend(db,plan,[]);
          const result=await runInstaller({target,plan,backend});
          assert.equal(result.status,'COMPLETE');
          assert.equal(backend.calls.filter(c=>c.startsWith('applyMigration')).length,n===0?24:0);
          const state=await inspectMigrationState(backend,target,plan);
          assert.equal(state.drift,false); assert.equal(state.recovery,undefined);
          const latest=plan.databaseBaseline!.profiles.find(p=>p.name==='history-prefix-24')!;
          assert.deepEqual(catalogFingerprints(await readCatalog(db)),latest.objects);
          const writes=backend.calls.filter(c=>/^(apply|deploy|setSecrets)/.test(c)).length;
          await runInstaller({target,plan,backend});
          assert.equal(backend.calls.filter(c=>/^(apply|deploy|setSecrets)/.test(c)).length,writes,'second run writes zero');
          if(n) {
            for(const [name,rows] of before) {
              const current=(await db.query<{row:Record<string,unknown>}>(`select to_jsonb(t) as row from ${name} t`)).rows.map(r=>r.row);
              assert.ok(current.length>=rows.length,`${name}: no row loss`);
              for(const row of rows) assert.ok(current.some(next=>Object.entries(row).every(([k,v])=> name==='sb_student_progress' && ['completed','completed_at'].includes(k) ? (k!=='completed'||!v||next.completed===true) : JSON.stringify(next[k])===JSON.stringify(v))),`${name}: identities and original fields preserved`);
            }
            const row=(await db.query<{completed:boolean,total_xp:number}>(`select p.completed,r.total_xp from sb_student_progress p join sb_student_rewards r using(student_id) where p.lesson=1`)).rows[0];
            assert.equal(row.completed,true); assert.equal(row.total_xp,999);
          }
        } finally {await db.close();}
      });
    }
  } finally {await source.close();}
});
test('Manual reviewed delta uses existing safe transition, retry is no-op, drift in transaction rolls back',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()); const db=await createFixture();
  try {
    await db.exec(storageStub); await seedProtectedRows(db);
    const backend=legacyBackend(db,plan,[]);
    assert.equal((await inspectMigrationState(backend,target,plan)).recovery,'LEGACY_RESUME_CANDIDATE');
    await runInstaller({target,plan,backend});
    assert.deepEqual(catalogFingerprints(await readCatalog(db)),plan.databaseBaseline!.profiles.find(p=>p.name==='manual-required-progress-contract')!.objects);
    assert.equal(backend.calls.filter(c=>c.startsWith('applyMigration')).length,0);
    const calls=backend.calls.filter(c=>c==='applyLegacyTransition').length;
    await runInstaller({target,plan,backend}); assert.equal(backend.calls.filter(c=>c==='applyLegacyTransition').length,calls);
    const tx=plan.legacyRecovery!.transitions.find(t=>t.from==='manual-required-progress-contract')!;
    await db.exec('alter table sb_students alter column name drop not null');
    await assert.rejects(db.exec(tx.query),/INSTALLER_CATALOG_CHANGED/);
    await db.exec('rollback');
    assert.equal((await inspectMigrationState(backend,target,plan)).drift,true);
  } finally {await db.close();}
});
test('Artifact contains no old migration application or destructive data statements',()=>{
  const text=readFileSync('scripts/installer/legacy-recovery.json','utf8');
  assert.equal(text.includes('supabase_migrations'),false);
  assert.equal(text.includes('truncate table'),false);
});

test('Contradictory history/data, unsafe storage policy, malformed evidence, and concurrent catalog changes fail closed', async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    for(const m of plan.migrations.slice(0,17)) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    const backend=legacyBackend(db,plan,plan.migrations.map(m=>m.name));
    assert.equal((await inspectMigrationState(backend,target,plan)).drift,true,'history newer than catalog');
    backend.migrations.splice(0,backend.migrations.length,...plan.migrations.slice(0,17).map(m=>m.name));
    await db.exec("delete from sb_problems where code='L1-01'");
    assert.equal((await inspectMigrationState(backend,target,plan)).review?.reason,'DATA_EVIDENCE_CONFLICT');
    backend.migrations.splice(0);
    assert.equal((await inspectMigrationState(backend,target,plan)).drift,false,'missing seed without claimed history is safely insertable');
    await db.exec('alter policy sb_problem_crops on storage.objects using(true)');
    assert.equal((await inspectMigrationState(backend,target,plan)).review?.reason,'DATA_EVIDENCE_CONFLICT');
    assert.equal(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c)),false);
  } finally {await db.close();}
});

test('Transaction protection rolls back PIN mutation; latest normalization promotes evidence without demotion',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    for(const m of plan.migrations) await db.exec(m.query.replace('create extension if not exists "pgcrypto";',''));
    await seedProtectedRows(db);
    const transition=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-24')!;
    const before=(await db.query<{hash:string}>('select md5(pin_hash) hash from sb_students')).rows[0].hash;
    const tampered=transition.query.replace('do $preserve$',"update sb_students set pin_hash='synthetic-unwanted-change'; do $preserve$");
    await assert.rejects(db.exec(tampered),/INSTALLER_DATA_PRESERVATION_FAILED/);
    await db.exec('rollback');
    assert.equal((await db.query<{hash:string}>('select md5(pin_hash) hash from sb_students')).rows[0].hash,before);
    const backend=legacyBackend(db,plan,[]);
    await runInstaller({target,plan,backend});
    const rows=(await db.query<{lesson:number,completed:boolean}>('select lesson,completed from sb_student_progress order by lesson')).rows;
    assert.equal(rows.find(r=>r.lesson===1)?.completed,true,'grandfathered completion preserved');
    assert.equal(rows.find(r=>r.lesson===9)?.completed,false,'authorship is participation');
    for(const lesson of [10,11]) assert.equal(rows.find(r=>r.lesson===lesson)?.completed,true,'submitted project evidence');
  }finally{await db.close();}
});
