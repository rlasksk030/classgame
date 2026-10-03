# 실사용 적용 직전 검증 자료

판정: **추가 보정 필요 / 실제 적용 금지**. 고정 runtime source는 PR #4 HEAD `5a90a242925e2d62af0376f6e99d9416c21248e4`입니다. 이 별도 branch는 운영 적용이나 PR #4 반영을 하지 않습니다.

- 최소 delta는 `sql/20261003051402_actual_use_required_progress_delta.sql`입니다. 공식 CLI migration new로 생성했던 이름을 유지합니다. `supabase/migrations` 밖에 두어 installer 자동 발견을 막습니다. 운영에서 실행할 파일명은 비공개 패키지의 APPLY.sql입니다.
- build-checks.mjs는 비공개 current/expected catalog에서 READ ONLY PRECHECK/POSTCHECK를 생성합니다. snapshot·실사용 row counts·원본 API backup은 Git에 넣지 않습니다.
- run-local.mjs는 private schema metadata와 private old API source를 받아 새 합성 DB를 만듭니다. auth.users는 로컬 provider stub입니다. 실제 Supabase에는 연결하지 않습니다. 실제 학생 자료는 사용하지 않습니다.
- edge-bundle.mjs는 현재 소스에서 source closure를 다시 계산하고 고정 검토 hash와 일치해야 통과합니다. student-auth = NO CHANGE.
- installer-gate.mjs는 수동 delta 후에도 generic installer가 과거 compatibility를 PENDING으로 판단함을 재현합니다. 이 gate는 배포 승인 PASS가 아니라 **안전하게 실행을 차단하는 테스트 PASS**입니다.

로컬 실행은 app 디렉터리에서 Node 24.14.1, lockfile의 PGlite 0.5.8로 수행했습니다. 예시는 private 경로를 직접 지정해야 하며 production URL/credential을 넣지 않습니다.

```sh
node qa/live-required-progress/run-local.mjs PRIVATE_CATALOG.json PRIVATE_NORMALIZED_OLD_API_DIR PRIVATE_OUTPUT_DIR
node --experimental-strip-types qa/live-required-progress/edge-bundle.mjs PRIVATE_EDGE_OUTPUT_DIR
node qa/live-required-progress/inventory.mjs PRIVATE_CALL_INVENTORY.json
node --experimental-strip-types qa/live-required-progress/installer-gate.mjs PRIVATE_CATALOG.json PRIVATE_GATE_RESULT.json
```

합성 계약 21개 + PRE/POST 검사 6개 + installer 중단 gate 1개 = 28개 PASS. 여러 학생 격리, 12차시 필수/자기평가 분리, 첫 적용 도중 schema/row rollback, 두 번째 적용을 명시적으로 검증했습니다. 보호 table 21개의 전체 합성 원본 필드와 기존 progress의 완료 외 필드를 보존합니다.

합성 DB는 PostgreSQL 18.3이고 운영 엔진은 17.6입니다. 실제 인증 smoke는 NOT_RUN입니다. 현재 ACTIVE metadata 두 함수·auth 원본 backup·최신 aggregates·secrets 이름 목록은 BLOCKED입니다. 전체 승격 순서의 installer reconnect/update 단계도 BLOCKED입니다.

실제 ID와 클릭 경로는 로컬 전용 가이드를 사용합니다. 공개 가이드 placeholder는 실행용 값이 아닙니다. 과거 migration 전체 replay/history repair/auth·secrets 변경은 금지입니다.
