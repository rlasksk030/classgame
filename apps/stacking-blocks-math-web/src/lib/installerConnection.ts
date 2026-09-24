import { InstallerClientError } from "./installerClient";

export type InstallerConnectionIssue = "session" | "mismatch" | "revoked" | "network";

export interface InstallerConnectionIssueInfo {
  issue: InstallerConnectionIssue;
  detail: string;
}

/** Same signal interpretation /setup's checkInstallerConnection already
 * uses (INSTALLER_AUTH_REQUIRED/SESSION_REQUIRED -> no session at all,
 * INSTALLER_TARGET_MISMATCH -> wrong project, upstreamStatus 401 -> the
 * OAuth grant itself was revoked/expired, anything else -> a genuine
 * network/server problem worth showing stage+upstream status for) -- kept
 * here as one shared classifier so every installer-client consumer reads
 * the exact same codes the same way instead of re-deriving its own rules. */
export function classifyInstallerConnectionError(reason: unknown): InstallerConnectionIssueInfo {
  if (reason instanceof InstallerClientError && (reason.code === "INSTALLER_AUTH_REQUIRED" || reason.code === "INSTALLER_SESSION_REQUIRED")) {
    return { issue: "session", detail: "" };
  }
  if (reason instanceof InstallerClientError && reason.code === "INSTALLER_TARGET_MISMATCH") {
    return { issue: "mismatch", detail: "" };
  }
  if (reason instanceof InstallerClientError && reason.upstreamStatus === 401) {
    return { issue: "revoked", detail: "" };
  }
  const parts = reason instanceof InstallerClientError
    ? [reason.stage ? `단계: ${reason.stage}` : null, reason.upstreamStatus ? `업스트림 상태: ${reason.upstreamStatus}` : null, `코드: ${reason.code}`].filter(Boolean)
    : [];
  return { issue: "network", detail: parts.join(" · ") };
}
