import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { getSupabase } from '../lib/supabase';
import { classifyTeacherError } from '../lib/teacherErrors';

export default function TeacherGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const auth = getSupabase().auth;
      let active = true;
      void auth.getSession().then(({ data, error }) => {
        if (!active) return;
        setSignedIn(Boolean(data.session)); setReady(true);
        if (error) { const info = classifyTeacherError(error); setError(`${info.code}: ${info.message}`); }
      });
      const { data } = auth.onAuthStateChange((_event, session) => { setSignedIn(Boolean(session)); setReady(true); });
      return () => { active = false; data.subscription.unsubscribe(); };
    } catch (error) { setReady(true); const info = classifyTeacherError(error); setError(`${info.code}: ${info.message}`); }
  }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) { const info = classifyTeacherError(error); setError(`${info.code}: ${info.message}`); }
      setPassword('');
    } catch (reason) { const info = classifyTeacherError(reason); setError(`${info.code}: ${info.message}`); }
    finally { setBusy(false); }
  };
  if (!ready) return <main className="screen app-max"><p role="status">로그인 확인 중…</p></main>;
  if (signedIn) return <><nav className="toolbar-row app-max"><a href="/teacher">교사 관리</a><button className="btn" onClick={() => void getSupabase().auth.signOut()}>교사 로그아웃</button></nav>{children}</>;
  return <main className="screen app-max"><form className="panel stack" onSubmit={login} style={{ maxWidth: 460, margin: '40px auto' }}>
    <h1>교사 로그인</h1><p>우리 반의 공간과 입체 수업을 준비해요.</p>
    <label>이메일<input className="field" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>비밀번호<input className="field" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="btn btn-primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
    {error && <p role="alert">{error}</p>}<a href="/">학생 로그인으로</a>
  </form></main>;
}
