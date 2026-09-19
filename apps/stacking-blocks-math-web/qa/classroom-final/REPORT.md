# Classroom final QA — 2026-09-20

Result: PARTIAL. Start HEAD ca832e5a542d254a385b0f512f16b3e70497904a, plus preserved working-tree changes. No installation, migration, production or old TEST project operation.

## Minimal repair

The deployed ReviewSummary only called `getStudentHome` on mount and `activity:review:save` on save. It had no evaluation read. The existing local repair now connects `ReviewSummary` → `activityApi('review:get')` → authenticated student-api activity dispatch → `sb_self_evaluations`, selecting only confidence/reflection by server-authenticated student ID. Loading disables edits to prevent overwriting saved text before fetch, saving disables repeated clicks, effect cleanup ignores stale reads. No problem generator, grader, curriculum, design or installer change.

Frontend and student-api must be updated together on fresh TEST; no migration required. This run has NOT deployed them. Supabase management read on the fresh project returned permission denied. Chrome connection also timed out. These limitations do not constitute remote PASS.

## Checks

- Related Node tests: 4 PASS (challenge API 2, review/concurrent writes 1, 30-student test 1).
- 30-student controlled test: synthetic login, two local classes, real activity handler + PostgreSQL/PGlite migrations/RPC. 60 progress submissions produce 30 completions and one 30-XP reward per student; 30 concurrent lists seed 24 rows/class without duplicates; peer and system public DTOs lack private fields; cross-class reads return 404. Duplicate score submissions produce one 2-point row/student. 60 project writes produce 30 success and 30 version-conflict responses; L11 reads each owner's L10 content. Self-evaluation restores under re-created synthetic sessions.
- PGlite serializes execution internally. This is a controlled contention/ownership check, NOT real Supabase network throughput, real Auth load, or a 30-browser benchmark.
- First test expectation incorrectly treated one completed problem as the whole seeded lesson complete. Corrected to assert that problem's completion, saved position and exactly one XP reward. Application assertion was not weakened to conceal a product failure.
- Typecheck, lint, production build, Edge typecheck, security: PASS. Build has existing chunk-size warnings. Lint initially scanned generated Playwright HTML/trace JavaScript; report moved to the already-excluded QA HTML directory, no source rules suppressed.
- Browser: one L12 test only; uses actual production-build route/UI with synthetic API transport and real activity SQL. Initial failures were a stale exact-label selector: the trace proves React mounted textarea text as a child of the wrapping label after restoration, changing the label text. The accessibility snapshot still names the textbox 배운 점. Changed to that exact textbox role/name, retained expected contents, and additionally asserted the review:get response. Final outcome recorded below.

## Remote evidence boundary / remaining work

Prior fresh TEST manual smoke (not repeated): student login, problem completion, progress after refresh/relogin, student A/B project isolation, L9 fallback and 2 points, L10 save → L11 continuation.

Current run: fresh TEST peer/system response capture NOT_VERIFIED. Local handler DTO checks PASS do not prove deployed response safety. Installer plan detail and fresh DB seed duplicates TODO. L12 common/adaptive full live flow and lesson-skip policy not newly verified. Real 30 simultaneous logins and independent PostgreSQL connections remain NOT_RUN. No claim of whole-class readiness.

Production: NONE. Existing `.gitignore`, overnight artifacts and phase5 artifacts preserved, excluded from this commit.

Final targeted Chromium run: 1 PASS, 0 FAIL (44.3 seconds). Actual numeric input/submission → self-evaluation save → reload → review:get response and restored textbox → B login/empty evaluation → A re-login/restored evaluation. Screenshot `review-restored.png` reviewed. UI_WITH_TEST_DATA; no Supabase request was sent by the browser test. Server: registered preview command, isolated port 4189 because existing 4173 was occupied. Temporary test config is removed after execution. Two earlier failed runs retained as diagnostic evidence, not counted as PASS.

Reproduce targeted browser check on a free standard port: `npm run test:e2e -- e2e/live-flow.spec.ts --grep 'lesson12 numeric'`.
Local controlled check: `node --experimental-strip-types --test tests/classroom-reliability.test.ts tests/classroom-thirty.test.ts tests/challenge-api-flow.test.ts`.
