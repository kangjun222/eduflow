import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// 토큰은 httpOnly 쿠키에 있어 자바스크립트로 읽을 수 없다.
// 그래서 로그인 상태는 /api/auth/me 응답으로만 확인한다.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // 첫 확인이 끝나기 전에 화면을 그리면 로그인한 사용자에게도
  // 로그인 폼이 한 번 깜빡였다 사라진다.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setUser(body?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message ?? '로그인에 실패했습니다.');
    }
    setUser(body.user);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, checking, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
