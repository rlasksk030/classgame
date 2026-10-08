-- Diagnostic metadata only. This query is NOT part of the acceptance fingerprint
-- and never changes permissions or reads application rows.
WITH RECURSIVE roles AS (
  SELECT oid, rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles
  WHERE rolname IN ('anon','authenticated','service_role','postgres')
), executor_reachable(oid) AS (
  SELECT oid FROM pg_roles WHERE rolname='postgres'
  UNION
  SELECT m.roleid FROM pg_auth_members m JOIN executor_reachable r ON m.member=r.oid
), executor_roles AS (
  SELECT r.* FROM pg_roles r JOIN executor_reachable x ON x.oid=r.oid
), executor_edges AS (
  SELECT m.* FROM pg_auth_members m JOIN executor_reachable r ON m.member=r.oid
), known_executor_roles(name) AS (
  VALUES ('postgres'),('anon'),('authenticated'),('service_role'),('authenticator'),
    ('pg_create_subscription'),('pg_monitor'),('pg_read_all_data'),('pg_signal_backend'),
    ('supabase_privileged_role'),('pg_read_all_settings'),('pg_read_all_stats'),('pg_stat_scan_tables')
), executor_bounds AS (
  -- Never truncate a larger graph into an apparently trusted one. The OTHER
  -- owner sentinel makes an oversized/unknown context fail closed server-side.
  SELECT (SELECT count(*) FROM executor_roles)<=32 AND (SELECT count(*) FROM executor_edges)<=64 AS bounded
), objects AS (
  SELECT 'tables::'||c.relname||':' AS key, c.oid, c.relowner AS owner, c.relacl AS acl, false AS function
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND left(c.relname,3)='sb_' AND c.relkind IN ('r','p')
  UNION ALL
  SELECT 'rpcs::'||p.proname||':'||pg_get_function_identity_arguments(p.oid), p.oid, p.proowner, p.proacl, true
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND left(p.proname,3)='sb_' AND p.prokind='f'
), permissions AS (
  SELECT o.key, jsonb_build_object(
    'owner',case when pg_get_userbyid(o.owner) IN ('postgres','supabase_admin') then pg_get_userbyid(o.owner) else 'OTHER' end,
    'otherGrantees',(select count(*) from aclexplode(coalesce(o.acl,acldefault(case when o.function then 'f'::"char" else 'r'::"char" end,o.owner))) a where a.grantee<>0 and a.grantee not in (select oid from roles)),
    'roles',(select jsonb_object_agg(r.rolname,jsonb_build_object(
      'privileges',(select coalesce(jsonb_agg(p order by p),'[]') from unnest(case when o.function then ARRAY['EXECUTE'] else ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] end) p where case when o.function then has_function_privilege(r.oid,o.oid,p) else has_table_privilege(r.oid,o.oid,p) end),
      'grantOptions',(select coalesce(jsonb_agg(p order by p),'[]') from unnest(case when o.function then ARRAY['EXECUTE'] else ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] end) p where case when o.function then has_function_privilege(r.oid,o.oid,p||' WITH GRANT OPTION') else has_table_privilege(r.oid,o.oid,p||' WITH GRANT OPTION') end)
    )) from roles r)
  ) value FROM objects o
)
SELECT jsonb_build_object(
 'executorGraph',jsonb_build_object(
   'databaseOwner',case when (select bounded from executor_bounds) and (select pg_get_userbyid(datdba) from pg_database where datname=current_database())='postgres' then 'postgres' else 'OTHER' end,
   'roles',case when (select bounded from executor_bounds) then (select coalesce(jsonb_agg(jsonb_build_object('name',case when r.rolname in (select name from known_executor_roles) then r.rolname else 'OTHER' end,'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,'inherit',r.rolinherit,'login',r.rolcanlogin) order by r.rolname),'[]') from executor_roles r) else '[]'::jsonb end,
   'edges',case when (select bounded from executor_bounds) then (select coalesce(jsonb_agg(jsonb_build_object('member',case when member.rolname in (select name from known_executor_roles) then member.rolname else 'OTHER' end,'role',case when target.rolname in (select name from known_executor_roles) then target.rolname else 'OTHER' end,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) order by member.rolname,target.rolname),'[]') from executor_edges m join pg_roles member on member.oid=m.member join pg_roles target on target.oid=m.roleid) else '[]'::jsonb end),
 'roles',(select coalesce(jsonb_object_agg(rolname,jsonb_build_object('superuser',rolsuper,'bypassRls',rolbypassrls,'inherit',rolinherit,'memberships',(select count(*) from pg_auth_members m where m.member=roles.oid))),'{}') from roles),
 'schema',(select jsonb_build_object('owner',case when pg_get_userbyid(nspowner) IN ('postgres','supabase_admin','pg_database_owner') then pg_get_userbyid(nspowner) else 'OTHER' end,'usage',(select jsonb_object_agg(rolname,has_schema_privilege(oid,'public','USAGE')) from roles),'create',(select jsonb_object_agg(rolname,has_schema_privilege(oid,'public','CREATE')) from roles)) from pg_namespace where nspname='public'),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('owner',case when pg_get_userbyid(d.defaclrole) IN ('postgres','supabase_admin') then pg_get_userbyid(d.defaclrole) else 'OTHER' end,'kind',d.defaclobjtype,'grantCount',(select count(*) from aclexplode(d.defaclacl))) order by d.defaclrole,d.defaclobjtype),'[]') from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'),
 'objects',(select coalesce(jsonb_object_agg(key,value),'{}') from permissions)
) AS snapshot;
