/* ============================================================
   EduFlow 초기 스키마
   - 문자열은 한글을 담으므로 전부 NVARCHAR 사용
   - 시간 컬럼은 DATETIME2 사용 (DATETIME은 정밀도가 낮고 범위가 좁다)
   ============================================================ */

/* ------------------------------------------------------------
   users : 학생 / 강사 / 관리자를 한 테이블에서 관리
   역할별로 테이블을 나누면 로그인·인증을 세 번 구현해야 하므로
   role 컬럼으로 구분한다.
   ------------------------------------------------------------ */
CREATE TABLE users (
    id            INT IDENTITY(1,1) NOT NULL,
    email         NVARCHAR(255)     NOT NULL,
    password_hash NVARCHAR(255)     NOT NULL,
    name          NVARCHAR(50)      NOT NULL,
    phone         NVARCHAR(20)      NULL,
    role          VARCHAR(10)       NOT NULL,
    status        VARCHAR(10)       NOT NULL CONSTRAINT DF_users_status DEFAULT 'active',
    created_at    DATETIME2(0)      NOT NULL CONSTRAINT DF_users_created DEFAULT SYSDATETIME(),
    updated_at    DATETIME2(0)      NOT NULL CONSTRAINT DF_users_updated DEFAULT SYSDATETIME(),

    CONSTRAINT PK_users        PRIMARY KEY (id),
    CONSTRAINT UQ_users_email  UNIQUE (email),
    CONSTRAINT CK_users_role   CHECK (role   IN ('student', 'teacher', 'admin')),
    CONSTRAINT CK_users_status CHECK (status IN ('active', 'inactive'))
);
GO

/* ------------------------------------------------------------
   rooms : 강의실
   ------------------------------------------------------------ */
CREATE TABLE rooms (
    id       INT IDENTITY(1,1) NOT NULL,
    name     NVARCHAR(50)      NOT NULL,
    capacity INT               NOT NULL,

    CONSTRAINT PK_rooms          PRIMARY KEY (id),
    CONSTRAINT UQ_rooms_name     UNIQUE (name),
    CONSTRAINT CK_rooms_capacity CHECK (capacity > 0)
);
GO

/* ------------------------------------------------------------
   courses : 강좌 (예: "중등 수학 A반")
   실제 수업 날짜는 lessons 에 따로 생성된다.
   ------------------------------------------------------------ */
CREATE TABLE courses (
    id         INT IDENTITY(1,1) NOT NULL,
    title      NVARCHAR(100)     NOT NULL,
    teacher_id INT               NOT NULL,
    room_id    INT               NOT NULL,
    capacity   INT               NOT NULL,
    tuition    INT               NOT NULL CONSTRAINT DF_courses_tuition DEFAULT 0,
    start_date DATE              NOT NULL,
    end_date   DATE              NOT NULL,
    status     VARCHAR(10)       NOT NULL CONSTRAINT DF_courses_status DEFAULT 'open',
    created_at DATETIME2(0)      NOT NULL CONSTRAINT DF_courses_created DEFAULT SYSDATETIME(),

    CONSTRAINT PK_courses          PRIMARY KEY (id),
    CONSTRAINT FK_courses_teacher  FOREIGN KEY (teacher_id) REFERENCES users(id),
    CONSTRAINT FK_courses_room     FOREIGN KEY (room_id)    REFERENCES rooms(id),
    CONSTRAINT CK_courses_capacity CHECK (capacity > 0),
    CONSTRAINT CK_courses_tuition  CHECK (tuition >= 0),
    CONSTRAINT CK_courses_dates    CHECK (end_date >= start_date),
    CONSTRAINT CK_courses_status   CHECK (status IN ('open', 'closed', 'cancelled'))
);
GO

/* ------------------------------------------------------------
   course_schedules : 강좌의 반복 패턴 (예: 매주 화·목 19:00~20:30)
   이 패턴을 바탕으로 lessons 회차를 생성한다.
   ------------------------------------------------------------ */
CREATE TABLE course_schedules (
    id          INT IDENTITY(1,1) NOT NULL,
    course_id   INT               NOT NULL,
    day_of_week TINYINT           NOT NULL,  -- 0=일요일 ... 6=토요일
    start_time  TIME(0)           NOT NULL,
    end_time    TIME(0)           NOT NULL,

    CONSTRAINT PK_course_schedules     PRIMARY KEY (id),
    CONSTRAINT FK_cs_course            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    CONSTRAINT UQ_cs_course_day_time   UNIQUE (course_id, day_of_week, start_time),
    CONSTRAINT CK_cs_day_of_week       CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT CK_cs_time_order        CHECK (end_time > start_time)
);
GO

/* ------------------------------------------------------------
   lessons : 실제 수업 회차 (날짜별 1행)

   teacher_id / room_id 를 courses 가 아니라 여기에도 두는 이유:
     - 대강(강사 변경), 강의실 변경, 보강(날짜 변경)이 회차 단위로 일어난다
     - 충돌 검사를 이 테이블 하나만 보고 처리할 수 있다
   ------------------------------------------------------------ */
CREATE TABLE lessons (
    id          INT IDENTITY(1,1) NOT NULL,
    course_id   INT               NOT NULL,
    teacher_id  INT               NOT NULL,
    room_id     INT               NOT NULL,
    lesson_date AS CAST(start_at AS DATE) PERSISTED,   -- start_at 에서 자동 계산
    start_at    DATETIME2(0)      NOT NULL,
    end_at      DATETIME2(0)      NOT NULL,
    status      VARCHAR(10)       NOT NULL CONSTRAINT DF_lessons_status DEFAULT 'scheduled',
    created_at  DATETIME2(0)      NOT NULL CONSTRAINT DF_lessons_created DEFAULT SYSDATETIME(),

    CONSTRAINT PK_lessons         PRIMARY KEY (id),
    CONSTRAINT FK_lessons_course  FOREIGN KEY (course_id)  REFERENCES courses(id) ON DELETE CASCADE,
    CONSTRAINT FK_lessons_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
    CONSTRAINT FK_lessons_room    FOREIGN KEY (room_id)    REFERENCES rooms(id),
    CONSTRAINT CK_lessons_time    CHECK (end_at > start_at),
    CONSTRAINT CK_lessons_status  CHECK (status IN ('scheduled', 'done', 'cancelled', 'makeup'))
);
GO

/* 충돌 검사 전용 인덱스.
   취소된 회차는 충돌 대상이 아니므로 필터를 걸어 인덱스 크기를 줄인다. */
CREATE INDEX IX_lessons_teacher_time
    ON lessons (teacher_id, start_at, end_at)
    WHERE status <> 'cancelled';
GO

CREATE INDEX IX_lessons_room_time
    ON lessons (room_id, start_at, end_at)
    WHERE status <> 'cancelled';
GO

CREATE INDEX IX_lessons_course_date
    ON lessons (course_id, start_at);
GO

/* ------------------------------------------------------------
   enrollments : 수강 신청
   ------------------------------------------------------------ */
CREATE TABLE enrollments (
    id           INT IDENTITY(1,1) NOT NULL,
    course_id    INT               NOT NULL,
    student_id   INT               NOT NULL,
    status       VARCHAR(10)       NOT NULL CONSTRAINT DF_enrollments_status DEFAULT 'active',
    enrolled_at  DATETIME2(0)      NOT NULL CONSTRAINT DF_enrollments_at DEFAULT SYSDATETIME(),
    cancelled_at DATETIME2(0)      NULL,

    CONSTRAINT PK_enrollments        PRIMARY KEY (id),
    CONSTRAINT FK_enroll_course      FOREIGN KEY (course_id)  REFERENCES courses(id) ON DELETE CASCADE,
    CONSTRAINT FK_enroll_student     FOREIGN KEY (student_id) REFERENCES users(id),
    CONSTRAINT CK_enroll_status      CHECK (status IN ('active', 'cancelled'))
);
GO

/* 같은 강좌를 중복 신청하지 못하게 막는다.
   단, 취소한 뒤 다시 신청하는 것은 허용해야 하므로
   status='active' 인 행에만 유니크를 건다. (필터링된 인덱스) */
CREATE UNIQUE INDEX UX_enrollments_active
    ON enrollments (course_id, student_id)
    WHERE status = 'active';
GO

CREATE INDEX IX_enrollments_student
    ON enrollments (student_id, status);
GO

/* ------------------------------------------------------------
   attendances : 출결 (회차 x 학생)
   ------------------------------------------------------------ */
CREATE TABLE attendances (
    id         INT IDENTITY(1,1) NOT NULL,
    lesson_id  INT               NOT NULL,
    student_id INT               NOT NULL,
    status     VARCHAR(10)       NOT NULL,
    note       NVARCHAR(200)     NULL,
    checked_by INT               NULL,   -- 출결을 입력한 강사
    checked_at DATETIME2(0)      NULL,

    CONSTRAINT PK_attendances          PRIMARY KEY (id),
    CONSTRAINT FK_att_lesson           FOREIGN KEY (lesson_id)  REFERENCES lessons(id) ON DELETE CASCADE,
    CONSTRAINT FK_att_student          FOREIGN KEY (student_id) REFERENCES users(id),
    CONSTRAINT FK_att_checked_by       FOREIGN KEY (checked_by) REFERENCES users(id),
    CONSTRAINT UQ_att_lesson_student   UNIQUE (lesson_id, student_id),
    CONSTRAINT CK_att_status           CHECK (status IN ('present', 'absent', 'late', 'excused'))
);
GO

CREATE INDEX IX_attendances_student
    ON attendances (student_id, lesson_id);
GO
