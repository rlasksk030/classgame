import { useEffect, useState } from "react";
import { getResolvedSupabaseConfig, projectRefFromUrl } from "../../lib/config";
import { getConfiguredInstallerClient, InstallerClientError, type InstallerPublicTarget, type InstallerRemoteStatus } from "../../lib/installerClient";
import { classifyInstallerConnectionError, type InstallerConnectionIssue } from "../../lib/installerConnection";
import { markInstallerResumeUpdate } from "../../lib/installer";

/**
 * One-click update status/apply widget for the teacher header.
 *
 * Reuses the exact same installer backend contract /setup already uses
 * (getConfiguredInstallerClient + InstallerPublicTarget + status/update
 * calls) against whatever Supabase project this browser is currently
 * connected to (getResolvedSupabaseConfig -- never a hardcoded ref, so this
 * works the same for every teacher's own project). No separate update
 * logic/protocol is invented here.
 *
 * Teacher Auth (getSupabase().auth) and installer OAuth (this widget) are
 * different credentials -- being logged in as a teacher does not imply a
 * live installer session. When the installer session/OAuth grant is
 * missing or expired, this shows "Supabase 연결이 필요합니다" and, on
 * click, starts the same OAuth authorize redirect /setup uses, but first
 * marks (sessionStorage) that /setup should finish the update and send the
 * teacher straight back here instead of stranding them in the install
 * wizard (see the resume effect in SetupPage.tsx).
 */

type WidgetState =
  | { kind: "unavailable" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "updateRequired" }
  | { kind: "needsConnection"; issue: InstallerConnectionIssue }
  | { kind: "unexpectedStatus"; status: InstallerRemoteStatus }
  | { kind: "updating" }
  | { kind: "updateComplete" }
  | { kind: "updateFailed"; code: string }
  | { kind: "checkFailed"; detail: string };

function buildTarget(): InstallerPublicTarget | null {
  const runtimeConfig = getResolvedSupabaseConfig();
  if (!runtimeConfig) return null;
  const projectRef = projectRefFromUrl(runtimeConfig.supabaseUrl);
  if (!projectRef) return null;
  return { projectRef, projectUrl: runtimeConfig.supabaseUrl, publishableKey: runtimeConfig.supabasePublishableKey, release: "spatial-math-v1" };
}

export default function UpdateStatusWidget({ onUpdated }: { onUpdated?: () => void }) {
  const [state, setState] = useState<WidgetState>({ kind: "checking" });
  const [authorizing, setAuthorizing] = useState(false);

  const installerClient = getConfiguredInstallerClient();

  const checkStatus = async () => {
    if (!installerClient) { setState({ kind: "unavailable" }); return; }
    const target = buildTarget();
    if (!target) { setState({ kind: "unavailable" }); return; }
    setState({ kind: "checking" });
    try {
      const result = await installerClient.getStatus(target);
      if (result.status === "INSTALLED") setState({ kind: "upToDate" });
      else if (result.status === "UPDATE_REQUIRED") setState({ kind: "updateRequired" });
      else setState({ kind: "unexpectedStatus", status: result.status });
    } catch (reason) {
      const { issue, detail } = classifyInstallerConnectionError(reason);
      if (issue === "session" || issue === "revoked" || issue === "mismatch") setState({ kind: "needsConnection", issue });
      else setState({ kind: "checkFailed", detail });
    }
  };

  useEffect(() => {
    void checkStatus();
  }, []);

  const connectAndUpdate = async () => {
    if (!installerClient || authorizing) return;
    setAuthorizing(true);
    try {
      markInstallerResumeUpdate();
      const { authorizeUrl } = await installerClient.beginAuthorization();
      window.location.assign(authorizeUrl);
    } catch {
      setAuthorizing(false);
      setState({ kind: "checkFailed", detail: "Supabase 연결을 시작하지 못했습니다." });
    }
  };

  const applyUpdate = async () => {
    if (!installerClient) return;
    const target = buildTarget();
    if (!target) { setState({ kind: "unavailable" }); return; }
    setState({ kind: "updating" });
    try {
      await installerClient.update(target);
      setState({ kind: "updateComplete" });
      onUpdated?.();
    } catch (reason) {
      const code = reason instanceof InstallerClientError ? reason.code : "INSTALLER_UPDATE_FAILED";
      setState({ kind: "updateFailed", code });
    }
  };

  if (state.kind === "unavailable") return null; // no installer backend configured for this deployment -- stay silent, never block the rest of the page

  return (
    <div className="update-status-widget toolbar-row" style={{ alignItems: "center" }} aria-label="업데이트 확인">
      {state.kind === "checking" && <span className="muted">업데이트 확인 중…</span>}

      {state.kind === "upToDate" && <>
        <span className="status-chip ready">✓ 최신 버전입니다</span>
        <button className="btn btn-sm" type="button" onClick={() => void checkStatus()}>다시 확인</button>
      </>}

      {state.kind === "unexpectedStatus" && <>
        <span className="muted">설치 상태: {state.status}</span>
        <a className="btn btn-sm" href="/setup">설치 화면에서 확인</a>
      </>}

      {state.kind === "updateRequired" && <>
        <span className="status-chip" style={{ background: "#fff4e5", color: "#8a5300" }}>● 업데이트가 있습니다</span>
        <button className="btn btn-sm btn-primary" type="button" onClick={() => void applyUpdate()}>지금 업데이트</button>
      </>}

      {state.kind === "needsConnection" && <>
        <span className="muted">Supabase 연결이 필요합니다.</span>
        <button className="btn btn-sm btn-primary" type="button" disabled={authorizing} onClick={() => void connectAndUpdate()}>{authorizing ? "연결 중…" : "연결하고 업데이트"}</button>
      </>}

      {state.kind === "updating" && <span className="muted" role="status">업데이트 적용 중… (학급·학생·진도 기록은 그대로 유지됩니다)</span>}

      {state.kind === "updateComplete" && <>
        <span className="status-chip ready" role="status">✓ 업데이트가 완료되었습니다.</span>
        <button className="btn btn-sm" type="button" onClick={() => window.location.reload()}>새로고침</button>
      </>}

      {state.kind === "updateFailed" && <>
        <span className="error" role="alert">업데이트에 실패했습니다. 오류 코드: {state.code}</span>
        <button className="btn btn-sm" type="button" onClick={() => void checkStatus()}>다시 시도</button>
      </>}

      {state.kind === "checkFailed" && <>
        <span className="muted">업데이트 확인 실패{state.detail ? ` (${state.detail})` : ""}</span>
        <button className="btn btn-sm" type="button" onClick={() => void checkStatus()}>다시 확인</button>
      </>}
    </div>
  );
}
