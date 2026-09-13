PHASE 4B: PARTIAL
IMPLEMENTATION: PARTIAL
STATIC_TESTS: PASS
BROWSER: BLOCKED
REMOTE: NOT_VERIFIED

## 시작 상태

- 브랜치: `feature/spatial-math-redesign-v1`
- 시작 HEAD: `df62b01abc0100db80216459cf94f84ae14b87f3`
- 기존 수정·미추적 QA 자료는 보존했다.

## 이번 보완

- [요구사항 대응표](./PHASE4_REQUIREMENTS_MATRIX.md)를 작성해 구현·검증 상태를 분리했다.
- 10·11차시 프로젝트 localStorage 키에 installation/class/student 범위를 적용해 공유 기기에서 상태가 섞이지 않게 했다.
- 10차시 Builder에 기존 reward material picker를 연결하고 appearance를 작품 상태에 포함했다.
- 블록이 4층 이상이면 층별 메모 입력을 동적으로 늘린다.
- 12차시 투영·층별 격자를 실제 입력 Renderer로 연결하고, 공통 6 + 맞춤 4 순서를 안정화했다.
- 10차시 재료 선택을 작품 상태의 `activeMaterial`로 유지해 다음 배치 블록·보관함 표시가 같은 재료를 사용하도록 연결했다.
- Builder Undo/Redo 스냅샷에 좌표와 외형을 함께 담고, 재료만 바꾼 작업도 이력에 포함했다.
- 기존 저장 작품을 읽을 때 외형·활성 재료를 안전하게 정규화해 누락된 이전 데이터는 원목으로 복원한다.

## 차시별 결과

- 9차시: 기존 학생 제작·게시 UI와 activity API 경로가 존재한다. 순수 계약에서 10개/범위/학급 격리/중복 제출을 확인했다. 독립 브라우저 다중 사용자 실제 조작은 BLOCKED.
- 10차시: Phase 4 경로는 10×10으로 시작하고 12×12 확장을 제공한다. 재료 선택은 Builder에 연결됐다. 서버 저장, 원격 보상 해금, 4층 이상 브라우저 조작은 미검증.
- 11차시: 동일 scoped 프로젝트와 외부 표현 자료를 읽는다. 층별 메모는 입력 가능하다. 실제 PDF·이미지 export와 점유 셀별 용도 zone은 미구현.
- 12차시: 공통 6 + 맞춤 4, 방향·숫자·투영·층별 답안 UI와 자기평가를 제공한다. 서버 progress·피드백 단계는 미연결.

## 검증

- `npm test`: PASS, 104개
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run typecheck:edge`: PASS (현재 작업 트리)
- `npm run test:security`: PASS (현재 작업 트리)
- `npm run build`: PASS
- Phase 4 Playwright: 실행하지 못함. 자동 승인 검토 사용량 한도 초과가 동일하게 적용되어 BLOCKED. 승인 우회·반복 시도 없음.

## 남은 BLOCKED / 미구현

- 실제 학생 A/B/C·교사 독립 context의 9차시 게시·풀이·점수·숨김.
- 실제 10×10 네 모서리, 12×12 확장, 고층 작품, 재료 Undo/Redo, 저장 복원 화면.
- 11차시 한 장 PDF·이미지 파일 생성 및 렌더링 검사.
- 12차시 오답→힌트→정답 공개, 서버 저장·교사 집계.
- 실제 Supabase 저장·공유·권한 집행·다기기 복원.
- iPad/Safari와 교사용 간편 설치.

## 안전 경계

원격 Supabase, migration, Edge Function, Cloudflare, push, 운영 데이터는 변경하지 않았다.

## Git

- 시작 HEAD: `df62b01abc0100db80216459cf94f84ae14b87f3`
- 문서 갱신 직전 HEAD: `11de076` (정적 검사는 이 커밋 이후 작업 트리 기준)
- Phase 4B 문서·계약 커밋: `cdeb585f96021ca65b028f9853ebbe31022deec4`, `aea2f449296427376166825df74a862b074418fa`, `11de076`
- 이번 Builder 외형 이력 보완은 기존 작업 트리의 미커밋 파일에 적용했으며, 기존 변경과 섞이지 않도록 별도 커밋하지 않았다.
- 기존 미커밋 변경·QA 자료는 포함하거나 삭제하지 않고 보존했다.
