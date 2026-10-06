# 기존 교사 설치 자동 복구 — 2026-10-06

검증 범위: LOCAL_DATABASE + REAL_LOCAL_BROWSER. 실제 해당 교사의 DB/세션은 조회하지 않았다. `target.projectRef`는 이미 승인된 installer 세션에서 사용한다. 사용자에게 별도로 project ref를 전달받는 절차는 필요하지 않다.

시작 HEAD: `dde86e2354328a47dd9720c6b49f9e814af766bc`. 같은 `fix/installer-legacy-db-manual-review` / PR #5에서 작업했다. 기존 진단 UI와 true drift 차단을 보존했다. 이전 보고서는 당시 결과로 그대로 둔다.

## 판정과 실행

- catalog의 27개 baseline 전부 사용: 빈 상태, migration 1~23 prefix, migration 24 최종, 수동 이전 계약, 수동 최소 delta 최종 계약.
- 객체 이름만 보지 않고 type/nullability/default/constraint/index/RPC body·ACL·search_path/trigger/RLS/policy/table·column ACL fingerprint를 비교한다.
- 알려진 비어 있지 않은 설치는 catalog와 5개 read-only aggregate evidence를 함께 검사한다. 완료 이력 전체·누락·일부·중간 누락은 같은 판정 경로를 사용한다. 이력과 실제 구조/데이터 증거가 충돌하면 차단한다.
- 복구 가능 상태는 `LEGACY_RESUME_CANDIDATE`. 과거 원본 migration을 실행하거나 이력을 임의 작성하지 않는다.
- 최신 catalog + data evidence + 동일 Edge hash/ACTIVE/verify_jwt + 기존 secret + probe이면 `INSTALLED`, DB write 0 / Edge deploy 0 / secret change 0.
- 빈 신규 DB만 기존 24개 migration 순서로 설치한다. 중간 실패 후 재시도는 확인된 prefix의 최소 transition을 사용한다.

## migration별 현재 상태 증거

번호는 현재 정렬된 manifest 24개 기준이다. `scripts/installer/legacy-recovery.json`은 migration SHA-256과 결합된다. 소스만 바뀌고 artifact가 갱신되지 않으면 실행을 거부한다.

| 번호 / migration | 현재 상태의 증거 | 필요한 경우에만 수행할 최소 변경 |
|---|---|---|
| 1 initial | 전체 sb catalog 계약 | 없는 table/column/object만 추가, 검증된 객체 정의 변경 |
| 2 seed | 배포 seed ID 또는 전역 code 누락 COUNT | 누락된 배포 seed만 INSERT, 기존 ID/기록 유지 |
| 3 problem_sources | column/index/catalog | 검증된 스키마 차이 |
| 4 atomic_attempts | RPC body/권한/catalog | 검증된 RPC 차이 |
| 5 curriculum | 배포 seed 누락·기존 알려진 내용 변형 COUNT | 누락 INSERT, 정확한 배포 구버전 내용만 보정 |
| 6 activities | table/RPC/constraint/catalog | 검증된 스키마 차이 |
| 7 teacher_reset | RPC body/권한/catalog | RPC 정의만 갱신, reset 호출 없음 |
| 8 worksheet | catalog + private bucket/policy 누락 및 충돌 COUNT | 없는 private bucket/policy만 추가, 공개 bucket/변형 policy는 차단 |
| 9 api_grants | table/column/RPC ACL | 검증된 grant 차이 |
| 10 challenge_score | column/constraint/catalog | 검증된 스키마 차이 |
| 11 practice_count | column/constraint/catalog | 검증된 스키마 차이 |
| 12 problem_accuracy | 정확히 알려진 과거 seed 내용 잔존 COUNT | 해당 ID의 배포 구버전 내용만 최신 보정 |
| 13 challenge_hint_type | constraint/catalog | 검증된 스키마 차이 |
| 14 challenge_top_type | constraint/catalog | 검증된 스키마 차이 |
| 15 architecture_grid | column/default/RPC/catalog | 기존 좌표/재료를 바꾸지 않는 계약 변경 |
| 16 rewards_loadout | column/RPC/catalog | 기존 보상/XP를 바꾸지 않는 계약 변경 |
| 17 phase5_persistence | table/column/index/policy/trigger/ACL | 검증된 스키마 차이 |
| 18 lesson9_system_bank | source/constraint/RPC/catalog | schema만 변경; 24개 은행은 API의 학급별 생성 경로이며 이 SQL에는 seed INSERT 없음 |
| 19 practice_controls | column/default/catalog | 새 설정 열의 기존 기본값 유지 |
| 20 guided_stage_progress | column/default/catalog | 새 guided_completed 열 기본값, 기존 진도 유지 |
| 21 required_lesson_completion | RPC body/catalog | 최신 필수 문제 판정 RPC 정의 |
| 22 progress_contract_backfill | 필수 답안·활동 증거 대비 미반영 progress COUNT | 과거 원본 backfill 재실행 금지, 24의 승격 전용 최소 delta |
| 23 atomic_progress_reset | RPC body/권한/catalog | RPC 정의만 갱신, reset 호출 없음 |
| 24 live_v4_compatibility | 최종 catalog + 필수/활동 progress COUNT | 최소 schema delta + 증거 기반 승격만 |

aggregate 응답은 `seedMissing`, `seedOutdated`, `storageMissing`, `progressMissing`, `dataConflict`의 0 이상 정수뿐이다. 예상 외 필드는 버린다. 이름/PIN/답안/작품 데이터는 조회 응답에 넣지 않는다. 이름 같은 공개 metadata도 aggregate에 섞지 않는다.

seed는 저장소의 기존 SQL 데이터만 사용한다. 개인 문제, 비활성 상태, 교사 편집 또는 더 최신의 별도 내용은 덮어쓰지 않는다. 기존 ID를 참조하는 attempts는 바꾸지 않는다. 원본 seed/문제/채점/생성기 파일 변경은 없다.

## 명시적 최소 transition과 데이터 보존

`legacy-generation.ts`는 로컬 PGlite에서 저장소 이력을 재현해 **오프라인**으로 source→target SQL을 생성한다. 운영 서버에서 임의 drift를 보고 schema diff를 만들어 고치지 않는다. `legacy-recovery.json`에 고정된 26개 non-empty transition만 실행 가능하다.

수동 이전 계약은 기존 `20261003051402_actual_use_required_progress_delta.sql`을 사용한다. 수동 최신 계약과 전체 migration 최신 계약은 별도 profile로 유지한다. 수동 설치에 전체 compatibility migration을 적용하지 않는다.

각 transaction은 advisory lock, 5초 lock timeout, 60초 statement timeout, table lock, 시작/종료 catalog guard, 데이터 보존 guard, 종료 aggregate evidence를 포함한다. 증거가 맞지 않거나 동시 schema 변경이 있으면 rollback한다.

보호 대상: sb_classes / sb_students / sb_student_pin_vault / sb_problem_attempts / sb_student_progress / sb_projects / sb_student_sessions / sb_student_rewards / sb_shared_challenges / sb_challenge_solves.

기존 PK/모든 기존 필드의 fingerprint는 DB transaction 내부 임시 테이블에서만 비교한다. 원자료나 fingerprint를 서버 응답·로그로 반환하지 않는다. progress의 완료 승격과 완료시각 보충만 예외이며 completed true→false를 허용하지 않는다. 기존 학생 UUID, PIN, attempt, project, session, reward/XP는 보존한다. 복구 SQL에서 데이터 DELETE/reset RPC 호출은 없다. RPC *정의*에 존재하는 명시적 교사 reset 코드는 설치 중 실행되지 않는다.

완료 근거가 있는 필수 문제/제출 작품은 승격하고, 문제 제작만 한 상태는 참여로 남긴다. 근거가 현재 재구성되지 않는 기존 완료도 강등하지 않는다. 의도적으로 PIN hash를 바꾼 테스트 transaction은 보존 guard가 거절하며 rollback한다.

## UI / Edge

- 정상 legacy: “기존 설치를 확인했습니다”와 “기존 설치 계속하기”. 성공 후 “교사 확인으로 계속” 활성화, 5단계 이동.
- 최신: update/write 없이 5단계 가능.
- 알 수 없는 drift: 프로젝트 ID, 진단 유형, matched profile, 차이 객체 수, 진단 코드만 표시. 설치/repair/update/5단계 차단, 설치 확인은 허용.
- 세션 만료 시 오래된 승인 상태를 지우고 4단계에서도 “Supabase 다시 연결”을 표시한다. 새로고침과 OAuth 재연결 후 재조회 가능.
- Edge는 version 번호 대신 현재 bundle closure hash + ACTIVE + verify_jwt를 사용한다. 같은 student-auth/student-api는 deploy 0. 다르면 해당 함수만 기존 실행 경로로 갱신한다.

## 검증

- 모든 prefix 0~24: 실제 PGlite SQL 적용, 이력 full/empty/partial/holey 판정. 비어 있지 않은 과거 설치의 원본 migration replay 0, 모든 보호 table의 synthetic 기존 row/identity/필드 보존, 두 번째 실행 write 0.
- 수동 이전→최소 delta→수동 최신, 재시도 write 0.
- 기존 12종 실제 catalog drift 회귀 유지, mutation 0. 이력/seed 충돌·storage policy 변형·동시 schema 변경·PIN 변형 추가 검사.
- 실제 Chromium 학생용이 아닌 `/setup` 설치 UI 신규 3건: legacy missing history→실제 로컬 DB upgrade→5단계; latest missing history→write 0→5단계; unknown drift→4단계 차단. OAuth 제공자·외부 Edge만 합성이고 installer HTTP/orchestrator/DB SQL/UI는 실제 경로다.
- 최종 전체 단위 검사 677/677 PASS (skip 0, fail 0), installer 상태 검사 23/23 PASS. PR의 최종 CI도 별도로 확인한다.
- 전체 주요/installer browser 64/64 PASS. Typecheck / strict installer TypeScript / lint / build / Edge / security PASS. 테스트 삭제·skip·기대값 완화 없음.
- 스크린샷 `legacy-installed`, `legacy-final`, `latest-final`, `drift-final`을 직접 열어 검토했다. 4→5단계/버튼 상태/안전 진단이 정상이다. 증거는 gitignored `qa/installer/runtime/2026-10-06_기존설치복구/`에 보존한다.

이 검증은 해당 교사의 실제 DB 완료 판정이 아니다. 배포 후 그 교사는 설치 화면 새로고침 → 설치 확인 → 기존 설치 계속하기(필요 시) → 교사 확인으로 계속 순서로 한 번 재시도한다. project ref 추가 전달이나 전체 재설치를 요구하지 않는다.
