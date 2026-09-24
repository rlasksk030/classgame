import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// One-click update on the teacher page, so a teacher never has to leave
// /teacher and walk the /setup wizard for a routine update. Reuses the
// exact same installer backend contract /setup already uses (same
// InstallerClient class, same status/update calls, same current-runtime-
// project resolution via getResolvedSupabaseConfig -- never a hardcoded
// project ref) rather than inventing a second update protocol.

async function readWidget(): Promise<string> {
  return readFile(new URL("../src/features/teacher/UpdateStatusWidget.tsx", import.meta.url), "utf8");
}
async function readSetup(): Promise<string> {
  return readFile(new URL("../src/pages/SetupPage.tsx", import.meta.url), "utf8");
}
async function readTeacherPage(): Promise<string> {
  return readFile(new URL("../src/pages/TeacherPage.tsx", import.meta.url), "utf8");
}
async function readInstallerLib(): Promise<string> {
  return readFile(new URL("../src/lib/installer.ts", import.meta.url), "utf8");
}

test("button location: the widget is rendered in the teacher header, immediately after the nav (도움말 button's row)", async () => {
  const page = await readTeacherPage();
  assert.match(page, /<\/nav>\s*\n\s*<UpdateStatusWidget onUpdated=\{/);
});

test("A. status INSTALLED renders '최신 버전입니다', not a generic success message invented separately from the shared InstallerRemoteStatus type", async () => {
  const widget = await readWidget();
  assert.match(widget, /if \(result\.status === "INSTALLED"\) setState\(\{ kind: "upToDate" \}\);/);
  assert.match(widget, /최신 버전입니다/);
});

test("B. status UPDATE_REQUIRED shows an explicit [지금 업데이트] action, and clicking it calls the shared installerClient.update(target) -- the same call /setup's 업데이트 button makes, not a separate reimplementation", async () => {
  const widget = await readWidget();
  assert.match(widget, /else if \(result\.status === "UPDATE_REQUIRED"\) setState\(\{ kind: "updateRequired" \}\);/);
  assert.match(widget, /지금 업데이트/);
  const applyFn = widget.match(/const applyUpdate = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(applyFn);
  assert.match(applyFn!, /await installerClient\.update\(target\);/);
  assert.match(applyFn!, /setState\(\{ kind: "updateComplete" \}\);/);
  assert.match(applyFn!, /onUpdated\?\.\(\);/, "must trigger the caller's refresh callback on success");
});

test("C. installer OAuth session missing/expired/revoked shows 'Supabase 연결이 필요합니다' with [연결하고 업데이트], which marks a resume flag before starting the SAME beginAuthorization() redirect /setup uses -- never a second OAuth implementation", async () => {
  const widget = await readWidget();
  assert.match(widget, /if \(issue === "session" \|\| issue === "revoked" \|\| issue === "mismatch"\) setState\(\{ kind: "needsConnection", issue \}\);/);
  assert.match(widget, /Supabase 연결이 필요합니다/);
  const connectFn = widget.match(/const connectAndUpdate = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(connectFn);
  assert.match(connectFn!, /markInstallerResumeUpdate\(\);/);
  assert.match(connectFn!, /const \{ authorizeUrl \} = await installerClient\.beginAuthorization\(\);/);
  assert.match(connectFn!, /window\.location\.assign\(authorizeUrl\);/);
});

test("C-continued. SetupPage consumes the resume flag once the OAuth round trip has rebound the same project, finishes the update, and navigates back to /teacher -- the teacher is never made to walk the wizard for a reconnect started from the update widget", async () => {
  const setup = await readSetup();
  const resumeEffect = setup.match(/useEffect\(\(\) => \{\s*if \(oauthCallbackPending \|\| !connectionVerified \|\| !installerClient\) return;[\s\S]*?\n {2}\}, \[oauthCallbackPending, connectionVerified, installerClient\]\);/);
  assert.ok(resumeEffect, "resume-update effect not found in SetupPage");
  assert.match(resumeEffect![0], /if \(!consumeInstallerResumeUpdate\(\)\) return;/);
  assert.match(resumeEffect![0], /await installerClient\.update\(installerTarget\(\)\);/);
  assert.match(resumeEffect![0], /navigate\("\/teacher"\);/);
});

test("C-continued. the resume flag is sessionStorage-backed and consumed exactly once (read-and-clear), never left to fire again on a later unrelated /setup visit", async () => {
  const lib = await readInstallerLib();
  assert.match(lib, /sessionStorage\.setItem\(INSTALLER_RESUME_UPDATE_KEY, "1"\);/);
  assert.match(lib, /const present = sessionStorage\.getItem\(INSTALLER_RESUME_UPDATE_KEY\) === "1";/);
  assert.match(lib, /if \(present\) sessionStorage\.removeItem\(INSTALLER_RESUME_UPDATE_KEY\);/);
});

test("current-project detection: the widget builds its target from getResolvedSupabaseConfig() + projectRefFromUrl(), the same runtime-config resolution every other part of the app uses -- no project ref is hardcoded anywhere in this file", async () => {
  const widget = await readWidget();
  assert.match(widget, /const runtimeConfig = getResolvedSupabaseConfig\(\);/);
  assert.match(widget, /const projectRef = projectRefFromUrl\(runtimeConfig\.supabaseUrl\);/);
  assert.doesNotMatch(widget, /tkniwelldgdlgwavyfdj|bykgkjwysliyqjqttabe|lpjpwrgzwumnikroledh/i, "must never hardcode a specific project ref");
});

test("data preservation: the widget and its resume flow only ever call installer status/update/beginAuthorization -- never any sb_classes/sb_students/sb_problem_attempts table access, and never install/repair/revoke (only status-check and update)", async () => {
  const widget = await readWidget();
  assert.doesNotMatch(widget, /from\("sb_|from\('sb_|\.delete\(\)|startInstall|\.repair\(|\.revoke\(/, "the teacher-page widget must only check status and update -- never install/repair/revoke or touch a data table directly");
});

test("11. a failed status check or failed update only ever sets this widget's own local state -- it imports no TeacherPage setter and cannot touch students/lessons/progress/sessions state", async () => {
  const widget = await readWidget();
  assert.doesNotMatch(widget, /setStudents|setLessons|setProgressStudents|setSessionsStudents|setStudentsError|setProgressSummaryError/, "must never reach into TeacherPage's own state setters");
  // The only bridge to TeacherPage is the onUpdated callback prop, called
  // solely on a *successful* update -- never on a checking/failed state.
  const applyFn = widget.match(/const applyUpdate = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(applyFn);
  const successBranch = applyFn!.split("} catch")[0];
  assert.match(successBranch, /onUpdated\?\.\(\);/);
});

test("F. TeacherPage wires onUpdated to refresh via the exact same loadClassData/loadSessions functions the page already uses for its own boot/polling -- no separate, possibly-inconsistent refresh path, and no forced full-page reload as the only option", async () => {
  const page = await readTeacherPage();
  assert.match(page, /onUpdated=\{\(\) => \{ if \(classId\) \{ void loadClassData\(classId\); void loadSessions\(classId\); \} \}\}/);
});

test("UI: no error-red/alarming styling for the routine 'update available' state -- a warm/neutral color only, per the 'no excessive warning colors' requirement, distinct from the genuine error (updateFailed/checkFailed) states which do use .error", async () => {
  const widget = await readWidget();
  const updateRequiredBlock = widget.match(/\{state\.kind === "updateRequired" && <>[\s\S]*?<\/>\}/)?.[0];
  assert.ok(updateRequiredBlock);
  assert.doesNotMatch(updateRequiredBlock!, /className="error"/);
  const failedBlock = widget.match(/\{state\.kind === "updateFailed" && <>[\s\S]*?<\/>\}/)?.[0];
  assert.match(failedBlock!, /className="error" role="alert"/);
});
