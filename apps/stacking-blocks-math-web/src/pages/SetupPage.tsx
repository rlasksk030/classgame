import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getAppConfig,
  getRuntimeSupabaseConfig,
  hasInvalidInstallationConfigHash,
  saveRuntimeSupabaseConfig,
  validateRuntimeSupabaseConfig,
} from "../lib/config";

async function checkSupabaseConnection(supabaseUrl: string, publishableKey: string): Promise<void> {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  if (!response.ok) throw new Error("Supabase 연결을 확인하지 못했습니다.");
}

function defaultInstallationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `install-${Date.now()}`;
}

export default function SetupPage() {
  const navigate = useNavigate();
  const current = getRuntimeSupabaseConfig();
  const vite = getAppConfig();
  const [installationId, setInstallationId] = useState(current?.installationId ?? defaultInstallationId());
  const [supabaseUrl, setSupabaseUrl] = useState(current?.supabaseUrl ?? (vite.configSource === "vite-fallback" ? vite.supabaseUrl ?? "" : ""));
  const [publishableKey, setPublishableKey] = useState(current?.supabasePublishableKey ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => hasInvalidInstallationConfigHash() ? "설치 링크가 손상되었거나 공개 연결 설정이 올바르지 않습니다." : null);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const config = { installationId: installationId.trim(), supabaseUrl: supabaseUrl.trim(), supabasePublishableKey: publishableKey.trim() };
    if (!validateRuntimeSupabaseConfig(config)) {
      setError("HTTPS 형식의 Supabase URL, 공개 Publishable Key, 설치 ID를 확인해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await checkSupabaseConnection(config.supabaseUrl, config.supabasePublishableKey);
      saveRuntimeSupabaseConfig(config);
      setPublishableKey("");
      setMessage("Supabase 연결됨 ✓ 공개 연결 설정을 이 기기에 저장했어요.");
      window.setTimeout(() => navigate(`/${window.location.search}`, { replace: true }), 250);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "연결을 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center-screen">
      <form className="panel stack" style={{ width: "min(560px, 100%)" }} onSubmit={connect}>
        <div>
          <h1>수업 연결 설정</h1>
          <p className="muted">선생님용 공개 Supabase 연결 정보만 등록합니다. 비밀키와 service_role 키는 입력하지 마세요.</p>
        </div>
        <div>
          <label className="label" htmlFor="installation-id">설치 ID</label>
          <input id="installation-id" className="field" value={installationId} onChange={(event) => setInstallationId(event.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="supabase-url">Supabase Project URL</label>
          <input id="supabase-url" className="field" type="url" placeholder="https://your-project.supabase.co" value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="publishable-key">Publishable Key</label>
          <input id="publishable-key" className="field" type="password" placeholder="sb_publishable_…" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} required />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "연결 확인 중…" : "연결 확인"}</button>
        <p className="muted" style={{ fontSize: 13 }}>연결 확인은 Auth 설정 엔드포인트만 읽습니다. DB 설치·Storage 생성은 자동으로 실행하지 않습니다.</p>
      </form>
    </main>
  );
}
