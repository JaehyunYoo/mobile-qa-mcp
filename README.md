# flutter-mobile-qa-mcp

Flutter 앱 QA 용 MCP 서버. [mobile-mcp](https://github.com/mobile-next/mobile-mcp)(앱 밖: 화면 읽기·탭·시스템 창)와
Dart MCP(`dart mcp-server`, 앱 안: 입력·위젯·런타임 에러)를 자식 프로세스로 띄우고, 둘을 묶은 **복합 도구**와 **요약 응답**을 제공한다.

## 왜 묶나
- `qa_read_screen`: 수천 줄 요소 목록을 서버 안에서 "보이는 텍스트·버튼 상태·좌표" 몇 줄로 요약 → 토큰 절약
- `qa_type`: mobile 로 포커스 → Dart `enter_text` → 값 확인을 한 번에(실기기 iOS 는 Flutter 입력칸에 키보드가 안 떠서 mobile 입력이 반영되지 않음)
- `qa_tap`: 접근성 이름 → 없으면 Flutter 위젯(텍스트·툴팁)으로 대체, 위험 단어(삭제·탈퇴·로그아웃·결제)는 `allowDanger` 없이 차단

## 도구
| 도구 | 설명 |
|---|---|
| `qa_connect` | 기기 선택 + DTD 연결 + frame sync off(`logFile` 에 `flutter run --print-dtd` 로그 경로) |
| `qa_read_screen` | 화면 요약(filter 가능) |
| `qa_tap` / `qa_tap_xy` | 텍스트/좌표로 탭, 탭 후 화면 요약 반환 |
| `qa_type` | 입력칸에 글자 입력 + 확인 |
| `qa_expect` | present / absent / enabled / disabled 검증 |
| `qa_dismiss_system` | 권한·추적·홈 팝업 창 규칙대로 닫기 |
| `qa_swipe` | 스크롤·당겨서 새로고침 |
| `qa_screenshot` | 이미지 |
| `qa_errors` | Flutter 런타임 에러 + 기기 크래시 |
| `qa_launch` | 앱 실행/재실행 |

## 요구 사항
- Node 20+, Xcode 명령줄 도구(iOS), Android platform-tools(Android)
- 실기기 iOS: mobilecli 에이전트 설치(`mobilecli agent install --device <id> --provisioning-profile <와일드카드 개발 프로필>`)
- 앱을 flutter_driver 확장을 켠 entry 로 실행: `enableFlutterDriverExtension()` 후 원래 main, `flutter run --print-dtd`

## 설치
```
npm install && npm run build
claude mcp add flutter-mobile-qa --scope project \
  -e QA_PROJECT_DIR=/path/to/flutter/project \
  -- node /path/to/flutter-mobile-qa-mcp/dist/index.js
```
환경 변수: `QA_DEVICE`(기기 id), `QA_PROJECT_DIR`, `QA_DART_CMD`(기본 `fvm dart mcp-server`), `QA_MOBILE_MCP`(기본 `@mobilenext/mobile-mcp@1.0.5`).

## 한계
- 아이콘만 있는 버튼은 접근성 이름이 없으면 `qa_tap_xy`(좌표) 필요 → 앱에 `Semantics`/`tooltip` 을 달면 해결
- 웹뷰(OAuth 로그인 등) 내부는 요소로 안 잡힘 → 좌표
- 시스템 창 규칙(`qa_dismiss_system`)과 위험 단어는 현재 한국어 UI 기준
