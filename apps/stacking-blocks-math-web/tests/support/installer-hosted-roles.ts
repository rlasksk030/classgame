/** Disposable local PostgreSQL/PGlite fixture only. Never run against Supabase.
 * Build the reviewed hosted graph while postgres is still the fixture admin,
 * then remove superuser so the actual recovery executes as the hosted owner. */
export const hostedExecutorRolesSql = `
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE supabase_privileged_role NOLOGIN INHERIT;
GRANT anon,authenticated,service_role TO authenticator;
GRANT pg_read_all_settings,pg_read_all_stats,pg_stat_scan_tables TO pg_monitor;
GRANT anon,authenticated,service_role,authenticator,pg_create_subscription,pg_monitor,pg_read_all_data,pg_signal_backend TO postgres WITH ADMIN OPTION;
GRANT supabase_privileged_role TO postgres;
ALTER ROLE postgres NOSUPERUSER BYPASSRLS INHERIT LOGIN;
`;
