# 공간과 입체 품질 게이트

이 문서는 현재 학생에게 제공되는 모든 문항과 활동을 검사할 때 적용한다. 숫자를 많이 생성한 것과 실제 학생이 풀 수 있음을 같은 결과로 취급하지 않는다.

## 검사 대상

- 1~8차시와 12차시의 고정 문항, 개념·확인·추가 단계
- 모든 practice template의 대표 seed와 실제 배정 seed manifest
- 9차시 친구 문제 만들기·힌트·친구 풀이
- 10차시 건축 설계, 11차시 소개서, 12차시 자기평가
- 교사 제작·학습지 가져오기 문항이 학생 route에 연결되는 경로

각 항목은 `lessonId`, `stage`, `problemId/activityId`, `sourceType`, `templateId`, `generatorVersion`, 질문 의도, 제공 자료, 입력 방식, 채점 방식, 공개 방식, 완료 조건, route, 상태를 가진다. `PROBLEM_INVENTORY.json`은 현재 코드에서 생성하며, template 대표 목록과 별도로 이번 버전 수업용 15/20문제 `assignmentManifest`를 기록한다.

## 상태

- `NOT_STARTED`: 검사 경로가 아직 없다.
- `IMPLEMENTED`: 코드 경로는 있으나 화면 또는 서버 관통 증거가 없다.
- `VERIFIED_LOCAL`: 현재 commit의 순수 로직·자동 검사·단위 테스트가 통과했다.
- `VERIFIED_LIVE`: 현재 commit을 실제 브라우저 또는 실제 Supabase에서 확인했다.
- `BLOCKED`: 권한·환경 제약으로 증거를 만들지 못했다.

## 통과 조건

1. 문제 문구, 자료, Renderer, 제출 payload, grader, 피드백이 같은 답안 계약을 사용한다.
2. 모든 그리기 문항에는 실제 셀 입력 UI가 mount된다. UI가 없으면 제출과 오답 증가를 막는다.
3. 고정 fixture의 기대 개수·격자·방향은 generator/grader 공통 함수와 독립적으로 확인한다.
4. 오답 1·2회, 3회 힌트, 힌트 후 오답 공개, 공개 후 재도전/재구성을 유형별로 확인한다.
5. 현재 문항은 problemId와 단계 범위로 유지하며 저장·복원·새 문제 세트에서 임의로 첫 문항으로 돌아가지 않는다.
6. 실제 학생 route와 교사 preview를 구분하고, 모의 API 검증은 LIVE로 보고하지 않는다.
7. 실제 브라우저·터치·Supabase를 확인하지 못한 항목은 반드시 `BLOCKED`로 남긴다.

## 권장 실행

```bash
npm run inventory:problems
npm run audit:problems
npm run audit:presentation
npm run audit:semantics
npm run audit:solvability
npm test
npm run test:security
npm run typecheck
npm run lint
npm run typecheck:edge
npm run build
npm run qa:visual
npm run qa:renderer
npm run test:e2e
npm run qa:local
```

브라우저 실행이 막히면 같은 실패를 반복하지 말고 운영자 맥에서 위 Playwright 명령을 실행한다. 테스트 계정·PIN·비밀키를 소스나 production 산출물에 넣지 않는다.

## 맥용 production 브라우저 실행기

`npm run qa:local`은 현재 앱 디렉터리와 HEAD를 기록하고, Vite production build를 만든 뒤 임시 loopback 포트에서 `vite preview`를 시작한다. 실행기가 시작한 preview만 종료하며, 기존 서버는 건드리지 않는다. Playwright Chromium으로 실제 학생 route와 Renderer를 열고 합성 student-api 응답을 사용해 셀 입력·숫자/선택 제출·5차시 제한·단계 전환·Builder 마우스/터치 드래그 저장·10×10 건축 복원을 검사한다.

결과는 `qa/local-browser-qa/report.json`, `qa/local-browser-qa/report.md`에 저장하고 성공/실패 캡처는 `qa/local-browser-qa/screenshots/`, preview 로그는 `qa/local-browser-qa/preview.log`, 실패 trace는 `qa/local-browser-qa/<case-id>.trace.zip`에 남긴다. `--headed` 또는 `QA_HEADED=1`로 운영자 맥에서 브라우저 창을 표시할 수 있다. 이 실행기는 `UI_WITH_TEST_DATA` 결과만 기록하며 실제 Supabase 성공으로 승격하지 않는다. inventory 전체는 중복 없는 총문항 수로 합산하지 않고 대표 브라우저 범위 밖을 NOT_RUN 후속 대상으로 명시한다.
