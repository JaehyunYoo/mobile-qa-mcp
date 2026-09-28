# flutter-mobile-qa-mcp

Flutter 앱을 **AI 에이전트(Claude Code 등)가 실기기·시뮬레이터에서 직접 조작하며 QA** 하도록 해 주는 MCP 서버입니다.

두 개의 MCP 서버를 안에서 띄워 묶습니다.

| 내부 서버 | 역할 | 잘하는 것 |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | **앱 밖**에서 본다 (OS 접근성 트리 + 스크린샷) | 화면 텍스트 읽기, 탭·스와이프, iOS 권한 창·알림 배너·웹 로그인 같은 **앱 밖 화면** |
| Dart MCP (`dart mcp-server`) | **앱 안**에서 본다 (실행 중인 앱의 VM 서비스) | **글자 입력**, 위젯 트리, Flutter 런타임 에러, 위젯 기준 탭 |

둘은 서로 못 하는 걸 채웁니다. 이 서버는 그 조합을 **도구 하나로 묶고, 응답을 요약**해서 호출 수와 토큰을 줄입니다.

```
AI 에이전트 ── flutter-mobile-qa-mcp ─┬─ mobile-mcp      ── 기기 (접근성 · 스크린샷 · 탭)
                                       └─ dart mcp-server ── 앱 (flutter_driver · 위젯 · 에러)
```

> 상태: 0.2.0. 두 내부 서버의 동작은 실기기(iPhone, iOS 26)와 시뮬레이터에서 검증했습니다.
> 이 서버의 복합 도구 자체로 끝까지 도는 시나리오 검증은 아직입니다.

---

## 목차
1. [무엇이 되고 무엇이 안 되나](#1-무엇이-되고-무엇이-안-되나)
2. [준비](#2-준비)
3. [설치와 등록](#3-설치와-등록)
4. [사용 방법](#4-사용-방법) — **처음이면 4-0 부터**
5. [도구 레퍼런스](#5-도구-레퍼런스)
6. [안전장치](#6-안전장치)
7. [문제 해결](#7-문제-해결)
8. [QA 가 잘 되게 앱을 다듬는 법](#8-qa-가-잘-되게-앱을-다듬는-법)

---

## 1. 무엇이 되고 무엇이 안 되나

실기기 QA 에서 실제로 해 본 결과입니다.

### 되는 것
| 작업 | 방법 | 비고 |
|---|---|---|
| 화면 텍스트·버튼·입력칸 값 읽기 | `qa_read_screen` | Flutter `Text`, Material 버튼, 입력칸이 이름으로 잡힘 |
| 텍스트 버튼·메뉴·하단 탭 누르기 | `qa_tap` | 예: "닫기", "약관 및 정책", "Google로 시작하기", 탭 "홈"·"캘린더" |
| iOS 권한 창 처리 | `qa_dismiss_system` / `qa_tap` | 알림·로컬 네트워크·추적 창 |
| 글자 입력 | `qa_type` | mobile 로 포커스 → Dart 로 입력 → 값 확인 |
| 버튼 활성/비활성·텍스트 존재 검증 | `qa_expect` | 예: 제목 입력 후 "저장" 버튼이 활성으로 바뀌는지 |
| 스크롤·당겨서 새로고침 | `qa_swipe` | |
| 앱 실행·재실행 | `qa_launch` | |
| 런타임 에러·크래시 확인 | `qa_errors` | |
| 푸시 탭·딥링크 라우팅 (시뮬레이터) | 셸의 `xcrun simctl push` / `simctl openurl` + 이 서버로 결과 확인 | 아래 [4-4](#4-4-푸시딥링크-테스트시뮬레이터) |

실제로 찾은 버그 예: 일정 시각이 9시간 어긋나 표시되는 문제를 `qa_read_screen` 텍스트 비교로 발견했습니다.

### 조건부로 되는 것
| 작업 | 조건 |
|---|---|
| **아이콘만 있는 버튼**(뒤로·닫기 X·설정 톱니·연필·휴지통) | 접근성 이름이 없으면 `qa_tap_xy`(좌표)로만 가능. 앱에 `tooltip`/`Semantics` 를 달면 `qa_tap` 으로 가능 → [8장](#8-qa-가-잘-되게-앱을-다듬는-법) |
| **웹뷰 안**(OAuth 로그인 페이지, 인앱 웹) | 요소가 안 잡혀 `qa_screenshot` 보고 `qa_tap_xy` |
| 글자 입력 | Dart 연결(`qa_connect`) 필요. 앱을 flutter_driver entry 로 실행해야 함 |

### 안 되는 것 (사람이 해야 함)
- 비밀번호·인증 코드 입력, Face ID, 개인 계정 선택
- 결제 확정, 스토어 로그인
- 홈 화면 위젯 실제 표시 확인, 실제 서버 푸시 수신 확인(시뮬레이터 `simctl push` 로 탭 라우팅까지는 가능)
- 화면 녹화(실기기 iOS 에서 파일이 남지 않았음)

### 주의할 점
- **한 번만 뜨는 오버레이**(첫 진입 가이드 Showcase, 이벤트 팝업)가 흐름을 막습니다. 시나리오는 "좌표를 외워서 누르기"가 아니라 **"화면을 읽고 → 판단해서 누르기"** 로 짜야 안정적입니다.
- 스와이프가 탭으로 인식돼 엉뚱한 카드가 눌릴 수 있습니다. 당겨서 새로고침은 `fromY` 를 화면 위쪽(헤더)으로.
- 시스템 창 규칙과 위험 단어 목록은 현재 **한국어 UI 기준**입니다.

---

## 2. 준비

### 공통
- Node.js 20+
- Flutter 프로젝트(fvm 사용 시 `QA_PROJECT_DIR` 로 프로젝트 루트 지정)

### iOS 시뮬레이터
- Xcode 명령줄 도구. 시뮬레이터 부팅(`xcrun simctl boot <udid>`)만 하면 됩니다.

### iOS 실기기
1. USB 연결, 잠금 해제, "이 컴퓨터 신뢰", 개발자 모드 켜기
2. **조작 에이전트 설치** (한 번. 프로필 만료 시 재설치)
   ```bash
   # mobile-mcp 가 받아 둔 mobilecli 경로
   MOBILECLI=$(ls ~/.npm/_npx/*/node_modules/@mobilenext/mobilecli-darwin-arm64/mobilecli-darwin-arm64 | head -1)
   $MOBILECLI agent install --device <기기 UDID> \
     --provisioning-profile "~/Library/Developer/Xcode/UserData/Provisioning Profiles/<와일드카드 개발 프로필>.mobileprovision"
   ```
   - 필요한 프로필: **App ID 가 `팀ID.*`(와일드카드)**, 개발용(`get-task-allow`), 이 기기 UDID 가 등록, 만료 전
   - 프로필 찾기: `security cms -D -i <파일>` 로 열어 `application-identifier` 와 `ProvisionedDevices` 확인
   - 폰 홈 화면에 에이전트 앱이 하나 생깁니다. 조작 중에는 상단 시계가 빨간색으로 보일 수 있습니다.

### Android
- `adb`(Android platform-tools): `brew install --cask android-platform-tools`, 에뮬레이터 또는 USB 디버깅 켠 기기

### 앱 쪽 준비 (글자 입력·위젯 기반 탭을 쓰려면)
flutter_driver 확장을 켠 **QA 전용 진입점**을 하나 둡니다. 스토어 빌드에는 쓰지 않습니다.

```yaml
# pubspec.yaml
dev_dependencies:
  flutter_driver:
    sdk: flutter
```
```dart
// lib/entry/entry_dev_driver.dart
import 'package:flutter_driver/driver_extension.dart';
import 'entry_dev.dart' as dev;

Future<void> main() async {
  enableFlutterDriverExtension();
  await dev.main();
}
```
실행할 때 **DTD 주소를 출력**하게 합니다.
```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <기기> --print-dtd > /tmp/qa_run.log 2>&1
# 로그에 "The Dart Tooling Daemon is available at: ws://127.0.0.1:…" 가 찍히면 준비 완료
```

---

## 3. 설치와 등록

```bash
git clone <이 저장소> ~/Desktop/flutter-mobile-qa-mcp   # 또는 복사
cd ~/Desktop/flutter-mobile-qa-mcp
npm install && npm run build
```

Claude Code 에 등록(QA 할 Flutter 프로젝트 루트에서):
```bash
claude mcp add flutter-mobile-qa --scope project \
  -e QA_PROJECT_DIR="$PWD" \
  -e QA_DEVICE=<기기 UDID, 생략 시 첫 번째 기기> \
  -- node ~/Desktop/flutter-mobile-qa-mcp/dist/index.js
```
등록 후 **Claude Code 를 재시작**해야 도구가 보입니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `QA_DEVICE` | 첫 번째 기기 | mobile-mcp 기기 id |
| `QA_PROJECT_DIR` | 현재 폴더 | Dart MCP 실행 위치(fvm 인식용) |
| `QA_DART_CMD` | `fvm dart mcp-server` | fvm 안 쓰면 `dart mcp-server` |
| `QA_MOBILE_MCP` | `@mobilenext/mobile-mcp@1.0.5` | 버전 고정(도구 이름이 바뀌면 이 서버도 맞춰야 함) |

> mobile-mcp·Dart MCP 를 따로 등록해 둘 필요는 없습니다. 이 서버가 안에서 띄웁니다.

---

## 4. 사용 방법

### 4-0. QA 를 어떻게 진행하나 — 내장 워크플로
무엇을 어떤 순서로 테스트할지 몰라도 됩니다. 서버에 **QA 진행 방식이 내장**돼 있습니다.

| 단계 | 쓰는 것 | 하는 일 | 기기 조작 |
|---|---|---|---|
| ① 계획 | 프롬프트 `plan_qa` | 기능 설명 → 관련 코드·문구를 읽고 **시나리오 세트**(기본 흐름·경계값·상태 반영·되돌리기·권한·회귀)를 `qa/scenarios/*.md` 로 작성 | 없음 |
| ② 검토 | 사람 | 시나리오 파일을 읽고 고침(Markdown 표) | 없음 |
| ③ 실행 | 프롬프트 `run_qa` | 시작 전 무엇을 할지 확인받고, 단계마다 조작 → `qa_expect` 판정 → 파일에 PASS/FAIL 표 기록, 만든 데이터 정리 | 있음 |
| ④ 보고 | 프롬프트 `report_qa` | 결과를 모아 결론(출시 가능/차단 이슈)·재현 단계·다음 액션 | 없음 |
| (수시) 탐색 | 프롬프트 `explore_qa` | 시나리오 없이 화면을 돌며 깨진 텍스트·빈 화면·에러 찾기(데이터 변경 없음) | 있음 |

Claude Code 에서는 프롬프트가 `/` 명령으로 보입니다: `/mcp__flutter-mobile-qa__plan_qa` 등. 그냥 말로 "투두 생성 QA 시나리오 짜줘" 라고 해도 됩니다.

**내장된 것**
- **서버 지침**: 연결하면 에이전트가 자동으로 받는 원칙(읽고→판단→조작→검증, 텍스트 우선, 데이터 정리, 위험 동작·개인 인증은 사람에게, 조작 전 확인)
- **시나리오 형식**: [guides/SCENARIO_FORMAT.md](guides/SCENARIO_FORMAT.md) (리소스 `qa://guides/scenario-format`)
- **예시 시나리오**: [guides/example-schedule-create.md](guides/example-schedule-create.md)
- **Claude Code 스킬**(선택): [skills/flutter-mobile-qa/SKILL.md](skills/flutter-mobile-qa/SKILL.md) — "QA 해줘" 같은 말을 알아듣고 위 워크플로로 연결. 설치: `cp -r skills/flutter-mobile-qa ~/.claude/skills/`

**예: 처음 쓰는 사람의 흐름**
```
나: 투두 기능 QA 시나리오 standard 로 짜줘
→ qa/scenarios/todo-001~005.md 생성, 목록 표 제시
나: (파일 확인 후) todo-001, 002 실행해줘. 로그는 /tmp/qa_run.log
→ 할 일 요약·확인 요청 → 실행 → 파일 끝에 결과 표
나: 결과 정리해줘, 출시 판단용으로
→ 보고서
```

### 4-1. 기본 흐름 (도구 직접 사용)
```
qa_connect(logFile: "/tmp/qa_run.log")   # 기기 + Dart 연결
qa_dismiss_system()                      # 권한 창·팝업 정리
qa_read_screen()                         # 지금 화면 읽기
qa_tap(text: "…") / qa_type(field: "…", text: "…")
qa_expect(text: "…", state: "present")   # 결과 검증
```
모든 조작 도구는 **실행 뒤 화면 요약을 함께 돌려줘서**, 매번 `qa_read_screen` 을 따로 부를 필요가 없습니다.

### 4-2. 에이전트에게 이렇게 요청하면 됩니다
```
flutter-mobile-qa 로 홈 → 마이 → 약관 및 정책까지 들어갔다 나와 보고,
각 화면에 깨진 텍스트나 에러가 없는지 확인해 줘.
```
```
일정을 하나 만들어 봐. 제목은 "QA 테스트", 저장 후 홈 카드에 제목과 시간이
편집기에서 본 값과 같게 나오는지 검증하고, 끝나면 그 일정은 지워 줘(삭제 허용).
```
```
설정 화면의 토글을 하나씩 보고 레이블과 켜짐/꺼짐 상태만 표로 정리해 줘. 값은 바꾸지 마.
```

### 4-3. 예시 — 일정 생성 시나리오
```
qa_read_screen(filter: "일정")                       → "일정을 공유해보세요 @214,661"
qa_tap(text: "일정을 공유해보세요")                    → 생성 화면 요약
qa_expect(text: "일정을 생성할게요", state: "disabled") → PASS (제목 비어 있음)
qa_type(field: "제목을 입력해주세요", text: "QA 테스트") → 입력 완료(확인됨)
qa_expect(text: "일정을 생성할게요", state: "enabled")  → PASS
qa_tap(text: "일정을 생성할게요")                       → 홈 요약에 "나 / QA 테스트 / 오후 12:00 ~ 오후 1:00"
```

### 4-4. 푸시·딥링크 테스트(시뮬레이터)
이 서버는 "보내기"는 하지 않고, 셸로 보낸 뒤 결과를 확인합니다.
```bash
# 푸시(FCM 은 payload 에 gcm.message_id 가 있어야 탭을 전달함)
cat > push.apns <<'JSON'
{"aps":{"alert":{"title":"t","body":"b"}},"gcm.message_id":"1","messageType":"VIEW_CALENDAR"}
JSON
xcrun simctl push <udid> <번들ID> push.apns
# 딥링크(iOS "…에서 열겠습니까?" 확인창이 뜨면 qa_tap "열기")
xcrun simctl openurl <udid> 'myscheme://open?…'
```

### 4-5. 토큰을 아끼는 요령
- 화면 확인은 `qa_screenshot`(이미지) 대신 `qa_read_screen`(텍스트). 필요한 부분만 `filter`
- 검증은 `qa_expect` 한 줄(PASS/FAIL)
- 이미지는 레이아웃·색처럼 **눈으로 봐야 하는 것**에만

---

## 5. 도구 레퍼런스

| 도구 | 인자 | 동작 |
|---|---|---|
| `qa_connect` | `logFile?`, `dtdUri?`, `device?` | 기기 선택. DTD 연결 후 `set_frame_sync false`. Dart 없이도 동작하지만 `qa_type`·위젯 대체 탭은 불가 |
| `qa_read_screen` | `filter?`, `limit?`(기본 60) | `[종류]텍스트 = 값 (비활성) @x,y` 형식 요약. 중첩 중복 제거, 상태바 잡음 제거 |
| `qa_tap` | `text`, `exact?`, `allowDanger?`, `waitMs?`(1500) | 접근성 이름/값 일치 → 포함 → Flutter `ByText` → `ByTooltipMessage` 순서로 찾음. 탭 후 화면 요약 |
| `qa_tap_xy` | `x`, `y`, `waitMs?` | 좌표 탭(화면 좌표 = `qa_read_screen` 의 `@x,y` 와 같은 기준) |
| `qa_type` | `field`, `text` | 입력칸(라벨·힌트·현재 값으로 찾음) 탭 → Dart `enter_text` → 값 확인. 실패 시 이유 반환 |
| `qa_expect` | `text`, `state?` = present / absent / enabled / disabled | `PASS …` 또는 `FAIL …` 한 줄 |
| `qa_dismiss_system` | 없음 | 추적 → "앱에 추적 금지 요청", 알림·로컬 네트워크 → "허용", 그 외 "닫기". 최대 5개 |
| `qa_swipe` | `direction`, `fromY?`, `distance?` | 스와이프 후 화면 요약 |
| `qa_screenshot` | 없음 | 이미지 반환 |
| `qa_errors` | 없음 | Flutter 런타임 에러(Dart 연결 시) + 기기 크래시 목록 |
| `qa_launch` | `packageName`, `restart?` | 앱 실행(재실행) 후 화면 요약 |

**프롬프트**: `plan_qa(feature, depth?, source?)` · `run_qa(scenario, logFile?, allowDanger?)` · `explore_qa(area, focus?, logFile?)` · `report_qa(scenarios, audience?)`
**리소스**: `qa://guides/scenario-format` · `qa://guides/example-schedule-create`

---

## 6. 안전장치
- **위험 단어 차단**: 삭제·탈퇴·로그아웃·결제·구독하기·구매·연결 끊기(및 영문 일부). `qa_tap` 은 `allowDanger: true` 없이 누르지 않습니다. 텍스트로 찾은 요소의 실제 라벨도 한 번 더 검사합니다.
- `qa_tap_xy`(좌표)는 무엇을 누르는지 알 수 없으므로 차단이 적용되지 않습니다. 좌표 탭 전에는 `qa_screenshot` 으로 확인하세요.
- 실제 사용자 계정으로 QA 하면 데이터가 실제로 생기고, 커플/공유 기능이면 **상대에게도 알림이 갑니다.** QA 전용 계정을 권장합니다.

---

## 7. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| Dart 탭·입력이 `Timed out waiting for Flutter Driver response` | 광고·Lottie 처럼 **계속 움직이는 화면**이라 프레임 동기화 대기 | `qa_connect` 가 `set_frame_sync false` 를 자동으로 함. 직접 부를 땐 먼저 끄기 |
| 실기기 스크린샷이 `timed out waiting for WebDriverAgent` | 에이전트 미실행 / 개발자 디스크 이미지 비활성 | 폰 잠금 해제 후 `xcrun devicectl device process launch --device <coredevice id> com.mobilenext.devicekit-iosUITests.xctrunner` 한 번 실행하면 이미지가 활성화됨. 이후 재시도 |
| `agent is not installed` | 에이전트 미설치 | [2장 iOS 실기기](#ios-실기기) |
| 글자를 보냈는데 값이 비어 있음 | 실기기 iOS 는 Flutter 입력칸에 키보드가 안 떠서 mobile 입력이 반영 안 됨 | `qa_type` 사용(Dart 입력) |
| `qa_type` 이 "입력 후 값이 보이지 않음" | 포커스가 안 잡힘 | 입력칸이 가려져 있지 않은지 `qa_read_screen` 으로 확인, 필요하면 `qa_tap` 으로 먼저 포커스 |
| `qa_tap` 이 탭 이름을 못 찾음 | 배지 등과 텍스트가 합쳐진 이름(예: `new\n함께하기`) | 기본은 포함 검색이라 대부분 찾음. `exact: true` 를 쓰지 않았는지 확인 |
| 첫 실행에 아무것도 안 눌림 | iOS 권한 창이 앞에 있음 | `qa_dismiss_system` |
| Dart 연결 실패 | `--print-dtd` 없이 실행 / 앱 재시작으로 주소 변경 | `flutter run … --print-dtd` 로 다시 띄우고 새 로그로 `qa_connect` |

---

## 8. QA 가 잘 되게 앱을 다듬는 법
- **아이콘 버튼에 이름 달기**: `IconButton(tooltip: '뒤로')`, 또는 커스텀 탭 영역을 `Semantics(label: '뒤로', button: true, child: …)` 로 감싸기. 공통 컴포넌트(디자인 시스템) 한 곳에서 처리하면 앱 전체에 적용됩니다. VoiceOver·TalkBack 지원도 함께 좋아집니다.
- **입력칸에 힌트/라벨**: `qa_type(field: …)` 가 힌트 텍스트로 찾습니다.
- **QA 전용 계정·데이터**: 실제 사용자 데이터와 분리.
- **한 번만 뜨는 가이드/팝업**: QA 빌드에서 끄는 플래그가 있으면 시나리오가 단순해집니다.
