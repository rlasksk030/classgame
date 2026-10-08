/** Read-only proof of one reviewed Supabase PostgreSQL 17 executor model.
 * No role is created/granted here, and a count alone is never proof.
 * Official source: supabase/postgres migrations/db/migrations/
 * 10000000000000_demote-postgres.sql
 * 20250605172253_grant_with_admin_to_postgres_16_and_above.sql
 * 20251001204436_predefined_role_grants.sql
 * 20260211120934_supabase_privileged_role.sql
 * https://www.postgresql.org/docs/17/predefined-roles.html
 */
export interface PermissionRoleState { superuser:boolean; bypassRls:boolean; inherit:boolean; memberships:number }
export interface ExecutorGraph {
  databaseOwner:string;
  roles:Array<{name:string;superuser:boolean;bypassRls:boolean;inherit:boolean;login:boolean}>;
  edges:Array<{member:string;role:string;admin:boolean;inherit:boolean;set:boolean}>;
}
const applicationRoles=['anon','authenticated','service_role'];
const roles=[...applicationRoles,'postgres'];
const directRoles=['anon','authenticated','authenticator','pg_create_subscription','pg_monitor','pg_read_all_data','pg_signal_backend','service_role','supabase_privileged_role'];
const monitorRoles=['pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables'];
const knownGraph:ExecutorGraph={
  databaseOwner:'postgres',
  roles:[...directRoles,'postgres',...monitorRoles].map(name=>({name,superuser:false,bypassRls:['postgres','service_role'].includes(name),inherit:name!=='authenticator',login:['postgres','authenticator'].includes(name)})),
  edges:[...directRoles.map(role=>({member:'postgres',role,admin:role!=='supabase_privileged_role',inherit:true,set:true})),
    ...applicationRoles.map(role=>({member:'authenticator',role,admin:false,inherit:false,set:true})),
    ...monitorRoles.map(role=>({member:'pg_monitor',role,admin:false,inherit:true,set:true}))],
};
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value && typeof value==='object' && !Array.isArray(value));
const keysEqual=(value:Record<string,unknown>,keys:string[])=>JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
function canonical(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(isObject(value)) return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

export function hasKnownHostedExecutorGraph(value:unknown):value is ExecutorGraph {
  return isObject(value) && keysEqual(value,['databaseOwner','roles','edges']) && equal(value,knownGraph);
}

/** Application-role context stays exact. The only added exception is the
 * complete hosted executor graph; raw graph metadata stays in plan snapshots
 * so equal counts with replaced edges cannot survive transaction guards. */
export function permissionRoleContextMatches(actual:unknown,expected:Record<string,PermissionRoleState>,executorGraph?:unknown):boolean {
  if(!isObject(actual) || !keysEqual(actual,roles)) return false;
  for(const role of roles) {
    const row=actual[role];
    if(!isObject(row) || !keysEqual(row,['superuser','bypassRls','inherit','memberships'])
      || ['superuser','bypassRls','inherit'].some(key=>typeof row[key]!=='boolean') || !Number.isSafeInteger(row.memberships)) return false;
    if(role!=='postgres' && (!equal(row,expected[role]) || row.memberships!==0)) return false;
  }
  const postgres=actual.postgres as unknown as PermissionRoleState;
  if(postgres.memberships===0) {
    // Keep older isolated-local snapshots compatible. If a graph is supplied,
    // it must prove the same isolation rather than contradict the count.
    return executorGraph===undefined || equal(executorGraph,{databaseOwner:'postgres',roles:[{name:'postgres',superuser:postgres.superuser,bypassRls:postgres.bypassRls,inherit:postgres.inherit,login:true}],edges:[]});
  }
  return postgres.memberships===9 && postgres.superuser===false && postgres.bypassRls===true && postgres.inherit===true
    && hasKnownHostedExecutorGraph(executorGraph)
    && applicationRoles.every(role=>{
      const graphRole=executorGraph.roles.find(row=>row.name===role)!;
      const row=actual[role] as unknown as PermissionRoleState;
      return graphRole.superuser===row.superuser && graphRole.bypassRls===row.bypassRls && graphRole.inherit===row.inherit;
    });
}
