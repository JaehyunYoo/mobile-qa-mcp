/**
 * qa_doctor — 환경 진단. 앱 버그와 환경 문제를 구분하기 위해, 각 연결 단계를 차례로 확인하고
 * "지금 쓸 수 있는 기능 / 못 쓰는 기능 / 복구 방법"을 표로 돌려준다.
 * 실제로 겪은 문제를 기준으로 한다: 에이전트 미설치, 개발자 디스크 이미지 비활성, DTD 옵션 누락, driver 확장 없음, frame sync.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DART_CMD, MOBILE_PKG, PROJECT_DIR, callChild, dart, driver, driverFailed, mobile, parseElements, state, textOf, withTimeout } from "./core.js";

type Row = { item: string; status: "✅" | "⚠️" | "❌" | "—"; detail: string; fix?: string };

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: PROJECT_DIR, timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return `ERR ${(e as Error).message.split("\n")[0]}`;
  }
};

export async function runDoctor(opts: { logFile?: string; dtdUri?: string }): Promise<string> {
  const rows: Row[] = [];
  const can = { screen: false, tapText: false, typeNative: false, typeFlutter: false, flutterTap: false, errors: false };

  // 1) Node
  const major = Number(process.versions.node.split(".")[0]);
  rows.push({ item: "Node.js", status: major >= 20 ? "✅" : "❌", detail: process.versions.node, fix: major >= 20 ? undefined : "Node 20+ 설치" });

  // 2) mobile-mcp + 기기 목록
  let devicesText = "";
  try {
    devicesText = textOf(await withTimeout(callChild(mobile(), "mobile_list_available_devices", {}), 90000, "mobile-mcp 기동"));
    rows.push({ item: `mobile-mcp (${MOBILE_PKG})`, status: "✅", detail: "기동" });
  } catch (e) {
    rows.push({ item: `mobile-mcp (${MOBILE_PKG})`, status: "❌", detail: (e as Error).message, fix: "네트워크(npx 설치) 확인, `npx -y " + MOBILE_PKG + "` 직접 실행해 오류 확인" });
  }
  type Dev = { id: string; name: string; platform: string; type: string; state: string; version?: string };
  let devices: Dev[] = [];
  try {
    devices = JSON.parse(devicesText).devices ?? [];
  } catch {}
  const target = devices.find((d) => d.id === state.deviceId) ?? devices[0];
  if (!devices.length && devicesText) {
    rows.push({ item: "기기", status: "❌", detail: "연결된 기기·부팅된 시뮬레이터 없음", fix: "실기기: USB 연결·잠금 해제·신뢰 / 시뮬레이터: `xcrun simctl boot <udid>` / Android: `adb devices`" });
  } else if (target) {
    if (!state.deviceId) state.deviceId = target.id;
    rows.push({
      item: "기기",
      status: target.state === "online" || target.state === "booted" || !target.state ? "✅" : "⚠️",
      detail: `${target.name} · ${target.platform} ${target.version ?? ""} · ${target.type} · ${target.id}${devices.length > 1 ? ` (총 ${devices.length}대 — QA_DEVICE 로 고정 권장)` : ""}`,
    });
  }

  // 3) 화면 읽기(= 실기기 iOS 는 조작 에이전트 필요)
  if (target) {
    try {
      const raw = textOf(await withTimeout(callChild(mobile(), "mobile_list_elements_on_screen", { device: target.id }), 60000, "화면 읽기"));
      if (/agent is not installed/i.test(raw)) {
        rows.push({ item: "조작 에이전트", status: "❌", detail: "기기에 에이전트 미설치", fix: "README 2장 'iOS 실기기': `mobilecli agent install --device <id> --provisioning-profile <와일드카드 개발 프로필>`" });
      } else if (/timed out waiting for WebDriverAgent|failed to start agent/i.test(raw)) {
        rows.push({
          item: "조작 에이전트",
          status: "❌",
          detail: "에이전트가 시작되지 않음",
          fix: "폰 잠금 해제 → `xcrun devicectl device process launch --device <coredevice id> com.mobilenext.devicekit-iosUITests.xctrunner` 한 번 실행(개발자 디스크 이미지 활성화) → 재시도. 개발자 신뢰(설정 > 일반 > VPN 및 기기 관리) 확인",
        });
      } else if (/^Error/i.test(raw)) {
        rows.push({ item: "화면 읽기", status: "❌", detail: raw.slice(0, 200) });
      } else {
        const els = parseElements(raw);
        can.screen = true;
        can.tapText = true;
        can.typeNative = true;
        can.errors = true;
        rows.push({
          item: "화면 읽기",
          status: els.length ? "✅" : "⚠️",
          detail: `요소 ${els.length}개${els.some((e) => e.id) ? `, 식별자(id) ${els.filter((e) => e.id).length}개` : ", 식별자(id) 없음 — Semantics(identifier)/accessibilityIdentifier 를 달면 id 로 선택 가능"}`,
          fix: els.length ? undefined : "웹뷰·캔버스 화면이거나 잠금 화면일 수 있음 — qa_screenshot 으로 확인",
        });
      }
    } catch (e) {
      rows.push({ item: "화면 읽기", status: "❌", detail: (e as Error).message, fix: "기기 잠금 해제, 에이전트 상태 확인" });
    }
  }

  // 4) Dart / Flutter (선택)
  const dartVer = sh(DART_CMD[0], DART_CMD[0] === "fvm" ? ["dart", "--version"] : ["--version"]);
  const dartOk = !dartVer.startsWith("ERR");
  rows.push({
    item: `Dart (${DART_CMD.join(" ")})`,
    status: dartOk ? "✅" : "—",
    detail: dartOk ? dartVer.split("\n").pop()! : "없음 — 네이티브 앱이면 무관",
    fix: dartOk ? undefined : "Flutter 앱이면 Dart SDK 설치·PATH 확인, 또는 QA_DART_CMD(예: `dart mcp-server`, fvm 이면 `fvm dart mcp-server`)와 QA_PROJECT_DIR 지정",
  });

  let uri = opts.dtdUri;
  if (!uri && opts.logFile) {
    if (!existsSync(opts.logFile)) {
      rows.push({ item: "flutter run 로그", status: "❌", detail: `${opts.logFile} 없음`, fix: "`flutter run -t <driver entry> --print-dtd > 로그 2>&1` 로 앱 실행" });
    } else {
      const log = readFileSync(opts.logFile, "utf8");
      uri = log.match(/Dart Tooling Daemon is available at: (ws:\/\/\S+)/)?.[1];
      const lost = /Lost connection to device|Application finished/i.test(log.slice(-4000));
      rows.push({
        item: "flutter run 로그",
        status: uri && !lost ? "✅" : "❌",
        detail: uri ? (lost ? "DTD 주소는 있으나 앱 연결이 끊김" : `DTD ${uri}`) : "DTD 주소 없음",
        fix: uri && !lost ? undefined : uri ? "앱을 다시 실행(flutter run … --print-dtd)" : "`--print-dtd` 옵션을 붙여 다시 실행",
      });
    }
  }
  if (uri && dartOk) {
    try {
      const r = textOf(await withTimeout(callChild(dart(), "dtd", { command: "connect", uri }), 30000, "DTD 연결"));
      const connected = /succeeded/i.test(r);
      state.dartConnected = connected;
      rows.push({ item: "DTD 연결", status: connected ? "✅" : "❌", detail: connected ? "연결됨" : r.slice(0, 200), fix: connected ? undefined : "로그의 DTD 주소가 최신인지(앱 재시작 시 바뀜) 확인" });
      if (connected) {
        const h = await withTimeout(driver({ command: "get_health", timeout: "5000" }), 20000, "flutter_driver 확인");
        if (driverFailed(h) || /not found|No extension|Unknown method/i.test(h)) {
          rows.push({
            item: "flutter_driver 확장",
            status: "❌",
            detail: h.slice(0, 160),
            fix: "앱을 `enableFlutterDriverExtension()` 을 부르는 QA 진입점으로 실행(README 2장 '앱 쪽 준비')",
          });
        } else {
          await driver({ command: "set_frame_sync", enabled: "false" });
          can.typeFlutter = true;
          can.flutterTap = true;
          rows.push({ item: "flutter_driver 확장", status: "✅", detail: "응답 정상 · frame sync off(계속 움직이는 화면 대비)" });
        }
      }
    } catch (e) {
      rows.push({ item: "DTD 연결", status: "❌", detail: (e as Error).message });
    }
  } else if (!uri) {
    rows.push({ item: "Flutter 연결", status: "—", detail: "logFile/dtdUri 미지정 — 네이티브 앱이면 무관", fix: "Flutter 앱이면 qa_doctor(logFile: \"…\") 로 다시 진단" });
  }

  // 결과
  const isIosReal = target?.platform === "ios" && target?.type === "real";
  const caps = [
    `${can.screen ? "✅" : "❌"} 화면 읽기·텍스트/id 로 탭·검증·스와이프·스크린샷`,
    `${can.typeFlutter ? "✅" : can.typeNative ? "⚠️" : "❌"} 글자 입력 — ${can.typeFlutter ? "Flutter(Dart)" : can.typeNative ? (isIosReal ? "네이티브 앱만(Flutter 앱은 실기기 iOS 에서 키보드가 안 떠서 Dart 필요)" : "기기 키보드") : "불가"}`,
    `${can.flutterTap ? "✅" : "—"} Flutter 위젯·ValueKey 기준 탭`,
    `${can.errors ? "✅" : "❌"} 크래시 목록${state.dartConnected ? " + Flutter 런타임 에러" : ""}`,
  ];
  return [
    "## qa_doctor",
    "| 항목 | 상태 | 내용 | 복구 방법 |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.item} | ${r.status} | ${r.detail.replace(/\|/g, "/")} | ${r.fix ?? ""} |`),
    "",
    "**지금 가능한 기능**",
    ...caps.map((c) => `- ${c}`),
  ].join("\n");
}
