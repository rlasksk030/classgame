# Overnight start status
2026-09-13T01:23:38.471160+09:00

$ git status --short
 M CURRENT_REQUIREMENTS.md
 M QUALITY_GATE.md
 M scripts/local-browser-qa.ts
 M shared/practiceSet.ts
 M src/components/world/BlockWorld.tsx
 M src/pages/ArchitecturePage.tsx
 M src/pages/LessonPage.tsx
 M src/styles/index.css
 M supabase/functions/student-api/index.ts
 M tests/practice-recovery.test.ts
?? qa/deployment-readiness/
?? qa/redesign-browser/
?? qa/redesign-phase1/browser-gate/BlockWorld.before-phase1b.txt
?? qa/redesign-phase1/browser-gate/BlockWorld.phase1b.patch
?? qa/redesign-phase1/browser-gate/build-final.log
?? qa/redesign-phase1/browser-gate/build-fix.log
?? qa/redesign-phase1/browser-gate/edge.log
?? qa/redesign-phase1/browser-gate/final-run.stderr.log
?? qa/redesign-phase1/browser-gate/final-run.stdout.log
?? qa/redesign-phase1/browser-gate/final-run/evidence/
?? qa/redesign-phase1/browser-gate/final-run/html/
?? qa/redesign-phase1/browser-gate/final-run/preview.log
?? qa/redesign-phase1/browser-gate/final-run/report.md
?? qa/redesign-phase1/browser-gate/final-run/screenshots/
?? qa/redesign-phase1/browser-gate/final-run/server-process.json
?? qa/redesign-phase1/browser-gate/final-run/webserver.stderr.log
?? qa/redesign-phase1/browser-gate/final-run/webserver.stdout.log
?? qa/redesign-phase1/browser-gate/first-browser-run/evidence/
?? qa/redesign-phase1/browser-gate/first-browser-run/html/
?? qa/redesign-phase1/browser-gate/first-browser-run/preview.log
?? qa/redesign-phase1/browser-gate/first-browser.stderr.log
?? qa/redesign-phase1/browser-gate/first-browser.stdout.log
?? qa/redesign-phase1/browser-gate/focused-confirmation/browser-environment.json
?? qa/redesign-phase1/browser-gate/focused-confirmation/evidence/
?? qa/redesign-phase1/browser-gate/focused-confirmation/html/
?? qa/redesign-phase1/browser-gate/focused-confirmation/preview.log
?? qa/redesign-phase1/browser-gate/focused-confirmation/screenshots/
?? qa/redesign-phase1/browser-gate/focused-confirmation/server-process.json
?? qa/redesign-phase1/browser-gate/focused-confirmation/webserver.stderr.log
?? qa/redesign-phase1/browser-gate/focused-confirmation/webserver.stdout.log
?? qa/redesign-phase1/browser-gate/gate-confirmation/html/
?? qa/redesign-phase1/browser-gate/lint-final.log
?? qa/redesign-phase1/browser-gate/lint-fixed.log
?? qa/redesign-phase1/browser-gate/lint.log
?? qa/redesign-phase1/browser-gate/manual/
?? qa/redesign-phase1/browser-gate/permitted-manual/
?? qa/redesign-phase1/browser-gate/right-side-reproduction.log
?? qa/redesign-phase1/browser-gate/right-side-reproduction/html/
?? qa/redesign-phase1/browser-gate/security.log
?? qa/redesign-phase1/browser-gate/test-typecheck-final.log
?? qa/redesign-phase1/browser-gate/test-typecheck.log
?? qa/redesign-phase1/browser-gate/typecheck.log
?? qa/redesign-phase1/browser-gate/unit.log
?? qa/redesign-phase1/browser-gate/verified-final.stderr.log
?? qa/redesign-phase1/browser-gate/verified-final.stdout.log
?? qa/redesign-phase1/browser-gate/verified-final/browser-environment.json
?? qa/redesign-phase1/browser-gate/verified-final/evidence/
?? qa/redesign-phase1/browser-gate/verified-final/html/
?? qa/redesign-phase1/browser-gate/verified-final/preview.log
?? qa/redesign-phase1/browser-gate/verified-final/report.md
?? qa/redesign-phase1/browser-gate/verified-final/screenshots/
?? qa/redesign-phase1/browser-gate/verified-final/server-process.json
?? qa/redesign-phase1/browser-gate/verified-final/webserver.stderr.log
?? qa/redesign-phase1/browser-gate/verified-final/webserver.stdout.log
?? qa/redesign-phase1/browser-gate/verified-run.stderr.log
?? qa/redesign-phase1/browser-gate/verified-run.stdout.log
?? qa/redesign-phase1/browser-gate/verified-run/
?? supabase/.temp/


$ git branch --show-current
feature/spatial-math-redesign-v1


$ git rev-parse HEAD
fcb1d28f37b92ecd61deb8680f5485b152beb4a5


$ git log --oneline -10
fcb1d28 fix: align spatial views and verify redesign in browser
5b43a25 feat: add spatial redesign lesson 3 local vertical slice
3454fd7 docs: record live repetition evidence and deployment verification limits
d6bbe66 fix: preserve legacy practice sets and make replacement idempotent
875229a docs: record practice set checkpoint validation
b7ae120 fix: isolate practice sets and prevent repeated generated tasks
ac0b3f3 fix: distinguish connection setup from verified installation
ac5d871 feat: restore staged lesson learning flow
fbcc098 qa: fix browser runner timing and drag probes
9518934 fix: align projection grids and completion navigation
