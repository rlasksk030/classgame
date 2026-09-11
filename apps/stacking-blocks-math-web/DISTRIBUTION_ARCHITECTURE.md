# 배포판 아키텍처 준비

이 앱은 여러 교사가 각자의 Supabase 프로젝트에 연결해 사용하는 배포판을 목표로 한다. 현재 코드에는 개인 프로젝트의 URL·키·교사·학급·학생 값을 하드코딩하지 않는다. 브라우저에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`와 선택적인 `VITE_INSTALLATION_ID`만 주입한다. `service_role` 키와 `APP_SESSION_SECRET`은 Edge Function Secret으로만 둔다.

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

`VersionService`와 `UpdateManifest`는 원격 manifest 연결을 위한 인터페이스다. `LocalVersionService`는 현재 버전만 반환하고 최신 버전이나 업데이트 성공을 만들어 내지 않는다. 향후 업데이트 orchestration은 `preflight → database → functions → storage → content → post-check → version` 순서를 따르며 기본 정책은 수동 승인이다.

## 데이터 보존과 migration

모든 DB 변경은 `supabase/migrations/`의 순번 파일로 관리한다. migration은 `if not exists`·안전한 upsert를 사용하고 학생·PIN·진도·시도·보상·snapshot·친구 문제·건축물·교사 문제를 삭제하지 않는다. 각 교사의 Supabase 프로젝트에는 같은 migration을 순서대로 적용하며, 개발자의 프로젝트 ref를 코드에 넣지 않는다.

현재 migration 버전은 001~011이다. 실제 새 프로젝트 적용 여부는 `SUPABASE_SETUP.md`와 작업 기록의 원격 점검 결과를 함께 확인한다.

## 진단 정보

`getDiagnosticInfo()`는 앱/DB 버전, 설치 ID, 환경, 브라우저 문자열만 반환한다. 학생 이름, PIN, 세션 토큰, 비밀키, service role, 학습 기록은 포함하지 않는다. 향후 관리자 화면의 “진단 정보 복사”에 사용할 수 있다.

## 현재 범위 밖

ZIP·설치 도우미 UI·원격 업데이트 서버·자동 migration·Storage bucket·중앙 manifest 배포는 아직 구현하지 않는다. 기존 학생/교사 학습 기능과 Supabase 보안 경계를 우선 보존한다.
