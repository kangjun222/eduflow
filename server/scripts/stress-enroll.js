require('dotenv').config();

const { sql, getPool } = require('../src/db');
const enrollmentService = require('../src/services/enrollmentService');

/*
  정원 초과 방지가 실제로 동작하는지 증명하는 스크립트.

  같은 강좌에 여러 명이 동시에 신청할 때,
    (1) 잠금 없이 "세고 넣는" 방식은 정원을 넘긴다
    (2) 강좌 행을 UPDLOCK 으로 잠그면 정확히 정원만큼만 들어간다
  를 같은 조건에서 나란히 측정한다.
*/

const CAPACITY = 5;
const ATTEMPTS = 20;

const PREFIX = 'stress-';

async function setup(pool) {
  // 신청만 검증하므로 수업 회차는 만들지 않는다.
  // 회차를 만들면 강사·강의실 충돌 검사가 끼어들어 측정 대상이 흐려진다.
  const { recordset: teacher } = await pool.request().query(`
    SELECT TOP 1 id FROM users WHERE role = 'teacher' AND status = 'active' ORDER BY id;
  `);
  const { recordset: room } = await pool.request().query('SELECT TOP 1 id FROM rooms ORDER BY id;');
  if (!teacher[0] || !room[0]) {
    throw new Error('강사나 강의실이 없습니다. npm run seed 를 먼저 실행하세요.');
  }

  const { recordset: course } = await pool
    .request()
    .input('teacherId', sql.Int, teacher[0].id)
    .input('roomId', sql.Int, room[0].id)
    .input('capacity', sql.Int, CAPACITY)
    .query(`
      INSERT INTO courses (title, teacher_id, room_id, capacity, start_date, end_date)
      OUTPUT INSERTED.id
      VALUES (N'[부하테스트] 정원 ${CAPACITY}명', @teacherId, @roomId, @capacity, '2099-01-01', '2099-01-31');
    `);

  const studentIds = [];
  for (let i = 1; i <= ATTEMPTS; i += 1) {
    const { recordset } = await pool
      .request()
      .input('email', sql.NVarChar(255), `${PREFIX}${i}@eduflow.test`)
      .input('name', sql.NVarChar(50), `테스트학생${i}`)
      .query(`
        INSERT INTO users (email, password_hash, name, role)
        OUTPUT INSERTED.id
        VALUES (@email, N'STRESS_TEST_NO_LOGIN', @name, 'student');
      `);
    studentIds.push(recordset[0].id);
  }

  return { courseId: course[0].id, studentIds };
}

async function cleanup(pool, courseId) {
  await pool
    .request()
    .input('courseId', sql.Int, courseId)
    .input('prefix', sql.NVarChar(50), `${PREFIX}%`)
    .query(`
      DELETE FROM enrollments WHERE course_id = @courseId;
      DELETE FROM courses     WHERE id = @courseId;
      DELETE FROM users       WHERE email LIKE @prefix;
    `);
}

async function reset(pool, courseId) {
  await pool
    .request()
    .input('courseId', sql.Int, courseId)
    .query('DELETE FROM enrollments WHERE course_id = @courseId;');
}

// 잠금을 걸지 않은 구현. 이 스크립트 안에서만 쓴다.
// "COUNT 로 세고, 자리가 있으면 INSERT" — 순차 실행에서는 완벽해 보인다.
async function naiveEnroll(pool, courseId, studentId) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const { recordset } = await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .query(`
        SELECT c.capacity,
               (SELECT COUNT(*) FROM enrollments e
                 WHERE e.course_id = c.id AND e.status = 'active') AS enrolled
        FROM courses c
        WHERE c.id = @courseId;
      `);

    const { capacity, enrolled } = recordset[0];
    if (enrolled >= capacity) throw new Error('정원이 찼습니다.');

    await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .input('studentId', sql.Int, studentId)
      .query('INSERT INTO enrollments (course_id, student_id) VALUES (@courseId, @studentId);');

    await tx.commit();
    return 'ok';
  } catch {
    try {
      await tx.rollback();
    } catch {
      // 무시
    }
    return 'rejected';
  }
}

async function measure(label, pool, courseId, studentIds, enrollFn) {
  await reset(pool, courseId);

  // 순서를 두지 않고 한꺼번에 던진다. 이게 재현하려는 상황이다.
  const results = await Promise.all(studentIds.map((id) => enrollFn(id)));

  const accepted = results.filter((r) => r === 'ok').length;
  const rejected = results.length - accepted;

  const { recordset } = await pool
    .request()
    .input('courseId', sql.Int, courseId)
    .query(`
      SELECT COUNT(*) AS actual FROM enrollments
       WHERE course_id = @courseId AND status = 'active';
    `);
  const actual = recordset[0].actual;
  const over = actual - CAPACITY;

  console.log(`\n── ${label}`);
  console.log(`   동시 요청      ${studentIds.length}건`);
  console.log(`   수락 / 거절    ${accepted} / ${rejected}`);
  console.log(`   실제 등록 인원  ${actual}명  (정원 ${CAPACITY}명)`);
  console.log(over > 0 ? `   ❌ 정원 초과 ${over}명` : '   ✅ 정원 이내');

  return { accepted, actual, over };
}

async function run() {
  const pool = await getPool();
  let courseId;

  try {
    const setupResult = await setup(pool);
    courseId = setupResult.courseId;
    const { studentIds } = setupResult;

    console.log(`정원 ${CAPACITY}명 강좌에 ${ATTEMPTS}명이 동시에 신청한다.`);

    const naive = await measure('잠금 없음 — COUNT 로 세고 INSERT', pool, courseId, studentIds, (id) =>
      naiveEnroll(pool, courseId, id)
    );

    const locked = await measure('UPDLOCK — 강좌 행을 잠그고 검사', pool, courseId, studentIds, (id) =>
      enrollmentService
        .enroll({ courseId, studentId: id })
        .then(() => 'ok')
        .catch(() => 'rejected')
    );

    console.log('\n── 결과');
    console.log(`   잠금 없음   ${naive.actual}명 등록 (초과 ${Math.max(0, naive.over)}명)`);
    console.log(`   UPDLOCK    ${locked.actual}명 등록 (초과 ${Math.max(0, locked.over)}명)`);

    if (locked.over > 0) {
      throw new Error('정원 초과가 발생했다. 잠금이 동작하지 않는다.');
    }
  } finally {
    if (courseId) await cleanup(pool, courseId);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
