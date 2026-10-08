-- Diagnostic metadata only. This query is NOT part of the acceptance fingerprint
-- and never changes permissions or reads application rows.
WITH roles AS (
  SELECT oid, rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles
  WHERE rolname IN ('anon','authenticated','service_role','postgres')
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
 'roles',(select coalesce(jsonb_object_agg(rolname,jsonb_build_object('superuser',rolsuper,'bypassRls',rolbypassrls,'inherit',rolinherit,'memberships',(select count(*) from pg_auth_members m where m.member=roles.oid))),'{}') from roles),
 'schema',(select jsonb_build_object('owner',case when pg_get_userbyid(nspowner) IN ('postgres','supabase_admin','pg_database_owner') then pg_get_userbyid(nspowner) else 'OTHER' end,'usage',(select jsonb_object_agg(rolname,has_schema_privilege(oid,'public','USAGE')) from roles),'create',(select jsonb_object_agg(rolname,has_schema_privilege(oid,'public','CREATE')) from roles)) from pg_namespace where nspname='public'),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('owner',case when pg_get_userbyid(d.defaclrole) IN ('postgres','supabase_admin') then pg_get_userbyid(d.defaclrole) else 'OTHER' end,'kind',d.defaclobjtype,'grantCount',(select count(*) from aclexplode(d.defaclacl))) order by d.defaclrole,d.defaclobjtype),'[]') from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'),
 'objects',(select coalesce(jsonb_object_agg(key,value),'{}') from permissions)
) AS snapshot;
