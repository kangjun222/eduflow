const express = require('express');

const authService = require('../services/authService');
const { COOKIE_NAME, cookieOptions, clearOptions, requireAuth } = require('../middleware/auth');

const router = express.Router();

// 로그인. 토큰은 응답 본문이 아니라 쿠키로만 내보낸다.
// 본문에 함께 담으면 프론트가 localStorage 에 저장할 길이 열려 쿠키를 쓴 의미가 없어진다.
router.post('/login', async (req, res, next) => {
  try {
    const { token, user } = await authService.login(req.body ?? {});
    res.cookie(COOKIE_NAME, token, cookieOptions(token));
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// 로그아웃. 쿠키를 지울 때는 설정할 때와 같은 옵션을 줘야 한다.
// path 나 sameSite 가 다르면 브라우저가 다른 쿠키로 보고 지우지 않는다.
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, clearOptions());
  res.status(204).end();
});

// 새로고침 후 로그인 상태를 복원할 때 쓴다.
// 쿠키가 httpOnly 라 프론트는 토큰을 읽을 수 없고, 이 엔드포인트로만 확인할 수 있다.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
