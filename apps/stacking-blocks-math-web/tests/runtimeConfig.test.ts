import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeInstallationConfig,
  getPendingInstallationConfig,
  readInstallationConfigFromHash,
  validateRuntimeSupabaseConfig,
  type RuntimeSupabaseConfig,
} from "../src/lib/config.ts";
import { getSupabase } from "../src/lib/supabase.ts";

const config: RuntimeSupabaseConfig = {
  installationId: "teacher-a",
  supabaseUrl: "https://teacher-a.supabase.co",
  supabasePublishableKey: "sb_publishable_teacher_a",
};

test("runtime installation config round-trips through a URL fragment", () => {
  const decoded = readInstallationConfigFromHash(`#install=${encodeInstallationConfig(config)}`);
  assert.deepEqual(decoded, config);
});

test("runtime config rejects server secrets and unsafe URLs", () => {
  assert.equal(validateRuntimeSupabaseConfig(config), true);
  assert.equal(validateRuntimeSupabaseConfig({ ...config, supabasePublishableKey: "service_role_secret" }), false);
  assert.equal(validateRuntimeSupabaseConfig({ ...config, supabaseUrl: "http://example.com" }), false);
});

test("changing the runtime installation switches the shared Supabase client", () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    window: { location: { hash: "" } },
  });
  storage.set("stacking-installation-config", JSON.stringify(config));
  const first = getSupabase();
  const secondConfig = { ...config, installationId: "teacher-b", supabaseUrl: "https://teacher-b.supabase.co" };
  (globalThis.window as { location: { hash: string } }).location.hash = `#install=${encodeInstallationConfig(secondConfig)}`;
  assert.deepEqual(getPendingInstallationConfig(), secondConfig);
  storage.set("stacking-installation-config", JSON.stringify(secondConfig));
  const second = getSupabase();
  assert.notEqual(first, second);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});
