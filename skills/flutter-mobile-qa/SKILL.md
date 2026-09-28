---
name: flutter-mobile-qa
description: 모바일 앱(직접 만든 앱·다른 회사 앱 모두, Flutter 최적화·네이티브 iOS·Android·React Native 가능)을 실기기·시뮬레이터에서 직접 조작하며 QA 할 때 사용. "QA 해줘", "시나리오 짜줘", "이 기능 테스트해줘", "화면 돌아보면서 이상한 곳 찾아줘", "QA 결과 정리해줘" 같은 요청. flutter-mobile-qa MCP 서버(qa_* 도구)가 연결돼 있어야 한다.
---

# 모바일 앱 QA (Flutter 최적화)

flutter-mobile-qa MCP 의 도구(qa_*)로 QA 를 진행한다. 요청을 네 가지 중 하나로 분류해 해당 절차를 따른다.

| 요청 | 절차 | MCP 프롬프트 |
|---|---|---|
| "시나리오 짜줘", "무엇을 테스트해야 해?" | 계획 | `plan_qa` |
| "이 시나리오 돌려줘", "QA 해줘"(시나리오 있음) | 실행 | `run_qa` |
| "돌아다니면서 이상한 곳 찾아줘" | 탐색 | `explore_qa` |
| "결과 정리해줘", "출시해도 돼?" | 보고 | `report_qa` |

시나리오가 없는데 "QA 해줘" 라고 하면: 먼저 **계획**으로 시나리오를 만들어 보여 주고, 사용자가 확인하면 **실행**.

## 공통 원칙
0. **먼저 `qa_doctor`.** 환경 문제를 앱 버그로 오판하지 않게. 앱 ID 를 모르면 `qa_apps`. 소스가 없는 앱이면 `plan_qa` 는 블랙박스(화면 둘러보기) 방식.
1. **기기 조작 전에 확인받는다.** 무엇을 할지, 데이터가 바뀌는지, 위험 단계(삭제·결제·로그아웃)가 있는지 요약해서 묻는다.
2. **읽고 → 판단 → 조작 → 검증.** 좌표를 외워 누르지 말고 매번 `qa_read_screen` 결과로 판단(ref·id 우선). 고정 대기 대신 `waitFor`/`timeoutMs`. 실행은 `qa_run_start` → `qa_step` → `qa_run_end` 로 기록.
3. **텍스트 우선.** 화면 확인은 `qa_read_screen`(filter), 이미지는 레이아웃·색 확인과 FAIL 증거에만.
4. **만든 데이터는 정리.** 입력값은 "QA 테스트 {날짜}" 처럼 찾기 쉽게.
5. **사람에게 넘길 것**: 비밀번호·인증 코드·Face ID·개인 계정 선택·결제 확정.
6. **끝나면 `qa_finish`** 로 기기 에이전트를 정리한다(iOS 'Automation Running' 표시 해제).
7. **FAIL 은 원인을 구분**: 앱 버그 / 시나리오 오류(화면이 바뀜) / 환경(연결·권한·데이터 없음).

## 형식
- 시나리오 형식: MCP 리소스 `qa://guides/scenario-format` (저장소 `guides/SCENARIO_FORMAT.md`)
- 예시: `qa://guides/example-schedule-create`
- 저장 위치: 앱 저장소 `qa/scenarios/<기능>-<번호>.md`, 실행 결과는 같은 파일 끝에 표로 추가

## 준비가 안 됐을 때
- `qa_connect` 가 Dart 미연결 → 글자 입력이 필요한 시나리오는 사용자에게 `flutter run -t <driver entry> --print-dtd > 로그` 실행을 요청
- 기기 없음/에이전트 오류 → README 7장(문제 해결) 안내
