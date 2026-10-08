import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPermissionDifference, expectedPermissionProfile, permissionContext, type PermissionSnapshot } from '../scripts/installer/permission-audit.ts';
import { hasKnownHostedExecutorGraph, permissionRoleContextMatches } from '../scripts/installer/hosted-role-proof.ts';
import { normalizeEquivalentCatalog } from '../scripts/installer/permission-recovery.ts';
import { buildDataRecovery } from '../scripts/installer/data-recovery.ts';
import { createDataRecoveryFixture } from './support/installer-data-recovery.ts';
import { readCatalog } from './support/installer-legacy-db.ts';
import { readFileSync } from 'node:fs';

function hostedGraph() {
  const direct=['anon','authenticated','authenticator','pg_create_subscription','pg_monitor','pg_read_all_data','pg_signal_backend','service_role','supabase_privileged_role'];
  return {
    databaseOwner:'postgres',
    roles:[...direct,'postgres','pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables'].map(name=>({name,superuser:false,bypassRls:['postgres','service_role'].includes(name),inherit:name!=='authenticator',login:['postgres','authenticator'].includes(name)})),
    edges:[...direct.map(role=>({member:'postgres',role,admin:role!=='supabase_privileged_role',inherit:true,set:true})),
      ...['anon','authenticated','service_role'].map(role=>({member:'authenticator',role,admin:false,inherit:false,set:true})),
      ...['pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables'].map(role=>({member:'pg_monitor',role,admin:false,inherit:true,set:true}))],
  };
}

test('exact hosted executor graph permits known manual data correction while preserving permission classification',async()=>{
  const f=await createDataRecoveryFixture('hosted-proof');
  try {
    const profile='manual-required-progress-contract';
    const expected=expectedPermissionProfile(profile,f.plan.databaseBaseline!.migrationHashes)!;
    const actual={...expected,defaultPrivileges:[],roles:{...expected.roles,postgres:{superuser:false,bypassRls:true,inherit:true,memberships:9}},executorGraph:hostedGraph()};
    const classify=(snapshot:unknown,structural=false)=>classifyPermissionDifference({profile,key:'tables::sb_students:',migrationHashes:f.plan.databaseBaseline!.migrationHashes,actual:snapshot,structural});
    assert.equal(classify(actual),'A_EQUIVALENT');
    assert.equal(permissionContext(actual).executorRoleModel,'HOSTED_VERIFIED');
    const catalog=await readCatalog(f.db);
    assert(normalizeEquivalentCatalog(f.plan,catalog,actual),'normal hosted membership is not application ACL drift');
    const transition=f.plan.legacyRecovery!.transitions.find(t=>t.from===profile && t.to===profile)!;
    const evidence=await f.backend.inspectDataEvidence!(f.target,transition.evidenceQuery);
    const recovery=buildDataRecovery(f.plan,[],catalog,actual,evidence);
    assert.equal(recovery.recoverable,true);
    if(recovery.recoverable) assert.equal(recovery.profile,profile);
    assert.equal(f.writes(),0,'creating the plan is read-only');
    const broader=structuredClone(actual);broader.objects['tables::sb_students:'].roles.authenticated.grantOptions.push('SELECT');
    assert.equal(classify(broader),'B_BROADER_PERMISSION');
    assert.equal(normalizeEquivalentCatalog(f.plan,catalog,broader),undefined);
    const missing=structuredClone(actual);missing.objects['tables::sb_students:'].roles.authenticated.privileges=[];
    assert.equal(classify(missing),'C_MISSING_PERMISSION');
    assert.equal(classify(actual,true),'D_STRUCTURAL_CHANGE');
    assert.equal(classify(undefined),'E_UNKNOWN');
    const noGraph:PermissionSnapshot={...expected,defaultPrivileges:[]};
    assert.equal(classify(noGraph),'A_EQUIVALENT','the existing membership-free local model remains supported');
    assert.equal(permissionContext(noGraph).executorRoleModel,'LOCAL_VERIFIED');
  } finally {await f.db.close();}
});

test('hosted proof rejects missing, unknown, indirect, duplicated and altered roles/edges even at the same membership count',()=>{
  const baseline=JSON.parse(readFileSync('scripts/installer/permission-baseline.json','utf8'));
  const profile=`history-prefix-${baseline.migrationHashes.length}`;
  const expected=expectedPermissionProfile(profile,baseline.migrationHashes)!;
  const actual={...expected,defaultPrivileges:[],roles:{...expected.roles,postgres:{superuser:false,bypassRls:true,inherit:true,memberships:9}},executorGraph:hostedGraph()};
  const classify=(value:unknown)=>classifyPermissionDifference({profile,key:'tables::sb_students:',migrationHashes:baseline.migrationHashes,structural:false,actual:value});
  assert(hasKnownHostedExecutorGraph(actual.executorGraph));
  const reordered=structuredClone(actual);reordered.executorGraph.roles.reverse();reordered.executorGraph.edges.reverse();
  assert.equal(classify(reordered),'A_EQUIVALENT','catalog ordering is immaterial');
  const changes:Array<(s:typeof actual)=>void>=[
    s=>{delete (s as {executorGraph?:unknown}).executorGraph;},
    s=>{s.executorGraph.databaseOwner='OTHER';},
    s=>{s.roles.postgres.memberships=8;},
    s=>{s.roles.postgres.superuser=true;},
    s=>{s.roles.postgres.bypassRls=false;},
    s=>{s.roles.anon.memberships=1;},
    s=>{s.roles.authenticated.superuser=true;},
    s=>{s.executorGraph.roles.find(r=>r.name==='postgres')!.login=false;},
    s=>{s.executorGraph.roles.find(r=>r.name==='authenticator')!.inherit=true;},
    s=>{s.executorGraph.roles.find(r=>r.name==='supabase_privileged_role')!.superuser=true;},
    s=>{s.executorGraph.roles[0].name='OTHER';},
    s=>{s.executorGraph.roles[0]={...s.executorGraph.roles[1]};},
    s=>{s.executorGraph.edges[0].role='pg_write_all_data';},
    s=>{s.executorGraph.edges[0]={...s.executorGraph.edges[1]};},
    s=>{s.executorGraph.edges[0].admin=false;},
    s=>{s.executorGraph.edges[0].inherit=false;},
    s=>{s.executorGraph.edges[0].set=false;},
    s=>{s.executorGraph.edges.find(e=>e.member==='authenticator')!.inherit=true;},
    s=>{s.executorGraph.edges.find(e=>e.member==='pg_monitor')!.role='pg_execute_server_program';},
    s=>{s.executorGraph.edges.push({member:'supabase_privileged_role',role:'supabase_admin',admin:false,inherit:true,set:true});},
  ];
  for(const change of changes) {
    const value=structuredClone(actual);change(value);
    assert.equal(classify(value),'E_UNKNOWN');
    assert.equal(permissionRoleContextMatches(value.roles,expected.roles,value.executorGraph),false);
    const diagnostic=permissionContext(value);
    assert.equal(diagnostic.executorRoleModel,'UNVERIFIED');
    assert.equal(JSON.stringify(diagnostic).includes('supabase_privileged_role'),false,'operator context includes only fixed enums');
  }
  const local=structuredClone(expected.roles);
  assert(permissionRoleContextMatches(local,expected.roles));
  const localGraph={databaseOwner:'postgres',roles:[{name:'postgres',superuser:local.postgres.superuser,bypassRls:local.postgres.bypassRls,inherit:local.postgres.inherit,login:true}],edges:[]};
  assert(permissionRoleContextMatches(local,expected.roles,localGraph));
  assert.equal(permissionRoleContextMatches(local,expected.roles,hostedGraph()),false,'zero count cannot hide a supplied nonempty graph');
});
