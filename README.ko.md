# mobile-qa-mcp

[English](README.md) | **한국어** | [日本語](README.ja.md)

> 기본 README는 영어입니다. 스킬·서버 지침·워크플로 프롬프트·도구 설명·시나리오 가이드는 영어로 관리하며, 에이전트의 설명·시나리오·보고서는 사용자가 요청한 언어를 따릅니다. 실제 화면 문구와 선택자는 앱의 원문을 유지합니다. 일부 런타임 도구 메시지는 한국어입니다.

모바일 앱을 **AI 에이전트(Claude Code 등)가 실기기·시뮬레이터에서 직접 조작하며 QA** 하도록 해 주는 MCP 서버입니다.
**직접 개발한 앱이든 다른 회사 앱이든** 쓸 수 있습니다(소스가 없어도 됨 — [4-6. 다른 회사 앱 QA](#4-6-다른-회사-앱-qa-블랙박스)).
구조는 **공통 모바일 QA 기능에 Flutter 전용 기능을 더한 형태**입니다. React Native와 네이티브 iOS·Android 앱은 mobile-mcp의 공통 기기 도구를 사용하고, Flutter는 Dart 연결로 입력·위젯·런타임 에러 기능을 추가로 사용합니다. [앱 종류별 지원](#1-1-앱-종류별-지원-flutter--네이티브--기타)과 [React Native 지원 범위·검증 상태](#1-2-react-native와-공통-qa-기능)를 참고하세요.

패키지·실행 파일 이름은 `mobile-qa-mcp`, MCP 등록명·선택 설치 스킬 이름은 `mobile-qa`입니다.

두 개의 MCP 서버를 안에서 띄워 묶습니다.

| 내부 서버 | 역할 | 잘하는 것 |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | **앱 밖**에서 본다 (OS 접근성 트리 + 스크린샷) | 화면 텍스트 읽기, 탭·스와이프, iOS 권한 창·알림 배너·웹 로그인 같은 **앱 밖 화면** |
| Dart MCP (`dart mcp-server`) | **앱 안**에서 본다 (실행 중인 앱의 VM 서비스) — **Flutter 앱에서만** | **글자 입력**, 위젯 트리, Flutter 런타임 에러, 위젯 기준 탭 |

둘은 서로 못 하는 걸 채웁니다. 이 서버는 그 조합을 **도구 하나로 묶고, 응답을 요약**해서 호출 수와 토큰을 줄입니다.

```
AI 에이전트 ── mobile-qa-mcp ─┬─ mobile-mcp      ── 기기 (접근성 · 스크린샷 · 탭)
                              └─ dart mcp-server ── 앱 (flutter_driver · 위젯 · 에러)
```

> 상태: 0.5.0. 두 내부 서버의 동작은 실기기(iPhone, iOS 26)와 시뮬레이터에서 검증했습니다.
> 0.5.0 의 새 기능(환경 진단·조건 대기·ref/id 선택·실행 기록)은 오프라인 단위 확인만 했고, **실기기 검증은 아직**입니다.

---

## 빠른 시작 — 어떻게 부르나

**도구(`qa_*`)를 직접 호출할 필요는 없습니다.** 에이전트에게 말로 요청하면 필요한 도구를 골라 부릅니다.
기기를 조작하기 전에는 에이전트가 무엇을 할지 먼저 알리고 확인받습니다.

### 1) 말로 요청 (가장 쉬움)
| 하고 싶은 것 | 이렇게 말하기 |
|---|---|
| 시나리오 만들기 | "투두 수정 기능 QA 시나리오 짜줘" |
| 시나리오 실행 | "qa/scenarios/todo-002.md 실행해줘" |
| 둘러보며 문제 찾기 | "마이 탭 돌아다니면서 깨진 텍스트 있는지 봐줘. 값은 바꾸지 말고" |
| 결과 정리 | "QA 결과 정리해줘, 출시 판단용으로" |
| 환경 확인 | "QA 환경 진단해줘" → `qa_doctor` |
| 다른 회사 앱 | "인스타그램 앱 ID 찾아서 로그인 화면까지 둘러봐줘. 아무것도 누르거나 입력하진 말고" → `qa_apps` → `qa_launch` → 탐색 |
| 끝내기 | "QA 끝났으니 정리해줘" → `qa_finish` (폰의 'Automation Running' 해제) |

### 2) `/` 명령 (정해진 절차대로)
입력창에 `/` 를 치고 `mobile-qa` 를 찾으면 프롬프트 4개가 나옵니다. 고르면 필요한 값을 묻습니다.

| 명령 | 입력 값 (굵게 = 필수) | 예 |
|---|---|---|
| `/mcp__mobile-qa__plan_qa` | **feature**, depth(smoke/standard/deep), source | `투두 수정`, `standard` |
| `/mcp__mobile-qa__run_qa` | **scenario**, logFile, allowDanger(yes), reportLanguage(en/ko/ja) | `qa/scenarios/todo-002.md`, `/tmp/qa_run.log` |
| `/mcp__mobile-qa__explore_qa` | **area**, focus, logFile, reportLanguage(en/ko/ja) | `마이 탭 전체`, `깨진 텍스트` |
| `/mcp__mobile-qa__report_qa` | **scenarios**, audience, reportLanguage(en/ko/ja) | `qa/scenarios`, `출시 판단` |

> `/` 목록에는 프롬프트만 나옵니다. 도구 목록은 `/mcp` → `mobile-qa` → **View tools** 에서 확인(18개).
> 서버를 업데이트했는데 새 도구가 안 보이면 `/reload-plugins` 또는 `/mcp` 에서 **Reconnect**.

### 3) 처음 한 번: 환경 진단
"QA 환경 진단해줘" → `qa_doctor` 가 기기·에이전트·Dart 연결을 확인하고 **지금 가능한 기능과 복구 방법**을 표로 알려 줍니다. 도구가 이상하게 실패할 때도 먼저 진단하세요(앱 버그와 환경 문제 구분).

### 4) 실행 전에 앱 띄우기 (Flutter 앱 · 글자 입력이 있는 QA)
```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <기기> --print-dtd > /tmp/qa_run.log 2>&1
```
이 로그 경로를 `run_qa` 의 `logFile` 로 주거나, 말로 "앱은 떠 있어, 로그는 /tmp/qa_run.log" 라고 알려 주면 됩니다. 준비 전체는 [2장](#2-준비).

---

## 목차
1. [무엇이 되고 무엇이 안 되나](#1-무엇이-되고-무엇이-안-되나)
2. [준비](#2-준비)
3. [설치와 등록](#3-설치와-등록)
4. [사용 방법](#4-사용-방법) — **처음이면 4-0 부터**
5. [도구 레퍼런스](#5-도구-레퍼런스) — 선택자·대기·실행 기록·진단
6. [안전장치와 프로젝트 설정](#6-안전장치와-프로젝트-설정)
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
| QA 종료 정리(iOS 'Automation Running' 해제) | `qa_finish` | |
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

### 1-1. 앱 종류별 지원 (Flutter · 네이티브 · 기타)

위의 "되는 것"은 Flutter 기준입니다. 도구마다 어느 내부 서버를 쓰는지에 따라 앱 종류별 지원이 달라집니다.
Dart 연결(`qa_connect` 의 `logFile`)은 Flutter 에서만 쓰고, **네이티브 앱은 Dart 없이** 기기 연결만으로 씁니다.

| 도구 | 쓰는 내부 서버 | Flutter | 네이티브 iOS (UIKit·SwiftUI) | 네이티브 Android (View·Compose) |
|---|---|---|---|---|
| `qa_read_screen` | mobile | ✅ `Text`·Material 위젯이 잡힘 | ✅ 표준 컨트롤은 기본 접근성이 있어 대체로 더 잘 잡힘 | ✅ `contentDescription`/텍스트 기준 |
| `qa_tap` | mobile → (Flutter면) Dart 대체 | ✅ 텍스트 버튼. 아이콘 버튼은 이름이 없으면 좌표 | ✅ `accessibilityLabel` 기준. 라벨 없는 이미지 버튼은 좌표 | ✅ `contentDescription` 기준 |
| `qa_type` | Dart(있으면) / 기기 키보드 | ✅ **Dart 필수**(실기기 iOS 는 Flutter 입력칸에 키보드가 안 떠서 기기 입력이 안 먹음) | ✅ 기기 키보드로 입력 | ✅ 기기 키보드로 입력 |
| `qa_expect` · `qa_swipe` · `qa_tap_xy` · `qa_screenshot` | mobile | ✅ | ✅ | ✅ |
| `qa_dismiss_system` · `qa_launch` · `qa_apps` · `qa_finish` | mobile | ✅ | ✅ | ✅ (시스템 창 규칙 기본값은 한·영·일 iOS 문구 — 프로젝트 설정으로 추가) |
| `qa_wait_until` · `qa_run_start/step/end` · `qa_doctor` | mobile (+Dart) | ✅ | ✅ | ✅ |
| 선택자 `id` (접근성 식별자) | mobile | ✅ `Semantics(identifier:)` (Flutter 3.19+) | ✅ `accessibilityIdentifier` | ✅ `resource-id` |
| 선택자 `key` (ValueKey) | Dart | ✅ | ❌ | ❌ |
| `qa_errors` | Dart + mobile | ✅ 런타임 에러 + 크래시 | ⚠️ 크래시 목록만 | ⚠️ 크래시 목록만 |
| `qa_connect` | mobile (+Dart) | 기기 + Dart 연결 | 기기만(`logFile` 생략) | 기기만 |
| 위젯 트리·Flutter 위젯 기준 탭 | Dart | ✅ | ❌ | ❌ |

실제 확인한 것: 네이티브 **설정 앱**(iOS)에서 앱 실행·요소 목록·탭·스와이프·홈 버튼이 정상 동작. 네이티브 앱의 글자 입력은 기기 키보드 경로로 구현돼 있으나 아직 실기기 검증 전.

**기타 프레임워크**
| 종류 | 사용 | 비고 |
|---|---|---|
| React Native | 공통 기기 경로 구현됨·RN 앱 검증 전 | 앱에서 접근성 라벨·식별자가 노출되어야 함. [아래 설명](#1-2-react-native와-공통-qa-기능) 참고 |
| 웹뷰·하이브리드(WebView, Capacitor 등) | ⚠️ 웹 콘텐츠 내부는 요소가 잘 안 잡힘 | 스크린샷 + 좌표. 웹 영역은 Playwright 같은 웹 도구가 더 적합 |
| 게임 엔진(Unity 등)·캔버스 렌더링 | ⚠️ 접근성 트리가 거의 없음 | 스크린샷 + 좌표만 |

**네이티브 앱에서 쓰는 법**
```text
qa_connect()                      # logFile 없이 — 기기만 연결
qa_launch(packageName: "com.example.app")
qa_dismiss_system()
qa_read_screen() → qa_tap(text: "…") → qa_type(field: "이메일", text: "…") → qa_expect(…)
qa_finish()
```
워크플로 프롬프트(`plan_qa`·`run_qa`·`explore_qa`·`report_qa`)도 그대로 쓸 수 있습니다. `run_qa` 에서 `logFile` 을 비워 두면 됩니다.

### 1-2. React Native와 공통 QA 기능

공통 도구는 **OS 접근성 정보와 기기 입력**을 이용합니다. 따라서 React Native에서도 각 플랫폼에 노출된 화면 요소·값을 통해 네이티브 앱과 같은 QA 흐름을 사용할 수 있습니다.

| 기능 | React Native에서의 경로와 제약 |
|---|---|
| 화면 읽기·탭·스와이프·앱 실행·스크린샷 | mobile-mcp 공통 경로. 접근성 요소가 노출되어야 안정적으로 대상을 선택할 수 있음 |
| 텍스트 입력 | Dart 없이 기기 키보드 사용. 기존 값에 이어 입력될 수 있어 재시도 전에 필드 상태 확인 필요 |
| 입력값·화면 상태 검증 | 입력 성공 판정에는 해당 필드의 실제 값이 노출되어야 함. 숨김·값 미제공은 자동 검증 불가 |
| 시나리오 작성·탐색·실행 기록·실패 복구·한영일 보고서 | 공통 도구와 에이전트 워크플로 사용. 최근 개선한 판정·복구 기능도 이 경로에 적용 |
| React 컴포넌트 트리·props·state 검사 | 현재 미구현 |
| JavaScript/Hermes 런타임 오류 수집 | 현재 미구현. Dart 없이 쓰는 `qa_errors`는 기기 크래시 목록을 확인하며, RN의 JavaScript 오류를 수집하지 않음 |

위의 네이티브 흐름처럼 **`logFile`·`dtdUri` 없이 `qa_connect()`**를 사용합니다. RN에는 Flutter SDK나 flutter_driver 진입점이 필요하지 않습니다. Flutter 세션에서 RN으로 전환할 때는 먼저 `qa_finish`로 이전 세션을 종료해 기존 Dart 연결을 재사용하지 않도록 합니다.

필요한 곳에 의미 있는 `accessibilityLabel`·`accessibilityRole`과 안정적인 `testID`를 지정하면 도움이 됩니다. 다만 **모든 플랫폼·컴포넌트에서 `testID`가 이 서버의 `id`로 노출된다고 보장할 수는 없습니다.** `qa_read_screen`에서 실제 반환되는 식별자나 ref를 확인해 사용하세요. 부모의 접근성 그룹 설정이나 커스텀 컨트롤에 따라 자식 요소 노출이 달라질 수 있습니다. [RN 공식 접근성 가이드](https://reactnative.dev/docs/accessibility)와 [testID 설명](https://reactnative.dev/docs/view#testid)을 참고하세요.

**검증 상태:** 이 프로젝트는 아직 RN 앱의 전체 흐름을 iOS·Android에서 검증하지 않았습니다. 공통 경로 구현과 오프라인 테스트만으로 RN 실기기 호환성이 검증된 것은 아닙니다. 출시 QA에 활용하기 전에 대상 앱의 요소·식별자 노출, 입력값 읽기, 키보드, 스크롤, 다이얼로그 동작을 확인해야 합니다.

### 주의할 점
- **한 번만 뜨는 오버레이**(첫 진입 가이드 Showcase, 이벤트 팝업)가 흐름을 막습니다. 시나리오는 "좌표를 외워서 누르기"가 아니라 **"화면을 읽고 → 판단해서 누르기"** 로 짜야 안정적입니다.
- 스와이프가 탭으로 인식돼 엉뚱한 카드가 눌릴 수 있습니다. 당겨서 새로고침은 `fromY` 를 화면 위쪽(헤더)으로.
- 시스템 창 규칙과 위험 단어 기본값은 **한국어·영어·일본어** 문구입니다. 다른 언어·앱 전용 문구는 [프로젝트 설정 파일](#프로젝트-설정-파일-선택--qaqaconfigjson)로 추가하세요.

---

## 2. 준비

### 공통
- Node.js 20+
- (Flutter 앱) Flutter SDK. **fvm 은 선택** — 프로젝트에 `.fvmrc`/`.fvm/fvm_config.json` 이 있으면 자동으로 `fvm dart` 를, 없으면 PATH 의 `dart` 를 씁니다. `QA_PROJECT_DIR` 로 프로젝트 루트 지정

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

### 앱 쪽 준비 — Flutter 앱만 (글자 입력·위젯 기반 탭을 쓰려면)
> 네이티브 앱은 이 절이 필요 없습니다. 디버그/QA 빌드를 기기에 설치해 두기만 하면 됩니다.

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
git clone <이 저장소> ~/Desktop/mobile-qa-mcp   # 또는 복사
cd ~/Desktop/mobile-qa-mcp
npm install && npm run build
```

Claude Code 에 등록(QA 할 Flutter 프로젝트 루트에서):
```bash
claude mcp add mobile-qa --scope project \
  -e QA_PROJECT_DIR="$PWD" \
  -e QA_DEVICE=<기기 UDID, 생략 시 첫 번째 기기> \
  -- node ~/Desktop/mobile-qa-mcp/dist/index.js
```
등록 후 **Claude Code 를 재시작**해야 도구가 보입니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `QA_DEVICE` | 첫 번째 기기 | mobile-mcp 기기 id |
| `QA_PROJECT_DIR` | 현재 폴더 | 프로젝트 루트 — Dart MCP 실행 위치, fvm 자동 판단, 설정 파일(`qa/qa.config.json`)·실행 기록 기준 |
| `QA_DART_CMD` | 자동: fvm 설정이 있으면 `fvm dart mcp-server`, 없으면 `dart mcp-server` | 다른 방식이면 직접 지정(예: `/opt/flutter/bin/dart mcp-server`, `puro dart mcp-server`) |
| `QA_CONFIG` | `<프로젝트>/qa/qa.config.json` | 프로젝트 설정 파일 경로 |
| `QA_RUNS_DIR` | `<프로젝트>/qa/runs` | 실행 기록 폴더 |
| `QA_MOBILE_MCP` | `@mobilenext/mobile-mcp@1.0.6` | 버전 고정(도구 이름이 바뀌면 이 서버도 맞춰야 함) |

> mobile-mcp·Dart MCP 를 따로 등록해 둘 필요는 없습니다. 이 서버가 안에서 띄웁니다.

### 이전 이름에서 전환하기

`flutter-mobile-qa-mcp`를 사용했다면 저장소·실행 파일 경로를 `mobile-qa-mcp`로 갱신하세요. 기존 MCP 등록 `flutter-mobile-qa`를 위 명령의 `mobile-qa`로 교체하면서 `QA_*` 설정을 유지한 뒤 클라이언트를 재연결합니다. 슬래시 명령의 접두사는 `/mcp__mobile-qa__…`로 바뀝니다.

선택 스킬은 `skills/mobile-qa`를 설치하고, 중복 인식을 막기 위해 이전에 설치한 `flutter-mobile-qa` 스킬을 제거하세요. `qa_*` 도구명, 프롬프트명, `qa://` 리소스, 설정 키, 기존 시나리오·실행 기록은 그대로 호환됩니다.

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

Claude Code 에서는 프롬프트가 `/` 명령으로 보입니다: `/mcp__mobile-qa__plan_qa` 등. 그냥 말로 "투두 생성 QA 시나리오 짜줘" 라고 해도 됩니다.

**내장된 것**
- **서버 지침**: 연결하면 에이전트가 자동으로 받는 원칙(읽고→판단→조작→검증, 텍스트 우선, 데이터 정리, 위험 동작·개인 인증은 사람에게, 조작 전 확인)
- **시나리오 형식**: [guides/SCENARIO_FORMAT.md](guides/SCENARIO_FORMAT.md) (리소스 `qa://guides/scenario-format`)
- **예시 시나리오**: [guides/example-schedule-create.md](guides/example-schedule-create.md)
- **Claude Code 스킬**(선택): [skills/mobile-qa/SKILL.md](skills/mobile-qa/SKILL.md) — "QA 해줘" 같은 말을 알아듣고 위 워크플로로 연결. 설치: `cp -r skills/mobile-qa ~/.claude/skills/`

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
qa_doctor(logFile: "/tmp/qa_run.log")     # 환경 진단 (네이티브·다른 회사 앱은 logFile 생략)
qa_connect(logFile: "/tmp/qa_run.log")    # 기기 + (Flutter) Dart 연결
qa_run_start(name: "TODO-002")            # 실행 기록 시작 (선택)
qa_dismiss_system()                       # 권한 창·팝업 정리
qa_read_screen()                          # 지금 화면 읽기 → r1, r2 … 참조
qa_tap(ref: "r12", waitFor: {text: "…", state: "present"})
qa_type(field: "…", text: "…")
qa_expect(text: "…", state: "enabled", timeoutMs: 5000)
qa_step(title: "…", expected: "…", result: "pass")
qa_run_end()                              # report.md
qa_finish()                               # 기기 에이전트 정리
```
모든 조작 도구는 **실행 뒤 화면 요약을 함께 돌려줘서**(새 ref 포함), 매번 `qa_read_screen` 을 따로 부를 필요가 없습니다.

### 4-2. 에이전트에게 이렇게 요청하면 됩니다
```
mobile-qa 로 홈 → 마이 → 약관 및 정책까지 들어갔다 나와 보고,
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
qa_read_screen(filter: "일정")              → "r18 일정을 공유해보세요 @214,661"
qa_tap(ref: "r18", waitFor: {text: "일정을 생성할게요"})       → 대기 PASS (620ms) + 생성 화면 요약
qa_expect(text: "일정을 생성할게요", state: "disabled")        → PASS (제목 비어 있음)
qa_type(field: "제목을 입력해주세요", text: "QA 테스트")        → 입력 완료(확인됨)
qa_expect(text: "일정을 생성할게요", state: "enabled", timeoutMs: 3000) → PASS
qa_tap(text: "일정을 생성할게요", waitFor: {text: "QA 테스트"}) → 홈 요약에 "나 / QA 테스트 / 오후 12:00 ~ 오후 1:00"
```
같은 문구의 버튼이 여러 개면 `qa_tap` 이 후보(ref·위치)를 돌려주므로 `ref` 로 다시 지정합니다.

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

### 4-6. 다른 회사 앱 QA (블랙박스)
소스가 없는 앱도 기기 연결만으로 QA 할 수 있습니다(Flutter 앱이어도 Dart 연결은 불가 → 네이티브와 같은 경로).
1. `qa_apps(filter: "앱 이름")` 로 번들 ID 확인 → `qa_launch(packageName)`
2. `plan_qa` 에 source 없이 요청하면 **블랙박스 모드**: 데이터를 바꾸지 않는 선에서 화면을 둘러보며 실제 문구·흐름을 모아 시나리오를 만듭니다(기기 조작 전 확인 요청).
3. `run_qa` / `explore_qa` 는 그대로 사용. 시나리오·실행 기록은 지금 작업 폴더의 `qa/` 아래에 저장.

주의
- 다른 회사 앱은 **실제 서비스에 영향**(결제·게시·메시지 전송·팔로우 등)이 있습니다. 탐색은 "누르지만 저장·전송하지 않는" 범위로, 위험 단어는 `qa/qa.config.json` 에 더 넣어 두세요.
- 테스트 계정으로, 이용약관이 허용하는 범위에서만.
- Flutter 앱이라도 실기기 iOS 에서는 글자 입력이 안 될 수 있습니다(키보드 미표시 — Dart 연결이 필요한데 남의 앱은 불가). 시뮬레이터·Android 는 대체로 기기 키보드로 입력됩니다.

## 5. 도구 레퍼런스

### 선택자 (qa_tap · qa_type · qa_expect 공통)
| 선택자 | 예 | 설명 |
|---|---|---|
| `ref` | `r12` | 방금 `qa_read_screen`(또는 조작 뒤 화면 요약)에 나온 참조. 탭 직전에 같은 요소인지(라벨·위치) 다시 확인하고, 화면이 바뀌었으면 거부 |
| `id` | `todo_title` | 접근성 식별자. 문구·언어가 바뀌어도 유지 — **가장 튼튼함**. 앱에 달아 두면 좋음([8장](#8-qa-가-잘-되게-앱을-다듬는-법)) |
| `text` | `저장` | 보이는 텍스트. 완전 일치 → 포함 순서. `exact: true` 로 완전 일치만 |
| `index` | `1` | 후보가 여럿일 때 0부터 몇 번째 |
| `key` (qa_tap 만) | `save_button` | Flutter `ValueKey<String>`. Dart 연결 필요 |

후보가 여럿이면 **누르지 않고 후보 목록**(ref·위치)을 돌려줍니다 — 같은 이름의 "삭제" 버튼이 두 개인 화면에서 엉뚱한 걸 누르지 않도록.

### 대기
- 조작 도구(`qa_tap`·`qa_tap_xy`·`qa_swipe`·`qa_launch`)는 `waitFor: {text|id, state}` + `timeoutMs` 를 주면 **그 조건이 될 때까지** 기다립니다. 없으면 **화면이 안정될 때까지**(연속 두 번 같은 화면, 기본 최대 3초·앱 실행은 별도 시간 제한) 기다립니다 — 고정 대기 없음.
- `qa_expect(..., timeoutMs)`: 조건이 될 때까지 재확인. `qa_wait_until`: 로딩 사라짐(absent)·버튼 활성(enabled)·화면 안정(`stable: true`) 대기.

### 검증과 실패 복구

- `qa_expect(state: "absent")`는 유효한 선택자와 일치하는 요소가 없을 때만 통과합니다. `STALE_REF`·`INVALID_SELECTOR`는 실패입니다. 삭제·화면 전환 뒤 부재 검증에는 안정적인 `id`나 완전 일치 `text`를 사용하세요. `present`·`absent`는 여러 일치 항목의 존재 여부를 확인할 수 있고, `enabled`·`disabled`는 유일한 대상이나 명시적인 `index`가 필요합니다.
- `qa_type`은 **입력 대상으로 지정한 필드의 값이 정확히 일치하는지** 확인합니다. 다른 화면 요소의 같은 문구는 성공 근거가 아닙니다. 키보드가 열려 필드가 이동해도 찾을 수 있도록 `id`를 권장합니다. ID가 없으면 라벨·종류·가까운 위치로 같은 필드를 유일하게 찾을 수 있어야 합니다. 숨김·마스킹·접근성 값 미제공은 자동 검증 불가로 처리합니다. `timeoutMs`는 입력 후 검증 대기 시간(기본 3000ms)이며, 입력을 반복하지 않습니다.
- 안정화 대기는 연속 두 번 같은 접근성 화면을 확인해야 성공합니다. 제한 시간 내 안정되지 않으면 `WAIT_TIMEOUT` 오류와 마지막 화면 요약을 반환합니다. 대기 실패가 앞선 탭·실행의 실패를 의미하지는 않습니다. 애니메이션 화면에서는 구체적인 `waitFor` 조건을 권장합니다.
- 스킬과 실행 프롬프트는 **실패한 단계당 보정 후 재시도 1회까지만** 허용합니다. 현재 상태를 먼저 확인하고 원래 실패를 기록하며, 복구 실패 시 종속 단계를 건너뜁니다. 저장·전송·생성·삭제·결제 결과가 불확실하면 같은 동작을 반복하지 않습니다. 연결 문제는 `qa_doctor`로 한 번 진단하고, 필요한 기능이 복구된 뒤 재개합니다.

### 도구
| 도구 | 인자 | 동작 |
|---|---|---|
| `qa_doctor` | `logFile?`, `dtdUri?` | 환경 진단 표(Node·mobile-mcp·기기·조작 에이전트·화면 읽기·식별자 유무·Dart·flutter run 로그·DTD·flutter_driver) + 지금 가능한 기능 + 복구 방법 |
| `qa_connect` | `logFile?`, `dtdUri?`, `device?` | 기기 선택. (Flutter) DTD 연결 후 `set_frame_sync false`. 네이티브·다른 회사 앱은 `logFile` 없이 |
| `qa_apps` | `filter?` | 설치된 앱 이름·번들 ID 검색 |
| `qa_launch` | `packageName`, `restart?`, `waitFor?`, `timeoutMs?` | 앱 실행(재실행) → 안정/조건 대기 → 화면 요약 |
| `qa_read_screen` | `filter?`, `limit?`(60) | `ref [종류]텍스트 = 값 id=식별자 (비활성) @x,y` 형식 요약 |
| `qa_tap` | 선택자, `key?`, `allowDanger?`, `waitFor?`, `timeoutMs?` | 선택자로 탭(못 찾으면 Flutter 텍스트·툴팁 대체). 위험 단어 차단. 대기 후 화면 요약 |
| `qa_tap_xy` | `x`, `y`, `waitFor?`, `timeoutMs?` | 좌표 탭(이름·id 없는 아이콘). 위험 차단 미적용 |
| `qa_type` | `field?`/`id?`/`ref?`, `index?`, `text`, `timeoutMs?`(3000) | 입력칸 탭 → 입력(Dart `enter_text` 또는 기기 키보드) → 값 확인 |
| `qa_expect` | 선택자, `state?`, `timeoutMs?` | `PASS/FAIL` 한 줄. 실행 기록 중 FAIL 이면 증거 자동 저장 |
| `qa_wait_until` | `text?`/`id?`, `state?`, `stable?`, `timeoutMs?`(10000) | 조건·화면 안정 대기 |
| `qa_dismiss_system` | 없음 | 규칙대로 방해 창 닫기(기본 한·영·일 + 프로젝트 규칙) |
| `qa_swipe` | `direction`, `fromY?`, `distance?`, `waitFor?`, `timeoutMs?` | 스와이프(시작 x 는 기기 화면 가운데) |
| `qa_screenshot` | 없음 | 이미지 |
| `qa_errors` | 없음 | Flutter 런타임 에러(Dart 연결 시) + 기기 크래시 목록 |
| `qa_run_start` | `name`, `scenario?`, `app?`, `appVersion?`, `dir?`, `reportLanguage?` | 실행 기록 시작 → 아래 폴더 생성 |
| `qa_step` | `title`, `expected?`, `result`(pass/fail/skip), `actual?`, `note?` | 단계 판정 기록. fail 이면 증거 저장 |
| `qa_run_end` | `summary?` | `report.md` 생성, PASS/FAIL 수와 경로 반환 |
| `qa_finish` | 없음 | 열린 실행 기록 닫기 → 기기 에이전트·mobilecli 데몬 종료 → 내부 연결 해제 |

### 실행 기록 폴더
```
qa/runs/20260928-112000-TODO-002/
├── meta.json        기기·앱·버전·git 브랜치/커밋(미커밋 여부)·Dart 연결 여부
├── steps.jsonl      모든 도구 호출(도구·인자·결과·ms) + qa_step 판정
├── report.md        요약(PASS/FAIL/SKIP·도구 오류) + 단계 표(기대·실제·ms·증거)
└── evidence/        실패 시: 003-expect-저장.png · .elements.txt(화면 요소 원본) · .errors.txt(런타임 에러·크래시)
```
대화에는 요약과 경로만 돌아옵니다(토큰 절약). 위치는 `QA_RUNS_DIR` 또는 설정 파일 `runsDir` 로 변경.

### 보고서 언어

`qa_run_start` 또는 `qa/qa.config.json`의 `reportLanguage`에 `en`·`ko`·`ja`를 지정합니다. 우선순위는 **도구 인자 → 프로젝트 설정 → `en`**입니다. 선택한 언어를 `meta.json`에 저장하고, 해당 실행의 `report.md` 제목과 표 항목에 적용합니다.

```text
qa_run_start(name: "TODO-002", reportLanguage: "ko")
```

`run_qa`·`explore_qa`·`report_qa` 프롬프트도 `reportLanguage`를 받습니다. 생략하면 에이전트는 지원되는 사용자 요청·대화 언어를 따르고, 그 외 실행 기록은 프로젝트 설정을 사용합니다. 단계 설명·요약·실제 화면 문구·증거는 자동 번역하지 않고 전달된 원문을 저장합니다. 기존 보고서 파일은 바뀌지 않습니다.

**프롬프트**: `plan_qa(feature, depth?, source?)` · `run_qa(scenario, logFile?, allowDanger?, reportLanguage?)` · `explore_qa(area, focus?, logFile?, reportLanguage?)` · `report_qa(scenarios, audience?, reportLanguage?)`
**리소스**: `qa://guides/scenario-format` · `qa://guides/example-schedule-create`

---

## 6. 안전장치와 프로젝트 설정
- **위험 단어 차단**: 기본 목록(한·영·일 — 삭제·탈퇴·로그아웃·결제·구매·구독하기·초기화·해지 / Delete·Remove·Log out·Sign out·Purchase·Buy·Subscribe·Pay·Reset·Deactivate / 削除·退会·ログアウト·購入·決済·解約 등)이 들어간 요소는 `qa_tap` 이 `allowDanger: true` 없이 누르지 않습니다. 텍스트로 찾은 요소의 실제 라벨도 한 번 더 검사합니다.
- `qa_tap_xy`(좌표)는 무엇을 누르는지 알 수 없으므로 차단이 적용되지 않습니다. 좌표 탭 전에는 `qa_screenshot` 으로 확인하세요.
- 실제 계정으로 QA 하면 데이터가 실제로 생기고, 공유·소셜 기능이면 **다른 사용자에게도 알림이 갑니다.** QA 전용 계정을 권장합니다. 다른 회사 앱은 [4-6](#4-6-다른-회사-앱-qa-블랙박스) 주의 참고.

### 프로젝트 설정 파일 (선택) — `qa/qa.config.json`
앱마다 다른 위험 단어·시스템 창 규칙을 둡니다(`QA_CONFIG` 로 다른 경로 지정 가능). 없으면 기본값만 씁니다.
```json
{
  "dangerWords": ["연결 끊기", "계정 전환"],
  "replaceDangerWords": false,
  "dismissRules": [
    { "when": "이벤트", "tap": "오늘 하루 보지 않기" },
    { "when": "", "tap": "나중에" }
  ],
  "runsDir": "qa/runs",
  "reportLanguage": "ko"
}
```
| 키 | 설명 |
|---|---|
| `dangerWords` | 기본 위험 단어에 **추가**(앱 전용 문구) |
| `replaceDangerWords` | `true` 면 기본 목록 대신 `dangerWords` 만 |
| `dismissRules` | `qa_dismiss_system` 규칙 — 화면에 `when` 문구가 보이면 `tap` 버튼을 누름(`when: ""` 은 항상). 기본 규칙보다 **먼저** 적용 |
| `runsDir` | 실행 기록 폴더(프로젝트 기준 상대 경로) |
| `reportLanguage` | 보고서 제목·표 언어: `en`(기본)·`ko`·`ja`. `qa_run_start.reportLanguage` 인자가 우선 |

---

## 7. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| Dart 탭·입력이 `Timed out waiting for Flutter Driver response` | 광고·Lottie 처럼 **계속 움직이는 화면**이라 프레임 동기화 대기 | `qa_connect` 가 `set_frame_sync false` 를 자동으로 함. 직접 부를 땐 먼저 끄기 |
| 실기기 스크린샷이 `timed out waiting for WebDriverAgent` | 에이전트 미실행 / 개발자 디스크 이미지 비활성 | 폰 잠금 해제 후 `xcrun devicectl device process launch --device <coredevice id> com.mobilenext.devicekit-iosUITests.xctrunner` 한 번 실행하면 이미지가 활성화됨. 이후 재시도 |
| `agent is not installed` | 에이전트 미설치 | [2장 iOS 실기기](#ios-실기기) |
| 글자를 보냈는데 값이 비어 있음 | 실기기 iOS 는 Flutter 입력칸에 키보드가 안 떠서 mobile 입력이 반영 안 됨 | `qa_type` 사용(Dart 입력) |
| `qa_type` 이 `INPUT_VALUE_MISMATCH` 반환 | 포커스가 안 잡힘 | 입력칸이 가려져 있지 않은지 `qa_read_screen` 으로 확인, 필요하면 `qa_tap` 으로 먼저 포커스 |
| `qa_tap` 이 탭 이름을 못 찾음 | 배지 등과 텍스트가 합쳐진 이름(예: `new\n함께하기`) | 기본은 포함 검색이라 대부분 찾음. `exact: true` 를 쓰지 않았는지 확인 |
| `qa_tap` 이 "후보가 N개" 로 실패 | 같은 텍스트 요소가 여러 개 | 돌려준 후보의 `ref` 나 `index` 로 다시. 반복되면 앱에 식별자(id) 추가 |
| "ref … 사라졌거나 움직임" | 읽은 뒤 화면이 바뀜(스크롤·팝업) | `qa_read_screen` 다시 → 새 ref 사용 |
| 뭐가 문제인지 모르겠음 | 환경인지 앱인지 불분명 | `qa_doctor` |
| 첫 실행에 아무것도 안 눌림 | iOS 권한 창이 앞에 있음 | `qa_dismiss_system` |
| 폰에 'Automation Running' 이 계속 떠 있음 | QA 후 조작 에이전트가 남아 있음 | `qa_finish` |
| Dart 연결 실패 | `--print-dtd` 없이 실행 / 앱 재시작으로 주소 변경 | `flutter run … --print-dtd` 로 다시 띄우고 새 로그로 `qa_connect` |

---

## 8. QA 가 잘 되게 앱을 다듬는 법
- **아이콘 버튼에 이름 달기**: `IconButton(tooltip: '뒤로')`, 또는 커스텀 탭 영역을 `Semantics(label: '뒤로', button: true, child: …)` 로 감싸기. 공통 컴포넌트(디자인 시스템) 한 곳에서 처리하면 앱 전체에 적용됩니다. VoiceOver·TalkBack 지원도 함께 좋아집니다.
- **식별자 달기(가장 효과 큼)**: 문구·언어가 바뀌어도 QA 가 깨지지 않습니다. `qa_read_screen` 에 `id=…` 로 보이고 `qa_tap(id: …)` 로 선택.
  - Flutter 3.19+: `Semantics(identifier: 'todo_save', child: …)` (iOS accessibilityIdentifier / Android resource-id 로 나감 — Dart 연결 없이 동작)
  - Flutter `ValueKey('todo_save')` 도 되지만 Dart 연결이 있어야 함(`qa_tap(key: …)`)
  - 네이티브 iOS: `accessibilityIdentifier` / SwiftUI `.accessibilityIdentifier(…)` · Android: `android:id`, Compose `Modifier.testTag(…)` + `testTagsAsResourceId`
- **입력칸에 힌트/라벨**: `qa_type(field: …)` 가 힌트 텍스트로 찾습니다.
- **QA 전용 계정·데이터**: 실제 사용자 데이터와 분리.
- **한 번만 뜨는 가이드/팝업**: QA 빌드에서 끄는 플래그가 있으면 시나리오가 단순해집니다.
