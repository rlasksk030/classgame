# 운영 installer 재연결 루프 수정 — 2026-10-03

판정: 소스 수정 및 안전한 로컬 관통 검증 PASS. Frontend 운영 승격은 계속 보류한다. 실제 운영은 아직 기존 bc535a4 프런트이며 이번 소스가 배포된 상태로 보고하지 않는다.

## 원인과 증거

- **UI 상태 전환 결함 확정**: 이전 공개 runtime config만으로 connectionVerified=true가 된다. 재개 effect가 resume marker를 미리 소비하고 update 실패를 무시한 뒤 finally에서 /teacher로 이동했다. OAuth bind 경로도 createSession 응답만 받고 status 확인 없이 /teacher로 이동했다.
- 수정 전 실제 Chromium 회귀 3개(session 실패/status 실패/기존 config만 있는 reload)가 모두 실패했다. 실패 뒤 오류 화면을 유지해야 한다는 assertion을 수정 후 통과했다.
- **쿠키 없는 요청 확정, 유실 원인은 미확정**: 운영 installer 로그 2026-10-03 KST 02:02~02:08에서 session_lookup_no_usable_id / cookieHeaderSent=true / installerSessionNamePresent=false 확인. 이는 해당 요청에 세션 쿠키가 없었다는 증거다. 항상 쿠키 설정이 깨진다는 증거와는 구분한다.
- KST 02:08:14~15에는 OAuth session_created_or_reused(viaOAuth=true), PUBLIC_KEY_FETCH_SUCCESS가 있고, 이후 STATUS_INSPECT_PROJECT_OK / STATUS_MIGRATIONS_OK / STATUS_SECRETS_OK / STATUS_FUNCTIONS_OK가 있다. 이 시점에는 세션/권한이 server status 처리에 사용됐다. 로그의 쿠키 값/권한 토큰은 수집하지 않았다.
- **Render Rewrite 누락/순서 오류 없음**: 실제 Dashboard를 읽어서 아래 두 규칙의 값·순서를 확인했다. 소스 render.yaml만으로 판정하지 않았다.
  1. /api/installer/* → https://stacking-blocks-math-installer.onrender.com/api/installer/* (Rewrite)
  2. /* → /index.html (Rewrite)
- 실제 Frontend Environment에는 변수/secret file/linked group이 없으며 VITE_INSTALLER_API_URL override도 없다. 변경 0건.
- 별도 실제 Chromium production context의 최초 JS 요청 및 session/status/delete 요청 모두 https://stacking-blocks-math.onrender.com/api/installer/*였다. 직접 installer host로 나가는 요청은 없었다.
- 운영 프록시에서 **권한 없는 임시 installer 메모리 세션**만 생성하여 검사했다. 쿠키 이름 installer_session, Path=/api/installer, Secure=true, HttpOnly=true, SameSite=Lax 확인. 후속 status/delete에 다시 전송됐고 delete=200 / 잔여 쿠키=0. OAuth/Management 호출, Supabase 프로젝트/계정/학생 자료 생성, update는 하지 않았다. 이 검사는 production OAuth grant 전체 왕복 검증으로 승격하지 않는다.

## 수정 계약

- installerReconnect.ts: project 일치 → AUTHORIZED session 응답 → 공개 키 검증 → cookie 기반 status → 공개 연결 확인을 모두 통과해야 fresh session을 반환한다.
- SetupPage.tsx: 공개 설정과 freshInstallerSession을 분리. 실패를 숨기는 resume effect와 무조건 finally navigation을 제거. verified session만 update에 사용하며 COMPLETE 및 후속 INSTALLED를 확인하고 복귀한다. 이미 INSTALLED이면 update 변이 없이 복귀한다.
- installer.ts: hasInstallerResumeUpdate/clearInstallerResumeUpdate 추가. 실패 시 marker 유지, 성공 시에만 제거. 기존 consume helper는 다른 호출 계약을 위해 유지하고 reconnect에서 사용하지 않는다.
- reload: 유효한 grant는 목록/선택 복원, 이미 소비된 grant는 서버의 유효한 session status를 다시 확인하여 복원한다. 공개 설정만 남았거나 쿠키가 없으면 오류 화면 유지. 실패 후 명시적 재시도 가능.
- auto-bind의 busy 플래그 공유 대신 별도 중복 bind ref 사용. mount discovery 중복도 방지. setup을 떠난 뒤 도착한 bind 결과는 config/update/navigation을 실행하지 않는다.
- 신규 기기의 개발자용 공개 설정 연결/교사 복귀 계약을 유지한다. 설치 update resume marker가 있으면 공개 키 확인만으로 update 복귀를 우회할 수 없다.
- backend 쿠키 속성, 권한, callback origin, RLS, migration, Edge, package/lockfile은 변경하지 않았다. 신규 설치 1~8단계 실제 화면 회귀를 추가했다.

## 검증

| 검증 | 결과 |
|---|---|
| 수정 전 동일 회귀 | 3 failed (의도한 오류 재현) |
| npm test | 623 passed / 0 failed / 0 skipped |
| installer HTTP/backend/proxy 별도 묶음 | 75 passed / 0 failed / 0 skipped (623에 포함) |
| npm run test:security | 1 passed / 0 failed |
| npm run typecheck / lint / build | PASS |
| 전체 Playwright E2E (workers=1) | 57 passed / 0 failed / 0 skipped |
| 새 reconnect E2E | 13 passed (57에 포함) |
| 새 실제 HTTP proxy/browser cookie E2E | 2 passed (57에 포함) |
| production 동일 origin 메모리 쿠키 검사 | PASS, 정확한 생성 세션 delete=200 |
| 수정본 production Frontend | NOT_DEPLOYED |
| production 외부 Supabase OAuth 조직 승인 전체 flow | 이번 수정본으로 NOT_RUN |

안전한 로컬 관통 검증은 실제 build/브라우저/Node installer/proxy/서명 HttpOnly 쿠키/상태/update/UI 복귀를 사용했다. 외부 Supabase consent/token exchange/Management/Auth/학생 API만 합성 처리했다. 성공 후 교사 widget의 ‘최신 버전입니다’ 확인, session cookie 누락 시 /setup 유지 및 update 0회 확인. 합성 테스트를 실제 운영 Supabase 인증 smoke로 보고하지 않는다.

기존 테스트 삭제·skip 추가·timeout/assertion 완화 없음. 구 unsafe resume 구현을 고정하던 구조 검사는 새 성공 조건으로 변경했고 실제 실패/성공 동작 검증을 추가했다.

## Git 및 운영 보존

- 시작: feature/spatial-math-redesign-v1 / 43186f49ddfb5bbd1e8184c380f642bed7d5561d.
- fix/2026-10-03-installer-reconnect-loop에서 수정 commit/push 후 동일 patch를 release/2026-10-03-required-progress에 cherry-pick한다. PR #4의 기존 진도 patch는 다시 만들지 않는다.
- PR #4는 Draft / OPEN / 미병합 유지. release/production 변경, Frontend/installer 배포, DB migration 재적용/rollback, Edge 재배포, 실제 학생 데이터 변경 모두 이번 작업 0건.
- DB compatibility migration 20261002163546 및 student-api v5 / student-auth v7 유지. Frontend LIVE dep-dat56gg473hc738esfk0 / bc535a4a750b9f66391e6b12301e52c86d0edd89 유지.
- 선행 임시 Admin smoke 계정 요청은 공식 CLI api-keys 조회가 403 privileges 부족으로 거절됐다. 계정/학급/학생 생성 0건. auth.users 직접 SQL이나 우회 권한 확대를 하지 않았다. 별도 공식 서버 Admin 권한 경로가 확보되어야 실제 인증 smoke를 계속할 수 있다.

다음 단계: 실제 운영 권한/세션 경로를 확보한 뒤 임시 Admin 교사 생성 → 기존 프런트+Edge v5 인증 smoke → PR #4 최종 승격. 이번 reconnect 수정과 로컬 검증 통과만으로 이를 생략하지 않는다.
