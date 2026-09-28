# New Device Teacher Access Fix

Status: IN PROGRESS — production and physical iPhone verification are mandatory before COMPLETE.

## Root cause and changes

Production intentionally resolves Supabase settings from browser-local runtime configuration. TeacherGate previously constructed the Supabase Auth client even when that configuration was absent, then rendered the classified exception verbatim. A clean device therefore saw SUPABASE_CONFIG_ERROR instead of a connection entry point.

TeacherGate now checks configuration before mounting the authentication component. Missing configuration shows “이 기기에서는 아직 수업앱 연결이 되어 있지 않습니다.” and “기존 수업앱 연결하기”. Malformed install fragments show friendly guidance and preserve any existing configuration.

The reconnect link opens /setup?returnTo=%2Fteacher. The exact /teacher allowlist is retained in same-tab sessionStorage across the existing OAuth round trip. The user explicitly selects the existing project; a successful project binding stores public configuration and returns to /teacher. Normal teacher authentication still applies. This path bypasses install/update execution and requires no database migration.

The dashboard's “교사용 접속 링크 복사” reuses encodeInstallationConfig and /teacher#install=.... Its payload contains only supabaseUrl, supabasePublishableKey, and the public project ref in the existing installationId field. Arbitrary installation identifiers and extra object properties are not exported. Legacy anon keys remain compatible; privileged/session JWTs and opaque tokens are rejected for teacher sharing.

## Secret audit

- Explicit field projection at serialization, parsing and persistence; extra service_role, OAuth secret, teacher password, auth token and student PIN properties are excluded.
- URL userinfo, query, fragments and non-root paths are rejected.
- service_role/authenticated/session JWT payloads are rejected; a legacy anon JWT remains supported.
- Teacher links require a Supabase project hostname and a recognized public-key format.
- OAuth credentials remain in the existing server flow; no credentials copied into links, source or reports.
- No migration, RLS, Edge Function, installer backend or Render configuration changes in this fix.
- Local pre-existing print-login-sheet commit ac0a056 is preserved as the parent.
- main is untouched.

## Verification ledger

- Baseline production: raw SUPABASE_CONFIG_ERROR reproduced in the clean Codex in-app browser on 2026-09-28.
- Baseline installed Chrome: existing class and 14 students visible before modification (personal data omitted from this report).
- New-device Chromium tests: initial 5 scenarios passed; OAuth and data responses here are synthetic, not live Supabase evidence.
- Unit: 582/582 PASS, no skips. Typecheck, lint, production build, security (1/1), and Edge typecheck PASS.
- Full E2E: initial 42 passed / 2 failed due to stale selectors; corrected-selector rerun and mobile run pending.
- TEST deployment and real OAuth: pending.
- Production deployment and fresh-device verification: pending.
- Physical iPhone Safari: BLOCKED pending user test; the user explicitly said a physical-device check is possible later. WebKit emulation is reported separately and cannot satisfy this item.

## Test commands

```
npm test
npm run typecheck
npm run lint
npm run build
npm run test:security
npm run typecheck:edge
npm run test:e2e
npx playwright test --config playwright.teacher.config.ts
```

Two existing E2E selectors were stale: height-map +/- used DOM order, and lesson 12 used a removed placeholder. Both now use current accessible names without changing product behavior or expectations.
