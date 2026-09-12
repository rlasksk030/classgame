# Spatial redesign Phase 1 — checkpoint

Date: 2026-09-13 KST. Start HEAD: 3454fd7dcd712da037ab08cf9582f7229cd8680a.
Branch: feature/spatial-math-redesign-v1.
Backup: /private/tmp/stacking-blocks-pre-redesign-20260912-235523/ (HEAD, status, tracked/staged diff, deployment-readiness; supabase/.temp excluded).

## IMPLEMENTED

Temporary identity-scoped local route: `/student/lesson/3/redesign`. Uses the existing runtime installation and student identity. No operating accounts were accessed. This slice does not call remote APIs or write legacy progress.

- Version `spatial-v2`: explicit lesson/activity/problem/input/grading/reveal/camera/completion contracts.
- Discriminated answer renderer: choice, boolean judgment, number, projection grid, height map, layers, blocks, mapping.
- Separate display adapter and inverse; existing floor ProjectionGrid now uses the adapter, without changing math coordinates.
- Lesson 3: five action-gated learn activities, summary, six common solve questions + four selected by error concept tags, five required practice + five optional.
- Four-step feedback: brief cue, visual focus + canonical view, specific hint, answer/reason/own-answer comparison. Correcting the actual input completes the task.
- Local answer/state serialization includes grid, choices, blocks/history, activity position, question position, adaptive assignment. Namespace includes project URL, installation, class, student, curriculum version.
- Shared Babylon scene reused; optional highlighted columns and allowed view controls added. Legacy authentication and remote functions unchanged by this phase.

## LOCAL_ONLY / REMOTE_SCHEMA_REQUIRED

The slice grades deterministically in the browser and stores progress on this device only. It does not claim server-secure assessment or cross-device synchronization. Its local solution definitions are client-visible; production server assessment requires private problem delivery/grading later.

REMOTE_SCHEMA_REQUIRED: versioned raw-answer/activity/set storage and server validation for spatial-v2. No migration was written/applied; no Edge Function was deployed. Legacy tables, records, PIN, Secret and attempts were not changed. A local token-derived namespace is not server authentication.

## Verification

- Fixed asymmetric fixture uses hand-written top/front/right expected grids, not only generator-grader self-comparison.
- New unit cases include display/inverse, add/remove effects, floating rejection, right-vs-left, canonical submission, deterministic samples, adaptive assignment, feedback, restoration, activity gates, unsupported solver/empty-constraint rejection.
- Generator samples: 0, 1, 2, 123, 314159, 2147483647, 4294967295. This is finite local validation, not all possible seeds.
- Existing + new unit suite: 75 passed in current working tree (pre-existing modifications included).
- typecheck, lint, Edge typecheck and security test passed; production build verification logs retained under /private/tmp/spatial-phase1-*.

## Browser: BLOCKED, executed 0

One production browser attempt was made. Vite preview failed before browser launch. Playwright recorded `Process from config.webServer was not able to start. Exit code: 1`. This run did not preserve the underlying preview stderr, so a precise OS cause is not claimed. It was not retried or bypassed.

Evidence: `../redesign-browser/3454fd7-2026-09-12T15-08-24-279Z/report.json`.
T01–T15 are all BLOCKED / NOT_RUN, not passed. No screenshots or successful UI claims.

The prepared `npm run qa:redesign` command now builds production assets, records HEAD/working-tree identity, starts only its own strict-port preview, preserves preview.log, blocks remote browser requests, and runs the same student route with synthetic identity/state. Reports are timestamped at `qa/redesign-browser/<HEAD>-<timestamp>/{identity.json,summary.json,report.json,report.md,preview.log,html/,evidence/}`. All required cases must execute/pass for exit 0. Playwright Chromium is an existing dependency; the hardened runner itself has not been rerun after the startup block.

Scenarios: learn 1–5; canonical camera; right reference; front display/inverse; full-cell submission; square cells desktop/tablet/portrait; real mouse drag/undo/redo/reload; synthetic touch drag; all ten solve inputs; stage round trip; grid reload; feedback/reveal/correction; practice five; legacy student login form; legacy teacher login form.

Existing student/teacher authentication LIVE behavior, Safari/iPad hardware, pointer/zoom and production WebGL visuals remain unverified. The login regression cases cover form rendering only, not Auth success.

## Preservation and scope

The original ten modified files remain uncommitted. Nine were byte-identical to their reconstructed pre-phase versions; BlockWorld contains only additive Phase 1 view/highlight hooks alongside its pre-existing edits. Newly written files and phase-only edits can be committed separately. supabase/.temp and deployment-readiness are excluded from the phase commit.

No push, deploy, remote migration, student-data modification, new installation executor, or other lesson redesign.
Overall: PARTIAL — IMPLEMENTED / VERIFIED_UNIT; NOT VERIFIED_LOCAL_BROWSER; REMOTE_NOT_VERIFIED.

## Phase 1B follow-up — actual browser gate PASS (2026-09-13 KST)

The original Phase 1 BLOCKED result above is historical and preserved. Phase 1B reproduced the actual sandbox EPERM, then used tool-approved local execution with the same production preview. Final single Chromium run: required T01–T15 and legacy ProjectionGrid R16 all PASS (16/16), real inputs/submissions/feedback/reload. A screenshot-discovered right-side display mismatch was reproduced by independent canvas-pixel expectations and fixed with a redesign-only display/inverse adapter. Board front label, floor grid visibility and minimal desktop comparison framing were corrected. Unit suite is now 76 PASS.

See [Phase 1B report](browser-gate/report.md), [final results](browser-gate/gate-confirmation/report.json), [screenshots](browser-gate/screenshots/manifest.json). Tested production build hash: 9021a0c7d760e7e518ab4f73928d63984b55d12ee78dd5df24c449cf319c2541. Start HEAD 5b43a2504085443235afed4c55ba0064ea043150 plus preserved working changes and Phase 1B edits. This is UI_WITH_TEST_DATA / LOCAL_ONLY, not live authentication, remote persistence or actual iPad/Safari verification. READY_FOR_PHASE_2 for this gate only; no next lesson implemented or deployed.
