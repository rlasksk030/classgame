# TEST installer를 Render에 올리는 방법

이 문서는 수학 앱의 TEST 프로젝트만 대상으로 합니다. 운영 Supabase ref는 입력하지 않습니다.

## Render에서 서비스 만들기

1. [Render](https://render.com)에 로그인합니다.
2. 대시보드에서 **New → Blueprint**를 선택합니다.
3. GitHub의 `rlasksk030/classgame` 저장소를 연결합니다.
4. 저장소 루트의 `render.yaml`을 확인하고 **Apply**를 누릅니다.
5. 생성될 서비스 이름이 `stacking-blocks-math-installer-test`인지 확인합니다.
6. 환경변수에서 `INSTALLER_ALLOWED_ORIGIN`에 수학 정적 앱의 정확한 HTTPS 주소를 입력합니다.
7. `INSTALLER_SESSION_SECRET`은 Render가 생성한 값을 그대로 사용합니다. 값을 문서·채팅·로그에 복사하지 않습니다.
8. **Create Web Service**를 눌러 배포합니다.

Blueprint가 사용하는 실행 설정은 다음과 같습니다.

- Root directory: `apps/stacking-blocks-math-web`
- Build command: `npm ci`
- Start command: `npm run installer:server`
- Health check: `/health`
- Target: `TEST` / 실제 TEST project ref (`.env.test.local`의 `SUPABASE_TEST_PROJECT_REF`)

## 배포 확인

1. Render 서비스의 **Events**에서 배포가 끝날 때까지 기다립니다.
2. 서비스의 **URL**을 열고 뒤에 `/health`를 붙입니다.
3. JSON 응답에서 `ok: true`, `service: "stacking-blocks-installer"`, `mode: "TEST"`를 확인합니다.
4. 수학 정적 앱의 빌드 환경에 `VITE_INSTALLER_API_URL`을 Render URL로 설정합니다.
5. 정적 앱을 다시 빌드한 뒤 `/setup`에서 Supabase 연결을 확인합니다.

## 아직 하지 않는 작업

- 이 문서는 Render 서비스나 Supabase 변경을 자동으로 실행하지 않습니다.
- service role·APP_SESSION_SECRET은 브라우저에 넣지 않습니다. TEST 전용 PAT만 `/setup`의 마스킹 입력으로 한 번 전달하며 입력·저장소·응답·로그에 남기지 않습니다. 서버 메모리의 15분 세션 또는 명시적 해제까지만 사용합니다.
- `/api/installer/credential`에는 TEST 검증용 PAT만 짧은 세션으로 입력합니다.
- 실제 TEST status/plan/repair/update/revoke 검증은 배포 후 별도 실행합니다.

QR 생성은 현재 앱에 연결된 client-side encoder가 없어 이 배포 안내의 완료 조건에 포함하지 않습니다. 현재 UI는 학생 링크 복사만 제공합니다.


## HTTPS TEST 설치 검증 체크포인트 (2026-09-19)

- 사용자는 이번 TEST 검증에 한해서 PAT 입력을 승인했습니다. 최종 교사용 배포는 PAT 직접 입력 없는 권한 연결이 필수이며 아직 미완료입니다.
- TEST 화면: https://stacking-blocks-math-setup-test.onrender.com/setup
- TEST 설치 서버: https://stacking-blocks-math-installer-test.onrender.com
- 정적 사이트 root/build/publish: `apps/stacking-blocks-math-web` / `npm ci && npm run build` / `dist`. SPA rewrite: `/*` → `/index.html`.
- 서버의 origin allowlist는 위 TEST 화면 origin 하나로 한정합니다. Supabase project allowlist는 별도 승인을 받은 새 빈 TEST ref로만 변경합니다. 기존 TEST 및 운영 DB에는 설치하지 않습니다.
- migration 개수와 schema version은 현재 체크인된 migration 파일 목록에서 계산합니다(현재 18개).
- API가 생성한 migration의 전체 파일명과 CLI의 version/name 기록을 모두 인식합니다. 재시도는 완료 migration을 건너뛰고 기존 APP_SESSION_SECRET을 유지합니다.
- 단일 Render Node 인스턴스 안에서 프로젝트 단위 실행 잠금이 서로 다른 세션의 동시 설치도 차단합니다. 다중 인스턴스 확장은 검증 범위 밖입니다.
- 권한은 TTL/해제로 폐기합니다. 서버 재시작 시 재연결이 필요하며, 복구 시 원격 설치 이력을 다시 조회합니다.
- 기존 QA 명령의 `--browser-ui`는 실제 HTTPS `/setup`을 조작하되 **합성 API만** 사용합니다. 실행 환경변수: `INSTALLER_FRONTEND_URL`, `INSTALLER_REMOTE_URL`, `INSTALLER_BUILD_COMMIT`. 명령: `npm run qa:installer:remote -- --browser-ui`.
- 위 합성 UI 검사는 실제 Supabase 신규 설치나 원격 CORS/cookie 검증을 대신하지 않습니다. 실측 결과는 runtime 실행별 폴더의 result.json/실제 스크린샷으로 남깁니다.
