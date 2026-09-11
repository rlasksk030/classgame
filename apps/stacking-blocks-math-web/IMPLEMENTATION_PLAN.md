# Implementation plan (2026-09-11)

The latest specification requires React/TypeScript/Vite, Babylon.js and Supabase.

## Repository investigation
- apps/gyeol-hap and apps/mystery-sign are separate static applications; leave them untouched.
- This application is isolated in apps/stacking-blocks-math-web.
- AI interview source is absent from this checkout. HANDOVER.md records a GAS/Sheets implementation with PIN hashing, HMAC sessions and lockout patterns. This is inherited evidence, not a fresh verification of that source.
- Reuse the existing sb_ schema namespace, server session verification and shared coordinate/projection/grading/attempt modules. Preserve Deno .ts import extensions.
- Retain the Cloudflare Pages deployment structure (_redirects, _headers, wrangler.toml).

## Implementation and verification sequence
1. Replace R3F with a shared Babylon engine: camera, pointer drag, snap/physics, ghost, layers, React cleanup.
2. Pure logic regression tests; durable student save/restore.
3. Teacher authentication, authoring, progress; lessons 9-12.
4. Lazy teacher worksheet extraction, review, explicit approval and publication; private Storage.
5. Migrations, live Supabase integration/RLS, desktop/touch E2E and production checks.

Do not claim production completion before all acceptance checks have actually passed.

## Verified continuation

- Replaced R3F with Babylon.js; modular imports reduced the lesson bundle from roughly 6 MB to roughly 1 MB before gzip.
- Added teacher Auth gate and Auth bearer forwarding; repaired missing teacher ownership checks.
- Added local snapshot recovery, teacher builder and teacher student-record viewer.
- Added UUID seed migrations and service-only atomic attempts/progress/reward RPC.
- Local checks: frontend and Edge typecheck, lint, 8 Node/PostgreSQL tests, 1 Deno security test, seed 26 checks; 4 Chromium E2E with mocked API.
- Actual Supabase credentials/configuration and deployment are not available in this checkout. No remote deployment or real-login verification has been performed.
- Do not treat the original HANDOVER's percentages as current completion evidence. The README lists unimplemented features explicitly.
