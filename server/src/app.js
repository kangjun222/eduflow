const path = require('path');

const express = require('express');
const cookieParser = require('cookie-parser');
const { sql, getPool } = require('./db');
const { AppError } = require('./errors');
const authRouter = require('./routes/auth');
const coursesRouter = require('./routes/courses');
const enrollmentsRouter = require('./routes/enrollments');
const timetableRouter = require('./routes/timetable');

const app = express();

// App Service 같은 리버스 프록시 뒤에서는 원래 프로토콜이 X-Forwarded-Proto 로 온다.
// 이걸 신뢰하지 않으면 HTTPS 요청을 http 로 보고 secure 쿠키를 거절한다.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());
// 인증 토큰이 httpOnly 쿠키로 오므로 req.cookies 를 채워둔다.
app.use(cookieParser());

// 서버가 살아있는지만 확인 (DB 미포함)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// DB까지 실제로 붙는지 확인
app.get('/health/db', async (req, res, next) => {
  try {
    const pool = await getPool();
    const { recordset } = await pool.request().query(
      'SELECT DB_NAME() AS dbName, SUSER_NAME() AS loginName, GETDATE() AS serverTime'
    );
    res.json({ status: 'ok', db: recordset[0] });
  } catch (err) {
    next(err);
  }
});

// 파라미터 바인딩 예시.
// 값을 문자열로 이어붙이면 SQL 인젝션이 되므로 반드시 input()으로 넘긴다.
app.get('/echo', async (req, res, next) => {
  try {
    const pool = await getPool();
    const { recordset } = await pool
      .request()
      .input('message', sql.NVarChar(200), req.query.message ?? '')
      .query('SELECT @message AS echoed');
    res.json(recordset[0]);
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/enrollments', enrollmentsRouter);
app.use('/api', timetableRouter);

// 운영에서는 Express 가 React 빌드까지 서빙한다.
// 프론트와 API 가 같은 출처가 되므로 CORS 설정이 필요 없고,
// httpOnly 쿠키가 개발할 때와 똑같이 동작한다. 배포 대상도 서버 하나로 줄어든다.
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // SPA 새로고침 대응. /timetable 같은 주소로 직접 들어와도 index.html 을 준다.
  // /api 는 넘기지 않는다. 넘기면 없는 API 를 부를 때 404 JSON 대신 HTML 이 돌아와
  // 프론트의 res.json() 이 엉뚱한 곳에서 터진다.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not Found' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
});

module.exports = app;
