import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// No React/DOM test harness exists in this repo (see other tests/*.test.ts:
// plain node:test, no jsdom/RTL). These assert the exact structural
// properties a live-reported "click does nothing, no network request" bug
// depends on, so a future edit can't silently reintroduce them:
// a wrapped `() => void handler()` swallowing the click, an implicit
// type="submit" button inside a form, or a disabled state gated on an
// unrelated flag (busy) that can get stuck for reasons that have nothing to
// do with this specific action.

async function readSetupPageSource(): Promise<string> {
  return readFile(new URL("../src/pages/SetupPage.tsx", import.meta.url), "utf8");
}

test("stale-session reconnect button calls startOAuthConnect directly, not a wrapped arrow function", async () => {
  const source = await readSetupPageSource();
  const staleSessionBlock = source.match(/설치 연결이 만료되었습니다[\s\S]{0,400}/)?.[0];
  assert.ok(staleSessionBlock, "the stale-session reconnect branch must exist");
  assert.match(staleSessionBlock!, /type="button"/);
  assert.match(staleSessionBlock!, /onClick=\{startOAuthConnect\}/);
  assert.doesNotMatch(staleSessionBlock!, /onClick=\{\(\)\s*=>\s*void startOAuthConnect\(\)\}/);
});

test("stale-session reconnect button is disabled only by authorizing, not by an unrelated busy flag", async () => {
  const source = await readSetupPageSource();
  const staleSessionBlock = source.match(/설치 연결이 만료되었습니다[\s\S]{0,400}/)?.[0];
  assert.ok(staleSessionBlock);
  assert.match(staleSessionBlock!, /disabled=\{authorizing\}/);
  assert.doesNotMatch(staleSessionBlock!, /disabled=\{authorizing \|\| busy\}/);
});

test("startOAuthConnect always clears authorizing via finally and never persists it", async () => {
  const source = await readSetupPageSource();
  const fnBody = source.match(/const startOAuthConnect = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "startOAuthConnect must exist");
  assert.match(fnBody!, /finally\s*\{[\s\S]*setAuthorizing\(false\)/);
  assert.match(fnBody!, /window\.location\.assign\(authorizeUrl\)/);
  // authorizing must stay a plain runtime useState, never round-tripped
  // through saveInstallerProgress/localStorage.
  assert.doesNotMatch(fnBody!, /saveInstallerProgress|localStorage/);
});

// Live Chrome Network evidence: a fresh "?oauth=granted" redirect never
// produced a projects/session request at all, because a stale connected
// flag from a *previous* project's config short-circuited the grant
// handling before it could run. These lock in that a fresh grant is
// processed unconditionally, and that the ordinary status-check effect
// can't race ahead of it against the stale project.

test("a fresh OAuth grant loads projects unconditionally, not gated behind the stale connectionVerified flag", async () => {
  const source = await readSetupPageSource();
  const mountEffect = source.match(/useEffect\(\(\) => \{\n {4}if \(!installerClient\) return;[\s\S]*?\n {2}\}, \[\]\);/)?.[0];
  assert.ok(mountEffect, "the oauth=granted mount effect must exist");
  const grantedBranch = mountEffect!.match(/if \(justGranted\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(grantedBranch, "the justGranted branch must exist");
  assert.match(grantedBranch!, /loadOAuthProjects\(true\)/);
  // The connectionVerified/useTemporaryPat short-circuit must sit AFTER the
  // justGranted branch's own early return, not gate it.
  const shortCircuitIndex = mountEffect!.indexOf("if (connectionVerified || useTemporaryPat) return;");
  const grantedBranchIndex = mountEffect!.indexOf("if (justGranted)");
  assert.ok(shortCircuitIndex > grantedBranchIndex, "the stale-flag short circuit must not run before the justGranted branch already returned");
});

test("the status-check effect is suppressed while an OAuth grant is still being processed", async () => {
  const source = await readSetupPageSource();
  const statusEffectGuard = source.match(/if \(oauthCallbackPending \|\| \(step !== 3 && step !== 4\)[^\n]*\) return;/)?.[0];
  assert.ok(statusEffectGuard, "the status-check effect must bail out while oauthCallbackPending is true");
});

test("loadOAuthProjects rebinds the previously-connected project automatically when it's still accessible", async () => {
  const source = await readSetupPageSource();
  const fnBody = source.match(/const loadOAuthProjects = async \(autoBind: boolean\) => \{[\s\S]*?\n {2}\};/)?.[0];
  assert.ok(fnBody, "loadOAuthProjects must exist");
  assert.match(fnBody!, /previousMatch/);
  assert.match(fnBody!, /result\.projects\.find\(\(project\) => project\.ref === previousRef\)/);
});
