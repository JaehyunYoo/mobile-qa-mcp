# mobile-qa-mcp

**English** | [한국어](README.ko.md) | [日本語](README.ja.md)

An MCP server that lets **AI agents (such as Claude Code) perform QA by interacting with mobile apps on physical devices and simulators**.
Use it with **your own apps or third-party apps**, even without source code — see [third-party app QA](#4-6-third-party-app-qa-black-box).
Its architecture is a **shared mobile QA layer with additional Flutter-specific capabilities**. React Native and native iOS/Android apps can use the common device tools through mobile-mcp; Dart adds Flutter-only input, widget, and runtime-error access. See [support by app type](#1-1-support-by-app-type) and [React Native support and validation status](#1-2-react-native-and-the-shared-qa-layer).

The package and command-line executable are named `mobile-qa-mcp`; the MCP registration and optional skill are named `mobile-qa`.

The server starts and combines two underlying MCP servers:

| Server | View of the app | Strengths |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | **Outside the app**: OS accessibility tree and screenshots | Reading screen text, tapping, swiping, and handling **system or external screens** such as iOS permission dialogs, notification banners, and web sign-in |
| Dart MCP (`dart mcp-server`) | **Inside the app**: the running app's VM service — **Flutter only** | **Text input**, widget trees, Flutter runtime errors, and widget-based taps |

The two servers complement each other. This server **combines operations into single tools and summarizes responses** to reduce tool calls and token usage.

```text
AI agent ── mobile-qa-mcp ─┬─ mobile-mcp      ── device (accessibility · screenshots · taps)
                           └─ dart mcp-server ── app (flutter_driver · widgets · errors)
```

> Status: 0.5.0. The underlying servers have been verified on a physical iPhone (iOS 26) and simulators.
> New 0.5.0 features (diagnostics, conditional waits, ref/id selectors, and run recording) have only passed offline unit checks; **physical-device validation is still pending**.
>
> This README is the default English documentation. The bundled skill, server instructions, workflow prompts, tool descriptions, and scenario guides are maintained in English. Agents are instructed to write explanations, scenarios, and reports in the user's requested language. Some runtime tool messages remain in Korean. Examples that target Korean app text retain the original labels; always match the text actually shown in your app.

---

## Quick start

**You do not need to call the `qa_*` tools yourself.** Describe the task to your agent, and it selects the tools.
Before interacting with a device, the workflow asks the agent to explain the intended actions and obtain confirmation.

### 1) Ask in natural language

| Goal | Example request |
|---|---|
| Create scenarios | "Write QA scenarios for editing a todo." |
| Run a scenario | "Run qa/scenarios/todo-002.md." |
| Explore for issues | "Explore the My tab and check for broken text. Do not change any values." |
| Summarize results | "Summarize the QA results for a release decision." |
| Check the environment | "Diagnose the QA environment." → `qa_doctor` |
| Inspect a third-party app | "Find Instagram's app ID, launch it, and inspect the login screen without tapping or typing." → `qa_apps` → `qa_launch` → inspection |
| Finish | "QA is done; clean up." → `qa_finish` (clears the phone's 'Automation Running' indicator) |

### 2) Use `/` commands for guided workflows

In Claude Code, type `/` and find `mobile-qa`. Choose one of four prompts and provide its arguments.

| Command | Arguments (**bold** = required) | Example |
|---|---|---|
| `/mcp__mobile-qa__plan_qa` | **feature**, depth(smoke/standard/deep), source | `Edit todo`, `standard` |
| `/mcp__mobile-qa__run_qa` | **scenario**, logFile, allowDanger(yes), reportLanguage(en/ko/ja) | `qa/scenarios/todo-002.md`, `/tmp/qa_run.log` |
| `/mcp__mobile-qa__explore_qa` | **area**, focus, logFile, reportLanguage(en/ko/ja) | `Entire My tab`, `broken text` |
| `/mcp__mobile-qa__report_qa` | **scenarios**, audience, reportLanguage(en/ko/ja) | `qa/scenarios`, `release decision` |

> The `/` menu lists prompts only. To see the 18 tools, use `/mcp` → `mobile-qa` → **View tools**.
> If new tools do not appear after an update, use `/reload-plugins` or **Reconnect** in `/mcp`.

### 3) Diagnose the environment first

Ask "Diagnose the QA environment." `qa_doctor` checks the device, automation agent, and Dart connection, then returns a table of **available capabilities and recovery steps**. Use it when tools fail unexpectedly to distinguish environment problems from app bugs.

### 4) Launch the app before testing text input in Flutter

```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <device> --print-dtd > /tmp/qa_run.log 2>&1
```

Pass this path as `run_qa`'s `logFile`, or tell the agent "The app is running; the log is /tmp/qa_run.log." See [prerequisites](#2-prerequisites) for the complete setup.

---

## Contents

1. [Capabilities and limitations](#1-capabilities-and-limitations)
2. [Prerequisites](#2-prerequisites)
3. [Installation and registration](#3-installation-and-registration)
4. [Usage](#4-usage) — **start with 4-0 if you are new**
5. [Tool reference](#5-tool-reference) — selectors, waits, run recording, and diagnostics
6. [Safeguards and project configuration](#6-safeguards-and-project-configuration)
7. [Troubleshooting](#7-troubleshooting)
8. [Making your app easier to test](#8-making-your-app-easier-to-test)

---

## 1. Capabilities and limitations

The following observations come from QA on physical devices.

### Supported operations

| Task | Tool or method | Notes |
|---|---|---|
| Read screen text, buttons, and input values | `qa_read_screen` | Flutter `Text`, Material buttons, and input fields are exposed by name |
| Tap text buttons, menus, and bottom tabs | `qa_tap` | For example: Close, Terms and Policies, Continue with Google, Home, Calendar |
| Handle iOS permission dialogs | `qa_dismiss_system` / `qa_tap` | Notifications, local network, and tracking |
| Enter text | `qa_type` | Focus through mobile → enter through Dart → verify the value |
| Check enabled/disabled states and text presence | `qa_expect` | For example, Save becomes enabled after entering a title |
| Scroll and pull to refresh | `qa_swipe` | |
| Launch or restart an app | `qa_launch` | |
| Clean up after QA (clear iOS 'Automation Running') | `qa_finish` | |
| Inspect runtime errors and crashes | `qa_errors` | |
| Test push taps and deep-link routing (simulator) | Shell: `xcrun simctl push` / `simctl openurl`, then verify with this server | See [4-4](#4-4-push-notifications-and-deep-links-simulator) |

Example of a bug found in practice: comparing text with `qa_read_screen` revealed schedule times displayed with a nine-hour offset.

### Conditional support

| Task | Requirement or limitation |
|---|---|
| **Icon-only buttons** (back, close, settings, edit, delete) | Without accessibility labels, use coordinates with `qa_tap_xy`. Add `tooltip`/`Semantics` to use `qa_tap`; see [section 8](#8-making-your-app-easier-to-test) |
| **WebView content** (OAuth pages, embedded web pages) | When elements are not exposed, inspect `qa_screenshot` and use `qa_tap_xy` |
| Flutter text input | Requires a Dart connection (`qa_connect`) and an app launched with a flutter_driver entry point for the tested physical iOS path |

### Not supported or requires a person

- Passwords, verification codes, Face ID, and personal account selection
- Payment confirmation and app-store sign-in
- Verifying actual home-screen widget rendering or delivery of real server push notifications (`simctl push` can test tap routing in a simulator)
- Screen recording (no file was produced in physical iOS testing)

### 1-1. Support by app type

The observations above focus on Flutter. Support varies according to the underlying server each tool uses.
Dart connections (`qa_connect` with `logFile`) are for Flutter only. **Native apps use the device connection without Dart**.

| Tool | Backend | Flutter | Native iOS (UIKit / SwiftUI) | Native Android (View / Compose) |
|---|---|---|---|---|
| `qa_read_screen` | mobile | ✅ `Text` and Material widgets | ✅ Standard controls generally expose accessibility well | ✅ `contentDescription` / text |
| `qa_tap` | mobile → Dart fallback for Flutter | ✅ Text buttons; coordinates for unlabeled icons | ✅ `accessibilityLabel`; coordinates for unlabeled image buttons | ✅ `contentDescription` |
| `qa_type` | Dart when connected / device keyboard | ✅ **Dart required on the tested physical iOS path**: Flutter fields do not open the device keyboard | ✅ Device keyboard | ✅ Device keyboard |
| `qa_expect` · `qa_swipe` · `qa_tap_xy` · `qa_screenshot` | mobile | ✅ | ✅ | ✅ |
| `qa_dismiss_system` · `qa_launch` · `qa_apps` · `qa_finish` | mobile | ✅ | ✅ | ✅ Default dialog rules target Korean, English, and Japanese iOS text; extend through project configuration |
| `qa_wait_until` · `qa_run_start` / `qa_step` / `qa_run_end` · `qa_doctor` | mobile (+ Dart) | ✅ | ✅ | ✅ |
| `id` selector (accessibility identifier) | mobile | ✅ `Semantics(identifier:)` (Flutter 3.19+) | ✅ `accessibilityIdentifier` | ✅ `resource-id` |
| `key` selector (ValueKey) | Dart | ✅ | ❌ | ❌ |
| `qa_errors` | Dart + mobile | ✅ Runtime errors + crashes | ⚠️ Crash list only | ⚠️ Crash list only |
| `qa_connect` | mobile (+ Dart) | Device + Dart | Device only (omit `logFile`) | Device only |
| Widget tree / Flutter widget-based taps | Dart | ✅ | ❌ | ❌ |

Verified on the native iOS **Settings app**: launching, listing elements, tapping, swiping, and the Home button. Native text input is implemented through the device keyboard but has not yet been validated on a physical device.

**Other frameworks**

| Framework | Support | Notes |
|---|---|---|
| React Native | Common device path implemented; RN app validation pending | Accessibility labels and identifiers must be exposed by the app; see [details below](#1-2-react-native-and-the-shared-qa-layer) |
| WebView / hybrid (Capacitor, etc.) | ⚠️ Web content often exposes few elements | Screenshots + coordinates; a web tool such as Playwright is better suited to the web portion |
| Game engines (Unity, etc.) / canvas rendering | ⚠️ Little or no accessibility tree | Screenshots + coordinates only |

**Native app workflow**

```text
qa_connect()                      # No logFile: device connection only
qa_launch(packageName: "com.example.app")
qa_dismiss_system()
qa_read_screen() → qa_tap(text: "…") → qa_type(field: "Email", text: "…") → qa_expect(…)
qa_finish()
```

The workflow prompts (`plan_qa`, `run_qa`, `explore_qa`, `report_qa`) also work here. Omit `logFile` in `run_qa`.

### 1-2. React Native and the shared QA layer

The common tools operate on **OS accessibility information and device input**, rather than React components. React Native apps can therefore use the same QA workflow as native apps, subject to the elements and values exposed on each platform.

| Capability | React Native path and limits |
|---|---|
| Read screens, tap, swipe, launch, and take screenshots | Shared mobile-mcp path; reliable targeting depends on exposed accessibility elements |
| Enter text | Device keyboard, without Dart. Existing content may be appended to; inspect the field before retrying |
| Verify input and screen state | The target field must expose its actual value for exact input verification. Hidden or unavailable values cannot be verified automatically |
| Plan scenarios, explore, record runs, recover from failures, and report in en/ko/ja | Shared tools and agent workflows; the recent verification and recovery improvements also apply to this path |
| Inspect the React component tree, props, or state | Not implemented |
| Collect JavaScript/Hermes runtime errors | Not implemented. Without Dart, `qa_errors` uses the device crash-list path; it does not collect React Native JavaScript errors |

Use the native workflow above with **`qa_connect()` without `logFile` or `dtdUri`**. Flutter SDK and a flutter_driver entry point are not required for React Native. When switching from a Flutter session, finish that session with `qa_finish` before connecting to the RN app, so the previous Dart connection is not reused.

Add meaningful `accessibilityLabel`/`accessibilityRole` values and stable `testID` values where appropriate. A `testID` is **not guaranteed to appear as this server's `id` selector on every platform or component**: inspect `qa_read_screen` and use the identifiers or refs actually returned. Parent accessibility grouping and custom controls may affect which children are exposed. See the official [React Native accessibility guide](https://reactnative.dev/docs/accessibility) and [testID documentation](https://reactnative.dev/docs/view#testid).

**Validation status:** this project has not yet validated a React Native app end to end on iOS or Android. The shared code path and offline tests establish implementation coverage, not RN device compatibility. Confirm element/identifier exposure, input-value reading, keyboard behavior, scrolling, and dialogs on the target app before relying on it for release QA.

### Practical caveats

- **One-time overlays** (onboarding showcases or promotional popups) can block the flow. Scenarios should **read the screen, decide, then act**, instead of relying on memorized coordinates.
- A swipe may be interpreted as a tap and open an unintended card. For pull to refresh, set `fromY` near the top/header.
- Default dialog rules and danger words cover **Korean, English, and Japanese**. Add other languages or app-specific text through [project configuration](#project-configuration-file-optional).

---

## 2. Prerequisites

### Common requirements

- Node.js 20+
- For Flutter apps: Flutter SDK. **fvm is optional**. If the project contains `.fvmrc` or `.fvm/fvm_config.json`, the server uses `fvm dart`; otherwise, it uses `dart` on PATH. Set the project root with `QA_PROJECT_DIR`.

### iOS simulator

- Xcode command-line tools and a booted simulator (`xcrun simctl boot <udid>`).

### Physical iOS device

1. Connect over USB, unlock the device, trust the computer, and enable Developer Mode.
2. **Install the automation agent** once; reinstall when the provisioning profile expires.

   ```bash
   # mobilecli downloaded by mobile-mcp
   MOBILECLI=$(ls ~/.npm/_npx/*/node_modules/@mobilenext/mobilecli-darwin-arm64/mobilecli-darwin-arm64 | head -1)
   $MOBILECLI agent install --device <device-UDID> \
     --provisioning-profile "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/<wildcard-development-profile>.mobileprovision"
   ```

   The profile must have a **wildcard App ID (`TEAMID.*`)**, allow development (`get-task-allow`), include this device's UDID, and be unexpired. Inspect it with `security cms -D -i <file>` and check `application-identifier` and `ProvisionedDevices`.
   An agent app appears on the phone's home screen. The clock may turn red during automation.

### Android

- `adb` (Android platform-tools): `brew install --cask android-platform-tools`.
- An emulator or a device with USB debugging enabled.

### Flutter app setup for text input and widget-based taps

> Native apps can skip this section. Install the debug/QA build on the device.

Create a **QA-only entry point** that enables the flutter_driver extension. Do not use it for store builds.

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

Launch with **DTD address output enabled**:

```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <device> --print-dtd > /tmp/qa_run.log 2>&1
# Ready when the log contains:
# The Dart Tooling Daemon is available at: ws://127.0.0.1:…
```

---

## 3. Installation and registration

```bash
git clone <repository-url> ~/Desktop/mobile-qa-mcp   # Or copy the repository
cd ~/Desktop/mobile-qa-mcp
npm install && npm run build
```

Register in Claude Code from the root of the app project you want to test:

```bash
claude mcp add mobile-qa --scope project \
  -e QA_PROJECT_DIR="$PWD" \
  -e QA_DEVICE=<device-UDID> \
  -- node ~/Desktop/mobile-qa-mcp/dist/index.js
```

Omit `-e QA_DEVICE=…` to use the first device. **Restart Claude Code** after registration to load the tools.

| Environment variable | Default | Description |
|---|---|---|
| `QA_DEVICE` | First device | mobile-mcp device ID |
| `QA_PROJECT_DIR` | Current directory | Project root: Dart MCP working directory, fvm detection, configuration (`qa/qa.config.json`), and run storage |
| `QA_DART_CMD` | `fvm dart mcp-server` if fvm is configured; otherwise `dart mcp-server` | Override for another setup, e.g. `/opt/flutter/bin/dart mcp-server` or `puro dart mcp-server` |
| `QA_CONFIG` | `<project>/qa/qa.config.json` | Project configuration path |
| `QA_RUNS_DIR` | `<project>/qa/runs` | Run recording directory |
| `QA_MOBILE_MCP` | `@mobilenext/mobile-mcp@1.0.5` | Pinned version; tool-name changes may require updates to this server |

> You do not need to register mobile-mcp or Dart MCP separately. This server starts them internally.

### Migrating from the previous name

If you used `flutter-mobile-qa-mcp`, update the checkout/executable path to `mobile-qa-mcp`. Replace the old MCP registration `flutter-mobile-qa` with `mobile-qa` using the command above, preserving your `QA_*` settings, and reconnect the client. Slash commands now use `/mcp__mobile-qa__…`.

For the optional skill, install `skills/mobile-qa` and remove the old installed `flutter-mobile-qa` skill to avoid duplicate discovery. The `qa_*` tool names, prompt names, `qa://` resources, configuration keys, and existing scenario/run files stay compatible.

---

## 4. Usage

### 4-0. Built-in QA workflow

The server provides a workflow to help decide **what to test and in which order**.

| Stage | Interface | What happens | Device interaction |
|---|---|---|---|
| ① Plan | `plan_qa` prompt | Read the feature description, related code, and UI strings; write a **scenario set** (happy path, boundaries, state propagation, undo, permissions, regression) to `qa/scenarios/*.md` | None with source access; black-box inspection requires confirmation |
| ② Review | Human | Read and edit the scenario files (Markdown tables) | None |
| ③ Run | `run_qa` prompt | Confirm the planned actions, execute each step, check with `qa_expect`, append PASS/FAIL results, and clean up test data | Yes |
| ④ Report | `report_qa` prompt | Summarize release readiness, blocking issues, reproduction steps, and next actions | None |
| As needed: explore | `explore_qa` prompt | Browse without a scenario to find broken text, blank screens, and errors, without changing data | Yes |

In Claude Code, prompts appear as `/` commands such as `/mcp__mobile-qa__plan_qa`. You can also ask "Write QA scenarios for creating a todo."

**Included guidance**

- **Server instructions**: principles delivered to the agent when it connects — read → decide → act → verify, prefer text, clean up data, involve a person for dangerous actions and authentication, and confirm before device interaction.
- **Scenario format**: [guides/SCENARIO_FORMAT.md](guides/SCENARIO_FORMAT.md), also available as `qa://guides/scenario-format`.
- **Example scenario**: [guides/example-schedule-create.md](guides/example-schedule-create.md).
- **Optional Claude Code skill**: [skills/mobile-qa/SKILL.md](skills/mobile-qa/SKILL.md) routes natural-language requests into these workflows. Install with `cp -r skills/mobile-qa ~/.claude/skills/`.

**Example session**

```text
You: Write standard-depth QA scenarios for todos.
→ Creates qa/scenarios/todo-001 through todo-005 and presents a summary table.
You: (After reviewing) Run todo-001 and todo-002. The log is /tmp/qa_run.log.
→ Summarizes actions, requests confirmation, runs the scenarios, and appends results.
You: Summarize the results for a release decision.
→ Produces a report.
```

### 4-1. Basic flow with direct tool calls

```text
qa_doctor(logFile: "/tmp/qa_run.log")      # Diagnostics; omit logFile for native/third-party apps
qa_connect(logFile: "/tmp/qa_run.log")     # Device + Dart connection for Flutter
qa_run_start(name: "TODO-002")            # Start recording (optional)
qa_dismiss_system()                      # Handle permission dialogs and popups
qa_read_screen()                         # Read the screen → refs r1, r2, …
qa_tap(ref: "r12", waitFor: {text: "…", state: "present"})
qa_type(field: "…", text: "…")
qa_expect(text: "…", state: "enabled", timeoutMs: 5000)
qa_step(title: "…", expected: "…", result: "pass")
qa_run_end()                             # Generate report.md
qa_finish()                              # Stop the device agent
```

Action tools return a **screen summary after the action**, including fresh refs where applicable, so you can often reuse that result instead of calling `qa_read_screen` separately.

### 4-2. Example requests

```text
Use mobile-qa to navigate from Home to My to Terms and Policies and back.
Check each screen for broken text or errors.
```

```text
Create a schedule titled "QA 테스트". After saving, verify that the home card shows
the same title and time as the editor. Delete that schedule afterward; deletion is allowed.
```

```text
Inspect the toggles on the Settings screen and list their labels and on/off states
in a table. Do not change any values.
```

### 4-3. Example: create a schedule

This example targets a Korean UI. Keep these strings in Korean when testing that UI.

```text
qa_read_screen(filter: "일정")
  → "r18 일정을 공유해보세요 @214,661"
qa_tap(ref: "r18", waitFor: {text: "일정을 생성할게요"})
  → Wait PASS (620ms) + creation screen summary
qa_expect(text: "일정을 생성할게요", state: "disabled")
  → PASS (title is empty)
qa_type(field: "제목을 입력해주세요", text: "QA 테스트")
  → Input completed and verified
qa_expect(text: "일정을 생성할게요", state: "enabled", timeoutMs: 3000)
  → PASS
qa_tap(text: "일정을 생성할게요", waitFor: {text: "QA 테스트"})
  → Home summary includes "나 / QA 테스트 / 오후 12:00 ~ 오후 1:00"
```

If multiple buttons share a label, `qa_tap` returns candidates with refs and positions. Retry using the intended `ref`.

### 4-4. Push notifications and deep links (simulator)

This server verifies the result; send the notification or open the URL from the shell.

```bash
# Push: FCM needs gcm.message_id in the payload to forward tap events
cat > push.apns <<'JSON'
{"aps":{"alert":{"title":"t","body":"b"}},"gcm.message_id":"1","messageType":"VIEW_CALENDAR"}
JSON
xcrun simctl push <udid> <bundle-ID> push.apns
# Deep link: if iOS asks to open the app, tap its Open button using qa_tap
xcrun simctl openurl <udid> 'myscheme://open?…'
```

### 4-5. Reducing token usage

- Prefer `qa_read_screen` (text) to `qa_screenshot` (image), and use `filter` for the relevant area.
- Use `qa_expect` for one-line PASS/FAIL checks.
- Reserve images for **visual checks**, such as layout and color.

### 4-6. Third-party app QA (black box)

Apps without source access can be tested through the device connection. Even for Flutter apps, without Dart access they use the same path as native apps.

1. Find the bundle ID with `qa_apps(filter: "app name")`, then call `qa_launch(packageName)`.
2. When source is unavailable, `plan_qa` uses **black-box inspection**: after confirmation, browse without changing data to collect the actual UI text and flow, then write scenarios.
3. Use `run_qa` and `explore_qa` as usual. Scenarios and run records go under `qa/` in the current working directory.

Caveats:

- Third-party app actions can affect **real services**, including payments, posts, messages, and follows. Keep exploration to navigation without saving or sending. Add app-specific danger words to `qa/qa.config.json`.
- Use a test account and stay within the service's terms.
- Text input in third-party Flutter apps may fail on physical iOS devices because the keyboard does not appear and Dart access is unavailable. Simulators and Android generally support the device keyboard path.

---

## 5. Tool reference

### Selectors

Used by `qa_tap`, `qa_type`, and `qa_expect` where supported. `qa_type` calls its text selector `field`.

| Selector | Example | Meaning |
|---|---|---|
| `ref` | `r12` | A reference from the latest screen read or action summary. The label and position are rechecked before use; a changed target is rejected |
| `id` | `todo_title` | Accessibility identifier. **Most durable across wording and language changes**; see [section 8](#8-making-your-app-easier-to-test) |
| `text` | `저장` | Visible text: exact match first, then substring match. Set `exact: true` for exact matching only |
| `index` | `1` | Zero-based candidate index when multiple elements match |
| `key` (`qa_tap` only) | `save_button` | Flutter `ValueKey<String>`; requires Dart |

Ambiguous matches return a **candidate list without tapping**, including refs and positions, to avoid pressing the wrong button when labels repeat.

### Waiting

- Action tools (`qa_tap`, `qa_tap_xy`, `qa_swipe`, `qa_launch`) accept `waitFor: {text|id, state}` and `timeoutMs` to **wait for a condition**. Otherwise, they wait for **screen stability** (two identical consecutive reads, normally up to three seconds; launch uses its own timeout).
- `qa_expect(..., timeoutMs)` retries until the condition matches or times out. Use `qa_wait_until` for loading indicators to disappear (`absent`), buttons to become enabled (`enabled`), or screen stability (`stable: true`).

### Verification and recovery

- `qa_expect(state: "absent")` passes only for a valid selector with no matching element. `STALE_REF` and `INVALID_SELECTOR` are failures. Use a stable `id` or exact `text` to verify absence after deletion or navigation. `present`/`absent` can test multiple matches; `enabled`/`disabled` requires a unique target or explicit `index`.
- `qa_type` verifies the **exact value of the same input field**. Text elsewhere on screen does not count. Prefer `id` so verification can follow a field that moves when the keyboard opens. Without an ID, the label, type, and nearby position must still identify one field. Hidden, masked, or unavailable values cannot be verified automatically. `timeoutMs` controls verification polling (default 3000 ms); it does not repeat typing.
- Stability waits require two identical consecutive accessibility snapshots. If the deadline expires, tools return `WAIT_TIMEOUT` as an error along with the last screen summary. A failed wait does not mean the preceding tap or launch failed. On animated screens, prefer a specific `waitFor` condition.
- The skill and execution prompts allow **at most one corrective retry per failed step**. Inspect the current state first, preserve the original failure, and skip dependent steps if recovery fails. Never repeat Save, Send, Create, Delete, or payment actions while their outcome is uncertain. Run `qa_doctor` once for connection problems; resume only after required capabilities recover.

### Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `qa_doctor` | `logFile?`, `dtdUri?` | Diagnostic table: Node, mobile-mcp, device, automation agent, screen reading, identifiers, Dart, flutter run log, DTD, flutter_driver; available capabilities and recovery steps |
| `qa_connect` | `logFile?`, `dtdUri?`, `device?` | Select device; for Flutter, connect to DTD and apply `set_frame_sync false`. Omit `logFile` for native/third-party apps |
| `qa_apps` | `filter?` | Search installed app names and bundle IDs |
| `qa_launch` | `packageName`, `restart?`, `waitFor?`, `timeoutMs?` | Launch/restart → wait for stability or condition → screen summary |
| `qa_read_screen` | `filter?`, `limit?`(60) | Compact lines: `ref [type]text = value id=identifier (disabled) @x,y` |
| `qa_tap` | Selector, `key?`, `allowDanger?`, `waitFor?`, `timeoutMs?` | Tap a match; Flutter text/tooltip fallback when not found. Apply danger-word checks, wait, then return a screen summary |
| `qa_tap_xy` | `x`, `y`, `waitFor?`, `timeoutMs?` | Coordinate tap for unlabeled targets. Danger-word checks do not apply |
| `qa_type` | `field?`/`id?`/`ref?`, `index?`, `text`, `timeoutMs?`(3000) | Focus field → enter text through Dart `enter_text` or device keyboard → verify value |
| `qa_expect` | Selector, `state?`, `timeoutMs?` | One-line PASS/FAIL; automatically capture evidence on failure during a recorded run |
| `qa_wait_until` | `text?`/`id?`, `state?`, `stable?`, `timeoutMs?`(10000) | Wait for a condition or stable screen |
| `qa_dismiss_system` | None | Dismiss blocking dialogs using Korean/English/Japanese defaults and project rules |
| `qa_swipe` | `direction`, `fromY?`, `distance?`, `waitFor?`, `timeoutMs?` | Swipe; when specifying `fromY`, start horizontally at the screen center |
| `qa_screenshot` | None | Screenshot image |
| `qa_errors` | None | Flutter runtime errors when connected to Dart, plus device crash list |
| `qa_run_start` | `name`, `scenario?`, `app?`, `appVersion?`, `dir?`, `reportLanguage?` | Start recording and create the run directory below |
| `qa_step` | `title`, `expected?`, `result`(pass/fail/skip), `actual?`, `note?` | Record a step result; capture evidence on failure |
| `qa_run_end` | `summary?` | Generate `report.md`; return result counts and path |
| `qa_finish` | None | Close an active run, stop the device agent/mobilecli daemon, and disconnect underlying servers |

### Run directory

```text
qa/runs/20260928-112000-TODO-002/
├── meta.json        Device, app/version, git branch/commit/dirty state, Dart connection
├── steps.jsonl      Tool calls (name, arguments, result, ms) and qa_step results
├── report.md        Summary (PASS/FAIL/SKIP/tool errors) and step table with evidence
└── evidence/        On failure: 003-expect-저장.png, .elements.txt (raw screen elements),
                     and .errors.txt (runtime errors/crashes)
```

Only summaries and paths return to the conversation to save tokens. Change the location with `QA_RUNS_DIR` or the `runsDir` configuration key.

### Report language

Set `reportLanguage` to `en`, `ko`, or `ja` in `qa_run_start`, or in `qa/qa.config.json`. Precedence: **tool argument → project setting → `en`**. The chosen language is saved in `meta.json` and used for `report.md` headings and table labels throughout the run.

```text
qa_run_start(name: "TODO-002", reportLanguage: "ko")
```

The `run_qa`, `explore_qa`, and `report_qa` prompts also accept `reportLanguage`. When omitted, the agent follows the requested/conversation language when supported; run recording otherwise falls back to project configuration. Step descriptions, summaries, raw UI text, and evidence are stored as supplied, without automatic translation. Existing report files are unchanged.

**Prompts**: `plan_qa(feature, depth?, source?)` · `run_qa(scenario, logFile?, allowDanger?, reportLanguage?)` · `explore_qa(area, focus?, logFile?, reportLanguage?)` · `report_qa(scenarios, audience?, reportLanguage?)`

**Resources**: `qa://guides/scenario-format` · `qa://guides/example-schedule-create`

---

## 6. Safeguards and project configuration

- **Danger-word blocking**: `qa_tap` checks words such as 삭제, 탈퇴, 로그아웃, 결제, 구매, 구독하기, 초기화, 해지 / Delete, Remove, Log out, Sign out, Purchase, Buy, Subscribe, Pay, Reset, Deactivate / 削除, 退会, ログアウト, 購入, 決済, 解約. Matching text requires `allowDanger: true`; the actual accessibility label of a resolved element is also checked.
- `qa_tap_xy` cannot identify the action at a coordinate, so danger-word blocking does not apply. Inspect `qa_screenshot` first.
- QA on real accounts creates real data, and sharing/social features can **notify other users**. Use dedicated QA accounts. See [third-party app caveats](#4-6-third-party-app-qa-black-box).

### Project configuration file (optional)

Use `qa/qa.config.json` for app-specific danger words and dialog rules. Override its path with `QA_CONFIG`. Without a file, only defaults apply.

The example below targets a Korean UI; keep its labels in the app's language.

```json
{
  "dangerWords": ["연결 끊기", "계정 전환"],
  "replaceDangerWords": false,
  "dismissRules": [
    { "when": "이벤트", "tap": "오늘 하루 보지 않기" },
    { "when": "", "tap": "나중에" }
  ],
  "runsDir": "qa/runs",
  "reportLanguage": "en"
}
```

| Key | Meaning |
|---|---|
| `dangerWords` | **Append** app-specific words to the default list |
| `replaceDangerWords` | When `true`, use only `dangerWords` instead of the defaults |
| `dismissRules` | For `qa_dismiss_system`, tap `tap` when `when` appears on screen; `when: ""` always matches. Project rules run **before** defaults |
| `runsDir` | Run directory, relative to the project root |
| `reportLanguage` | Report heading language: `en` (default), `ko`, or `ja`. Overridden by `qa_run_start.reportLanguage` |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dart tap/input: `Timed out waiting for Flutter Driver response` | Frame synchronization waits on **continuous animation**, such as ads or Lottie | `qa_connect` applies `set_frame_sync false` automatically; disable it first when calling the driver directly |
| Physical-device screenshot: `timed out waiting for WebDriverAgent` | Agent not running or developer disk image inactive | Unlock the phone, run `xcrun devicectl device process launch --device <coredevice-id> com.mobilenext.devicekit-iosUITests.xctrunner` once to activate the image, then retry |
| `agent is not installed` | Missing automation agent | Follow [physical iOS setup](#physical-ios-device) |
| Text was sent but the field is empty | Flutter fields on physical iOS may not open the device keyboard | Use `qa_type` with Dart |
| `qa_type` reports that the value is not visible after input | Focus may have failed | Use `qa_read_screen` to check whether the field is obscured; focus with `qa_tap` if needed |
| `qa_tap` cannot find a tab name | Label includes a badge or other text, e.g. `new\n함께하기` | Default substring matching usually works; check whether `exact: true` was set |
| `qa_tap` returns multiple candidates | Repeated labels | Retry with a returned `ref` or `index`; add app identifiers if it recurs |
| Ref is gone or moved | Screen changed after reading (scroll/popup) | Read again with `qa_read_screen` and use a fresh ref |
| Cause unclear | Could be environment or app | Run `qa_doctor` |
| Nothing responds on the first run | iOS permission dialog is in front | Run `qa_dismiss_system` |
| 'Automation Running' remains on the phone | Device agent is still running after QA | Run `qa_finish` |
| Dart connection fails | Missing `--print-dtd` or address changed after app restart | Relaunch with `flutter run … --print-dtd` and reconnect using the new log |

---

## 8. Making your app easier to test

- **Label icon buttons**: use `IconButton(tooltip: '뒤로')` or wrap custom tap targets in `Semantics(label: '뒤로', button: true, child: …)`. Use the actual UI language. Apply this in shared design-system components to improve QA and VoiceOver/TalkBack across the app.
- **Add identifiers** for the largest reliability improvement across wording/language changes. They appear as `id=…` in `qa_read_screen` and can be selected with `qa_tap(id: …)`.
  - Flutter 3.19+: `Semantics(identifier: 'todo_save', child: …)` exposes an iOS accessibilityIdentifier / Android resource-id without Dart.
  - Flutter `ValueKey('todo_save')` works with `qa_tap(key: …)` but requires Dart.
  - Native iOS: `accessibilityIdentifier` / SwiftUI `.accessibilityIdentifier(…)`. Android: `android:id`, or Compose `Modifier.testTag(…)` with `testTagsAsResourceId`.
- **Add hints or labels to input fields** so `qa_type(field: …)` can find them.
- **Use dedicated QA accounts and data**, separate from real users.
- **Provide QA-build flags to disable one-time guides/popups** to simplify scenarios.
