require('dotenv').config();

const { sql, getPool } = require('../src/db');

// 개발용 시드 데이터.
// password_hash 는 인증 구현 전까지 자리표시자를 넣어둔다.
const PLACEHOLDER_HASH = 'SEED_PLACEHOLDER_NOT_A_REAL_HASH';

const USERS = [
  { email: 'admin@eduflow.test', name: '박원장', role: 'admin' },
  { email: 'teacher1@eduflow.test', name: '김수학', role: 'teacher' },
  { email: 'teacher2@eduflow.test', name: '이영어', role: 'teacher' },
  { email: 'teacher3@eduflow.test', name: '최과학', role: 'teacher' },
  { email: 'student1@eduflow.test', name: '한지민', role: 'student' },
  { email: 'student2@eduflow.test', name: '오세훈', role: 'student' },
  { email: 'student3@eduflow.test', name: '정다은', role: 'student' },
];

const ROOMS = [
  { name: '201호', capacity: 20 },
  { name: '202호', capacity: 15 },
  { name: '301호', capacity: 30 },
];

async function run() {
  const pool = await getPool();

  for (const u of USERS) {
    await pool
      .request()
      .input('email', sql.NVarChar(255), u.email)
      .input('name', sql.NVarChar(50), u.name)
      .input('role', sql.VarChar(10), u.role)
      .input('hash', sql.NVarChar(255), PLACEHOLDER_HASH)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM users WHERE email = @email)
        INSERT INTO users (email, password_hash, name, role)
        VALUES (@email, @hash, @name, @role);
      `);
  }

  for (const r of ROOMS) {
    await pool
      .request()
      .input('name', sql.NVarChar(50), r.name)
      .input('capacity', sql.Int, r.capacity)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM rooms WHERE name = @name)
        INSERT INTO rooms (name, capacity) VALUES (@name, @capacity);
      `);
  }

  const { recordset } = await pool.request().query(`
    SELECT id, name, role FROM users ORDER BY id;
  `);
  const rooms = await pool.request().query('SELECT id, name, capacity FROM rooms ORDER BY id;');

  console.log('=== 사용자 ===');
  recordset.forEach((u) => console.log(`  ${String(u.id).padStart(2)}  ${u.name}  (${u.role})`));
  console.log('=== 강의실 ===');
  rooms.recordset.forEach((r) => console.log(`  ${String(r.id).padStart(2)}  ${r.name}  정원 ${r.capacity}`));
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
