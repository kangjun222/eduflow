const sql = require('mssql');

const config = {
  server: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: {
    // 배포 환경에서는 암호화를 켜고 인증서를 검증한다.
    // 로컬 SQL Server는 자체 서명 인증서라 검증을 건너뛴다. (SSMS의 '서버 인증서 신뢰'와 같은 조치)
    encrypt: process.env.NODE_ENV === 'production',
    trustServerCertificate: process.env.NODE_ENV !== 'production',
  },
};

// 커넥션 풀은 프로세스당 하나만 만들어 재사용한다.
// 요청마다 새로 연결하면 부하가 조금만 늘어도 커넥션이 고갈된다.
let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      poolPromise = undefined; // 실패한 풀을 캐싱하면 이후 요청이 계속 같은 에러를 받는다
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
