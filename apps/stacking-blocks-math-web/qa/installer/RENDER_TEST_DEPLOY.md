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
- PAT, service role, APP_SESSION_SECRET, 학생 PIN은 브라우저나 저장소에 넣지 않습니다.
- `/api/installer/credential`에는 TEST 검증용 PAT만 짧은 세션으로 입력합니다.
- 실제 TEST status/plan/repair/update/revoke 검증은 배포 후 별도 실행합니다.

QR 생성은 현재 앱에 연결된 client-side encoder가 없어 이 배포 안내의 완료 조건에 포함하지 않습니다. 현재 UI는 학생 링크 복사만 제공합니다.
