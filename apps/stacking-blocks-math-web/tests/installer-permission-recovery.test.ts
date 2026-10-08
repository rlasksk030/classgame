import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPermissionRecovery, normalizeEquivalentCatalog, prepareEquivalentLegacyTransition } from '../scripts/installer/permission-recovery.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { catalogFingerprints, type Catalog } from '../scripts/installer/database-state.ts';
import type { PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { emptyLegacyDb, readCatalog, seedProtectedRows } from './support/installer-legacy-db.ts';

const permissionQuery = readFileSync('scripts/installer/permission-audit.sql','utf8');

test('known Supabase ACL drift repairs only exact privileges and preserves every app row/default grant',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    await db.exec('alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role; alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;');
    for(const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";',''));
    await seedProtectedRows(db);
    const snapshot=async()=> (await db.query<{snapshot:PermissionSnapshot}>(permissionQuery)).rows[0].snapshot;
    const beforeCatalog=await readCatalog(db),beforePermissions=await snapshot();
    const rowQuery=beforeCatalog.tables.map(t=>`select '${t.name}' table_name,to_jsonb(t) row_data from public."${t.name}" t`).join(' union all ');
    const rows=await db.query(rowQuery);
    const defaults=await db.query('select to_jsonb(d) row_data from pg_default_acl d order by oid');
    const recovery=buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),beforeCatalog,beforePermissions);
    assert.equal(recovery.recoverable,true);
    if(!recovery.recoverable) throw new Error(recovery.reason);
    assert.equal(recovery.profile,`history-prefix-${plan.migrations.length}`);
    assert.equal(new Set(recovery.changes.map(c=>c.object)).size,22);
    assert.ok(recovery.changes.every(c=>c.action==='REVOKE' && c.role!=='postgres'));
    assert.ok(recovery.changes.some(c=>c.privileges.includes('TRUNCATE')));
    assert.doesNotMatch(recovery.query,/^(?:ALTER\s+DEFAULT|ALTER\s+TABLE.*DISABLE\s+ROW\s+LEVEL|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|(?:GRANT|REVOKE).*\bCASCADE)\b/im);
    assert.match(recovery.query,/lock_timeout='5s'/);
    assert.match(recovery.query,/statement_timeout='60s'/);
    assert.equal(buildPermissionRecovery(plan,[],beforeCatalog,beforePermissions).recoverable,true,'manual installation has exact known structure; HTTP still requires data evidence and consent');
    assert.equal(buildPermissionRecovery(plan,['209901010001_foreign.sql'],beforeCatalog,beforePermissions).recoverable,false);
    assert.equal(buildPermissionRecovery(plan,[plan.migrations[0].name,plan.migrations[0].name],beforeCatalog,beforePermissions).recoverable,false);
    assert.deepEqual(await db.query(rowQuery),rows,'planning never writes');
    await db.exec(recovery.query);
    assert.deepEqual(await db.query(rowQuery),rows,'all application rows preserved exactly');
    assert.deepEqual(await db.query('select to_jsonb(d) row_data from pg_default_acl d order by oid'),defaults);
    const afterCatalog=await readCatalog(db),afterPermissions=await snapshot();
    const normalized=normalizeEquivalentCatalog(plan,afterCatalog,afterPermissions);
    assert.ok(normalized,'raw ACL/null defaults normalized only after full equivalence');
    assert.deepEqual(catalogFingerprints(normalized),plan.databaseBaseline!.profiles.find(p=>p.name===recovery.profile)!.objects);
    assert.deepEqual(buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),afterCatalog,afterPermissions),{recoverable:false,reason:'NO_PERMISSION_DRIFT'});
    // Reusing an old approved transaction cannot make a second mutation.
    await assert.rejects(db.exec(recovery.query),/INSTALLER_PERMISSION_PLAN_STALE/);await db.exec('rollback');
    assert.deepEqual(await db.query(rowQuery),rows);
  }finally{await db.close();}
});

test('ACL recovery denies RLS/RPC/column ACL and unknown privilege contexts; stale/error transactions roll back',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    for(const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";',''));
    await seedProtectedRows(db);
    const history=plan.migrations.map(m=>m.name);
    const snapshot=async()=> (await db.query<{snapshot:PermissionSnapshot}>(permissionQuery)).rows[0].snapshot;
    const build=async()=>buildPermissionRecovery(plan,history,await readCatalog(db),await snapshot());
    await db.exec('grant truncate on sb_students to anon');
    const originalCatalog=await readCatalog(db),originalPermissions=await snapshot();
    const recovery=await build(); assert.equal(recovery.recoverable,true);
    if(!recovery.recoverable) throw new Error(recovery.reason);
    for(const mutate of [
      (c:Catalog)=>{c.tables.find(t=>t.name==='sb_students')!.rls=false;},
      (c:Catalog)=>{c.rpc_definitions[0].definition='arbitrary definition';},
      (c:Catalog)=>{c.column_acls.push({table:'sb_students',column:'name',acl:['anon=r/postgres']});},
    ]) {const catalog=structuredClone(originalCatalog);mutate(catalog);assert.equal(buildPermissionRecovery(plan,history,catalog,originalPermissions).recoverable,false);assert.equal(normalizeEquivalentCatalog(plan,catalog,originalPermissions),undefined);}
    for(const mutate of [
      (p:PermissionSnapshot)=>{p.roles.authenticated.memberships=1;},
      (p:PermissionSnapshot)=>{p.roles.anon.bypassRls=true;},
      (p:PermissionSnapshot)=>{p.schema.create.anon=true;},
      (p:PermissionSnapshot)=>{p.objects['tables::sb_students:'].owner='OTHER';},
    ]) {const permissions=structuredClone(originalPermissions);mutate(permissions);assert.equal(buildPermissionRecovery(plan,history,originalCatalog,permissions).recoverable,false);}
    const invalid=structuredClone(originalCatalog);invalid.tables.find(t=>t.name==='sb_students')!.acl=(invalid.tables.find(t=>t.name==='sb_students')!.acl as string[]).concat('unknown=r/postgres');
    assert.equal(buildPermissionRecovery(plan,history,invalid,originalPermissions).recoverable,false);
    await db.exec('grant trigger on sb_students to anon');
    await assert.rejects(db.exec(recovery.query),/INSTALLER_PERMISSION_PLAN_STALE/);await db.exec('rollback');
    assert.equal((await snapshot()).objects['tables::sb_students:'].roles.anon.privileges.includes('TRUNCATE'),true);
    await db.exec('revoke trigger on sb_students from anon');
    await assert.rejects(db.exec(recovery.query.replace('DO $acl_guard$ BEGIN\n  IF (SELECT snapshot FROM',"DO $forced$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RECOVERY_ERROR'; END $forced$;\nDO $acl_guard$ BEGIN\n  IF (SELECT snapshot FROM")),/SYNTHETIC_RECOVERY_ERROR/);await db.exec('rollback');
    assert.deepEqual(await snapshot(),originalPermissions);
    // Inject after the ACL mutation, then confirm both ACL and rows roll back.
    const beforeRows=await db.query('select to_jsonb(t) row_data from sb_student_progress t');
    await assert.rejects(db.exec(recovery.query.replace('COMMIT;',"DO $forced$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AFTER_APPLY'; END $forced$;\nCOMMIT;")),/SYNTHETIC_AFTER_APPLY/);await db.exec('rollback');
    assert.deepEqual(await snapshot(),originalPermissions);assert.deepEqual(await db.query('select to_jsonb(t) row_data from sb_student_progress t'),beforeRows);
    // A changed data row inside the transaction trips the preservation guard.
    await assert.rejects(db.exec(recovery.query.replace('REVOKE TRUNCATE ON TABLE public."sb_students" FROM "anon";', 'REVOKE TRUNCATE ON TABLE public."sb_students" FROM "anon"; UPDATE sb_student_progress SET completed=false;')),/INSTALLER_DATA_PRESERVATION_FAILED/);await db.exec('rollback');
    assert.deepEqual(await db.query('select to_jsonb(t) row_data from sb_student_progress t'),beforeRows);
  }finally{await db.close();}
});

test('missing required permission is restored; equivalent explicit defaults cannot weaken PUBLIC or bypass data evidence',async()=>{
  const plan=await readMathInstallerPlan(process.cwd()),db=await emptyLegacyDb();
  try {
    for(const migration of plan.migrations) await db.exec(migration.query.replace('create extension if not exists "pgcrypto";',''));
    const snapshot=async()=> (await db.query<{snapshot:PermissionSnapshot}>(permissionQuery)).rows[0].snapshot;
    await db.exec('grant execute on function sb_owns_class(uuid) to public');
    assert.ok(normalizeEquivalentCatalog(plan,await readCatalog(db),await snapshot()));
    await db.exec('revoke select on sb_students from authenticated');
    const recovery=buildPermissionRecovery(plan,plan.migrations.map(m=>m.name),await readCatalog(db),await snapshot());
    assert.equal(recovery.recoverable,true);if(!recovery.recoverable) throw new Error(recovery.reason);
    assert.deepEqual(recovery.changes,[{object:'sb_students',kind:'table',action:'GRANT',role:'authenticated',privileges:['SELECT']}]);
    await db.exec(recovery.query);
    assert.ok(normalizeEquivalentCatalog(plan,await readCatalog(db),await snapshot()));
    const transition=plan.legacyRecovery!.transitions.find(t=>t.from===recovery.profile)!;
    const guarded=prepareEquivalentLegacyTransition(plan,transition,await readCatalog(db),await snapshot());
    assert.ok(guarded);
    assert.match(guarded,/sb_acl_legacy_expected/);
    assert.equal(prepareEquivalentLegacyTransition(plan,{...transition,query:transition.query+'\nselect 1;'},await readCatalog(db),await snapshot()),undefined,'only immutable packaged transition accepted');
    const structural=plan.legacyRecovery!.transitions.find(t=>t.from!==t.to)!;
    assert.equal(prepareEquivalentLegacyTransition(plan,structural,await readCatalog(db),await snapshot()),undefined,'schema-changing transition is never wrapped');
    const changedPlan={...plan,migrations:[...plan.migrations].reverse()};
    assert.equal(buildPermissionRecovery(changedPlan,plan.migrations.map(m=>m.name),await readCatalog(db),await snapshot()).recoverable,false);
  }finally{await db.close();}
});
