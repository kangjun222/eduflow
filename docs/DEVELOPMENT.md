# 개발 가이드

작업을 이어서 할 때 이 문서부터 읽는다.

---

## 1. 다시 시작하는 법

터미널 두 개를 띄운다. **프로젝트 루트(`D:\project`)에서 실행한다.**

```bash
npm run dev          # 터미널 1 — API 서버 (localhost:3000)
npm run dev:client   # 터미널 2 — 화면    (localhost:5173)
```

브라우저는 **http://localhost:5173** 으로 연다.
3000번은 API라 JSON만 나온다.

### 서버가 안 뜨면

| 증상 | 확인 |
|---|---|
| `EADDRINUSE` / 옛날 응답이 옴 | 이전 node 프로세스가 살아있다. 아래 참고 |
| `[db] connection failed` | SQL Server 서비스가 꺼져 있다 |

```bash
# 3000번을 잡고 있는 프로세스 확인 후 종료
netstat -ano | grep ":3000.*LISTENING"
taskkill //PID <번호> //F
```

```powershell
# SQL Server 서비스 확인
Get-Service MSSQLSERVER
Start-Service MSSQLSERVER   # 꺼져 있으면
```

---

## 2. 자주 쓰는 명령

루트에서 실행한다.

| 명령 | 설명 |
|---|---|
| `npm run dev` | API 서버 (파일 저장 시 자동 재시작) |
| `npm run dev:client` | React 개발 서버 |
| `npm run migrate` | 새 마이그레이션 적용 |
| `npm run seed` | 시드 데이터 넣기 (여러 번 실행해도 안전) |
| `npm run build` | React 프로덕션 빌드 |
| `npm run setup` | 의존성 전체 설치 (새 PC에서 받았을 때) |

---

## 3. 개발 환경

이 PC에 이미 세팅된 내용이다. **새 PC에서 받으면 4번을 참고해 다시 해야 한다.**

| 항목 | 값 |
|---|---|
| Node | 20.15.0 |
| SQL Server | 2022, 기본 인스턴스 `localhost:1433` |
| 데이터베이스 | `portfolio_dev` |
| DB 로그인 | `portfolio_app` (해당 DB에만 `db_owner`) |
| 비밀번호 | `server/.env` 에 있음 (git에 올라가지 않음) |

### SSMS로 DB 볼 때

```
서버 이름:  localhost
인증:       Windows 인증
암호화:     선택 사항        ← 기본값(필수)이면 인증서 오류가 난다
```

`서버 인증서 신뢰` 체크박스를 켜도 된다.
로컬 SQL Server는 자체 서명 인증서를 쓰기 때문에 생기는 문제이고, 서버가 잘못된 게 아니다.

### Node 버전

Vite가 `Node 20.19+ 필요` 경고를 띄우지만 동작에는 문제없다.
여유 있을 때 **Node 22 LTS로 올리면** 이 경고와 `mssql`의 Azure 의존성 경고가 함께 사라진다.

---

## 4. 새 PC에서 처음 세팅할 때

1. **SQL Server 설정** — 기본 설치 상태로는 Node에서 접속이 안 된다. 관리자 PowerShell에서:

   ```powershell
   $key = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQLServer'
   Set-ItemProperty "$key\SuperSocketNetLib\Tcp" -Name Enabled -Value 1 -Type DWord
   Set-ItemProperty "$key\SuperSocketNetLib\Tcp\IPAll" -Name TcpPort -Value '1433' -Type String
   Set-ItemProperty "$key\SuperSocketNetLib\Tcp\IPAll" -Name TcpDynamicPorts -Value '' -Type String
   Set-ItemProperty $key -Name LoginMode -Value 2 -Type DWord   # 혼합 인증
   Restart-Service MSSQLSERVER -Force
   ```

   TCP/IP가 꺼져 있으면 SSMS는 되는데 Node만 안 된다. Shared Memory와 TCP는 다른 통로다.

2. **DB와 계정 생성** — SSMS에서 Windows 인증으로 접속 후:

   ```sql
   CREATE DATABASE portfolio_dev;
   GO
   CREATE LOGIN portfolio_app WITH PASSWORD = '원하는_비밀번호', CHECK_POLICY = ON;
   GO
   USE portfolio_dev;
   CREATE USER portfolio_app FOR LOGIN portfolio_app;
   ALTER ROLE db_owner ADD MEMBER portfolio_app;
   ```

3. **환경변수** — `server/.env.example`을 `server/.env`로 복사하고 비밀번호를 채운다.

4. **설치와 초기화**

   ```bash
   npm run setup
   npm run migrate
   npm run seed
   ```

---

## 5. 현재 진행 상황

```
[x] DB 스키마 (7개 테이블)
[x] 마이그레이션 실행기
[x] 강좌 개설 API + 시간 충돌 방지     ← 핵심 기술 포인트 1
[x] 주간 시간표 화면 (React)
[ ] 인증 (로그인 · 역할별 권한)        ← 다음 작업
[ ] 수강신청 + 정원 초과 방지          ← 핵심 기술 포인트 2
[ ] 출결 처리
[ ] 배포
```

### 지금 되는 것

- 시간표에서 주간 수업을 색깔 블록으로 확인
- 화면에서 강좌 개설, 충돌 시 빨간 경고로 차단
- 샘플 데이터: 강사 3 / 학생 3 / 강의실 3 / 강좌 4

---

## 6. 다음 작업 — 인증

의존성은 이미 설치돼 있다 (`bcryptjs`, `jsonwebtoken`, `cookie-parser`).

### 정한 것

**토큰은 httpOnly 쿠키에 담는다.**
`localStorage`는 XSS로 토큰이 통째로 털린다. 쿠키는 자바스크립트에서 접근할 수 없다.

**배포할 때 Express가 React 빌드를 함께 서빙한다.**
프론트와 백이 같은 출처가 되므로 쿠키가 그대로 동작하고, CORS 설정도 필요 없다.
배포 대상이 서버 하나로 줄어 무료 티어에도 유리하다.

### 할 일

- [ ] `server/src/services/authService.js` — 로그인, 비밀번호 검증
- [ ] `server/src/middleware/auth.js` — 토큰 검증, 역할 확인
- [ ] `server/src/routes/auth.js` — `POST /api/auth/login`, `/logout`, `GET /api/auth/me`
- [ ] `.env`에 `JWT_SECRET` 추가 (`.env.example`에도 자리만)
- [ ] 시드의 `password_hash`를 진짜 bcrypt 해시로 교체
- [ ] `POST /api/courses`를 관리자만 호출 가능하도록 제한
- [ ] React 로그인 화면 + 비로그인 시 접근 차단

### 그다음 — 수강신청

정원 초과 방지가 목표다. 강사 충돌과 같은 종류의 동시성 문제지만
"겹치는 행이 있나"가 아니라 "몇 명인가"를 세는 방식이라 잠금 거는 지점이 다르다.
**정원 5명에 10명이 동시에 신청하는 테스트**를 만들어 증명한다.

---

## 7. 주요 설계 결정

바꾸기 전에 이유를 먼저 확인할 것.

| 결정 | 이유 |
|---|---|
| `lessons`에 회차를 실제 행으로 생성 | 패턴만 저장하면 휴강·보강을 표현할 수 없다 |
| `lessons`가 강사·강의실을 직접 보유 | 대강·강의실 변경이 회차 단위로 일어난다. 충돌 검사도 이 테이블만 보면 된다 |
| 중복 신청 차단에 필터링된 유니크 인덱스 | 일반 UNIQUE면 취소한 학생이 재신청할 수 없다 |
| 충돌 검사에 `UPDLOCK, HOLDLOCK` | 없으면 동시 요청에서 뚫린다. 실측: 8건 중 4건 통과, 겹친 회차 24건 발생 |
| 회차 날짜 계산을 SQL에서 수행 | JS `Date`를 거치면 드라이버가 UTC로 바꿔 시각이 밀린다 |
| 임시 테이블 대신 CTE | `sp_executesql` 스코프 때문에 임시 테이블이 다음 쿼리에서 사라진다 |
| 토큰을 httpOnly 쿠키에 저장 | `localStorage`는 XSS에 취약하다 |

자세한 내용은 [README의 트러블슈팅](../README.md#트러블슈팅) 참고.

---

## 8. 자주 막히는 것

**서버를 고쳤는데 옛날 응답이 온다**
이전 node 프로세스가 3000번을 잡고 있다. `npm`을 종료해도 자식 프로세스는 살아남는 경우가 있다.
위 1번의 `taskkill`로 정리한다.

**`Invalid object name '#...'`**
`query()`는 `sp_executesql`로 실행되어 호출마다 스코프가 분리된다.
임시 테이블은 다음 호출에서 사라지므로 CTE를 쓴다.

**마이그레이션에서 문법 오류가 난다**
`GO`는 T-SQL이 아니라 SSMS/sqlcmd의 배치 구분자다.
`scripts/migrate.js`가 이걸 잘라서 보내므로, 직접 드라이버로 실행하지 말 것.

**한글이 깨진다**
문자열 컬럼은 반드시 `NVARCHAR`를 쓴다. 쿼리 리터럴에는 `N'중등 수학'`처럼 `N` 접두사를 붙인다.
Git Bash 터미널에서 깨져 보이는 건 표시 문제일 뿐 데이터는 정상인 경우가 많다.

**`npm install` 후 Vite가 네이티브 바이너리를 못 찾는다**
npm의 선택적 의존성 버그다. `node_modules`와 `package-lock.json`을 지우고 다시 설치한다.
그래도 안 되면 Node 버전이 요구 사항보다 낮은지 확인한다.

---

## 9. 배포 계획

**아직 안 했다. 인증이 끝나면 바로 진행한다.**

MSSQL은 무료 매니지드 선택지가 사실상 **Azure SQL Database 무료 티어** 하나뿐이다.

1. Azure SQL 무료 티어로 DB 생성 (생성 화면에서 "Free offer" 확인)
2. `npm run build`로 React 빌드
3. Express가 `client/dist`를 정적 서빙하도록 설정 (production 한정)
4. 서버를 Azure App Service 등에 배포
5. 운영 환경변수는 파일이 아니라 **호스팅 대시보드에 직접 입력**한다

### 주의

- Azure SQL 서버리스는 **자동 일시중지**가 있다. 깨어나는 동안 첫 요청이 타임아웃 난다.
  일시중지를 끄거나, 지원 기간에는 cron으로 주기적으로 깨워둔다.
- 면접관은 로딩 50초를 기다리지 않는다. **배포 링크가 죽어 있으면 안 본다.**

---

## 10. 남은 할 일 (포트폴리오용)

- [ ] README 맨 위에 **데모 GIF** 추가 — 충돌로 막히는 장면이 가장 효과적이다
- [ ] 배포 링크와 테스트 계정을 README에 기재
- [ ] GitHub 레포 이름을 `portfolio` → `eduflow` 로 변경 (`gh repo rename eduflow`)
- [ ] 개발하며 막힌 것을 그때그때 README 트러블슈팅에 기록
      (나중에 기억으로 복원하려면 안 된다)
