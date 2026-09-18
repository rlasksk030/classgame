# Easy Setup 구조 비교

면담실 구현 원문을 현재 환경에서 확인하지 못했으므로, AI 면담실 열은 `NOT_FOUND`로 기록한다. 수학 열은 현재 코드와 테스트에 근거한다.

| 항목 | AI 면담실 참고 | 수학 현재 | 최종 통합 방향 |
|---|---|---|---|
| 관리 인증 | NOT_FOUND | OAuth state/PKCE 계약, PAT는 backend 입력 계약 후보 | OAuth 우선, PAT는 개발·복구 fallback |
| 설치 backend | NOT_FOUND | Management API adapter + orchestrator 로컬 구현 | 별도 승인 backend, Cloudflare 정적 유지 |
| credential 저장 | NOT_FOUND | `EphemeralCredential`, 브라우저는 HttpOnly session만 | 메모리/짧은 TTL 암호화 저장 |
| migration | NOT_FOUND | source migration plan, 누락분 순차 적용 계약 | app manifest의 001~017만 적용 |
| Function deploy | NOT_FOUND | student-auth/student-api hash 비교·probe 계약 | allowlist된 두 함수만 배포 |
| Secret | NOT_FOUND | APP_SESSION_SECRET 미존재 때만 서버 생성 계약 | 값은 브라우저·로그에 반환하지 않음 |
| 상태·복구·업데이트 | NOT_FOUND | 단계별 state와 idempotent fake 검증 | 실제 원격 상태 재조회 후 재개 |
| 교사·학급·학생 | NOT_FOUND | 기존 Supabase Auth/teacher API 재사용 | 설치 backend와 런타임 데이터 분리 |
| PIN·QR | NOT_FOUND | PIN은 기존 vault, QR은 링크 복사만 구현 | QR encoder 승인·구현 필요 |
| AI API | 면담실 전용 추정, 확인 불가 | 사용하지 않음 | 수학 manifest에서 제외 |
| 완료 판정 | NOT_FOUND | 실제 원격 설치·smoke는 미검증 | status + teacher/student smoke 증거 필요 |
| 보안 | NOT_FOUND | production guard, redaction, no public secret | 공통 backend에서도 동일 경계 유지 |

## 결론

현재 확인 가능한 공통화 범위는 관리 인증 계약, project binding, 단기 자격 증명, 단계별 설치 상태, migration/function/Secret orchestration이다. 면담실 전용 Worker·Durable Object·AI 자원은 근거 없이 재사용하지 않는다. 실제 통합은 참고 소스 접근과 backend 운영 승인 이후의 별도 단계다.
