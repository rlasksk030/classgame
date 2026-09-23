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
