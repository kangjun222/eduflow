const { sql, getPool } = require('../db');
const { badRequest, notFound, conflict } = require('../errors');

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// SQL Server 오류 1205 = 교착 상태(deadlock) 희생자.
// 잘못된 요청이 아니라 타이밍 문제이므로 재시도하면 대부분 성공한다.
const DEADLOCK_ERROR = 1205;
const MAX_RETRY = 3;

// 기간과 요일 패턴으로부터 수업 회차 후보를 만드는 공통 CTE.
//
// 임시 테이블(#candidates)을 쓰지 않는 이유:
//   node-mssql 의 query() 는 sp_executesql 로 실행되어 호출마다 스코프가 분리된다.
//   앞 호출에서 만든 임시 테이블은 그 호출이 끝나는 순간 사라지므로
//   다음 호출에서 참조하면 "Invalid object name" 이 난다.
//   CTE 를 두 번 계산하게 되지만 대상이 최대 1년치 날짜라 비용은 무시할 수준이다.
//
// 날짜 계산을 JS 가 아니라 SQL 에서 하는 이유:
//   JS Date 를 거치면 드라이버가 UTC 로 변환하면서 시각이 밀릴 수 있다.
//   SET DATEFIRST 7 로 고정하면 DATEPART(WEEKDAY) 가 일요일=1 이 되어
//   day_of_week(일=0) 와 항상 1 만큼 차이나는 관계가 성립한다.
const CANDIDATE_CTE = `
        WITH d AS (
            SELECT CAST(@startDate AS DATE) AS dt
            UNION ALL
            SELECT DATEADD(DAY, 1, dt) FROM d WHERE dt < CAST(@endDate AS DATE)
        ),
        cand AS (
            SELECT
                DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', cs.start_time), CAST(d.dt AS DATETIME2(0))) AS start_at,
                DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', cs.end_time),   CAST(d.dt AS DATETIME2(0))) AS end_at
            FROM d
            JOIN course_schedules cs
              ON cs.course_id = @courseId
             AND cs.day_of_week = DATEPART(WEEKDAY, d.dt) - 1
        )`;

function validate(input) {
  const { title, teacherId, roomId, capacity, startDate, endDate, schedules } = input;

  if (!title || String(title).trim() === '') throw badRequest('title은 필수입니다.');
  if (!Number.isInteger(teacherId)) throw badRequest('teacherId는 정수여야 합니다.');
  if (!Number.isInteger(roomId)) throw badRequest('roomId는 정수여야 합니다.');
  if (!Number.isInteger(capacity) || capacity < 1) throw badRequest('capacity는 1 이상이어야 합니다.');
  if (!DATE_PATTERN.test(startDate ?? '')) throw badRequest('startDate 형식은 YYYY-MM-DD 입니다.');
  if (!DATE_PATTERN.test(endDate ?? '')) throw badRequest('endDate 형식은 YYYY-MM-DD 입니다.');
  if (endDate < startDate) throw badRequest('endDate는 startDate 이후여야 합니다.');
  if (!Array.isArray(schedules) || schedules.length === 0) {
    throw badRequest('schedules는 최소 1개 이상이어야 합니다.');
  }

  schedules.forEach((s, i) => {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) {
      throw badRequest(`schedules[${i}].dayOfWeek는 0(일)~6(토) 사이여야 합니다.`);
    }
    if (!TIME_PATTERN.test(s.startTime ?? '')) throw badRequest(`schedules[${i}].startTime 형식은 HH:mm 입니다.`);
    if (!TIME_PATTERN.test(s.endTime ?? '')) throw badRequest(`schedules[${i}].endTime 형식은 HH:mm 입니다.`);
    if (s.endTime <= s.startTime) throw badRequest(`schedules[${i}]의 종료 시각이 시작 시각보다 빠릅니다.`);
  });

  // 같은 강좌 안에서 시간이 겹치는 패턴을 미리 걸러낸다. (DB까지 갈 필요 없는 검사)
  for (let i = 0; i < schedules.length; i += 1) {
    for (let j = i + 1; j < schedules.length; j += 1) {
      const a = schedules[i];
      const b = schedules[j];
      if (a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime) {
        throw badRequest(`같은 강좌 안에서 ${DAY_NAMES[a.dayOfWeek]}요일 시간이 서로 겹칩니다.`);
      }
    }
  }
}

async function assertTeacherAndRoom(tx, teacherId, roomId) {
  const { recordset } = await tx
    .request()
    .input('teacherId', sql.Int, teacherId)
    .input('roomId', sql.Int, roomId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE id = @teacherId AND role = 'teacher' AND status = 'active') AS teacherOk,
        (SELECT COUNT(*) FROM rooms WHERE id = @roomId) AS roomOk,
        (SELECT capacity FROM rooms WHERE id = @roomId) AS roomCapacity;
    `);

  const row = recordset[0];
  if (!row.teacherOk) throw notFound(`강사(id=${teacherId})를 찾을 수 없습니다.`);
  if (!row.roomOk) throw notFound(`강의실(id=${roomId})을 찾을 수 없습니다.`);
  return row.roomCapacity;
}

async function attemptCreate(pool, input) {
  const { title, teacherId, roomId, capacity, tuition = 0, startDate, endDate, schedules } = input;

  const tx = pool.transaction();
  await tx.begin();

  try {
    const roomCapacity = await assertTeacherAndRoom(tx, teacherId, roomId);
    if (capacity > roomCapacity) {
      throw badRequest(`정원(${capacity})이 강의실 수용 인원(${roomCapacity})을 초과합니다.`);
    }

    // 1) 강좌 생성
    const courseResult = await tx
      .request()
      .input('title', sql.NVarChar(100), title.trim())
      .input('teacherId', sql.Int, teacherId)
      .input('roomId', sql.Int, roomId)
      .input('capacity', sql.Int, capacity)
      .input('tuition', sql.Int, tuition)
      .input('startDate', sql.VarChar(10), startDate)
      .input('endDate', sql.VarChar(10), endDate)
      .query(`
        INSERT INTO courses (title, teacher_id, room_id, capacity, tuition, start_date, end_date)
        OUTPUT INSERTED.id
        VALUES (@title, @teacherId, @roomId, @capacity, @tuition, @startDate, @endDate);
      `);
    const courseId = courseResult.recordset[0].id;

    // 2) 반복 패턴 저장
    for (const s of schedules) {
      await tx
        .request()
        .input('courseId', sql.Int, courseId)
        .input('dayOfWeek', sql.TinyInt, s.dayOfWeek)
        .input('startTime', sql.VarChar(8), s.startTime)
        .input('endTime', sql.VarChar(8), s.endTime)
        .query(`
          INSERT INTO course_schedules (course_id, day_of_week, start_time, end_time)
          VALUES (@courseId, @dayOfWeek, @startTime, @endTime);
        `);
    }

    // 3) 충돌 검사.
    //    UPDLOCK + HOLDLOCK 이 핵심이다.
    //    HOLDLOCK 은 조회한 범위에 범위 잠금(range lock)을 걸어,
    //    검사와 삽입 사이에 다른 트랜잭션이 겹치는 회차를 끼워 넣지 못하게 막는다.
    //    이게 없으면 "검사할 땐 없었는데 넣고 보니 겹치는" 상황이 발생한다.
    const conflictResult = await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .input('startDate', sql.VarChar(10), startDate)
      .input('endDate', sql.VarChar(10), endDate)
      .input('teacherId', sql.Int, teacherId)
      .input('roomId', sql.Int, roomId)
      .query(`
        SET DATEFIRST 7;
${CANDIDATE_CTE}
        SELECT TOP (5)
            CASE WHEN l.teacher_id = @teacherId THEN 'teacher' ELSE 'room' END AS conflictType,
            c.title    AS courseTitle,
            u.name     AS teacherName,
            r.name     AS roomName,
            l.start_at AS startAt,
            l.end_at   AS endAt
        FROM cand
        JOIN lessons l WITH (UPDLOCK, HOLDLOCK)
          ON l.status <> 'cancelled'
         AND (l.teacher_id = @teacherId OR l.room_id = @roomId)
         AND cand.start_at < l.end_at
         AND l.start_at   < cand.end_at
        JOIN courses c ON c.id = l.course_id
        JOIN users   u ON u.id = l.teacher_id
        JOIN rooms   r ON r.id = l.room_id
        ORDER BY l.start_at
        OPTION (MAXRECURSION 0);
      `);

    if (conflictResult.recordset.length > 0) {
      const first = conflictResult.recordset[0];
      const who = first.conflictType === 'teacher'
        ? `강사 ${first.teacherName}`
        : `강의실 ${first.roomName}`;
      throw conflict(`${who}의 일정이 겹칩니다. (${first.courseTitle})`, conflictResult.recordset);
    }

    // 4) 충돌이 없으면 회차를 실제로 만든다.
    //    위 검사에서 잡은 범위 잠금은 커밋 전까지 유지되므로,
    //    그 사이 다른 트랜잭션이 겹치는 회차를 넣을 수 없다.
    const insertResult = await tx
      .request()
      .input('courseId', sql.Int, courseId)
      .input('startDate', sql.VarChar(10), startDate)
      .input('endDate', sql.VarChar(10), endDate)
      .input('teacherId', sql.Int, teacherId)
      .input('roomId', sql.Int, roomId)
      .query(`
        SET DATEFIRST 7;
${CANDIDATE_CTE}
        INSERT INTO lessons (course_id, teacher_id, room_id, start_at, end_at)
        SELECT @courseId, @teacherId, @roomId, start_at, end_at
        FROM cand
        OPTION (MAXRECURSION 0);

        SELECT @@ROWCOUNT AS created;
      `);

    const lessonCount = insertResult.recordset[0].created;
    if (lessonCount === 0) {
      throw badRequest('해당 기간에 생성될 수업 회차가 없습니다. 요일과 기간을 확인하세요.');
    }

    await tx.commit();
    return { courseId, lessonCount };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // 이미 롤백된 경우는 무시한다.
    }
    throw err;
  }
}

async function createCourse(input) {
  validate(input);
  const pool = await getPool();

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    try {
      return await attemptCreate(pool, input);
    } catch (err) {
      const isDeadlock =
        err.number === DEADLOCK_ERROR || err.originalError?.info?.number === DEADLOCK_ERROR;

      if (isDeadlock && attempt < MAX_RETRY) {
        // 교착 상태는 재시도로 해소된다. 같은 순간에 다시 부딪히지 않도록 잠깐 쉰다.
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw conflict('요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
}

async function getCourse(courseId) {
  const pool = await getPool();
  const { recordsets } = await pool
    .request()
    .input('courseId', sql.Int, courseId)
    .query(`
      SELECT c.id, c.title, c.capacity, c.tuition,
             c.start_date AS startDate, c.end_date AS endDate, c.status,
             u.name AS teacherName, r.name AS roomName,
             (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolledCount,
             (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessonCount
      FROM courses c
      JOIN users u ON u.id = c.teacher_id
      JOIN rooms r ON r.id = c.room_id
      WHERE c.id = @courseId;

      SELECT id, start_at AS startAt, end_at AS endAt, status
      FROM lessons
      WHERE course_id = @courseId
      ORDER BY start_at;
    `);

  const course = recordsets[0][0];
  if (!course) throw notFound(`강좌(id=${courseId})를 찾을 수 없습니다.`);
  return { ...course, lessons: recordsets[1] };
}

module.exports = { createCourse, getCourse };
