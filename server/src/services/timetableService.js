const { sql, getPool } = require('../db');
const { badRequest } = require('../errors');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 특정 기간의 수업 회차를 시간표 형태로 조회한다.
// 화면이 요일·시간 격자로 그리므로 요일 번호와 시:분을 함께 내려준다.
async function getTimetable({ from, to, teacherId, roomId }) {
  if (!DATE_PATTERN.test(from ?? '')) throw badRequest('from 형식은 YYYY-MM-DD 입니다.');
  if (!DATE_PATTERN.test(to ?? '')) throw badRequest('to 형식은 YYYY-MM-DD 입니다.');
  if (to < from) throw badRequest('to는 from 이후여야 합니다.');

  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('from', sql.VarChar(10), from)
    .input('to', sql.VarChar(10), to)
    .input('teacherId', sql.Int, teacherId ?? null)
    .input('roomId', sql.Int, roomId ?? null)
    .query(`
      SET DATEFIRST 7;

      SELECT
          l.id,
          l.course_id                        AS courseId,
          c.title                            AS courseTitle,
          u.name                             AS teacherName,
          r.name                             AS roomName,
          l.status,
          CONVERT(VARCHAR(10), l.start_at, 23) AS date,
          DATEPART(WEEKDAY, l.start_at) - 1    AS dayOfWeek,
          CONVERT(VARCHAR(5), l.start_at, 108) AS startTime,
          CONVERT(VARCHAR(5), l.end_at, 108)   AS endTime,
          (SELECT COUNT(*) FROM enrollments e
            WHERE e.course_id = c.id AND e.status = 'active') AS enrolledCount,
          c.capacity
      FROM lessons l
      JOIN courses c ON c.id = l.course_id
      JOIN users   u ON u.id = l.teacher_id
      JOIN rooms   r ON r.id = l.room_id
      WHERE l.start_at >= CAST(@from AS DATETIME2(0))
        AND l.start_at <  DATEADD(DAY, 1, CAST(@to AS DATETIME2(0)))
        AND (@teacherId IS NULL OR l.teacher_id = @teacherId)
        AND (@roomId    IS NULL OR l.room_id    = @roomId)
      ORDER BY l.start_at, r.name;
    `);

  return recordset;
}

// 강좌 개설 폼에서 쓸 선택지
async function getMeta() {
  const pool = await getPool();
  const { recordsets } = await pool.request().query(`
    SELECT id, name FROM users WHERE role = 'teacher' AND status = 'active' ORDER BY name;
    SELECT id, name, capacity FROM rooms ORDER BY name;
    SELECT id, name FROM users WHERE role = 'student' AND status = 'active' ORDER BY name;
  `);

  return { teachers: recordsets[0], rooms: recordsets[1], students: recordsets[2] };
}

async function listCourses() {
  const pool = await getPool();
  const { recordset } = await pool.request().query(`
    SELECT c.id, c.title, c.capacity, c.status,
           CONVERT(VARCHAR(10), c.start_date, 23) AS startDate,
           CONVERT(VARCHAR(10), c.end_date, 23)   AS endDate,
           u.name AS teacherName,
           r.name AS roomName,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessonCount,
           (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolledCount
    FROM courses c
    JOIN users u ON u.id = c.teacher_id
    JOIN rooms r ON r.id = c.room_id
    ORDER BY c.id DESC;
  `);
  return recordset;
}

module.exports = { getTimetable, getMeta, listCourses };
