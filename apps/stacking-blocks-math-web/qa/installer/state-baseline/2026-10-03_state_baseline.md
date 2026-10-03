# Installer state-based compatibility

범위: LOCAL_LOGIC / UI_WITH_TEST_DATA. 실제 Supabase 및 운영 installer/Frontend 배포는 수행하지 않는다. 기존 promotion PR은 Draft / OPEN / 미병합으로 유지한다. 프로젝트 ref, 실제 학급 코드, 학생 row, 비밀값은 이 공개 문서와 fixture에 포함하지 않는다.

## 원인과 변경

기존 `statusFor`, `planFor`, `runInstaller`는 migration history에 없는 파일을 무조건 적용 대상으로 판단했다. 수동 최소 delta로 실제 계약을 충족하고 API까지 갱신해도 과거 파일 4개가 PENDING이 되어, 더 넓은 compatibility SQL이 기존 함수/기본값/grant를 다시 바꿀 수 있었다.

이제 수학 release plan에 검증된 DB catalog baseline을 의무적으로 포함한다. 상태 조회, 계획 생성, 직접 orchestrator 실행 모두 같은 읽기 전용 판정을 사용한다. 실제 객체 정의가 다르거나 catalog를 확인할 수 없으면, 이력이 완전하더라도 자동 변경을 허용하지 않는다. API로 우회해서 install/repair/update를 요청해도 `409 INSTALLER_MANUAL_REVIEW_REQUIRED`로 중단한다. 세션의 이전 작업 완료 플래그는 이 검증을 대신하지 않는다.

- APPLIED_BY_HISTORY: 실제 계약이 검증됐고 해당 migration 이력도 존재.
- SATISFIED_BY_STATE: 최종 release 계약이 검증됐으나 이력이 없음. SQL 및 history row 쓰기 없음.
- PENDING: 빈 신규 설치 또는 정확한 이력 prefix와 대응하는 검증된 중단 상태에서만 사용.
- DRIFT_REQUIRES_REVIEW: 부분 일치, 알 수 없는 정의, 정의 검증 불가. DB/Edge/Secret 자동 변경 금지.

UI는 drift에서 “자동 업데이트로 변경하기 전에 확인이 필요합니다.”를 표시하고 설치·복구·업데이트를 비활성화한다. 상태 확인은 가능하다. reconnect는 승인된 drift 상태를 읽을 수 있지만 update, 반복 OAuth, 교사 화면 성공 이동을 하지 않는다. `INSTALLED`에서는 update 없이 복귀한다.

## 계약과 재현 방법

`database-baseline.json`은 27개 프로필을 포함한다: 빈 상태와 중간 migration 23개, 전체 이력 최종 계약, 수동 설치의 이전 계약, 수동 최소 delta 최종 계약. 이전 수동 계약이 확인되면 이를 단순 fresh-install prefix로 오인하여 과거 4개를 실행하지 않는다. 기존 standalone delta가 필요한 manual review 상태로 분류한다.

비교 범위는 `public.sb_*`의 tables/RLS/force RLS/ACL, columns/type/default/nullability, constraints, indexes, policies 및 mode/roles, RPC signature/return type/SECURITY DEFINER/owner/search_path/full function definition, triggers/enabled, column grants이다. 각 객체를 정렬해 SHA-256으로 비교한다. 이름과 테이블 존재만으로 통과시키지 않는다. 물리적 열 순서와 PG18의 중복 NOT NULL constraint 표현만 제외한다. sb namespace 밖의 객체는 검사·변경하지 않는다. 알 수 없는 sb 객체나 새로운 함수 정의는 보수적으로 manual review를 요구한다.

핵심 변경은 `sb_record_attempt`, `sb_save_building`, `sb_submit_challenge_v2`, `sb_reset_class_progress`, `sb_track_challenge_author` 및 동일 이름 trigger, `sb_practice_assignments.updated_at`이다. 다른 진도·보상·세션·활동 객체도 비교한다. 전체 migration 설치의 기존 최종 정의와 수동 최소 delta의 최종 정의는 서로 다른 검증된 프로필로 관리하며, 서로 같다고 가정하지 않는다. 특히 기존 전체 compatibility의 grid 기본값/권한을 수동 delta DB에 다시 적용하지 않는다.

baseline 생성기는 credentials/network 없이 PGlite에서 schema만 재현한다. source migration SHA도 baseline에 묶어, SQL이 바뀌었는데 baseline만 오래된 경우 자동 실행을 차단한다. 공개 manual fixture는 catalog metadata뿐이며 actual row를 복사하지 않는다. 과거 FAIL의 4개 history-only pending 재현 assertion을 유지하고, 실제 orchestrator에 대한 변경 후 기대치는 0으로 강화했다.

```sh
node --experimental-strip-types scripts/installer/generate-database-baseline.ts
node --experimental-strip-types --test tests/installer-database-state.test.ts
```

Management API catalog 조회는 고정 server-side SQL만 `/database/query`에 `read_only: true`로 요청한다. 이력 변조, `auth.users` row 조회, service_role 추출, OAuth scope 확대를 추가하지 않는다. 기준 API는 [공식 Management OpenAPI](https://api.supabase.com/api/v1-json)의 `V1RunQueryBody`다. [공식 changelog](https://supabase.com/changelog)는 PG17/18 표현 차이와 기존 OAuth 흐름 검토에 사용했다.

## Edge

version number는 update 판정에 사용하지 않는다. 현재 bundle closure SHA-256과 배포 metadata의 content-hash marker, ACTIVE 상태, verify_jwt 설정을 비교한다. 이는 기존 installer가 실제로 업로드한 source closure의 fingerprint 경로이며, 이번 작업에서 원격 deployed source를 새로 다운로드하여 재검증했다는 뜻은 아니다. 호환 fingerprint가 확인되지 않은 함수를 같다고 추정하지 않는다.

- student-api: 현재 closure 34개, `ce0424f0063b6df70050e325fa55af6a537a53d1464dac752fd99b49275c7c8a`.
- student-auth: 현재 closure 4개, `8ea7f01dee5188b812ee4070d9e83767513220e2682bf7135973ce0837bbee23`. 호환 fingerprint 및 설정 일치 시 NO CHANGE.
- 이전 API만 다른 경우 migration 0 / API update 1 / auth update 0 / secret update 0.

현재 운영 버전·원본 백업·실사용 데이터 smoke의 미확정 사항을 이 합성 테스트로 PASS 처리하지 않는다. 운영 installer에는 이번 수정도 아직 배포하지 않았다. 수동 DB 적용 후 기존 운영 installer의 update를 호출하기 전에 이 보호 코드 반영과 최신 읽기 전용 검증이 필요하다.

## 최소 delta 보존

기준 commit `1f45a11579f264e332d4bdd6edd30dc9fa712a29`의 standalone SQL은 변경하지 않았다.

`20261003051402_actual_use_required_progress_delta.sql` SHA-256:
`464f2ebba29bee9664957e0e926f6af5c716c5c375ee762d66520987dbabc788`.

실제 운영 변경 0건. 적용 승인은 별도이며 PR에 cherry-pick/Ready/merge하지 않는다.

## 검증 기록

최종 실행 수와 Git/CI 결과는 `verification.json`을 따른다. 모든 브라우저 검증은 합성 응답/로컬 PostgreSQL을 사용한다. 테스트 삭제, skip 추가, timeout 확대, assertion 완화는 없다. 최초 전체 E2E 병렬 실행의 9차시 두 케이스 시간 초과도 별도로 기록한다.


최종 로컬 결과: npm test 645/645, installer state 21/21(위 645에 포함), security 1/1, 최소 delta 27/27, 기본 Playwright 61/61. 타입/Edge/installer server 타입 검사, lint, build PASS. 기본 E2E 최초 병렬 실행은 59 PASS/2 timeout이고, assertion/timeout을 유지한 작업자 1개 전체 재실행은 61 PASS/0 FAIL/0 SKIP이다.

별도 redesign 전체 33개는 30 PASS/3 FAIL/0 SKIP이다. P46(10차시 편집 중 저장 안내 없음), P47/P48(이미 변경된 h1 문구와 오래된 기대값 불일치) 실패를 기준 commit archive에서 같은 테스트 그대로 다시 실행하여 동일한 3 FAIL을 확인했다. 이 학습 화면/테스트는 이번 patch에서 변경하지 않았다. 이 결과를 전체 PASS로 보고하거나 테스트를 제외하지 않는다. 운영 승격 근거로 삼으려면 별도 보정이 필요하다.
