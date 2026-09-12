# 배포판 아키텍처 준비

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

향후 실행부는 installationId/project ref/목표 release별 migration 버전·해시, 함수 bundle 해시, 마지막 성공 단계, 안전한 오류 코드를 보관한다. 재시도마다 실제 원격 상태를 재조회한다. 불명확한 수동 SQL 이력은 자동 재실행하지 않는다. 기존 학생/PIN/진도/작품과 적용 migration을 보존하고 기존 Secret은 재생성하지 않는다. 중복 학급 생성 방지·부분 성공·작업 잠금·토큰 만료·중단 복구를 검증해야 한다. 이 실행부와 영속 재개 기능은 아직 미구현이다.

LocalVersionService는 원격 release를 조회하지 않는다. SCHEMA_VERSION도 실제 DB 적용 증거가 아니다. 현재 저장소에는 001~016 migration이 있으며 원격 적용 여부는 프로젝트별 확인 대상이다. 설치 완료는 연결·DB/RLS·함수·Storage·교사·학급 및 학생 인증·첫 활동 저장·새 세션 복원 증거까지 필요하다. 상태 함수의 boolean 입력만으로 LIVE 성공을 주장하지 않는다.

실제 신규 설치/업데이트/중단 복구: NOT_RUN. 자동 실행부: BLOCKED(장소·권한·비용 승인 필요). 수업 오류와 기존 QA 미완료 항목은 계속 우선 처리한다.

이 앱은 여러 교사가 각자의 Supabase 프로젝트에 연결해 사용하는 배포판을 목표로 한다. 현재 코드에는 개인 프로젝트의 URL·키·교사·학급·학생 값을 하드코딩하지 않는다. 브라우저는 런타임 `RuntimeSupabaseConfig`를 우선 사용하고, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`와 선택적인 `VITE_INSTALLATION_ID`는 개발·테스트 fallback으로만 사용한다. `service_role` 키와 `APP_SESSION_SECRET`은 Edge Function Secret으로만 둔다.

## Cloudflare 비용 제약: 정적 호스팅만

Cloudflare는 개발자 계정 비용이 발생하지 않는 **순수 정적 호스팅**으로만 사용한다.

- Pages에는 `npm run build` 결과인 `dist/`만 배포한다.
- `public/_redirects`, 정적 asset, HTML/CSS/JS만 Cloudflare에서 제공한다.
- Pages Functions, Workers, KV, D1, Durable Objects, R2, Cloudflare API proxy와 사용량 기반 서버 기능은 사용하지 않는다.
- 학생 로그인·PIN·교사 Auth·진도·시도·스냅샷·문제은행·학습지 Storage·Edge Functions는 각 교사의 Supabase 프로젝트에 직접 요청한다.
- 브라우저에서 `service_role` 키나 Edge Function Secret을 사용하지 않는다. Cloudflare 서버 환경변수도 핵심 기능의 전제 조건으로 만들지 않는다.

학생 수와 교사 수가 늘어도 개발자 Cloudflare 계정에서 동적 요청을 처리하지 않는다. Supabase의 무료 요금제·제한과 각 교사의 데이터베이스 비용은 Cloudflare 비용과 별도로 관리한다.

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

`/setup`은 `checkSupabaseConnection`으로 `/auth/v1/settings`만 읽어 연결을 확인하고 공개 설정을 저장한다. DB 설치·Storage bucket 생성·교사 인증은 자동 실행하지 않는다. 향후 `checkRequiredTables`, `checkRequiredFunctions`, `checkStorageBuckets`, `checkTeacherAdmin`, `checkClassConfiguration` 점검을 이어 붙일 수 있다.

## 업데이트 구조

`VersionService`와 `UpdateManifest`는 원격 manifest 연결을 위한 인터페이스다. `LocalVersionService`는 현재 버전만 반환하고 최신 버전이나 업데이트 성공을 만들어 내지 않는다. 향후 업데이트 orchestration은 `정적 앱 preflight → 각 교사 Supabase migration → Edge Functions → Storage/content 호환성 → post-check → 앱 버전` 순서를 따르며 기본 정책은 수동 승인이다. Cloudflare는 새 `dist/` 파일을 제공할 뿐 migration이나 동적 API를 실행하지 않는다.

## 데이터 보존과 migration

모든 DB 변경은 `supabase/migrations/`의 순번 파일로 관리한다. migration은 `if not exists`·안전한 upsert를 사용하고 학생·PIN·진도·시도·보상·snapshot·친구 문제·건축물·교사 문제를 삭제하지 않는다. 각 교사의 Supabase 프로젝트에는 같은 migration을 순서대로 적용하며, 개발자의 프로젝트 ref를 코드에 넣지 않는다.

현재 migration 버전은 001~013이다. 012는 문제 정확성 감사에서 확인된 기존 기본 문제의 정답·투영·시점 데이터를 보정하고, 013은 친구 문제의 힌트 카드 유형을 저장한다. 기존 migration을 다시 실행하지 않고 설치된 DB에 순서대로 적용한다. 실제 새 프로젝트 적용 여부는 `SUPABASE_SETUP.md`와 작업 기록의 원격 점검 결과를 함께 확인한다.

## 진단 정보

`getDiagnosticInfo()`는 앱/DB 버전, 설치 ID, 환경, 브라우저 문자열만 반환한다. 학생 이름, PIN, 세션 토큰, 비밀키, service role, 학습 기록은 포함하지 않는다. 향후 관리자 화면의 “진단 정보 복사”에 사용할 수 있다.

## 현재 범위 밖

ZIP·설치 도우미 고급 점검 UI·원격 업데이트 서버·자동 migration·Storage bucket·중앙 manifest 배포는 아직 구현하지 않는다. 기본 `/setup` 런타임 연결 설정은 구현되어 있으며, 추가 기능을 만들 때도 Cloudflare 서버 기능을 도입하지 않고 기존 학생/교사 학습 기능과 Supabase 보안 경계를 우선 보존한다.
