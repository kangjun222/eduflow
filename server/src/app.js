const express = require('express');
const cookieParser = require('cookie-parser');
const { sql, getPool } = require('./db');
const { AppError } = require('./errors');
const authRouter = require('./routes/auth');
const coursesRouter = require('./routes/courses');
const timetableRouter = require('./routes/timetable');

const app = express();
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
app.use('/api', timetableRouter);

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
