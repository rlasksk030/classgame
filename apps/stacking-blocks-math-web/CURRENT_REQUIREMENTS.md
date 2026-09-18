# 현재 요구사항 기준표

## INSTALL_EASY — 다른 교사용 최종 배포판 필수 완료 조건

- **미구현 / 최종 완료 차단**. READY 판정 개선과 별개이며 실제 제거한 교사 수동 작업 **0개**.
- 계정 연결 → 학급 이름·학생 명단 붙여넣기 → 학생 링크·QR → 학생 로그인·첫 저장·재접속 복원을 목표로 한다.
- 일반 교사에게 터미널/GitHub/SQL/함수 배포/env 편집/관리 토큰·서버 비밀키 복사를 요구하지 않는 설치 실행부가 필요하다. 설치 중단 이어하기·재시도·다른 기기 재연결·학생/PIN/진도/작품 보존 업데이트를 포함한다.
- 기존 DISTRIBUTION_ARCHITECTURE의 권장 실행안 한 개(제작자 운영 Supabase OAuth 실행부)를 재사용한다. 중앙 실행부 도입·권한·비밀 보관·비용 승인 전 생성/배포하지 않는다. 현재 교사 Auth 계정 수동 생성까지 완전히 없앤 실행안은 아니므로 목표 충족으로 표시하지 않는다.
- 최종 검증은 개발 경험 없는 다른 교사가 제작자 실시간 도움 없이 신규 설치와 저장·복원에 성공한 경우다. 신규 설치/업데이트 실제 검증 NOT_RUN. 학습 QA PASS만으로 전체 완료 금지.


## 2026-09-12 실제 35문항 / 설치 실행안 후속

- 시작 HEAD 875229a. 기존 READY 수정·b7ae120 생성기 수정을 이번 신규 성과로 다시 계산하지 않는다.
- L5-SET: 실제 DB 34 generated 행(17code×2)+기본 추가1=35, 배정20. 저장seed603756/반환seed595837 불일치, 원격 student-api v4 확인. 실제 화면35개 순회, 11번 복귀, 답 제출 없음. DB 공개 과제6개/35이며 정확한 동일코드 두 ID의 화면 순서는 DOM표식 부재로 미확정. 상세 `qa/practice-sets/2026-09-12-live-investigation/`.
- L5-RECOVERY: 기존 코드 수정 위에 practiceSet 계약2/서버 버전 불일치 안내/기본 추가량과 배정량 분리 표시/읽기 실패 보존을 추가. 새세트 전환이 없는 구서버에서 성공처럼 안내하지 않는다. 저장seed에 세트가 없고 기존 기본seed 세트가 남은 경우 기존 화면을 유지한다. 명시적 새 세트 시작 후에만 다음seed의 v2세트로 연결; 원격 배포 및 실제 복구는 승인 전 NOT_RUN.
- L5-POSITION: 직접 practice 재접속 때 단계 내 서버 위치를 복원. 학생·설치가 다른 임시 답안/위치를 섞지 않고 구 unscoped 저장소는 삭제하지도 자동 이관하지도 않는다. 화면 검증 미완료.
- INSTALL-PLAN: 권장안은 제작자 소유의 별도 Supabase Free 설치 실행부 하나. 구체적인 제작자/교사 준비·scope·비용·재개·승인 범위를 DISTRIBUTION_ARCHITECTURE 첫 절에 기록. 교사 Auth Dashboard 생성은 초기안에 남으며 완전 3단계 완료가 아니다. 실제 수동 감소0/목표5묶음. 새 중앙 실행부 예외 승인 전 미운영.
- 실제 브라우저에 접근해 구버전 오류를 재현한 사실과, 최신 변경을 production/원격에서 검증한 결과를 구분한다. 포트 제한을 현재 운영 UI의 오류 원인으로 기록하지 않는다.

## 교사용 간편 설치·업데이트 (2026-09-12 추가)

이번 메시지의 10개 요구를 통합한다. attachments 검색에서 해당 제목의 별도 첨부 전문은 찾지 못했다. R01~R06, 학습·채점·3D·자동 QA 요구는 유지하며 설치 작업으로 대체하지 않는다.

### Phase 7 구현 상태 (2026-09-13)

기존 `/setup` 경로를 8단계 설치 마법사로 확장했다. 연결 확인, 설치 위치 이어하기, 교사 Auth 로그인, 학급 생성/선택, 학생 명단 일괄 생성, 학생 로그인 smoke, 학생 접속 링크 복사를 기존 API 경로에 연결했다. 실제 수정은 `src/pages/SetupPage.tsx`, `src/lib/installer.ts`, `src/styles/index.css`, `tests/installer.test.ts`에 있다.

다만 정적 SPA와 공개 Publishable key만으로 migration·Edge Function·APP_SESSION_SECRET을 자동 설치할 수는 없다. 이번 Phase 7B에서 브라우저 번들에 포함되지 않는 `scripts/installer/` 실행 계약·Supabase Management API 어댑터·재개 가능한 오케스트레이터·합성 백엔드와, 관리 토큰을 받지 않는 `src/lib/installerClient.ts`를 추가했다. Phase 7C에서는 앱별 `InstallerManifest`, OAuth 우선 공개 연결 경계, 별도 실행 장소용 `scripts/installer/http-server.ts`를 추가하고 면담실 참고 구조를 조사 문서로 분리했다. 실제 OAuth 앱/installer backend 배포와 원격 설치는 승인 전 실행하지 않았으므로 INSTALL-01/03/04/05의 실제 자동화·신규 설치 관통 검증은 PARTIAL/BLOCKED로 유지한다. 관리 토큰이나 service_role을 브라우저에 넣는 우회는 금지했다. 이번 변경으로 실제 교사 외부 수동 작업을 제거한 수는 0개이며, 상세 결과는 `qa/installer/INSTALLER_REPORT.md`에 기록한다.

| 요구 ID | 최신 요구 | 폐기한 이전 요구 | 실제 구현 파일 | 완료 확인 방법 | 상태 |
|---|---|---|---|---|---|
| INSTALL-01 | 처음 시작하기→우리 반 만들기→수업 시작; 기본 설치에서 터미널/SQL/GitHub/함수 배포/env/관리 토큰 복사 제거 | 외부 수동 준비를 3단계 뒤에 숨김 | `src/pages/SetupPage.tsx`, `src/lib/installer.ts`, `scripts/installer/*` | 빈 프로젝트 실제 교사 작업 기록 | PARTIAL: 실행 계약·Management API 어댑터는 로컬 구현, 교사에게 제공되는 backend 없음 |
| INSTALL-02 | 공개 설정 연결과 설치 완료를 구분 | 설정/학급만으로 READY | src/lib/distribution.ts, src/pages/SetupPage.tsx | 선행 조건·학생 로그인·저장·복원 누락 시 READY 금지 | IMPLEMENTED |
| INSTALL-03 | OAuth API·권한·실행 장소·비용 확인 후 자동화 | 브라우저에 관리 토큰·Secret 요구 | `scripts/installer/management-api.ts`, DISTRIBUTION_ARCHITECTURE.md | 공식 API 대조 및 실행부 승인 | PARTIAL: 서버 전용 Management API 호출 계약, OAuth 등록·배포 미실행 |
| INSTALL-04 | 재설치·업데이트·재개 시 기존 학생/PIN/진도/작품/Secret 보존 | SQL 전체 재실행·Secret 재생성 | `scripts/installer/orchestrator.ts`, `scripts/installer/fake-backend.ts` | 원격 이력/해시 비교·중단 복구 | PARTIAL: idempotent 로컬 오케스트레이터, 원격 상태 검증 미실행 |
| INSTALL-05 | 교사 인증→학급/학생 생성→학생 인증→첫 활동 저장→새 세션 복원까지 완료 확인 | 연결 성공 화면만 제공 | `src/pages/SetupPage.tsx`, `src/lib/installer.ts`, `src/lib/distribution.ts`, `scripts/installer/*` | 실제 신규 설치·업데이트 관통 증거 | PARTIAL: 기존 마법사와 실행 계약 연결, 실제 신규/업데이트 관통 검증 BLOCKED |

설계·구현·LOCAL_LOGIC·UI_WITH_TEST_DATA·실제 신규 설치·실제 업데이트를 각각 보고한다. 점검 플래그는 실제 서버 검증 증거를 대신하지 않는다.

이 문서는 2026-09-12 최신 사용자 지시를 기준으로 작성했다. 상태는 코드/단위 검증과 실제 브라우저·Supabase 검증을 구분한다.

### Phase 7E 배포 준비 (2026-09-13)

`scripts/installer/runtime.ts`와 `start.ts`는 TEST 전용 Node 실행부의 시작 계약을 제공한다. 허용 project ref/origin, 운영 ref 차단, 서명된 HttpOnly 세션, 짧은 TTL, PAT 메모리 보관을 검증한다. `qa:installer:remote`는 실제 실행 시에만 환경변수의 TEST PAT를 사용하고 안전한 상태 artifact만 남긴다. 이는 배포 준비 상태이며 HTTPS 호스트·도메인·권한·비용 승인이 없어 `INSTALL-03/04/05`의 LIVE 완료나 교사 수동 작업 감소로 계산하지 않는다. QR encoder와 `/setup`의 실제 remote 연결은 미구현/미검증이다.

| 요구 ID | 최신 요구 | 폐기한 이전 요구 | 실제 구현 파일 | 완료 확인 방법 | 상태 |
|---|---|---|---|---|---|
| DIR-01 | 이 단원의 ‘옆’은 오른쪽에서 본 모양이다. | 화면 오른쪽 면을 옆으로 해석하는 표현 | `shared/blocks.ts`, `shared/spatialConventions.ts`, `src/features/block-world/BlockScene.ts` | 비대칭 fixture의 오른쪽 투영·side 계산·카메라 버튼을 독립 확인 | VERIFIED_LOCAL (브라우저 BLOCKED) |
| DIR-02 | 옆 자료와 답안은 오른쪽 관찰 기준을 사용하고 한글 기준을 안내한다. | side enum/영문 표시만으로 완료 처리 | `src/pages/LessonPage.tsx`, `src/features/activities/Representations.tsx`, `shared/problemPresentation.ts` | DOM 자료·제목·답안 격자 확인 | IMPLEMENTED (브라우저 BLOCKED) |
| DIR-03 | 위·높이 지도·층별 지도·답안 격자는 앞/옆 기준을 일관되게 표시한다. | 3D 판 바깥 화살표와 2D 관찰자 화살표 혼용 | `src/features/activities/ProjectionGrid.tsx`, `src/styles/index.css`, `src/components/world/BlockWorld.tsx` | 3·4·8·12차시 자료의 방향 표식 스크린샷 | BLOCKED |
| REWARD-01 | XP는 실제 해금 가능한 보상에만 사용하고 별은 성취 기록으로 유지한다. | 화면에 XP/별 숫자만 표시 | `shared/rewards.ts`, `src/pages/RewardsPage.tsx` | 카탈로그 임계값 단위 테스트와 보상 공방 화면 | VERIFIED_LOCAL |
| REWARD-02 | 해금 재료는 10차시에서 새 블록·선택 블록에 실제 적용되고 저장/복원된다. | 보상 화면만 있고 건축 화면에서 사용할 수 없음 | `src/components/world/BlockWorld.tsx`, `src/features/block-world/BlockScene.ts`, `src/pages/ArchitecturePage.tsx`, `supabase/migrations/202609110016_rewards_loadout.sql` | 재료 선택→배치/기존 블록 적용→저장→11차시 복원 | IMPLEMENTED (실제 Supabase/브라우저 BLOCKED) |
| ARCH-01 | 신규 10차시 기본 작업판은 10×10×3이며 기존 5×5·8×8 작품은 보존한다. | 8×8을 신규 기본값으로 보고하거나 4×4를 기본으로 사용 | `shared/activities.ts`, `supabase/schema.sql`, `supabase/migrations/202609110016_rewards_loadout.sql` | 신규 EMPTY_BUILDING와 서버 기본값·좌표 경계 테스트 | VERIFIED_LOCAL |
| ARCH-02 | 큰 화면에서 넓은 판과 문제 자료를 함께 보여주며 내용을 숨기지 않는다. | 카메라 확대만으로 작은 판을 크게 보이게 처리 | `src/pages/ArchitecturePage.tsx`, `src/styles/index.css` | 1366×768 실제 화면 캡처 | BLOCKED |
| DATA-01 | 외형 metadata는 좌표/개수/투영/채점과 분리한다. | 외형을 수학 정답 데이터에 포함 | `shared/activities.ts`, `shared/rewards.ts`, `shared/grading.ts` | 외형 변경 전후 동일 좌표 채점 테스트 | VERIFIED_LOCAL |
| DATA-02 | 보상/작품 저장은 서버에서 잠금과 권한을 재검증한다. | 클라이언트 XP 또는 외형 값을 신뢰 | `student-api/index.ts`, `supabase/functions/_shared/activities.ts`, `supabase/migrations/202609110016_rewards_loadout.sql` | Edge typecheck, RLS/security 테스트, 실제 RPC 검증 | IMPLEMENTED (원격 migration BLOCKED) |
| QA-01 | generator와 grader 동일 함수 비교만으로 PASS하지 않고 고정 기대값·실제 화면을 분리한다. | 무작위 seed 결과만으로 화면 기능 완료 처리 | `tests/activities.test.ts`, `scripts/audit-*.ts`, `QA_REPORT.md` | 고정 fixture·audit·브라우저 캡처를 별도 기록 | IMPLEMENTED (브라우저 BLOCKED) |
| QA-02 | 운영자 맥에서 실행 가능한 합성 데이터 브라우저 QA 명령을 제공한다. | 샌드박스에서 반복 실패하거나 존재하지 않는 명령 안내 | `package.json`, `e2e/`, `QA_CHECKLIST.md` | 명령 실제 실행 및 캡처 산출물 확인 | BLOCKED |

## 판정 원칙

- `IMPLEMENTED`: 코드 경로가 존재하나 화면 또는 실제 서버 관통 확인이 남아 있다.
- `VERIFIED_LOCAL`: 현재 커밋에서 자동 검사/순수 로직 검증이 통과했다.
- `VERIFIED_LIVE`: 실제 브라우저 또는 실제 Supabase에서 현재 커밋을 확인한 경우에만 사용한다.
- `BLOCKED`: 환경 제약으로 증거를 만들지 못한 경우다. 과거 커밋의 PASS는 현재 검증으로 재사용하지 않는다.
- `NOT_STARTED`: 코드 경로가 아직 없다.

현재 브라우저 QA는 이 환경의 Vite/Playwright 포트 바인딩 제한으로 BLOCKED다. 원격 migration 016 적용과 Supabase 관통 검증도 운영자 승인·접속이 필요한 별도 작업이다.

## 긴급 학생 화면 오류 기준 (2026-09-12)

| 요구 ID | 최신 요구 | 폐기한 이전 요구 | 실제 구현 파일 | 완료 확인 방법 | 상태 |
|---|---|---|---|---|---|
| R01 | 3차시 그리기 문항은 실제 입력 격자를 mount하고, 면 정보가 없으면 제출/오답을 막는다. | `gridSpec` 데이터만 있으면 화면도 정상이라고 판정 | `src/pages/LessonPage.tsx`, `shared/problemPresentation.ts` | Renderer 계약 및 실제 DOM QA (`qa:renderer`) | IMPLEMENTED (브라우저 BLOCKED) |
| R02 | 5차시 정보 충분성 선택과 ‘숨은 블록 없음’ 숫자 세기를 분리한다. | 앞모습 자료를 원본 3D 총개수로 채점 | `shared/seedProblems.ts`, `shared/practiceGenerator.ts`, `shared/grading.ts` | 고정 대표값·생성 seed 독립 테스트 | VERIFIED_LOCAL |
| R03 | 답안 유형에 맞는 정답 공개/후속 활동만 제공한다. | 모든 오답에 ‘다시 쌓기’ 공통 문구 | `shared/attempts.ts`, `supabase/functions/student-api/index.ts`, `src/pages/LessonPage.tsx` | 비쌓기 `requiresRebuild=false`, 쌓기 재구성 상태 기계 | VERIFIED_LOCAL |
| R04 | 학생 표시는 `앞`·`옆`으로 단순화하고 기준 안내를 짧게 제공한다. | `앞쪽 경계`·긴 관찰자 문구 반복 | `src/components/world/BlockWorld.tsx`, `src/components/world/ProjectionGrid.tsx`, `src/pages/LessonPage.tsx` | 소스/DOM 문자열 및 화면 캡처 | IMPLEMENTED (브라우저 BLOCKED) |
| R05 | 보관함은 세 면이 맞붙은 닫힌 정육면체이며 기존 드래그·탭 배치를 유지한다. | 펼쳐진 CSS 전개도 형태 | `src/components/world/BlockWorld.tsx`, `src/styles/index.css` | SVG 꼭짓점 검사·화면 조작 | IMPLEMENTED (브라우저 BLOCKED) |
| R06 | 학생 단계는 `① 개념 배우기 → ② 문제 풀기 → ③ 더 풀어보기`이며 각 단계가 실제 URL·본문·문항으로 분리되고 위치를 보존한다. | `전체 학습 / 개념 익히기 / 개념 확인` 혼합 표시, 버튼만 바뀌는 단계 전환 | `src/pages/LessonLearnPage.tsx`, `src/pages/LessonPage.tsx`, `src/pages/StudentWorld.tsx`, `src/App.tsx` | `/learn` 안내 활동, `/solve` 입력·채점, `/practice` 반복 문제의 직접 접속·전환·새로고침과 단계별 문항/입력 복원 | IMPLEMENTED (정적 검사 통과, 브라우저 BLOCKED) |
