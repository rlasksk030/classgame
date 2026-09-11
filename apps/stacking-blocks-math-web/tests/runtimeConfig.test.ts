import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeInstallationConfig,
  readInstallationConfigFromHash,
  validateRuntimeSupabaseConfig,
  type RuntimeSupabaseConfig,
} from "../src/lib/config.ts";

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
