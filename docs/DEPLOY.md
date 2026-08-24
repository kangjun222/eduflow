# 배포 가이드

Azure SQL(무료 오퍼) + Azure App Service 기준.
코드 쪽 준비는 끝나 있다. 여기서는 Azure 콘솔에서 할 일만 다룬다.

---

## 0. 먼저 알아야 할 것 — 무료 오퍼의 진짜 제약

Azure SQL 무료 오퍼는 **월 10만 vCore-초**를 준다.
2 vCore 서버리스 기준으로 나누면 **월 약 14시간**이다.

| | 결과 |
|---|---|
| 자동 일시중지를 **끄면** | 24시간 깨어 있으므로 **반나절 만에 한 달치 소진** |
| 소진 후 | 그달 남은 기간 DB 정지 (또는 유료 전환 — 생성 시 선택) |

**자동 일시중지는 켜둔다.** 대신 첫 요청이 깨우는 데 30~60초 걸리므로,
**지원서를 내는 기간에만** 외부 cron으로 주기적으로 깨워둔다. (5절)

---

## 1. Azure SQL 데이터베이스 생성

포털 → **SQL databases** → **만들기**

| 항목 | 값 |
|---|---|
| 데이터베이스 이름 | `eduflow` |
| 서버 | 새로 만들기 → 위치는 **Korea Central** |
| 서버 관리자 로그인 | 원하는 계정명 (로컬의 `portfolio_app` 과 달라도 된다) |
| 인증 방법 | **SQL 인증** |
| 워크로드 환경 | 개발 |

**여기가 핵심** — 컴퓨팅+스토리지 → **구성** 에서
**"무료 오퍼 적용"(Apply free offer)** 이 보이는지 확인한다.
안 보이면 구독에 이미 무료 DB가 있거나 지역이 지원하지 않는 것이다.

- 서비스 계층: **범용 - 서버리스**
- **자동 일시 중지: 켬** (0절 참고. 기본 1시간이면 충분하다)
- 한도 초과 시 동작: **월말까지 정지** (유료 전환 아님)

네트워킹 탭:
- **Azure 서비스가 이 서버에 액세스하도록 허용: 예** ← App Service 가 붙으려면 필요
- **현재 클라이언트 IP 주소 추가: 예** ← 내 PC에서 마이그레이션하려면 필요

> 집·회사 IP가 바뀌면 여기서 다시 추가해야 한다.
> `Cannot open server ... requested by the login` 이 나오면 대부분 이 문제다.

---

## 2. 스키마와 시드 넣기

내 PC에서 원격 DB를 향해 실행한다. 서버가 아직 없어도 된다.

```bash
# server/.env 를 잠시 원격으로 바꾸거나, 아래처럼 한 번만 덮어쓴다
cd server
DB_HOST=<서버이름>.database.windows.net \
DB_NAME=eduflow \
DB_USER=<관리자로그인> \
DB_PASSWORD='<비밀번호>' \
DB_ENCRYPT=true DB_TRUST_CERT=false \
node scripts/migrate.js

# 같은 방식으로 시드
... node scripts/seed.js
```

Azure SQL은 자체 서명이 아니라 진짜 인증서를 쓰므로
**`DB_ENCRYPT=true`, `DB_TRUST_CERT=false`** 가 맞다. 로컬과 반대다.

첫 명령이 30~60초 멈춰 있어도 정상이다. 일시중지된 DB가 깨어나는 중이다.

---

## 3. App Service 배포

포털 → **App Services** → **만들기 → 웹앱**

| 항목 | 값 |
|---|---|
| 게시 | 코드 |
| 런타임 스택 | **Node 22 LTS** |
| 운영 체제 | Linux |
| 지역 | Korea Central (DB와 같은 지역) |
| 요금제 | **F1 (무료)** 로 시작 |

> F1은 하루 CPU 60분 제한이 있고 "항상 켜기"를 못 쓴다.
> 20분 놀면 잠들어 첫 요청이 느려진다. 감당이 안 되면 B1으로 올린다.

### 배포 방법 — GitHub Actions

**배포 센터** → 소스: **GitHub** → 레포/브랜치(`main`) 선택 → 저장.

Azure가 워크플로 파일을 자동 생성하는데, **이 프로젝트는 모노레포라 그대로 두면 실패한다.**
루트 `package.json` 에는 의존성이 없어서 `npm install` 만으로는
`server/node_modules` 도 `client/dist` 도 만들어지지 않는다.

생성된 `.github/workflows/*.yml` 의 빌드 단계를 이렇게 고친다:

```yaml
      - name: 의존성 설치와 빌드
        run: |
          npm run setup
          npm run build
```

그리고 **앱 설정에 `SCM_DO_BUILD_DURING_DEPLOYMENT=false`** 를 넣는다.
Azure가 서버에서 다시 빌드하려 들면 아래 함정에 걸린다.

> **함정** — 앱 설정에 `NODE_ENV=production` 이 있으면
> `npm install` 이 devDependencies 를 건너뛴다. Vite 가 devDependency 라서
> 서버에서 빌드하면 "vite: not found" 로 죽는다.
> **빌드는 GitHub Actions에서, 배포는 산출물만.**

시작 명령은 루트 `package.json` 의 `start` 가 잡아준다. (`npm --prefix server start`)

---

## 4. 환경변수 (앱 설정)

App Service → **설정 → 환경 변수 → 앱 설정**.
`.env` 파일은 git에 올라가지 않으므로 **여기에 직접 넣는 것이 유일한 경로다.**

| 이름 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST` | `<서버이름>.database.windows.net` |
| `DB_PORT` | `1433` |
| `DB_NAME` | `eduflow` |
| `DB_USER` | `<관리자 로그인>` |
| `DB_PASSWORD` | `<비밀번호>` |
| `JWT_SECRET` | **로컬과 다른 새 값**으로 생성해서 넣는다 |
| `JWT_EXPIRES_IN` | `2h` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |

`JWT_SECRET` 새로 만들기:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`PORT` 는 **넣지 않는다.** App Service가 자기 값을 주입한다.

저장하면 앱이 재시작된다.

---

## 5. 깨워두기 (지원 기간 한정)

일시중지된 DB는 첫 요청에 30~60초 걸린다. 면접관은 기다리지 않는다.
[cron-job.org](https://cron-job.org) 같은 무료 서비스로
**10~15분마다 `https://<앱이름>.azurewebsites.net/health/db`** 를 호출해 둔다.

`/health` 가 아니라 **`/health/db`** 여야 한다. DB까지 건드려야 깨어난다.

계산 — 15분 간격으로 깨워두면 DB가 사실상 상시 가동이 되어
월 14시간 한도를 넘긴다. 그러므로 **상시로 돌리지 말고,
이력서를 뿌린 주에만 켜고 끝나면 끈다.**

---

## 6. 배포 후 확인

```bash
curl -i https://<앱이름>.azurewebsites.net/health      # 서버
curl -i https://<앱이름>.azurewebsites.net/health/db   # DB (첫 호출은 느릴 수 있다)
```

브라우저로 열어 **로그인까지** 확인한다.
로그인이 안 되면 `secure` 쿠키 문제일 가능성이 높다 — 주소가 `https` 인지,
앱 설정에 `NODE_ENV=production` 이 들어갔는지 본다.

로그가 필요하면 App Service → **로그 스트림**.

마지막으로 README 맨 위에 **배포 링크와 테스트 계정**을 적는다.

---

## 자주 걸리는 것

| 증상 | 원인 |
|---|---|
| `vite: not found` (빌드 실패) | 서버에서 빌드 중. `SCM_DO_BUILD_DURING_DEPLOYMENT=false` 확인 |
| `Cannot find module 'express'` | `server/node_modules` 가 안 올라갔다. 워크플로의 `npm run setup` 확인 |
| `Cannot open server ... requested by the login` | SQL 서버 방화벽. IP 추가 또는 "Azure 서비스 허용" 켜기 |
| 로그인이 계속 풀린다 | `secure` 쿠키인데 http로 접속 중이거나 `trust proxy` 가 안 켜졌다 |
| 첫 요청만 타임아웃 | DB 자동 일시중지. 정상 동작이다. 5절 참고 |
| 갑자기 DB가 안 붙는다 | 무료 한도 소진 가능성. 포털에서 사용량 확인 |
