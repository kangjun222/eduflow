require('dotenv').config();

const bcrypt = require('bcryptjs');

const { sql, getPool } = require('../src/db');
const { createCourse } = require('../src/services/courseService');

// 개발용 시드 데이터.
// 시드 계정은 전부 같은 비밀번호를 쓴다. 개발용이므로 노출돼도 무방하다.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'eduflow123!';
// 비용 10은 로그인 1회에 약 100ms 를 쓰게 해 무차별 대입을 느리게 만든다.
const SEED_PASSWORD_HASH = bcrypt.hashSync(SEED_PASSWORD, 10);

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
      .input('hash', sql.NVarChar(255), SEED_PASSWORD_HASH)
      .query(`
        -- 이미 있는 계정은 비밀번호만 다시 맞춘다.
        -- 자리표시자 해시로 만들어진 기존 시드 계정도 이 경로로 복구된다.
        IF EXISTS (SELECT 1 FROM users WHERE email = @email)
            UPDATE users
               SET password_hash = @hash, updated_at = SYSDATETIME()
             WHERE email = @email;
        ELSE
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

  // 샘플 강좌는 강좌가 하나도 없을 때만 만든다. (재실행해도 중복되지 않도록)
  const { recordset: existing } = await pool.request().query('SELECT COUNT(*) AS n FROM courses;');
  if (existing[0].n === 0) {
    const teachers = recordset.filter((u) => u.role === 'teacher');
    const roomList = rooms.recordset;

    const samples = [
      { title: '중등 수학 A반', t: 0, r: 0, days: [2, 4], start: '19:00', end: '20:30' },
      { title: '중등 영어 B반', t: 1, r: 1, days: [1, 3], start: '17:00', end: '18:30' },
      { title: '고등 과학 심화', t: 2, r: 2, days: [6], start: '10:00', end: '12:00' },
      { title: '중등 수학 심화', t: 0, r: 2, days: [5], start: '19:00', end: '21:00' },
    ];

    for (const s of samples) {
      await createCourse({
        title: s.title,
        teacherId: teachers[s.t].id,
        roomId: roomList[s.r].id,
        capacity: Math.min(10, roomList[s.r].capacity),
        startDate: '2026-09-01',
        endDate: '2026-10-31',
        schedules: s.days.map((d) => ({ dayOfWeek: d, startTime: s.start, endTime: s.end })),
      });
    }
    console.log(`=== 샘플 강좌 ${samples.length}개 생성 ===`);
  }

  console.log('=== 사용자 ===');
  console.log(`  (전 계정 공통 비밀번호: ${SEED_PASSWORD})`);
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
