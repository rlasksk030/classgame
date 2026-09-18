# 배포판 아키텍처 준비

## 승인 검토용 권장안 1개 — 제작자 Supabase 설치 실행부 (2026-09-12)

**관리 실행부는 로컬 코드 계약과 서버 전용 Management API 어댑터까지 구현했지만 아직 미배포/미운영이다. 실제로 제거한 교사 수동 작업은 아직 0개다.** 아래 안은 Cloudflare 서버 사용 없이 반복적인 기술 설치를 줄이지만, 제작자 소유의 별도 실행 장소가 필요하므로 현재의 ‘새 중앙 서버 금지’ 조건에 대한 예외 승인이 필요하다. 승인하지 않으면 공개 URL/key만으로 같은 자동화를 실행할 수 없다.

### 실행 장소와 담당

제작자가 소유·운영하는 **별도 Supabase Free 프로젝트 1개**에 OAuth callback과 설치 작업용 Edge Functions, 작업 상태용 DB를 둔다. 기존 `/setup`만 확장한다. Cloudflare에는 기존 정적 SPA와 공개 release manifest만 둔다. 학생 로그인·PIN·진도·작품 요청은 설치 실행부를 거치지 않고 각 교사의 Supabase로 직접 간다. 중앙 DB에는 project ref, installationId, 승인한 release, 단계 결과·해시만 저장하고 학생/PIN/작품은 저장하지 않는다.

공식 [OAuth 통합](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)은 code 교환 때 client secret과 state 검증, 권장 PKCE를 사용하며 Edge Functions 예제를 제공한다. 따라서 정적 브라우저만으로 비밀값을 안전하게 보관하는 실행부를 대체하지 않는다.

### 제작자가 처음 한 번 준비할 것

1. 별도 Free 프로젝트 여유·조직 요금제를 확인하고 사용 한도를 정한다. 유료 전환과 결제수단 등록은 이번 승인안에 포함하지 않는다.
2. OAuth 앱과 고정 callback URL, 선택 scope를 등록한다. client secret과 토큰 암호화 키는 설치 프로젝트의 서버 Secret에만 넣는다.
3. 설치 함수/작업 상태 schema를 배포하고 인증·허용 origin·CSRF/PKCE·프로젝트 소유 권한·release 서명을 검증한다. OAuth 승인 조직과 사용자가 선택한 프로젝트를 서버에서 매 요청에 바인딩한다.
4. 기존 migrations와 두 학생 Edge Function의 검증된 산출물을 같은 저장소에서 만들고 해시 manifest를 배포한다. 설치 실행부 안에서 npm/Vite/Deno 번들을 매번 빌드하지 않는다.
5. 신규 설치·부분 실패·재시도·업데이트·권한 철회 시험을 합성/빈 승인 프로젝트에서 먼저 수행한다. 이 단계들은 아직 수행하지 않았다.

### 다른 교사가 매번 실제로 할 일

| 지금 필요한 작업 | 권장안 구현 후 | 실제 감소 여부 |
|---|---|---|
| Supabase 계정·조직 준비 | 최초 계정 가입/로그인 및 약관 동의는 교사 본인 | 남음 |
| 프로젝트 수동 생성·DB 비밀번호 설정 | `/setup`에서 조직/이름/서울/무료 여유 확인 후 생성 승인; 서버가 비밀번호 생성·API 생성 | 자동화 목표 |
| migration SQL 실행 | 승인 release의 미적용 migration만 Management API 실행 | 자동화 목표 |
| CLI 설치·함수 배포 | 해당 release의 student-auth/student-api 배포 | 자동화 목표 |
| APP_SESSION_SECRET 복사·설정 | 없는 경우에만 서버 생성/설정; 이미 있으면 유지 | 자동화 목표 |
| 공개 URL/key 복사 | 서버가 공개 설정만 돌려주고 기존 RuntimeSupabaseConfig 저장 | 자동화 목표 |
| 교사 Auth 계정 생성 | **초기 실행안에서는 교사가 Dashboard에서 1회 생성** 후 기존 `/teacher` 로그인 | 남음 |
| 학급·학생 입력, 링크 배부 | 기존 `/teacher` 그대로 | 수업 준비로 남음 |
| 학생 로그인→첫 저장→새 세션 복원 | 설치 진단의 TEST 학생 1명 사용에 별도 명시 동의, 실제 학생 API로 검증 | 자동화 목표, 미검증 |

즉 기술 작업 5묶음(프로젝트/DB/함수/Secret/공개설정)을 없애는 목표지만 **현재 감소 0, 구현 후 목표 5**다. 계정 동의와 교사 Auth 생성은 숨기지 않는다. 완전한 ‘브라우저 세 단계 설치’ 완료안으로 광고하지 않는다. 교사 계정 자동화는 이 파일럿의 성공 조건에 몰래 포함하지 않는다.

교사 Auth 생성을 남긴 이유: 현재 `/teacher`는 기존 Supabase Auth 비밀번호 로그인을 재사용한다. Management OAuth 승인이 곧 앱 교사 Auth 계정인 것은 아니다. [기본 메일 발송](https://supabase.com/docs/guides/auth/auth-smtp)은 조직 팀 주소만 허용하고 현재 2건/시간이며 운영용 SLA가 없다. 모든 교사에게 초대 메일이 배달된다고 가정하거나, 메일 확인/RLS를 끄거나, 교사마다 SMTP 비밀키 설정을 추가하여 ‘간소화’로 세지 않는다. 이 단계까지 제거하려면 별도 안전한 등록/메일 경로의 검증과 승인이 추가로 필요하다.

### 자동화 API와 권한

서버가 OAuth Management API로 프로젝트 조회/생성, [migration 적용](https://supabase.com/docs/reference/api/v1-apply-a-migration), [함수 배포](https://supabase.com/docs/reference/api/v1-deploy-a-function), Secrets 조회/설정을 한다. 공개 publishable key만으로 실행하지 않는다. Supabase 문서상 migration Management API는 선택된 partner OAuth 앱에만 제공되므로, OAuth 앱 승인 범위가 확인되기 전에는 자동 migration을 지원한다고 약속하지 않는다.

[공식 scope 표](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)를 기준으로 Organizations Read, Projects Read/Write, Database Read/Write, Edge Functions Read/Write, Secrets Read/Write, Auth Read를 승인 후보로 정한다. Storage Read는 bucket 확인에 사용한다. Billing·Domain·Branch는 요청하지 않는다. 실제 endpoint별 최소 scope 조합은 신규 설치 시험에서 확인해야 한다. 특히 Database Write/Secrets Read는 단일 앱 테이블·공개키만으로 제한된 권한이 아니므로 넓은 관리 권한이라는 사실을 교사에게 알린다. 실행부 allowlist는 위험을 줄이지만 플랫폼 권한 자체를 좁히지는 않는다.

서버에 보관할 비밀값: OAuth client secret, 암호화 키, 설치 중에만 필요한 암호화 OAuth access/refresh token. 앱/URL/로그로 보내지 않는다. 생성용 DB 비밀번호는 요청 동안만 사용하고 저장하지 않는다. 기존 APP_SESSION_SECRET은 이름/존재만 검사하며 교체하지 않는다. API key 목록에서 공개키만 반환하고 service_role/secret key는 브라우저로 보내지 않는다. 교사 비밀번호·학생 PIN은 중앙 설치 DB에 보관하지 않는다.

### 중단·재개·업데이트·철회

- 한 프로젝트/목표 release에 작업 하나만 허용한다. 단계별 `planned/running/verified/blocked`와 remote checksum을 기록한다. HTTP 한 번에 전체 설치를 끝내지 않는다.
- 한 요청은 migration 또는 함수 하나만 처리하고, 다음 요청이 실제 원격 상태를 재조회한 후 이어 간다. 네트워크 timeout이면 ‘성공’으로 표시하지 않고 다시 조회한다.
- 기존 migration 이력과 파일 해시가 불명확하면 중단한다. **현재 운영 프로젝트도 MCP migration 목록이 빈 배열이지만 schema는 존재한다. 빈 이력은 빈 DB라는 증거가 아니다.** schema 대조 없이 모든 migration을 다시 실행하지 않는다.
- 설치 중단은 다음 mutation을 정지한다. 이미 만든 프로젝트/schema를 자동 삭제하지 않는다. Secret이 이미 있으면 덮지 않고 기존 학생/PIN/진도/작품·문항 정답도 임의 갱신하지 않는다.
- 파일럿 토큰 보존 정책은 작업 진행 중 최대 24시간, 완료/취소 때 암호화 토큰 삭제로 제안한다. 만료 후에는 다시 OAuth 승인하고 비민감 단계 기록으로 이어 간다. 플랫폼 승인도 교사가 Dashboard에서 철회할 수 있게 안내한다. 로컬 토큰 삭제만으로 플랫폼 철회가 완료됐다고 표시하지 않는다.
- 업데이트 때 다시 승인받아 대상 release의 차이만 적용한다. 이미 적용된 파일 수정·전체 재설치·기존 Secret 재발급은 금지한다. 실패한 단계와 해당 기능을 표시하고 수업 데이터는 유지한다.
- READY는 학생 첫 인증/저장/새 세션 복원 결과를 받은 뒤에만 표시한다. 진단용 학생 API 호출은 READY 이전에도 허용한다. 현재 코드에서 getInstallationStatus는 route/API 진입 gate로 쓰이지 않아 이 순환 차단은 없다.

### 비용과 미확인 조건

2026-09-12 공식 [가격표](https://supabase.com/pricing): Free $0/월, 활성 프로젝트 2개 제한, 프로젝트 DB 500MB, Storage 1GB, egress 5GB, 1주 비활성 시 pause, 자동 백업/SLA 없음. [함수 비용](https://supabase.com/docs/guides/functions/pricing)은 Free 500,000회 포함이며 Free 초과 유료 단가는 제시하지 않는다. 유료 플랜의 100만회당 $2를 Free의 자동 과금으로 해석하지 않는다.

[함수 제한](https://supabase.com/docs/guides/functions/limits)은 메모리256MB, Free wall150초, CPU2초/요청, server-side bundle5MB다. 따라서 단계 분할·미리 준비한 bundle·제한된 재시도가 필요하다. 함수 호출 횟수 외에도 DB/전송량/프로젝트 여유를 확인한다. 파일럿 자체 운영 상한은 10개 설치/일, 한 작업 최대100개 함수 요청, 동시 설치1개로 제안한다(공식 quota가 아닌 제작자 제한). 한도 근접·429·pause·조직이 유료일 때 자동 유료 전환 없이 정지한다.

미확인: 제작자 조직의 실제 Free 여유, OAuth 앱 공개 등록/승인 조건, Management API 실측 요청 한도, 설치당 실제 호출·전송량, 중앙 실행부 재개/삭제 정책 구현. 따라서 영구 $0·무제한 설치·항상 가용을 보장하지 않는다. 별도 중앙 프로젝트가 없어도 되는 현재 수업 실행 경로는 유지한다.

### 정확한 승인 대상과 현재 상태

승인 대상은 **제작자 소유의 별도 Supabase Free 설치 프로젝트와 OAuth 앱 운영, 위 관리 scope·최대24시간 암호화 토큰 보관, 명시적으로 승인된 교사 프로젝트에만 설치/업데이트 실행**이다. 중앙 실행부 금지의 예외가 필요하며 Cloudflare는 여전히 정적이다. 유료 전환·임의 기존 프로젝트 변경·학생 데이터 중앙 수집은 승인 범위 밖이다.

`scripts/installer/contract.ts`, `security.ts`, `management-api.ts`, `orchestrator.ts`, `fake-backend.ts`에 실행 계약·대상 바인딩·암호학적 Secret 생성·단계별 재개·Management API 호출·합성 상태 어댑터를 두었다. 이는 브라우저 번들에 포함되지 않으며 management credential은 `EphemeralCredential` 수명 안에서만 사용한다. OAuth 앱/실행 서버/Secret 생성, 배포, 원격 migration, 신규 설치·업데이트 실험은 **NOT_RUN**이다. 현재 설치 완료 판정 수정은 기존 체크포인트 그대로 유지했다.

## 간편 설치 추가 계약 — 2026-09-12

이 절이 아래 과거 준비 설명보다 우선한다. 기존 `/setup`, RuntimeSupabaseConfig, `/teacher` 학급·학생 관리, VersionService를 재사용한다. 별도 마법사는 만들지 않는다. 아래 작업은 아직 수동이며 세 단계로 숨기지 않는다.

| 실제 작업 | 현재 수행 위치/담당 | 자동화에 필요한 것 |
|---|---|---|
| 계정·프로젝트 준비 | 교사별 Supabase Dashboard | 소유자 동의·대상 선택/생성 |
| DB/RLS/문항 설치 | 교사별 기술 지원자가 migration 적용 | Database 관리 권한·이력 비교 |
| student-auth/student-api 배포 | 교사별 CLI 또는 Dashboard | Edge Functions 관리 권한·bundle |
| APP_SESSION_SECRET 설정 | 교사별 서버 설정 | Secrets 권한, 미존재 시에만 생성 |
| 교사 Auth 계정 | Dashboard 생성/초대 | 계정 소유자 확인·초대 흐름 |
| 공개 연결 정보 | /setup 또는 설치 링크 | 이미 준비된 runtime config 재사용 |
| 학급·학생·PIN·학생 링크 | /teacher | 기존 앱 기능 재사용 |
| 학생 첫 저장·재접속 복원 | 별도 실제 관통 확인 | 최소 테스트 데이터와 실제 응답 증거 |

제작자 1회 준비: 공통 정적 dist, 검증된 migration/function 산출물, 버전 manifest 관리. 자동 설치를 도입한다면 OAuth 앱 등록·callback·안전한 비밀값 보관·권한 철회·실행부 운영도 제작자 준비다. 교사별 프로젝트 설치는 별개의 반복 작업이다. 이번 변경으로 제거한 외부 수동 설치 작업은 **0개**다. 현재 상태를 간편 자동 설치 완료로 광고하지 않는다.

### 공식 API·권한·실행 장소·비용 조사

2026-09-12 확인한 [공식 OAuth 통합](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)은 계정 승인 후 code 교환에 client secret을 요구하며 state 검증과 PKCE를 설명한다. [Management API](https://supabase.com/docs/reference/api/introduction)는 OAuth/PAT 관리 권한이 필요하다. 공개 URL/key는 이를 대체하지 않는다. PAT 수동 복사는 교사 기본 경로로 채택하지 않는다.

승인된 서버에서 OAuth 교환→대상 프로젝트 확인→[migration 적용](https://supabase.com/docs/reference/api/v1-apply-a-migration)→[함수 배포](https://supabase.com/docs/reference/api/v1-deploy-a-function)→Secret/계정 준비→관통 확인이 후보 경로다. [scope](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)는 Organizations/Projects 조회, Database·Edge Functions·Secrets의 해당 읽기/쓰기가 필요하고 프로젝트 생성에는 Projects 쓰기도 필요하다. 정확한 최소 조합은 실제 신규 설치 실험 전 미확정이다. Billing·삭제 작업은 설치 작업에 넣지 않는다.

정적 브라우저에는 client secret을 둘 수 없다. 교사 프로젝트의 Edge Function에서 실행해도 그 최초 함수 배포를 위한 실행부가 먼저 필요하다. 현재 제약에서 검증된 완전 자동 경로는 없다. 제작자 Supabase 등에 중앙 설치 함수를 두는 후보는 새 중앙 서버이므로 **도입 이유·운영 비용·권한 승인 후** 구현한다. 이번에 서버/계정/OAuth 앱/Secret은 만들지 않았다.

[Supabase 가격표](https://supabase.com/pricing)의 Free 한도는 실행부의 영구 $0 비용을 보장하지 않는다. 실행 수·저장량·프로젝트/OAuth 조건 확인 전 비용은 미확정이다. Cloudflare는 정적 Pages만 유지한다. 유료 서비스·타 저장소 통합은 승인 전 하지 않는다.

### 보존·재개·완료

향후 실행부는 installationId/project ref/목표 release별 migration 버전·해시, 함수 bundle 해시, 마지막 성공 단계, 안전한 오류 코드를 보관한다. 재시도마다 실제 원격 상태를 재조회한다. 불명확한 수동 SQL 이력은 자동 재실행하지 않는다. 기존 학생/PIN/진도/작품과 적용 migration을 보존하고 기존 Secret은 재생성하지 않는다. 중복 학급 생성 방지·부분 성공·작업 잠금·토큰 만료·중단 복구를 검증해야 한다. 원격 installer session과 OAuth callback 서버는 아직 미배포이며, 로컬 오케스트레이터는 누락 단계만 재개한다.

LocalVersionService는 원격 release를 조회하지 않는다. SCHEMA_VERSION도 실제 DB 적용 증거가 아니다. 현재 저장소에는 001~017 migration이 있으며 원격 적용 여부는 프로젝트별 확인 대상이다. 설치 완료는 연결·DB/RLS·함수·Storage·교사·학급 및 학생 인증·첫 활동 저장·새 세션 복원 증거까지 필요하다. 상태 함수의 boolean 입력만으로 LIVE 성공을 주장하지 않는다.

실제 신규 설치/업데이트/중단 복구: NOT_RUN. 원격 자동 실행부 운영: BLOCKED(장소·권한·비용 승인 필요). 로컬 실행 계약의 합성 재개 검사는 통과했지만 실제 TEST 상태 확인은 아직 하지 않았다. 수업 오류와 기존 QA 미완료 항목은 계속 우선 처리한다.

이 앱은 여러 교사가 각자의 Supabase 프로젝트에 연결해 사용하는 배포판을 목표로 한다. 현재 코드에는 개인 프로젝트의 URL·키·교사·학급·학생 값을 하드코딩하지 않는다. 브라우저는 런타임 `RuntimeSupabaseConfig`를 우선 사용하고, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`와 선택적인 `VITE_INSTALLATION_ID`는 개발·테스트 fallback으로만 사용한다. `service_role` 키와 `APP_SESSION_SECRET`은 Edge Function Secret으로만 둔다.

## Cloudflare 비용 제약: 정적 호스팅만

Cloudflare는 개발자 계정 비용이 발생하지 않는 **순수 정적 호스팅**으로만 사용한다.

- Pages에는 `npm run build` 결과인 `dist/`만 배포한다.
- `public/_redirects`, 정적 asset, HTML/CSS/JS만 Cloudflare에서 제공한다.
- Pages Functions, Workers, KV, D1, Durable Objects, R2, Cloudflare API proxy와 사용량 기반 서버 기능은 사용하지 않는다.
- 학생 로그인·PIN·교사 Auth·진도·시도·스냅샷·문제은행·학습지 Storage·Edge Functions는 각 교사의 Supabase 프로젝트에 직접 요청한다.
- 브라우저에서 `service_role` 키나 Edge Function Secret을 사용하지 않는다. Cloudflare 서버 환경변수도 핵심 기능의 전제 조건으로 만들지 않는다.

학생 수와 교사 수가 늘어도 개발자 Cloudflare 계정에서 동적 요청을 처리하지 않는다. Supabase의 무료 요금제·제한과 각 교사의 데이터베이스 비용은 Cloudflare 비용과 별도로 관리한다.

### 설치 실행부의 현재 경계 (Phase 7E)

정적 Pages 산출물에는 Supabase 관리 토큰이나 Secret을 넣지 않는다. 현재 준비된 `scripts/installer/start.ts`는 Node 런타임, 아웃바운드 HTTPS, 메모리 세션, 암호화 모듈, 저장소의 migration/function 소스 읽기가 필요하며 TEST allowlist와 운영 ref 차단을 시작 시 검증한다. Management API 호출은 서버 전용 `SupabaseManagementBackend`가 PAT를 일시적으로 사용한다.

이 실행부를 실제 교사에게 제공하려면 HTTPS Node 호스트, 도메인과 허용 origin, `INSTALLER_SESSION_SECRET`, TEST project ref allowlist, PAT 또는 Supabase OAuth 앱과 callback 운영이 필요하다. 별도 호스트는 Cloudflare Pages의 정적 범위 밖이며 비용·권한·운영 주체가 승인되지 않아 생성·배포하지 않았다. `npm run installer:server`는 승인된 호스트에서 기동할 준비된 진입점이고, `npm run qa:installer:remote`는 TEST 환경변수로 원격 상태를 점검하는 운영자용 실행기다. QR encoder와 실제 remote `/setup` 연결은 아직 미구현/미검증이다.

### 공통 정적 산출물과 연결 설정

교사마다 별도 서버 번들을 만들지 않고 같은 정적 앱을 사용한다. 설치 식별자와 연결 정보는 `/setup`에서 `stacking-installation-config` 키로 로컬에 저장하거나 `/#install=` fragment로 전달한다. Vite의 `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`는 개발·테스트 fallback이며, `.env.local`의 실제 값은 저장소에 커밋하지 않는다. 특정 교사의 값을 공통 `dist/`에 고정하는 방식은 최종 다중 교사 배포 계약으로 간주하지 않는다.

설치 fragment가 이미 다른 설치와 연결된 공유 기기에 들어오면 앱은 현재 설정을 유지하고 “다른 설치 설정으로 변경할까요?” 확인을 거친 뒤에만 교체한다. 설정은 공개 연결 정보만 포함하고 Secret·service role은 포함하지 않는다. 학생 토큰은 설치 교체 때 삭제해 다른 교사의 세션이 이어지지 않게 한다. 학생·교사 브라우저는 해당 Supabase로 직접 통신하며 Cloudflare 프록시는 추가하지 않는다.

## 버전 계약

- 앱 버전은 `src/lib/config.ts`의 `APP_VERSION`(현재 `1.0.0`)에서 읽는다.
- DB 계약 버전은 `SCHEMA_VERSION`(현재 `202609110016`)으로 표시한다.
- `getVersionState()`가 `currentAppVersion`, `requiredSchemaVersion`, `installedSchemaVersion`, `updateRequired`를 계산한다. 설치된 DB 버전이 부족하면 새 기능을 사용하기 전에 업데이트 필요 상태로 표시할 수 있다.
- 기본 문제와 생성 문제는 기존의 안정적인 ID·`generatorVersion`·seed를 유지한다. 알고리즘을 바꿀 때는 새 generator version을 사용해 기존 학생의 문제가 바뀌지 않게 한다.

## 설치 상태

`getInstallationStatus()`는 설정값과 설치 점검 결과를 합쳐 `NOT_CONFIGURED`부터 `READY`까지의 상태를 계산한다. 현재는 네트워크를 확인했다고 가장하지 않고, 설치 마법사가 나중에 다음 점검 결과를 주입할 수 있는 순수 계약만 제공한다.

```ts
getInstallationStatus({
  migrationsReady: true,
  edgeFunctionsReady: true,
  adminReady: true,
  classReady: true,
});
```

`/setup`은 8단계 교사 마법사로 연결 확인, 교사 Auth 로그인, 기존 학급 선택/생성, 학생 명단 일괄 생성, 학생 로그인 smoke, 접속 링크 복사를 제공한다. 설치 위치는 설치 ID·단계·학급 식별자만 `stacking-installer-progress`에 저장하고 PIN·비밀번호·access token은 저장하지 않는다. DB 설치·Storage bucket 생성·Edge Function 배포·Secret 설정은 여전히 자동 실행하지 않는다. 정적 SPA와 공개 Publishable key만으로 관리 작업을 수행할 수 없기 때문이다. 안전한 관리용 실행부와 권한·비용 승인이 없는 상태에서 설치 완료를 가장하지 않는다.

## 업데이트 구조

`VersionService`와 `UpdateManifest`는 원격 manifest 연결을 위한 인터페이스다. `LocalVersionService`는 현재 버전만 반환하고 최신 버전이나 업데이트 성공을 만들어 내지 않는다. 향후 업데이트 orchestration은 `정적 앱 preflight → 각 교사 Supabase migration → Edge Functions → Storage/content 호환성 → post-check → 앱 버전` 순서를 따르며 기본 정책은 수동 승인이다. Cloudflare는 새 `dist/` 파일을 제공할 뿐 migration이나 동적 API를 실행하지 않는다.

## 데이터 보존과 migration

모든 DB 변경은 `supabase/migrations/`의 순번 파일로 관리한다. migration은 `if not exists`·안전한 upsert를 사용하고 학생·PIN·진도·시도·보상·snapshot·친구 문제·건축물·교사 문제를 삭제하지 않는다. 각 교사의 Supabase 프로젝트에는 같은 migration을 순서대로 적용하며, 개발자의 프로젝트 ref를 코드에 넣지 않는다.

현재 migration 버전은 001~013이다. 012는 문제 정확성 감사에서 확인된 기존 기본 문제의 정답·투영·시점 데이터를 보정하고, 013은 친구 문제의 힌트 카드 유형을 저장한다. 기존 migration을 다시 실행하지 않고 설치된 DB에 순서대로 적용한다. 실제 새 프로젝트 적용 여부는 `SUPABASE_SETUP.md`와 작업 기록의 원격 점검 결과를 함께 확인한다.

## 진단 정보

`getDiagnosticInfo()`는 앱/DB 버전, 설치 ID, 환경, 브라우저 문자열만 반환한다. 학생 이름, PIN, 세션 토큰, 비밀키, service role, 학습 기록은 포함하지 않는다. 향후 관리자 화면의 “진단 정보 복사”에 사용할 수 있다.

## 현재 범위 밖

ZIP·설치 도우미 고급 점검 UI·원격 업데이트 서버·자동 migration·Storage bucket·중앙 manifest 배포는 아직 구현하지 않는다. 기본 `/setup` 런타임 연결 설정은 구현되어 있으며, 추가 기능을 만들 때도 Cloudflare 서버 기능을 도입하지 않고 기존 학생/교사 학습 기능과 Supabase 보안 경계를 우선 보존한다.
