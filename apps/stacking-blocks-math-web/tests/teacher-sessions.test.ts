import test from "node:test";
import assert from "node:assert/strict";
import { summarizeStudentLiveStatus, summarizeClassLiveStatus } from "../shared/teacherSessions.ts";

// Teacher Page Expansion Phase 3A: this is the exact function
// teacher:sessions:list calls per student. A session ROW alone is
// deliberately never enough to claim "접속 중" -- these tests pin down
// the conservative classification the spec required.

const NOW = new Date("2026-01-01T12:00:00Z").getTime();

test("C. a revoked session is never treated as active, even if not yet expired", () => {
  const status = summarizeStudentLiveStatus(
    "s1",
    [{ issued_at: "2026-01-01T11:00:00Z", expires_at: "2026-01-01T18:00:00Z", revoked: true }],
    "2026-01-01T11:59:00Z", // 1 min ago
    NOW,
  );
  assert.equal(status.hasActiveSession, false);
  assert.equal(status.status, "recent", "recent activity alone (no valid session) is 최근 활동, not 접속 중");
});

test("C. an expired session is never treated as active", () => {
  const status = summarizeStudentLiveStatus(
    "s1",
    [{ issued_at: "2026-01-01T09:00:00Z", expires_at: "2026-01-01T11:00:00Z", revoked: false }],
    null,
    NOW,
  );
  assert.equal(status.hasActiveSession, false);
  assert.equal(status.status, "offline");
});

test("having a valid session with NO recent activity is only 'session_only', never claimed as live presence", () => {
  const status = summarizeStudentLiveStatus(
    "s1",
    [{ issued_at: "2026-01-01T09:00:00Z", expires_at: "2026-01-01T18:00:00Z", revoked: false }],
    "2026-01-01T10:00:00Z", // 2 hours ago
    NOW,
  );
  assert.equal(status.hasActiveSession, true);
  assert.equal(status.status, "session_only");
  assert.equal(status.indicator, "off", "the compact table dot must not light up for session-only");
});

test("D. valid session + activity within 5 minutes -> active (접속 중 추정)", () => {
  const status = summarizeStudentLiveStatus(
    "s1",
    [{ issued_at: "2026-01-01T11:00:00Z", expires_at: "2026-01-01T18:00:00Z", revoked: false }],
    "2026-01-01T11:58:00Z", // 2 min ago
    NOW,
  );
  assert.equal(status.status, "active");
  assert.equal(status.indicator, "on");
});

test("D. activity between 5 and 10 minutes ago (no valid session) -> recent, not active", () => {
  const status = summarizeStudentLiveStatus("s1", [], "2026-01-01T11:52:00Z", NOW); // 8 min ago
  assert.equal(status.status, "recent");
  assert.equal(status.indicator, "on", "recent activity still lights the compact dot");
});

test("D. activity older than 10 minutes with no session -> offline", () => {
  const status = summarizeStudentLiveStatus("s1", [], "2026-01-01T11:00:00Z", NOW); // 60 min ago
  assert.equal(status.status, "offline");
  assert.equal(status.indicator, "off");
});

test("no session and no activity at all -> offline, never crashes on null lastActivityAt", () => {
  const status = summarizeStudentLiveStatus("s1", [], null, NOW);
  assert.equal(status.status, "offline");
  assert.equal(status.hasActiveSession, false);
});

test("token/session-id/credential fields are never part of the returned shape (schema check)", () => {
  const status = summarizeStudentLiveStatus("s1", [{ issued_at: "2026-01-01T11:00:00Z", expires_at: "2026-01-01T18:00:00Z", revoked: false }], null, NOW);
  const keys = Object.keys(status);
  for (const forbidden of ["token", "tokenHash", "sessionId", "ip", "userAgent", "credential"]) {
    assert.ok(!keys.includes(forbidden), `must never include ${forbidden}`);
  }
});

test("summarizeClassLiveStatus aggregates across the whole class in one pass", () => {
  const rows = [
    summarizeStudentLiveStatus("s1", [{ issued_at: "2026-01-01T11:59:00Z", expires_at: "2026-01-01T18:00:00Z", revoked: false }], "2026-01-01T11:59:30Z", NOW),
    summarizeStudentLiveStatus("s2", [], "2026-01-01T11:53:00Z", NOW), // 7 min ago -> recent
    summarizeStudentLiveStatus("s3", [], null, NOW), // offline, no session
  ];
  const summary = summarizeClassLiveStatus(rows, NOW);
  assert.equal(summary.estimatedActive, 1);
  assert.equal(summary.activeWithin5Min, 1);
  assert.equal(summary.activeWithin10Min, 2);
  assert.equal(summary.noSession, 2);
});
