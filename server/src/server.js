require('dotenv').config();

const app = require('./app');
const { getPool } = require('./db');

const port = Number(process.env.PORT ?? 3000);

async function start() {
  // 요청을 받기 전에 DB 연결을 확인한다.
  // 여기서 실패하면 원인을 바로 알 수 있어 디버깅이 쉬워진다.
  try {
    await getPool();
    console.log('[db] connected');
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });
}

start();
