require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getPool } = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

// GO 는 T-SQL 문법이 아니라 sqlcmd/SSMS 의 배치 구분자다.
// 드라이버에 그대로 넘기면 문법 에러가 나므로 여기서 잘라준다.
function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

async function ensureMigrationTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID('schema_migrations', 'U') IS NULL
    CREATE TABLE schema_migrations (
        filename   NVARCHAR(255) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        applied_at DATETIME2(0)  NOT NULL CONSTRAINT DF_schema_migrations DEFAULT SYSDATETIME()
    );
  `);
}

async function getApplied(pool) {
  const { recordset } = await pool.request().query('SELECT filename FROM schema_migrations');
  return new Set(recordset.map((row) => row.filename));
}

async function run() {
  const pool = await getPool();
  await ensureMigrationTable(pool);

  const applied = await getApplied(pool);
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('적용할 마이그레이션이 없습니다. (최신 상태)');
    return;
  }

  for (const filename of pending) {
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const batches = splitBatches(sqlText);

    // 파일 하나를 트랜잭션으로 묶는다.
    // 중간에 실패하면 전부 롤백되어 스키마가 어중간한 상태로 남지 않는다.
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      for (const batch of batches) {
        await transaction.request().batch(batch);
      }

      await transaction
        .request()
        .input('filename', filename)
        .query('INSERT INTO schema_migrations (filename) VALUES (@filename)');

      await transaction.commit();
      console.log(`적용됨: ${filename} (배치 ${batches.length}개)`);
    } catch (err) {
      await transaction.rollback();
      console.error(`실패: ${filename}`);
      throw err;
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
