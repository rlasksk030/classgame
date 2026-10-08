import test from "node:test";
import assert from "node:assert/strict";

import {
  clearInstallerProgress,
  getOrCreatePendingInstallationId,
  installerStorageIsScopedToInstallation,
  readInstallerProgress,
  saveInstallerProgress,
} from "../src/lib/installer.ts";

function setupStorage(configInstallationId = "install-a") {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    window: {},
  });
  storage.set("stacking-installation-config", JSON.stringify({ installationId: configInstallationId }));
  return storage;
}

test("installer progress is resumable and stores only installation scope", () => {
  setupStorage();
  saveInstallerProgress({ installationId: "install-a", step: 6, classId: "class-a", className: "TEST반", studentCount: 2, updatedAt: "" });
  assert.equal(readInstallerProgress("install-a")?.step, 6);
  assert.equal(readInstallerProgress("install-b"), null);
  assert.equal(installerStorageIsScopedToInstallation(), true);
  const raw = String(globalThis.localStorage.getItem("stacking-installer-progress"));
  assert.equal(raw.includes("password"), false);
  assert.equal(raw.includes("pin"), false);
  clearInstallerProgress();
  assert.equal(readInstallerProgress("install-a"), null);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

test("installer progress is rejected when it belongs to another installation", () => {
  setupStorage("install-a");
  saveInstallerProgress({ installationId: "install-b", step: 3, updatedAt: "" });
  assert.equal(readInstallerProgress("install-a"), null);
  assert.equal(installerStorageIsScopedToInstallation(), false);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

test("pending installation id survives a full page reload before any runtime config exists (OAuth round trip)", () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    window: {},
  });
  let calls = 0;
  const fallback = () => { calls += 1; return `generated-${calls}`; };
  const first = getOrCreatePendingInstallationId(fallback);
  // Simulate the real browser navigation to Supabase's consent screen and
  // back: React state is gone, but the id must resolve to the same value so
  // readInstallerProgress(id) still finds the step saved before the redirect.
  const second = getOrCreatePendingInstallationId(fallback);
  assert.equal(second, first);
  assert.equal(calls, 1);
  saveInstallerProgress({ installationId: first, step: 3, updatedAt: "" });
  assert.equal(readInstallerProgress(getOrCreatePendingInstallationId(fallback))?.step, 3);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});


test("pending class creation reuses its code after reload and isolates teachers/installations", async () => {
  const { getOrCreateInstallerClassDraft, readInstallerClassDraft, clearInstallerClassDraft } = await import('../src/lib/installer.ts');
  const storage = new Map<string, string>();
  Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  try {
    const first = getOrCreateInstallerClassDraft('installation-a', 'teacher-a', 'Our class', () => 'ABCDEF1234');
    assert.deepEqual(getOrCreateInstallerClassDraft('installation-a', 'teacher-a', 'Our class', () => 'DIFFERENT1'), first);
    assert.equal(readInstallerClassDraft('installation-b', 'teacher-a'), null);
    assert.equal(readInstallerClassDraft('installation-a', 'teacher-b'), null);
    assert.throws(() => getOrCreateInstallerClassDraft('installation-a', 'teacher-a', 'Another name', () => 'DIFFERENT1'), /INSTALLER_CLASS_DRAFT_PENDING/);
    clearInstallerClassDraft('installation-a', 'teacher-a', 'WRONGCODE1');
    assert.deepEqual(readInstallerClassDraft('installation-a', 'teacher-a'), first);
    clearInstallerClassDraft('installation-a', 'teacher-a', first.classCode);
    assert.equal(getOrCreateInstallerClassDraft('installation-a', 'teacher-a', 'New class', () => 'NEWCLASS12').classCode, 'NEWCLASS12');
  } finally { delete (globalThis as { sessionStorage?: unknown }).sessionStorage; }
});

test("class draft storage failure prevents creating a non-resumable intent", async () => {
  const { getOrCreateInstallerClassDraft } = await import('../src/lib/installer.ts');
  Object.assign(globalThis, { sessionStorage: { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } } });
  try { assert.throws(() => getOrCreateInstallerClassDraft('install', 'teacher', 'Class', () => 'ABCDEF1234'), /storage unavailable/); }
  finally { delete (globalThis as { sessionStorage?: unknown }).sessionStorage; }
});
