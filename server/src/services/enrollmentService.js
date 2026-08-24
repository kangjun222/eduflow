const { sql, getPool } = require('../db');
const { badRequest, notFound, conflict } = require('../errors');

// 유니크 인덱스 위반. 2601 = 인덱스, 2627 = 제약조건.
const DUPLICATE_KEY = [2601, 2627];
const DEADLOCK_ERROR = 1205;
const MAX_RETRY = 3;

const errorNumber = (err) => err.number ?? err.originalError?.info?.number;

async function attemptEnroll(pool, { courseId, studentId }) {
  const tx = pool.transaction();
  await tx.begin();

  try {
    // 강좌 행 하나를 UPDLOCK 으로 잠근다. 여기가 이 기능의 핵심이다.
    //
    // 잠그지 않으면 두 요청이 나란히 "4명이네, 아직 자리 있다"를 읽고
    // 둘 다 INSERT 해서 정원 5명짜리 강좌에 6명이 들어간다.
    // COUNT 는 읽는 순간의 값일 뿐, 그 값이 유지된다는 보장이 없다.
    //
    // UPDLOCK 은 서로 호환되지 않으므로 같은 강좌를 노리는 요청들이
    // 이 지점에서 한 줄로 세워진다. 잠금은 커밋까지 유지된다.
    //
    // 강좌 개설의 충돌 검사와 달리 HOLDLOCK(범위 잠금)이 필요 없다.
    // 거기서는 "아직 존재하지 않는 회차"가 끼어드는 것을 막아야 했지만,
    // 여기서 지켜야 할 대상은 이미 존재하는 강좌 행 하나뿐이다.
    const { recordset } = await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .input('studentId', sql.Int, studentId)
      .query(`
        SELECT
            c.capacity,
            c.status,
            c.title,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.status = 'active') AS enrolled,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.student_id = @studentId AND e.status = 'active') AS mine,
            (SELECT COUNT(*) FROM users u
              WHERE u.id = @studentId AND u.role = 'student' AND u.status = 'active') AS studentOk
        FROM courses c WITH (UPDLOCK, ROWLOCK)
        WHERE c.id = @courseId;
      `);

    const row = recordset[0];
    if (!row) throw notFound(`강좌(id=${courseId})를 찾을 수 없습니다.`);
    if (!row.studentOk) throw notFound(`학생(id=${studentId})을 찾을 수 없습니다.`);
    if (row.status !== 'open') throw conflict('신청을 받지 않는 강좌입니다.');
    if (row.mine > 0) throw conflict('이미 신청한 강좌입니다.');
    if (row.enrolled >= row.capacity) {
      throw conflict(`정원이 찼습니다. (${row.enrolled}/${row.capacity})`, {
        enrolled: row.enrolled,
        capacity: row.capacity,
      });
    }

    const inserted = await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .input('studentId', sql.Int, studentId)
      .query(`
        INSERT INTO enrollments (course_id, student_id)
        OUTPUT INSERTED.id
        VALUES (@courseId, @studentId);
      `);

    await tx.commit();
    return {
      enrollmentId: inserted.recordset[0].id,
      courseId,
      courseTitle: row.title,
      enrolled: row.enrolled + 1,
      capacity: row.capacity,
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // 이미 롤백된 경우는 무시한다.
    }

    // 중복 신청은 위에서 걸러지지만, 같은 학생이 같은 순간에 두 번 눌렀다면
    // 필터링된 유니크 인덱스가 마지막 방어선이 된다. 이때는 400 이 아니라 409 다.
    if (DUPLICATE_KEY.includes(errorNumber(err))) {
      throw conflict('이미 신청한 강좌입니다.');
    }
    throw err;
  }
}

async function enroll({ courseId, studentId }) {
  if (!Number.isInteger(courseId)) throw badRequest('courseId는 정수여야 합니다.');
  if (!Number.isInteger(studentId)) throw badRequest('studentId는 정수여야 합니다.');

  const pool = await getPool();

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    try {
      return await attemptEnroll(pool, { courseId, studentId });
    } catch (err) {
      if (errorNumber(err) === DEADLOCK_ERROR && attempt < MAX_RETRY) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw conflict('요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
}

// 취소는 정원을 늘리는 방향이라 경쟁 조건이 없다.
// 남은 자리를 잘못 계산할 위험이 없으므로 잠금 없이 한 문장으로 처리한다.
async function cancel({ courseId, studentId }) {
  if (!Number.isInteger(courseId)) throw badRequest('courseId는 정수여야 합니다.');

  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('courseId', sql.Int, courseId)
    .input('studentId', sql.Int, studentId)
    .query(`
      UPDATE enrollments
         SET status = 'cancelled', cancelled_at = SYSDATETIME()
       WHERE course_id = @courseId AND student_id = @studentId AND status = 'active';

      SELECT @@ROWCOUNT AS cancelled;
    `);

  if (recordset[0].cancelled === 0) {
    throw notFound('신청 내역이 없습니다.');
  }
  return { courseId, cancelled: true };
}

async function listByStudent(studentId) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('studentId', sql.Int, studentId)
    .query(`
      SELECT
          e.id, e.course_id AS courseId, e.status,
          c.title AS courseTitle, c.capacity,
          u.name  AS teacherName,
          r.name  AS roomName,
          CONVERT(VARCHAR(10), c.start_date, 23) AS startDate,
          CONVERT(VARCHAR(10), c.end_date, 23)   AS endDate
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      JOIN users   u ON u.id = c.teacher_id
      JOIN rooms   r ON r.id = c.room_id
      WHERE e.student_id = @studentId AND e.status = 'active'
      ORDER BY c.start_date;
    `);
  return recordset;
}

module.exports = { enroll, cancel, listByStudent };
