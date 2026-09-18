# AI 면담실 Easy Setup 참고 조사

조사일: 2026-09-13

## Found implementation

현재 수학 프로젝트 작업 공간(`/Users/kimnana/Documents/codex`)에서 `ai-interview-room-*`, `EasySetup`, `AuthCredentials`, `EASY_SETUP_ENABLED`, `SUPABASE_OAUTH_CLIENT_SECRET` 등의 경로와 문자열을 검색했으나 면담실 Easy Setup 구현을 찾지 못했다.

사용자가 지정한 GitHub 저장소 `rlasksk030/daengdaeng-lab`도 이 실행 환경의 네트워크 제한으로 원격 소스 조회가 되지 않았다. 따라서 면담실 코드를 읽었다거나 복사했다고 보고하지 않는다.

## Reusable contract adopted in the math app

참고 구현 대신 수학 앱에서 이미 검증한 경계를 유지한다.

- 공개 SPA: `src/lib/installerClient.ts` — HttpOnly installer session 요청만 수행하며 관리 토큰을 받지 않는다.
- 서버/CLI: `scripts/installer/management-api.ts`, `oauth.ts`, `orchestrator.ts` — Management OAuth state/PKCE, 임시 자격 증명, 대상 project ref 결합, migration·function·Secret 단계 재개.
- 앱별 manifest: `scripts/installer/contract.ts`, `math-manifest.ts` — `stacking-blocks-math`의 migration·함수·Secret·probe만 선언한다.
- 수학 전용 후속 단계: 교사 Auth, 학급, 학생, PIN, 학생 smoke는 기존 `/setup`과 `student-api` 경로를 사용한다.

## Adapt / do not reuse

면담실의 실제 코드를 확인하지 못했으므로 특정 저장 구조·Worker·Durable Object·AI API를 수학 앱에 가져오지 않았다. 수학 앱은 OpenAI/면담 모델을 설치 요구사항으로 포함하지 않으며, Cloudflare는 정적 Pages만 사용한다.

실제 공통 backend를 만들려면 참고 프로젝트의 소스와 실행 장소·권한·비용을 먼저 확인하고 별도 승인을 받아야 한다. 현재는 로컬 계약과 공개 client 연결까지만 구현했으며 OAuth 앱 등록·backend 배포·원격 설치는 실행하지 않았다.
