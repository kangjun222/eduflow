import { useState } from 'react';
import { useAuth } from './auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="panel login-panel">
        <header className="header">
          <h1>EduFlow</h1>
          <span className="subtitle">학원 수업·예약 관리</span>
        </header>

        <form onSubmit={submit}>
          <label>이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@eduflow.test"
              autoComplete="username"
              required
            />
          </label>
          <label>비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
        </form>

        {error && <div className="alert error"><p>{error}</p></div>}

        {/* 포트폴리오 데모용 안내. 실제 서비스라면 노출하지 않는다. */}
        <p className="muted login-hint">
          데모 계정 — admin@eduflow.test / teacher1@eduflow.test / student1@eduflow.test<br />
          비밀번호는 모두 <code>eduflow123!</code>
        </p>
      </section>
    </div>
  );
}
