# EduFlow

> 학원 수업·예약 관리 플랫폼. 강사·강의실의 시간 충돌을 방지하는 예약 처리에 초점을 맞췄다.

- **배포 링크**: (배포 후 여기에)
- **테스트 계정**: (로그인 구현 후 여기에)

## 기술 스택

| 구분 | 기술 |
|---|---|
| Runtime | Node.js 20 |
| Backend | Express 5 |
| Database | SQL Server 2022 |
| Driver | mssql (tedious) |
| Frontend | React + Vite (예정) |

## 프로젝트 구조

```
eduflow/
├─ server/              백엔드
│  ├─ src/              앱 코드
│  ├─ db/migrations/    스키마 (SQL)
│  └─ scripts/          마이그레이션 실행기
└─ client/              프론트엔드 (예정)
```

## 실행 방법

```bash
npm run setup                    # 의존성 설치
cp server/.env.example server/.env   # DB 접속 정보 입력
npm run migrate                  # 테이블 생성
npm run dev                      # 서버 실행
```

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | 서버 상태 |
| `GET /health/db` | DB 연결 상태 |
| `POST /api/courses` | 강좌 개설 (회차 자동 생성 + 충돌 검사) |
| `GET /api/courses/:id` | 강좌 상세 + 회차 목록 |

강좌 개설 요청 예시:

```json
{
  "title": "중등 수학 A반",
  "teacherId": 5,
  "roomId": 2,
  "capacity": 10,
  "startDate": "2026-09-01",
  "endDate": "2026-11-30",
  "schedules": [
    { "dayOfWeek": 2, "startTime": "19:00", "endTime": "20:30" },
    { "dayOfWeek": 4, "startTime": "19:00", "endTime": "20:30" }
  ]
}
```

`dayOfWeek`는 0(일)~6(토). 기간과 요일 패턴으로 수업 회차를 전부 생성하며,
강사 또는 강의실 일정이 겹치면 `409`와 함께 겹치는 수업 정보를 돌려준다.

## 도메인

| 역할 | 기능 |
|---|---|
| 학생 | 수업 조회·신청·취소, 내 시간표, 출결 확인 |
| 강사 | 담당 수업·수강생 조회, 출결 처리 |
| 관리자 | 회원·강사·강좌 관리, 시간표 편성 |

## ERD

```
users ──┬─(teacher_id)─→ courses ──→ lessons ──→ attendances
        └─(student_id)─→ enrollments        ↗
                          rooms ────────────┘
```

| 테이블 | 설명 |
|---|---|
| `users` | 학생·강사·관리자 (role로 구분) |
| `rooms` | 강의실 |
| `courses` | 강좌 (예: 중등 수학 A반) |
| `course_schedules` | 강좌의 반복 패턴 (매주 화·목 19시) |
| `lessons` | 실제 수업 회차 (날짜별 1행) |
| `enrollments` | 수강 신청 |
| `attendances` | 출결 (회차 × 학생) |

## 설계 노트

**회차를 실제 행으로 생성한다**

`courses`에 반복 패턴만 저장하지 않고 `lessons`에 날짜별 회차를 만들어 둔다.
휴강·보강처럼 특정 회차만 바뀌는 경우를 패턴만으로는 표현할 수 없기 때문이다.
`lessons`가 강사·강의실을 직접 들고 있어 대강과 강의실 변경도 회차 단위로 처리된다.

**중복 수강신청은 필터링된 유니크 인덱스로 막는다**

`(course_id, student_id)`에 일반 UNIQUE를 걸면 취소한 학생이 재신청할 수 없다.
살아있는 신청에만 유니크를 적용해 이 문제를 피했다.

```sql
CREATE UNIQUE INDEX UX_enrollments_active
    ON enrollments (course_id, student_id)
    WHERE status = 'active';
```

## 트러블슈팅

### 1. 동시 요청에서 시간 충돌 검사가 뚫린다

**문제**

"이 강사가 그 시간에 수업이 있는지" 확인한 뒤 회차를 넣는 구조였다.
단건 요청으로는 정상 동작했지만, 같은 시간대를 동시에 등록하면 충돌한 강좌가 함께 생성됐다.

**원인**

검사와 삽입 사이에 다른 트랜잭션이 끼어들 수 있었다.

```
트랜잭션 A: 겹치는 수업 조회 → 없음
트랜잭션 B: 겹치는 수업 조회 → 없음   (A가 아직 커밋 전이라 보이지 않음)
트랜잭션 A: 회차 삽입 → 성공
트랜잭션 B: 회차 삽입 → 성공          ← 겹치는 회차가 생김
```

읽은 행을 잠가도 소용이 없다. 아직 존재하지 않는 행이 나중에 삽입되는
팬텀(phantom) 문제라, 없는 행에 대한 잠금이 필요했다.

PostgreSQL에는 시간 겹침을 막는 `EXCLUDE` 제약이 있지만 SQL Server에는 없어서
직접 해결해야 했다.

**해결**

충돌 검사 쿼리에 `UPDLOCK, HOLDLOCK` 힌트를 걸었다.
`HOLDLOCK`은 조회 범위에 범위 잠금(range lock)을 걸어, 같은 범위에 대한
다른 트랜잭션의 삽입을 커밋 시점까지 막는다.

```sql
FROM cand
JOIN lessons l WITH (UPDLOCK, HOLDLOCK)
  ON l.status <> 'cancelled'
 AND (l.teacher_id = @teacherId OR l.room_id = @roomId)
 AND cand.start_at < l.end_at
 AND l.start_at   < cand.end_at
```

교착 상태(오류 1205)는 요청이 잘못된 게 아니라 타이밍 문제이므로
최대 3회까지 재시도하도록 했다.

**결과**

같은 강사·같은 시간에 동시 요청 8건을 보내 비교했다.

| | 성공 | 충돌 차단 | DB에 겹친 회차 |
|---|---|---|---|
| 잠금 없음 | 4 | 4 | **24건** |
| `UPDLOCK, HOLDLOCK` | 1 | 7 | **0건** |

잠금이 없을 때는 4개 강좌가 동시에 등록되며 겹치는 회차 24개가 실제로 저장됐다.

### 2. 임시 테이블이 다음 쿼리에서 사라진다

**문제**

회차 후보를 `#candidates` 임시 테이블에 만들어두고 다음 쿼리에서 쓰려 했는데
`Invalid object name '#candidates'` 오류가 났다. 같은 트랜잭션, 같은 커넥션인데도 그랬다.

**원인**

node-mssql의 `query()`는 내부적으로 `sp_executesql`로 실행된다.
`sp_executesql`은 자체 스코프를 갖기 때문에, 그 안에서 만든 지역 임시 테이블은
호출이 끝나는 순간 삭제된다.

**해결**

임시 테이블을 쓰지 않고 회차 후보를 CTE로 정의해 충돌 검사 쿼리와 삽입 쿼리에서
각각 계산하도록 바꿨다. 재계산 비용은 최대 1년치 날짜라 무시할 수준이다.

### 3. 날짜 계산을 JS에서 하면 시각이 밀린다

**문제**

19:00 수업을 만들었는데 저장된 값이 다른 시각이 되는 경우가 있었다.

**원인**

JS `Date` 객체를 드라이버에 넘기면 UTC로 변환된다.
`DATETIME2`는 시간대 정보가 없는 타입이라 이 변환이 그대로 오차가 된다.

**해결**

회차 생성을 SQL에서 처리해 JS `Date`를 아예 거치지 않도록 했다.
요일 계산은 서버 설정에 따라 달라지지 않도록 `SET DATEFIRST 7`로 고정했다.
