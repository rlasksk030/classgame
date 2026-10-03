WITH app_tables AS (
  SELECT c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND left(c.relname,3)='sb_' AND c.relkind IN ('r','p')
)
SELECT jsonb_build_object(
  'captured_at', clock_timestamp(),
  'server_version', current_setting('server_version'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'schema_version', (SELECT max(version) FROM supabase_migrations.schema_migrations),
  'migration_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]') FROM supabase_migrations.schema_migrations),
  'compatibility_history_present', EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE position('live_v4_compatibility' IN coalesce(name,''))>0),
  'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl) ORDER BY relname),'[]') FROM app_tables),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default,'position',ordinal_position) ORDER BY table_name,ordinal_position),'[]') FROM information_schema.columns WHERE table_schema='public' AND left(table_name,3)='sb_'),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY t.relname,k.conname),'[]') FROM pg_constraint k JOIN app_tables t ON t.oid=k.conrelid WHERE k.contype<>'n'),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]') FROM pg_indexes WHERE schemaname='public' AND left(tablename,3)='sb_'),
  'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) ORDER BY tablename,policyname),'[]') FROM pg_policies WHERE schemaname='public' AND left(tablename,3)='sb_'),
  'rpcs', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'acl',p.proacl,'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,3)='sb_' AND p.prokind='f'),
  'baseline_note','Catalog only; no student row payloads'
,
 'rpc_definitions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'search_path',p.proconfig,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,3)='sb_' AND p.prokind='f'),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND left(c.relname,3)='sb_' AND NOT t.tgisinternal),
 'column_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl) ORDER BY c.relname,a.attname),'[]') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND left(c.relname,3)='sb_' AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
 'policy_modes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive) ORDER BY tablename,policyname),'[]') FROM pg_policies WHERE schemaname='public' AND left(tablename,3)='sb_')
) AS snapshot;
