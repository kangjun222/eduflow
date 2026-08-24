const jwt = require('jsonwebtoken');

const { unauthorized, forbidden } = require('../errors');
const authService = require('../services/authService');

// 토큰을 localStorage 가 아니라 httpOnly 쿠키에 담는다.
// localStorage 는 자바스크립트로 읽을 수 있어 XSS 한 번이면 토큰이 통째로 털린다.
const COOKIE_NAME = 'eduflow_token';

// 쿠키 만료를 토큰 만료에 맞춘다.
// 쿠키만 오래 남으면 이미 죽은 토큰을 계속 보내 매 요청이 401 이 된다.
function cookieOptions(token) {
  const { exp } = jwt.decode(token);
  return {
    httpOnly: true,
    // 개발 환경은 http 라 secure 를 켜면 쿠키가 아예 저장되지 않는다.
    secure: process.env.NODE_ENV === 'production',
    // 배포 시 Express 가 React 빌드를 함께 서빙해 같은 출처가 되므로 lax 로 충분하다.
    sameSite: 'lax',
    path: '/',
    expires: new Date(exp * 1000),
  };
}

function clearOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

// 로그인한 사용자만 통과시킨다. 통과하면 req.user 가 채워진다.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      throw unauthorized('로그인이 필요합니다.');
    }
    const payload = authService.verifyToken(token);
    // 토큰의 role 을 그대로 믿지 않고 DB 에서 다시 읽는다.
    // 발급 이후 강등되거나 비활성화된 계정이 만료 전까지 권한을 유지하면 안 된다.
    req.user = await authService.getActiveUser(payload.sub);
    next();
  } catch (err) {
    next(err);
  }
}

// 역할 검사. requireAuth 뒤에 붙여 쓴다.
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    next(unauthorized('로그인이 필요합니다.'));
    return;
  }
  if (!roles.includes(req.user.role)) {
    next(forbidden('이 작업을 수행할 권한이 없습니다.'));
    return;
  }
  next();
};

module.exports = { COOKIE_NAME, cookieOptions, clearOptions, requireAuth, requireRole };
