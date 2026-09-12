# Phase 1B server diagnosis

Starting branch: `feature/spatial-math-redesign-v1`
Starting HEAD: `5b43a2504085443235afed4c55ba0064ea043150`
Date: 2026-09-13 KST. Pre-existing working changes preserved.

## Exact reproduction

`npm run qa:redesign` was run once unchanged before diagnosis. `reproduction.json`, `qa-redesign.stdout.log`, and `qa-redesign.stderr.log` preserve the result. Build succeeded. Preview exited with `listen EPERM: operation not permitted 127.0.0.1:4186`. Exit was immediate, not a 15-second timeout. No listening process was found on that port.

Actual chain: package.json → scripts/run-redesign-qa.mjs → production build → playwright.redesign.config.ts → scripts/redesign-preview.mjs → node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4186 --strictPort. Both the health URL and browser baseURL use http://127.0.0.1:4186. localhost/IPv6 resolution is not used.

The exact preview wrapper was also run outside Playwright in the sandbox: same EPERM, PID created then exited (`manual-server.json`). The same command under tool-approved local execution successfully served HTTP 200 for `/`, `/?class=TEST`, `/student/lesson/3/redesign`, and `/teacher` (`permitted-manual-server.json`). Only the owned server was stopped.

Confirmed cause: sandbox localhost binding restriction. Not a missing build, port collision, IPv4/IPv6 mismatch, Vite argument, missing browser, missing Supabase environment value, working directory, or incorrect health URL. No port change, timeout increase, dev-server substitution, or new dependency was needed.

## Real browser findings

Original 15 tests passed in actual Chromium, but screenshot inspection found an untested mismatch. At +X, the asymmetric model shows column heights 2,1,3, while the reference grid showed 3,1,2. The new T03 samples the actual WebGL screenshot and compares it to independently fixed cells. It failed against the original build at the reference-grid assertion (the rendered model itself passed). See `right-side-reproduction.log` and its screenshot/trace.

Correction: redesign-only projection display/inverse adapter mirrors legacy stored side columns. Coordinate arrays, generated answers, grading, curriculum IDs and existing records remain unchanged. Applied to learn references, matching, change comparison, solve/practice answers, materials and answer reveal. Legacy ProjectionGrid remains on its established contract, with a separate actual-route floor regression.

Other observed corrections: front text is attached to the actual z=0 board edge instead of a fixed canvas-bottom badge; original perspective framing clipped the highest cube, so home/free distance is increased without changing canonical orthographic placement scale. Removed surplus header margins without reducing 48px cells or touch buttons. Position DOM updates occur only when the projected marker moves.

QA fixes: screenshot coverage and stronger input/delete/feedback/restore checks; R16 legacy grid uses actual `GRID` presentation enum; preview PID/exit/stdout/stderr recording; full runner logs and non-overwriting output; retained traces; ESLint excludes generated Playwright HTML viewer code (original lint failure was 3632 errors in vendor trace assets, not application source).

## Scope

UI_WITH_TEST_DATA, production preview, LOCAL_ONLY progress. New-route grading runs the actual client grading logic; no always-correct mock. Legacy grid fixture checks its actual submission payload and returns an incorrect response for the intentionally partial answer. All non-local requests are aborted or intercepted as synthetic responses. LIVE_SUPABASE and physical iPad/Safari are not verified. No deployment, migration, remote account or student data change.

Final execution results are recorded separately in report.md and the final-run report.

## Subsequent evidence-driven QA corrections

`final-run/` ran all 16 cases: 14 passed, T09 and T13 failed. T09 reached problem 7/10 after six real submissions, then exceeded its 90s total flow budget while recording a full-page two-model capture (the interrupted screenshot stream reported an unexpected byte count). T13 actually reached the extra problem 6/10; its generic h2 selector also matched the retained five-problem completion heading. This was a TEST selector error, not a failure to enter extra practice.

T13 now selects the actual 6/10 question heading. T01 (five complete activities) and T09 (ten complete problems) have a bounded 180s total budget; individual assertion waits remain 5s. Automatic trace video screenshots were removed to reduce software-rendering/IO work; explicit requested screenshots and DOM/action traces remain. No test is skipped and no answer or grading assertion is relaxed.

Screenshot inspection additionally showed that the picking plane at y=-0.005 covered the tile tops at y=-0.01. It is now below the tiles at y=-0.02, exposing their gaps without changing integer coordinates or support rules. Two before/after models and the answer/correct-answer pair were unnecessarily stacked vertically; the existing views now sit side by side where desktop width permits. Narrow-screen stacking and full-size controls remain.

The final gate is `verified-final/`, not `final-run/`. Its identity file records the exact source/build hashes, original HEAD and retained working changes. Final status is derived from its actual report, not from the earlier original 15/15 or intermediate 14/16 results.

## Final confirmation

`verified-final/` executed 16: 13 passed. T07/T13 reached the correct page just after the 5s cold-start heading wait; failure DOM snapshots contain the expected heading. T08 failed before input because manual tracing.start duplicated Playwright-owned tracing. Only initial heading wait was bounded to 15s and manual trace start/stop removed; interaction assertions and actual touch gestures unchanged.

`focused-confirmation/`: T07/T08/T13 all pass on unchanged dist. `gate-confirmation/`: final full single invocation 16/16 PASS, retries 0, no skipped tests. This supersedes the earlier proposed final gate. Both use the exact verified-final production build hash, with final test-source identity recorded. No browser installation or user manual QA required. See report.md, summary.json, screenshots/manifest.json.
