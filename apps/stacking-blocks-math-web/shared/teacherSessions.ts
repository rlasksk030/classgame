/**
 * Pure classification for the teacher "수업 현황" (live classroom status)
 * feature (Teacher Page Expansion Phase 3A). Kept dependency-free, same
 * reason as shared/teacherProgress.ts: the edge function can't be
 * imported directly into node:test (it calls Deno.serve() at module
 * scope), so logic that needs real unit coverage lives here.
 *
 * Deliberately conservative: a session ROW existing is never presented
 * as "접속 중" on its own. "접속 중 추정" requires both a non-revoked,
 * non-expired session AND recent learning activity (sb_problem_attempts /
 * sb_student_progress updated_at) -- a session with no recent activity is
 * only "로그인 세션 있음", never claimed as live presence.
 */

export interface SessionSourceRow {
  issued_at: string;
  expires_at: string;
  revoked: boolean;
}

export type LiveStatus = "active" | "recent" | "session_only" | "offline";

export interface StudentLiveStatus {
  studentId: string;
  hasActiveSession: boolean;
  sessionIssuedAt: string | null;
  sessionExpiresAt: string | null;
  lastActivityAt: string | null;
  status: LiveStatus;
  /** compact 2-state indicator for the progress table (●/○) -- never more than 2 colors. */
  indicator: "on" | "off";
}

const ACTIVE_WINDOW_MIN = 5;
const RECENT_WINDOW_MIN = 10;

export function summarizeStudentLiveStatus(
  studentId: string,
  sessions: SessionSourceRow[],
  lastActivityAt: string | null,
  now: number = Date.now(),
): StudentLiveStatus {
  const activeSession = sessions.find((s) => !s.revoked && new Date(s.expires_at).getTime() > now);
  const hasActiveSession = Boolean(activeSession);
  const minutesSinceActivity = lastActivityAt ? (now - new Date(lastActivityAt).getTime()) / 60000 : null;

  let status: LiveStatus;
  if (hasActiveSession && minutesSinceActivity !== null && minutesSinceActivity <= ACTIVE_WINDOW_MIN) status = "active";
  else if (minutesSinceActivity !== null && minutesSinceActivity <= RECENT_WINDOW_MIN) status = "recent";
  else if (hasActiveSession) status = "session_only";
  else status = "offline";

  return {
    studentId,
    hasActiveSession,
    sessionIssuedAt: activeSession?.issued_at ?? null,
    sessionExpiresAt: activeSession?.expires_at ?? null,
    lastActivityAt,
    status,
    indicator: status === "active" || status === "recent" ? "on" : "off",
  };
}

export interface ClassLiveStatusSummary {
  estimatedActive: number;
  activeWithin5Min: number;
  activeWithin10Min: number;
  noSession: number;
}

export function summarizeClassLiveStatus(rows: StudentLiveStatus[], now: number = Date.now()): ClassLiveStatusSummary {
  const withinMinutes = (minutes: number) =>
    rows.filter((r) => r.lastActivityAt && (now - new Date(r.lastActivityAt).getTime()) / 60000 <= minutes).length;
  return {
    estimatedActive: rows.filter((r) => r.status === "active").length,
    activeWithin5Min: withinMinutes(5),
    activeWithin10Min: withinMinutes(10),
    noSession: rows.filter((r) => !r.hasActiveSession).length,
  };
}
