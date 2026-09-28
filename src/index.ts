#!/usr/bin/env node
/**
 * flutter-mobile-qa-mcp — mobile-mcp(앱 밖: 화면·탭·시스템 창) + Dart MCP(앱 안: 입력·위젯·에러)를 묶은 QA 서버.
 *
 * 핵심은 "합치기"가 아니라 복합 도구 + 응답 요약:
 *  - qa_read_screen 은 수천 줄 요소 목록을 서버 안에서 "보이는 텍스트·버튼 상태" 몇 줄로 줄여서 돌려준다.
 *  - qa_type 은 mobile 로 포커스 → Dart 로 enter_text → mobile 로 값 확인을 한 번에 한다(실기기 iOS 는 키보드가 안 떠서 mobile 입력이 안 먹음).
 *  - 위험 동작(삭제·탈퇴·로그아웃·결제)은 allowDanger 없이는 누르지 않는다.
 *
 * 환경 변수
 *  QA_DEVICE           기기 id(없으면 첫 번째 기기)
 *  QA_PROJECT_DIR      Flutter 프로젝트 루트(Dart MCP 실행 위치, fvm 사용 시 필요)
 *  QA_DART_CMD         Dart MCP 실행 명령(기본 "fvm dart mcp-server", fvm 없으면 "dart mcp-server")
 *  QA_MOBILE_MCP       mobile-mcp 패키지(기본 "@mobilenext/mobile-mcp@1.0.5")
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";

const PROJECT_DIR = process.env.QA_PROJECT_DIR ?? process.cwd();
const DART_CMD = (process.env.QA_DART_CMD ?? "fvm dart mcp-server").split(" ");
const MOBILE_PKG = process.env.QA_MOBILE_MCP ?? "@mobilenext/mobile-mcp@1.0.5";
const DANGER = ["삭제", "탈퇴", "로그아웃", "결제", "구독하기", "구매", "연결 끊기", "Delete", "Logout", "Purchase"];

// ---------------------------------------------------------------- child clients (lazy)
type ToolResult = { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };

async function spawnClient(name: string, command: string, args: string[], cwd?: string): Promise<Client> {
  const client = new Client({ name: `flutter-mobile-qa/${name}`, version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command, args, cwd, stderr: "ignore" }));
  return client;
}
let mobileP: Promise<Client> | undefined;
let dartP: Promise<Client> | undefined;
const mobile = () => (mobileP ??= spawnClient("mobile", "npx", ["-y", MOBILE_PKG]));
const dart = () => (dartP ??= spawnClient("dart", DART_CMD[0], DART_CMD.slice(1), PROJECT_DIR));

async function callChild(c: Promise<Client>, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await (await c).callTool({ name, arguments: args })) as ToolResult;
}
const textOf = (r: ToolResult) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

// ---------------------------------------------------------------- device
let deviceId = process.env.QA_DEVICE;
async function device(): Promise<string> {
  if (deviceId) return deviceId;
  const t = textOf(await callChild(mobile(), "mobile_list_available_devices", {}));
  const m = t.match(/"id":"([^"]+)"/);
  if (!m) throw new Error(`기기를 찾지 못했습니다: ${t.slice(0, 200)}`);
  return (deviceId = m[1]);
}
const m = async (name: string, args: Record<string, unknown> = {}) =>
  callChild(mobile(), name, { device: await device(), ...args });

// ---------------------------------------------------------------- screen model
type El = { type: string; label: string; value: string; x: number; y: number; w: number; h: number; disabled: boolean };
const unq = (s: string) => s.replace(/\\n/g, "\n").replace(/\\r/g, "");

function parseElements(raw: string): El[] {
  const out: El[] = [];
  for (const line of raw.split("\n")) {
    const pos = line.match(/at=(-?\d+),(-?\d+) size=(\d+)x(\d+)/);
    if (!line.startsWith("@") || !pos) continue;
    const type = line.split(" ")[1] ?? "";
    const label = unq(line.match(/ label="([^"]*)"/)?.[1] ?? line.match(/ name="([^"]*)"/)?.[1] ?? "");
    const value = unq(line.match(/ value="([^"]*)"/)?.[1] ?? "");
    if (!label && !value) continue;
    out.push({ type, label, value, x: +pos[1], y: +pos[2], w: +pos[3], h: +pos[4], disabled: / disabled\b/.test(line) });
  }
  // 같은 텍스트가 중첩 요소로 여러 번 나오면 가장 작은(가장 구체적인) 것만 남긴다.
  const best = new Map<string, El>();
  for (const e of out) {
    const k = `${e.label}|${e.value}`;
    const b = best.get(k);
    if (!b || e.w * e.h < b.w * b.h) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}
async function screen(): Promise<El[]> {
  return parseElements(textOf(await m("mobile_list_elements_on_screen")));
}
const NOISE = /^(Wi‑?Fi|총 \d|배터리|\d{1,2}:\d{2}$|Home screen icons|label-view)/;
function summarize(els: El[], limit = 60): string {
  const lines = els
    .filter((e) => !NOISE.test(e.label))
    .slice(0, limit)
    .map((e) => {
      const text = [e.label, e.value && e.value !== e.label ? `= ${e.value}` : ""].filter(Boolean).join(" ").replace(/\n/g, " / ");
      const kind = /Button|TextField|Switch|Cell|Icon|Image/.test(e.type) ? `[${e.type}]` : "";
      return `${kind}${text}${e.disabled ? " (비활성)" : ""}  @${e.x + (e.w >> 1)},${e.y + (e.h >> 1)}`;
    });
  return lines.join("\n") || "(읽을 수 있는 요소 없음 — 웹뷰/이미지 화면일 수 있음. qa_screenshot 사용)";
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
function find(els: El[], text: string, exact: boolean): El | undefined {
  const t = norm(text);
  const hit = (s: string) => (exact ? norm(s) === t : norm(s).includes(t));
  return els.find((e) => norm(e.label) === t || norm(e.value) === t) ?? (exact ? undefined : els.find((e) => hit(e.label) || hit(e.value)));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

// ---------------------------------------------------------------- dart connection
let dartConnected = false;
async function ensureDart(): Promise<boolean> {
  return dartConnected;
}
async function driver(args: Record<string, unknown>): Promise<string> {
  return textOf(await callChild(dart(), "flutter_driver_command", args));
}

// ---------------------------------------------------------------- server
const server = new McpServer({ name: "flutter-mobile-qa", version: "0.1.0" });

server.tool(
  "qa_connect",
  "QA 세션 준비. 기기를 고르고, Flutter 앱의 DTD(ws://…)에 연결해 flutter_driver 프레임 동기화를 끈다(계속 움직이는 화면에서 타임아웃 방지). dtdUri 를 주거나, `flutter run --print-dtd` 로그 파일 경로(logFile)를 주면 거기서 찾는다.",
  { dtdUri: z.string().optional(), logFile: z.string().optional(), device: z.string().optional() },
  async ({ dtdUri, logFile, device: dev }) => {
    if (dev) deviceId = dev;
    const id = await device();
    let uri = dtdUri;
    if (!uri && logFile && existsSync(logFile)) {
      uri = readFileSync(logFile, "utf8").match(/Dart Tooling Daemon is available at: (ws:\/\/\S+)/)?.[1];
    }
    const lines = [`기기: ${id}`];
    if (uri) {
      const r = textOf(await callChild(dart(), "dtd", { command: "connect", uri }));
      dartConnected = /succeeded/i.test(r);
      if (dartConnected) await driver({ command: "set_frame_sync", enabled: "false" });
      lines.push(dartConnected ? `Dart 연결: ${uri} (frame sync off)` : `Dart 연결 실패: ${r.slice(0, 200)}`);
    } else {
      lines.push("Dart 미연결 — 글자 입력(qa_type)·위젯 기반 탭 대체가 불가. `flutter run --print-dtd` 로그를 logFile 로 주세요.");
    }
    return ok(lines.join("\n"));
  },
);

server.tool(
  "qa_read_screen",
  "현재 화면을 요약해서 읽는다: 보이는 텍스트·버튼·입력칸 값·비활성 여부와 중심 좌표만(원본 요소 목록 대비 수십 분의 1 크기). filter 를 주면 그 문자열을 포함한 항목만.",
  { filter: z.string().optional(), limit: z.number().optional() },
  async ({ filter, limit }) => {
    let els = await screen();
    if (filter) els = els.filter((e) => norm(e.label + " " + e.value).includes(norm(filter)));
    return ok(summarize(els, limit ?? 60));
  },
);

server.tool(
  "qa_tap",
  "텍스트로 요소를 찾아 탭한다. 접근성 요소(이름·값) → 없으면 Flutter 위젯(텍스트·툴팁)으로 대체. 위험 단어(삭제·탈퇴·로그아웃·결제 등)는 allowDanger=true 일 때만. 탭 후 waitMs 만큼 기다린 뒤 화면 요약을 돌려준다.",
  {
    text: z.string(),
    exact: z.boolean().optional(),
    allowDanger: z.boolean().optional(),
    waitMs: z.number().optional(),
  },
  async ({ text, exact, allowDanger, waitMs }) => {
    if (!allowDanger && DANGER.some((d) => text.includes(d))) return fail(`위험 동작으로 차단: "${text}" (allowDanger=true 필요)`);
    const els = await screen();
    const el = find(els, text, exact ?? false);
    let how: string;
    if (el) {
      if (!allowDanger && DANGER.some((d) => el.label.includes(d))) return fail(`위험 동작으로 차단: "${el.label}"`);
      await m("mobile_click_on_screen_at_coordinates", { x: el.x + (el.w >> 1), y: el.y + (el.h >> 1) });
      how = `접근성 "${el.label || el.value}"${el.disabled ? " (비활성 상태였음)" : ""}`;
    } else if (await ensureDart()) {
      let r = await driver({ command: "tap", finderType: "ByText", text, timeout: "3000" });
      if (/isError":true/.test(r)) r = await driver({ command: "tap", finderType: "ByTooltipMessage", text, timeout: "3000" });
      if (/isError":true/.test(r)) return fail(`"${text}" 를 찾지 못함 (접근성·위젯 모두)\n현재 화면:\n${summarize(els, 30)}`);
      how = `Flutter 위젯 "${text}"`;
    } else {
      return fail(`"${text}" 를 찾지 못함 (Dart 미연결)\n현재 화면:\n${summarize(els, 30)}`);
    }
    await sleep(waitMs ?? 1500);
    return ok(`탭: ${how}\n--- 화면 ---\n${summarize(await screen(), 40)}`);
  },
);

server.tool(
  "qa_tap_xy",
  "좌표로 탭(아이콘만 있는 버튼 등 접근성 이름이 없는 요소). 좌표는 qa_read_screen/qa_screenshot 기준 화면 좌표.",
  { x: z.number(), y: z.number(), waitMs: z.number().optional() },
  async ({ x, y, waitMs }) => {
    await m("mobile_click_on_screen_at_coordinates", { x, y });
    await sleep(waitMs ?? 1500);
    return ok(`탭: (${x}, ${y})\n--- 화면 ---\n${summarize(await screen(), 40)}`);
  },
);

server.tool(
  "qa_type",
  "입력칸에 글자를 넣는다: field(입력칸의 라벨·힌트·현재 값)로 찾아 탭해 포커스 → Dart enter_text → 값이 들어갔는지 확인. Dart 연결(qa_connect) 필요.",
  { field: z.string(), text: z.string() },
  async ({ field, text }) => {
    if (!(await ensureDart())) return fail("Dart 미연결 — qa_connect 먼저");
    const els = await screen();
    const el = els.find((e) => /TextField|TextView|SearchField/.test(e.type) && (norm(e.label).includes(norm(field)) || norm(e.value).includes(norm(field)))) ?? find(els, field, false);
    if (!el) return fail(`입력칸 "${field}" 를 찾지 못함\n${summarize(els, 30)}`);
    await m("mobile_click_on_screen_at_coordinates", { x: el.x + Math.min(el.w >> 2, 60), y: el.y + (el.h >> 1) });
    await sleep(1000);
    const r = await driver({ command: "enter_text", text });
    if (/isError":true/.test(r)) return fail(`enter_text 실패: ${r.slice(0, 200)}`);
    await sleep(800);
    const after = await screen();
    const got = after.find((e) => norm(e.value).includes(norm(text)) || norm(e.label).includes(norm(text)));
    return got ? ok(`입력 완료: "${text}" (확인됨)`) : fail(`입력 후 값이 보이지 않음 — 포커스 실패 가능\n${summarize(after, 30)}`);
  },
);

server.tool(
  "qa_expect",
  "화면 검증. text 가 보이는지(state=present, 기본), 안 보이는지(absent), 버튼이 활성(enabled)/비활성(disabled)인지. 통과/실패와 근거를 한 줄로.",
  { text: z.string(), state: z.enum(["present", "absent", "enabled", "disabled"]).optional() },
  async ({ text, state }) => {
    const s = state ?? "present";
    const el = find(await screen(), text, false);
    const pass =
      s === "present" ? !!el : s === "absent" ? !el : s === "enabled" ? !!el && !el.disabled : !!el && el.disabled;
    const why = el ? `"${(el.label || el.value).replace(/\n/g, " / ")}"${el.disabled ? " (비활성)" : ""}` : "없음";
    return pass ? ok(`PASS ${s} "${text}" — ${why}`) : fail(`FAIL ${s} "${text}" — ${why}`);
  },
);

server.tool(
  "qa_dismiss_system",
  "앱 흐름을 막는 창을 규칙대로 닫는다(최대 5개): iOS 알림 권한·로컬 네트워크 → 허용, 추적 → 추적 금지 요청, 앱 홈 팝업 → 닫기.",
  {},
  async () => {
    const done: string[] = [];
    for (let i = 0; i < 5; i++) {
      const els = await screen();
      const all = els.map((e) => e.label).join(" ");
      let target: El | undefined;
      if (/추적/.test(all)) target = find(els, "앱에 추적 금지 요청", true);
      else if (/로컬 네트워크|알림을 보내/.test(all)) target = find(els, "허용", true);
      else target = find(els, "닫기", true);
      if (!target) break;
      await m("mobile_click_on_screen_at_coordinates", { x: target.x + (target.w >> 1), y: target.y + (target.h >> 1) });
      done.push(target.label);
      await sleep(1500);
    }
    return ok(done.length ? `닫음: ${done.join(" → ")}` : "닫을 창 없음");
  },
);

server.tool(
  "qa_swipe",
  "스와이프(스크롤). direction=up 이면 내용이 위로(아래 내용 보기). 당겨서 새로고침은 direction=down, fromY 를 화면 위쪽(예: 150)으로.",
  { direction: z.enum(["up", "down", "left", "right"]), fromY: z.number().optional(), distance: z.number().optional() },
  async ({ direction, fromY, distance }) => {
    await m("mobile_swipe_on_screen", { direction, ...(fromY ? { x: 214, y: fromY } : {}), ...(distance ? { distance } : {}) });
    await sleep(1200);
    return ok(`스와이프 ${direction}\n--- 화면 ---\n${summarize(await screen(), 40)}`);
  },
);

server.tool("qa_screenshot", "스크린샷(이미지). 텍스트로 충분하면 qa_read_screen 이 훨씬 가볍다.", {}, async () => {
  const r = await m("mobile_take_screenshot");
  return { content: (r.content ?? []) as never };
});

server.tool(
  "qa_errors",
  "문제 확인: Flutter 런타임 에러(Dart 연결 시) + 기기 크래시 목록.",
  {},
  async () => {
    const parts: string[] = [];
    if (await ensureDart()) parts.push("[Flutter 런타임 에러]\n" + textOf(await callChild(dart(), "get_runtime_errors", {})).slice(0, 2000));
    parts.push("[기기 크래시]\n" + textOf(await m("mobile_list_crashes")).slice(0, 1000));
    return ok(parts.join("\n\n"));
  },
);

server.tool(
  "qa_launch",
  "앱 실행(또는 재실행). packageName 은 번들 ID(예: com.example.app.dev).",
  { packageName: z.string(), restart: z.boolean().optional() },
  async ({ packageName, restart }) => {
    if (restart) await m("mobile_terminate_app", { packageName });
    await m("mobile_launch_app", { packageName });
    await sleep(3000);
    return ok(`실행: ${packageName}\n--- 화면 ---\n${summarize(await screen(), 40)}`);
  },
);

await server.connect(new StdioServerTransport());
