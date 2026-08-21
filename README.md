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

(개발하며 막혔던 것, 원인, 해결을 여기에 기록)
