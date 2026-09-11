import test from "node:test";
import assert from "node:assert/strict";

import { APP_VERSION, SCHEMA_VERSION } from "../src/lib/config.ts";
import { LocalVersionService, getInstallationStatus, getVersionState } from "../src/lib/distribution.ts";

test("배포판 버전 계약은 package/migration 버전을 노출한다", () => {
  assert.equal(APP_VERSION, "1.0.0");
  assert.equal(SCHEMA_VERSION, "202609110013");
});

test("설치 상태는 점검 결과를 받아 READY까지 계산한다", () => {
  const status = getInstallationStatus({
    supabaseConnected: true,
    migrationsReady: true,
    edgeFunctionsReady: true,
    adminReady: true,
    classReady: true,
  });
  assert.equal(status.stage, "READY");
});

test("로컬 버전 서비스는 원격 업데이트를 가장하지 않는다", async () => {
  const service = new LocalVersionService();
  assert.equal(await service.checkForUpdates(), null);
});

test("앱과 설치된 DB 버전의 호환 상태를 계산한다", () => {
  assert.equal(getVersionState("202609110012").updateRequired, true);
  assert.equal(getVersionState("202609110013").updateRequired, false);
  assert.equal(getVersionState().updateRequired, true);
});
