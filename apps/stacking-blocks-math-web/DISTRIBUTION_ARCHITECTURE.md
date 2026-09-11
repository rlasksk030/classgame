# 배포판 아키텍처 준비

이 앱은 여러 교사가 각자의 Supabase 프로젝트에 연결해 사용하는 배포판을 목표로 한다. 현재 코드에는 개인 프로젝트의 URL·키·교사·학급·학생 값을 하드코딩하지 않는다. 브라우저에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`와 선택적인 `VITE_INSTALLATION_ID`만 주입한다. `service_role` 키와 `APP_SESSION_SECRET`은 Edge Function Secret으로만 둔다.

## Cloudflare 비용 제약: 정적 호스팅만

Cloudflare는 개발자 계정 비용이 발생하지 않는 **순수 정적 호스팅**으로만 사용한다.

- Pages에는 `npm run build` 결과인 `dist/`만 배포한다.
- `public/_redirects`, 정적 asset, HTML/CSS/JS만 Cloudflare에서 제공한다.
- Pages Functions, Workers, KV, D1, Durable Objects, R2, Cloudflare API proxy와 사용량 기반 서버 기능은 사용하지 않는다.
- 학생 로그인·PIN·교사 Auth·진도·시도·스냅샷·문제은행·학습지 Storage·Edge Functions는 각 교사의 Supabase 프로젝트에 직접 요청한다.
- 브라우저에서 `service_role` 키나 Edge Function Secret을 사용하지 않는다. Cloudflare 서버 환경변수도 핵심 기능의 전제 조건으로 만들지 않는다.

학생 수와 교사 수가 늘어도 개발자 Cloudflare 계정에서 동적 요청을 처리하지 않는다. Supabase의 무료 요금제·제한과 각 교사의 데이터베이스 비용은 Cloudflare 비용과 별도로 관리한다.

### 공통 정적 산출물과 연결 설정

교사마다 별도 서버 번들을 만들지 않고 같은 정적 앱을 사용한다. 설치 식별자는 `VITE_INSTALLATION_ID` 또는 향후 설치 설정에서 관리한다. 현재 코드는 Vite의 `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`를 읽는 단계이므로, `.env.local`의 실제 값은 저장소에 커밋하지 않는다. 특정 교사의 값을 공통 `dist/`에 고정하는 방식은 최종 다중 교사 배포 계약으로 간주하지 않는다.

향후 설치 도우미는 정적 파일을 다시 빌드하지 않고도 교사의 공개 Supabase URL·Publishable Key를 등록할 수 있는 런타임 설정 계층(예: 설치별 로컬 설정 또는 별도 정적 설정 파일)을 추가해야 한다. 설정은 공개 연결 정보만 포함하고 Secret·service role은 포함하지 않는다. 그때도 학생·교사 브라우저가 해당 Supabase로 직접 통신하며 Cloudflare 프록시는 추가하지 않는다.

## 버전 계약

- 앱 버전은 `src/lib/config.ts`의 `APP_VERSION`(현재 `1.0.0`)에서 읽는다.
- DB 계약 버전은 `SCHEMA_VERSION`(현재 `202609110011`)으로 표시한다.
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

향후 `/setup`은 `checkSupabaseConnection`, `checkRequiredTables`, `checkRequiredFunctions`, `checkStorageBuckets`, `checkTeacherAdmin`, `checkClassConfiguration`을 순서대로 호출하고 교사 승인 뒤에만 설치를 완료한다. 이번 단계에서는 자동 migration, Storage bucket 생성, 원격 업데이트를 실행하지 않는다.

## 업데이트 구조

`VersionService`와 `UpdateManifest`는 원격 manifest 연결을 위한 인터페이스다. `LocalVersionService`는 현재 버전만 반환하고 최신 버전이나 업데이트 성공을 만들어 내지 않는다. 향후 업데이트 orchestration은 `정적 앱 preflight → 각 교사 Supabase migration → Edge Functions → Storage/content 호환성 → post-check → 앱 버전` 순서를 따르며 기본 정책은 수동 승인이다. Cloudflare는 새 `dist/` 파일을 제공할 뿐 migration이나 동적 API를 실행하지 않는다.

## 데이터 보존과 migration

모든 DB 변경은 `supabase/migrations/`의 순번 파일로 관리한다. migration은 `if not exists`·안전한 upsert를 사용하고 학생·PIN·진도·시도·보상·snapshot·친구 문제·건축물·교사 문제를 삭제하지 않는다. 각 교사의 Supabase 프로젝트에는 같은 migration을 순서대로 적용하며, 개발자의 프로젝트 ref를 코드에 넣지 않는다.

현재 migration 버전은 001~011이다. 실제 새 프로젝트 적용 여부는 `SUPABASE_SETUP.md`와 작업 기록의 원격 점검 결과를 함께 확인한다.

## 진단 정보

`getDiagnosticInfo()`는 앱/DB 버전, 설치 ID, 환경, 브라우저 문자열만 반환한다. 학생 이름, PIN, 세션 토큰, 비밀키, service role, 학습 기록은 포함하지 않는다. 향후 관리자 화면의 “진단 정보 복사”에 사용할 수 있다.

## 현재 범위 밖

ZIP·설치 도우미 UI·런타임 연결 설정·원격 업데이트 서버·자동 migration·Storage bucket·중앙 manifest 배포는 아직 구현하지 않는다. 이 항목을 추가할 때도 Cloudflare 서버 기능을 도입하지 않고, 기존 학생/교사 학습 기능과 Supabase 보안 경계를 우선 보존한다.
