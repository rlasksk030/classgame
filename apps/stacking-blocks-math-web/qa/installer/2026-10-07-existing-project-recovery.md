# Existing project recovery and schema diagnostics

Baseline: release/production `afda27728696a8e03ba98edb05c34cad0d249749` verified through Git remote and GitHub. Render frontend `dep-db2d2r7avr4c73ahpodg` and installer `dep-db2d2r7avr4c73ahpnkg` were live on that commit before this change.

Reported teacher project: `steloixpdrnwmijnkdax`. Reported state: `UNRECOGNIZED_SCHEMA`, comparison `history-prefix-24`, 22 object differences; reconnect returned an empty OAuth project list. These are user-supplied observations, not a direct inspection of the teacher database.

## Schema evidence and limits

Reviewed Git history including PR #5 (`dde86e2`, `d34ad98`), state baseline change `7005ea3`, manual delta preparation `40d2dcd`, compatibility expansion `105cdd0`, progress changes `875364b`, and earlier migration/schema history. The existing generator reconstructs the 24 migration prefixes plus empty and two manual profiles from checked-in SQL and the manual catalog fixture. The existing real PGlite regression suite exercises all 27 recognized states and protected rows.

The connected developer Supabase account does not list the teacher project. No teacher DB SQL was executed. Existing Render logs contain no `schema_review` event for this release. The actual 22 keys/signature therefore remain unavailable, and cannot be matched to a historical schema from the count alone. No speculative legacy profile, delta, history entry, or acceptance rule was added.

Catalog normalization was reviewed: object-property and array ordering are already canonicalized; physical column position and PostgreSQL 18 NOT NULL catalog entries are already excluded while column nullability remains checked. SQL/default/constraint/RPC text, search_path, ACL semantics, trigger and RLS/policy changes remain strict. Whitespace changes inside SQL can change string literals or function behavior; this patch does not broadly normalize them or ignore permissions to force a match. A PostgreSQL-version or privilege difference is a hypothesis until the actual keys and authorized catalog evidence are available.

`schema_review` now records projectRef, reason, baseline, comparisonBaseline, differenceCount and key/change pairs. HTTP diagnostics and logs omit SQL definitions, rows and credentials. Repository-known object keys are printed exactly. Unknown identifiers may themselves contain secrets, so their names are replaced with a stable opaque identifier; their section and change remain visible. UI exposes the full safe list under 진단 상세.

## OAuth recovery contract

An existing authorized installer session is checked before project discovery on reload/reconnect. A fresh OAuth callback intentionally uses the new grant rather than a prior cookie, preserving account-switch and stale-session protections.

Only persisted runtime configuration supplies the recovery target; no free-text project-ref input is introduced. It must exactly match `https://<projectRef>.supabase.co`. If discovery returns zero projects, the server inspects that project with the current OAuth grant and verifies the returned ref. The recovery target is bound to that short-lived grant. Session creation checks the list again and repeats direct inspection before consuming the grant. A bare session request without verified recovery cannot bypass the project list. Non-empty lists retain the ordinary membership check.

403 gives the original-account guidance; 404 gives an existing-installation mismatch message. Neither tells existing users to create a project. Fresh users without runtime configuration retain the new-project guidance. Public config stays unchanged on denied/mismatching targets.

Management API response parsing prefers the documented `ref`, supports older `id` responses, and projects only public metadata. It never substitutes the requested ref for an absent response identifier.

## Official API references checked

- https://supabase.com/docs/reference/api/v1-list-all-projects
- https://supabase.com/docs/reference/api/v1-get-project
- https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration
- https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes

Both project endpoints require `projects:read`. OAuth authorization is organization-scoped; organization selection and project membership must not be inferred from local configuration. The docs do not provide an exhaustive reason list for an empty array, so this change does not assert that empty means no project, wrong scope, or a particular account issue. Scopes are configured on the OAuth app; changing them requires reauthorization. No scopes were broadened. The changelog Markdown endpoint could not be read by the web tool (unsupported content type).

## Verification

Windows clean clone, Node/npm lockfile install. Initial checks exposed checkout CRLF conversion and sandbox loopback constraints; the working copy was restored to repository LF content and tests were run with loopback access. No production SQL or Edge deployment was performed by local tests.

- Full unit suite after recovery/diagnostic change: 687 passed, zero failed/skipped.
- Management adapter and added recovery/diagnostic tests after API compatibility adjustment: 69 passed.
- Security: 1 passed; typecheck, typecheck:edge, lint, build passed.
- Installer browser tests: 27 passed, including real HTTP/cookies + synthetic Management API, empty list success/403/404/fresh, existing session reuse, 22-item UI and known legacy/latest/drift with real local PostgreSQL.
- Existing regression tests/assertions remain intact. No skips were added.

Known legacy: historical replay zero, only the pre-existing guarded transition; latest: DB writes/Edge redeploy/secret changes zero; fresh: 24 migrations; real drift: mutations zero. Protected tables, PIN/UUID/attempt/project/session/reward fields and true completion preservation are covered by the retained PGlite suite. No Edge source, migration, baseline or transition artifact changed.

Actual teacher recovery remains unverified. After deployment, refresh setup and press 설치 확인 once; the teacher's own authorized session produces the missing metadata. Keep drift blocked unless a known profile already matches or a subsequent evidence-backed exact profile/transition is reviewed.
