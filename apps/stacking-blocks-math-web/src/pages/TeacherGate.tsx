import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { getSupabase } from '../lib/supabase';
import { classifyTeacherError } from '../lib/teacherErrors';

export default function TeacherGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newPasswordDone, setNewPasswordDone] = useState(false);
  useEffect(() => {
    try {
      const auth = getSupabase().auth;
      let active = true;
      void auth.getSession().then(({ data, error }) => {
        if (!active) return;
        setSignedIn(Boolean(data.session)); setReady(true);
        if (error) { const info = classifyTeacherError(error); setError(`${info.code}: ${info.message}`); }
      });
      // Supabase emits PASSWORD_RECOVERY once, right after the browser lands
      // on this page via the reset-email link (detectSessionInUrl consumes
      // the recovery token automatically). That is the ONLY moment we show
      // the "새 비밀번호 설정" form -- never for a normal login.
      const { data } = auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') setRecovering(true);
        setSignedIn(Boolean(session)); setReady(true);
      });
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
  const sendReset = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setResetError('');
    try {
      // resetPasswordForEmail only needs the public anon/publishable key
      // already configured for this connected project -- no admin access,
      // no new account created, no existing data touched. Whether or not
      // the address is registered, we show the same confirmation message
      // (standard practice: never reveal account existence via this form).
      const { error } = await getSupabase().auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/teacher`,
      });
      if (error) { const info = classifyTeacherError(error); setResetError(`${info.code}: ${info.message}`); }
      else setResetSent(true);
    } catch (reason) { const info = classifyTeacherError(reason); setResetError(`${info.code}: ${info.message}`); }
    finally { setBusy(false); }
  };
  const submitNewPassword = async (event: FormEvent) => {
    event.preventDefault(); setResetError('');
    if (newPassword.length < 6) { setResetError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (newPassword !== newPasswordConfirm) { setResetError('두 비밀번호가 서로 달라요. 다시 확인해 주세요.'); return; }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password: newPassword });
      if (error) { const info = classifyTeacherError(error); setResetError(`${info.code}: ${info.message}`); }
      else { setNewPasswordDone(true); setRecovering(false); }
    } catch (reason) { const info = classifyTeacherError(reason); setResetError(`${info.code}: ${info.message}`); }
    finally { setBusy(false); }
  };
  if (!ready) return <main className="screen app-max"><p role="status">로그인 확인 중…</p></main>;
  if (recovering) {
    return <main className="screen app-max"><form className="panel stack" onSubmit={submitNewPassword} style={{ maxWidth: 460, margin: '40px auto' }}>
      <h1>새 비밀번호 설정</h1>
      {newPasswordDone
        ? <p className="success" role="status">비밀번호가 바뀌었습니다. 이제 이 비밀번호로 로그인할 수 있어요.</p>
        : <>
          <p className="muted">이메일로 받은 링크를 통해 들어오셨습니다. 새 비밀번호를 입력해 주세요. 학급·학생·진도 기록은 그대로 유지됩니다.</p>
          <label>새 비밀번호<input className="field" type="password" autoComplete="new-password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          <label>새 비밀번호 확인<input className="field" type="password" autoComplete="new-password" required value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? '변경 중…' : '비밀번호 바꾸기'}</button>
          {resetError && <p role="alert">{resetError}</p>}
        </>}
    </form></main>;
  }
  if (signedIn) return <><nav className="toolbar-row app-max"><a href="/teacher">교사 관리</a><button className="btn" onClick={() => void getSupabase().auth.signOut()}>교사 로그아웃</button></nav>{children}</>;
  if (resetMode) {
    return <main className="screen app-max"><form className="panel stack" onSubmit={sendReset} style={{ maxWidth: 460, margin: '40px auto' }}>
      <h1>비밀번호 재설정</h1>
      {resetSent
        ? <p className="success" role="status">입력하신 주소로 재설정 안내 메일을 보냈습니다(해당 이메일로 가입된 계정이 있는 경우). 메일함(스팸함 포함)을 확인해 주세요.</p>
        : <>
          <p className="muted">가입할 때 쓴 이메일을 입력하면 비밀번호 재설정 링크를 보내드려요.</p>
          <label>이메일<input className="field" type="email" autoComplete="username" required value={resetEmail} onChange={e => setResetEmail(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? '보내는 중…' : '재설정 이메일 보내기'}</button>
          {resetError && <p role="alert">{resetError}</p>}
        </>}
      <button type="button" className="btn btn-sm" onClick={() => { setResetMode(false); setResetSent(false); setResetError(''); }}>로그인 화면으로</button>
    </form></main>;
  }
  return <main className="screen app-max"><form className="panel stack" onSubmit={login} style={{ maxWidth: 460, margin: '40px auto' }}>
    <h1>교사 로그인</h1><p>우리 반의 공간과 입체 수업을 준비해요.</p>
    <label>이메일<input className="field" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>비밀번호<input className="field" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="btn btn-primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="btn btn-sm" onClick={() => { setResetMode(true); setResetEmail(email); }}>비밀번호를 잊으셨나요?</button>
    <a href="/">학생 로그인으로</a>
  </form></main>;
}
