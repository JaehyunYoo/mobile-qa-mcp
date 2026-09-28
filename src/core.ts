/**
 * 공통 기반: 자식 MCP 클라이언트(mobile-mcp · Dart MCP), 기기, 화면 모델, 선택자, 대기.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { statSync } from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const PROJECT_DIR = process.env.QA_PROJECT_DIR ?? process.cwd();
/** Dart MCP 실행 명령. QA_DART_CMD 가 없으면 프로젝트에 fvm 설정(.fvmrc/.fvm)이 있을 때만 fvm 을 쓴다. */
export const DART_CMD = (
  process.env.QA_DART_CMD ??
  (["/.fvmrc", "/.fvm/fvm_config.json"].some((f) => existsSyncEarly(PROJECT_DIR + f)) ? "fvm dart mcp-server" : "dart mcp-server")
).split(" ");
function existsSyncEarly(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
export const MOBILE_PKG = process.env.QA_MOBILE_MCP ?? "@mobilenext/mobile-mcp@1.0.5";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 프로젝트별 설정. 기본값은 앱과 무관한 일반 단어(한국어·영어·일본어).
 * 앱 전용 단어·규칙은 `<프로젝트>/qa/qa.config.json`(또는 QA_CONFIG 경로)에 둔다:
 * {
 *   "dangerWords": ["연결 끊기"],          // 기본 목록에 추가
 *   "replaceDangerWords": false,           // true 면 기본 목록 대신 이것만
 *   "dismissRules": [{ "when": "추적", "tap": "앱에 추적 금지 요청" }],  // 기본 규칙 앞에 추가
 *   "runsDir": "qa/runs"
 * }
 */
export type DismissRule = { when: string; tap: string };
type Config = { dangerWords?: string[]; replaceDangerWords?: boolean; dismissRules?: DismissRule[]; runsDir?: string };

const DEFAULT_DANGER = [
  // ko
  "삭제", "탈퇴", "로그아웃", "결제", "구매", "구독하기", "초기화", "해지",
  // en
  "Delete", "Remove", "Log out", "Logout", "Sign out", "Purchase", "Buy", "Subscribe", "Pay", "Reset", "Deactivate",
  // ja
  "削除", "退会", "ログアウト", "購入", "決済", "登録する", "解約",
];
/** 시스템 권한·추적 창과 흔한 팝업. when(화면 어딘가의 문구)이 보이면 tap(버튼)을 누른다. 위에서부터 먼저 맞는 규칙. */
const DEFAULT_DISMISS: DismissRule[] = [
  // 앱 추적(ATT) — 거부 쪽
  { when: "추적", tap: "앱에 추적 금지 요청" },
  { when: "track your activity", tap: "Ask App Not to Track" },
  { when: "トラッキング", tap: "Appにトラッキングしないように要求" },
  // 알림·로컬 네트워크 — 허용(QA 진행에 필요)
  { when: "알림을 보내", tap: "허용" },
  { when: "로컬 네트워크", tap: "허용" },
  { when: "Would Like to Send You Notifications", tap: "Allow" },
  { when: "local network", tap: "Allow" },
  { when: "通知を送信", tap: "許可" },
  { when: "ローカルネットワーク", tap: "許可" },
  // 앱 팝업 닫기
  { when: "", tap: "닫기" },
  { when: "", tap: "Close" },
  { when: "", tap: "閉じる" },
];

function loadConfig(): Config {
  const path = process.env.QA_CONFIG ?? join(PROJECT_DIR, "qa", "qa.config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Config;
  } catch (e) {
    process.stderr.write(`[flutter-mobile-qa] 설정 파일 읽기 실패 ${path}: ${(e as Error).message}\n`);
    return {};
  }
}
export const CONFIG = loadConfig();
export const DANGER = CONFIG.replaceDangerWords ? (CONFIG.dangerWords ?? []) : [...DEFAULT_DANGER, ...(CONFIG.dangerWords ?? [])];
export const DISMISS_RULES: DismissRule[] = [...(CONFIG.dismissRules ?? []), ...DEFAULT_DISMISS];
export const RUNS_DIR = process.env.QA_RUNS_DIR ?? (CONFIG.runsDir ? join(PROJECT_DIR, CONFIG.runsDir) : join(PROJECT_DIR, "qa", "runs"));

// ---------------------------------------------------------------- child clients (lazy)
export type ToolResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

async function spawnClient(name: string, command: string, args: string[], cwd?: string): Promise<Client> {
  const client = new Client({ name: `flutter-mobile-qa/${name}`, version: "0.5.0" });
  await client.connect(new StdioClientTransport({ command, args, cwd, stderr: "ignore" }));
  return client;
}
export const state = {
  mobileP: undefined as Promise<Client> | undefined,
  dartP: undefined as Promise<Client> | undefined,
  dartConnected: false,
  deviceId: process.env.QA_DEVICE as string | undefined,
  /** 마지막 qa_read_screen 스냅샷(ref → 요소). 화면이 바뀌면 ref 는 탭 직전에 다시 확인한다. */
  lastRefs: new Map<string, El>(),
};
export const mobile = () => (state.mobileP ??= spawnClient("mobile", "npx", ["-y", MOBILE_PKG]));
export const dart = () => (state.dartP ??= spawnClient("dart", DART_CMD[0], DART_CMD.slice(1), PROJECT_DIR));

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: ${ms}ms 초과`)), ms))]);
}
export async function callChild(c: Promise<Client>, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await (await c).callTool({ name, arguments: args })) as ToolResult;
}
export const textOf = (r: ToolResult) =>
  (r.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

export async function device(): Promise<string> {
  if (state.deviceId) return state.deviceId;
  const t = textOf(await callChild(mobile(), "mobile_list_available_devices", {}));
  const m = t.match(/"id":"([^"]+)"/);
  if (!m) throw new Error(`기기를 찾지 못했습니다: ${t.slice(0, 200)}`);
  return (state.deviceId = m[1]);
}
export const m = async (name: string, args: Record<string, unknown> = {}) =>
  callChild(mobile(), name, { device: await device(), ...args });
let screenSize: { w: number; h: number } | undefined;
/** 기기 화면 크기(탭 좌표 기준). 스와이프 시작점 등 기기별 값 계산용. */
export async function getScreenSize(): Promise<{ w: number; h: number }> {
  if (screenSize) return screenSize;
  const t = textOf(await m("mobile_get_screen_size"));
  const mm = t.match(/(\d+)\s*x\s*(\d+)/);
  return (screenSize = mm ? { w: +mm[1], h: +mm[2] } : { w: 390, h: 844 });
}
export const resetScreenSize = () => (screenSize = undefined);
export async function driver(args: Record<string, unknown>): Promise<string> {
  return textOf(await callChild(dart(), "flutter_driver_command", args));
}
export const driverFailed = (r: string) => /isError":true/.test(r);

// ---------------------------------------------------------------- screen model
export type El = {
  ref: string;
  type: string;
  label: string;
  value: string;
  /** 접근성 식별자 — iOS accessibilityIdentifier / Android resource-id / Flutter `Semantics(identifier:)` */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
};
const unq = (s: string) => s.replace(/\\n/g, "\n").replace(/\\r/g, "");
export const cx = (e: El) => e.x + (e.w >> 1);
export const cy = (e: El) => e.y + (e.h >> 1);

export function parseElements(raw: string): El[] {
  const out: Omit<El, "ref">[] = [];
  for (const line of raw.split("\n")) {
    const pos = line.match(/at=(-?\d+),(-?\d+) size=(\d+)x(\d+)/);
    if (!line.startsWith("@") || !pos) continue;
    const type = line.split(" ")[1] ?? "";
    const label = unq(line.match(/ label="([^"]*)"/)?.[1] ?? line.match(/ name="([^"]*)"/)?.[1] ?? "");
    const value = unq(line.match(/ value="([^"]*)"/)?.[1] ?? "");
    let id = line.match(/ id="([^"]*)"/)?.[1] ?? "";
    if (id === label) id = ""; // iOS 는 식별자가 없으면 라벨을 id 로 돌려준다 — 진짜 식별자만 남김
    if (!label && !value && !id) continue;
    out.push({ type, label, value, id, x: +pos[1], y: +pos[2], w: +pos[3], h: +pos[4], disabled: / disabled\b/.test(line) });
  }
  // 같은 텍스트·식별자가 중첩 요소로 여러 번 나오면 하나만 남긴다: 조작 가능한 요소(버튼·입력칸 등)를 우선,
  // 둘 다 같은 부류면 더 작은(구체적인) 것. 비활성 상태는 겹친 요소 중 하나라도 비활성이면 비활성. 위치가 먼 동명 요소는 따로 둔다.
  const interactive = (t: string) => /Button|TextField|SecureTextField|SearchField|TextView|EditText|Switch|Toggle|Cell|Link|CheckBox|Slider/.test(t);
  const kept: Omit<El, "ref">[] = [];
  for (const e of out.sort((a, b) => a.w * a.h - b.w * b.h)) {
    const i = kept.findIndex(
      (k) =>
        k.label === e.label &&
        k.value === e.value &&
        k.id === e.id &&
        e.x <= k.x + 1 &&
        e.y <= k.y + 1 &&
        e.x + e.w >= k.x + k.w - 1 &&
        e.y + e.h >= k.y + k.h - 1,
    );
    if (i < 0) kept.push(e);
    else {
      const disabled = kept[i].disabled || e.disabled;
      if (interactive(e.type) && !interactive(kept[i].type)) kept[i] = e;
      kept[i] = { ...kept[i], disabled };
    }
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x).map((e, i) => ({ ...e, ref: `r${i + 1}` }));
}

export async function screenRaw(): Promise<string> {
  return textOf(await m("mobile_list_elements_on_screen"));
}
export async function screen(): Promise<El[]> {
  return parseElements(await screenRaw());
}

const NOISE = /^(Wi‑?Fi|총 \d|배터리|\d{1,2}:\d{2}$|Home screen icons|label-view)/;
export function summarize(els: El[], limit = 60): string {
  const lines = els
    .filter((e) => !NOISE.test(e.label))
    .slice(0, limit)
    .map((e) => {
      const text = [e.label, e.value && e.value !== e.label ? `= ${e.value}` : ""]
        .filter(Boolean)
        .join(" ")
        .replace(/\n/g, " / ");
      const kind = /Button|TextField|Switch|Cell|Icon|Image|EditText/.test(e.type) ? `[${e.type}]` : "";
      const id = e.id ? ` id=${e.id}` : "";
      return `${e.ref} ${kind}${text}${id}${e.disabled ? " (비활성)" : ""} @${cx(e)},${cy(e)}`;
    });
  return lines.join("\n") || "(읽을 수 있는 요소 없음 — 웹뷰/이미지 화면일 수 있음. qa_screenshot 사용)";
}
/** 스냅샷을 ref 저장소에 기록하고 요약을 돌려준다(qa_read_screen·조작 후 화면 요약 공통). */
export function remember(els: El[], limit = 40): string {
  state.lastRefs = new Map(els.map((e) => [e.ref, e]));
  return summarize(els, limit);
}

// ---------------------------------------------------------------- selectors
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
export type Selector = { text?: string; id?: string; ref?: string; index?: number; exact?: boolean };
export type Resolved = { el?: El; candidates?: El[]; reason?: string };

/**
 * 선택자 해석. 우선순위 ref > id > text.
 * text 는 "완전 일치 → 포함" 순서로 찾고, 후보가 여럿이면 index 가 없을 때 후보 목록을 돌려준다(엉뚱한 버튼을 누르지 않도록).
 */
export function resolve(els: El[], sel: Selector): Resolved {
  if (sel.ref) {
    const prev = state.lastRefs.get(sel.ref);
    if (!prev) return { reason: `ref ${sel.ref} 를 모름 — qa_read_screen 을 다시 읽어 주세요` };
    const same = els.filter(
      (e) => e.label === prev.label && e.value === prev.value && e.id === prev.id && Math.abs(cx(e) - cx(prev)) < 40 && Math.abs(cy(e) - cy(prev)) < 40,
    );
    if (same.length === 1) return { el: same[0] };
    return { reason: `ref ${sel.ref}("${prev.label || prev.value}")가 화면에서 사라졌거나 움직임 — qa_read_screen 을 다시 읽어 주세요` };
  }
  let pool: El[];
  let what: string;
  if (sel.id) {
    pool = els.filter((e) => e.id === sel.id);
    what = `id=${sel.id}`;
  } else if (sel.text) {
    const t = norm(sel.text);
    pool = els.filter((e) => norm(e.label) === t || norm(e.value) === t);
    if (!pool.length && !sel.exact) pool = els.filter((e) => norm(e.label).includes(t) || norm(e.value).includes(t));
    what = `"${sel.text}"`;
  } else return { reason: "text / id / ref 중 하나가 필요합니다" };
  if (!pool.length) return { reason: `${what} 를 찾지 못함` };
  if (sel.index !== undefined) return pool[sel.index] ? { el: pool[sel.index] } : { reason: `${what} 후보 ${pool.length}개 — index ${sel.index} 없음`, candidates: pool };
  if (pool.length > 1) return { candidates: pool, reason: `${what} 후보가 ${pool.length}개 — ref 또는 index(0부터)로 지정해 주세요` };
  return { el: pool[0] };
}
export function describeCandidates(c: El[]): string {
  return c.map((e, i) => `  index ${i}: ${e.ref} ${(e.label || e.value).replace(/\n/g, " / ")}${e.id ? ` id=${e.id}` : ""} @${cx(e)},${cy(e)}`).join("\n");
}

// ---------------------------------------------------------------- waiting
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Cond = { sel: Selector; state: "present" | "absent" | "enabled" | "disabled" };

export function check(els: El[], c: Cond): { pass: boolean; why: string } {
  const r = resolve(els, { ...c.sel, index: c.sel.index ?? (c.sel.ref ? undefined : 0) });
  const el = r.el;
  const pass =
    c.state === "present" ? !!el : c.state === "absent" ? !el : c.state === "enabled" ? !!el && !el.disabled : !!el && el.disabled;
  const why = el ? `"${(el.label || el.value || el.id).replace(/\n/g, " / ")}"${el.disabled ? " (비활성)" : ""}` : "없음";
  return { pass, why };
}

/** 조건이 맞을 때까지 화면을 다시 읽는다(최대 timeoutMs). 고정 대기 대신 쓴다. */
export async function waitFor(c: Cond, timeoutMs: number, intervalMs = 400) {
  const t0 = Date.now();
  let els = await screen();
  let r = check(els, c);
  while (!r.pass && Date.now() - t0 < timeoutMs) {
    await sleep(intervalMs);
    els = await screen();
    r = check(els, c);
  }
  return { ...r, els, elapsedMs: Date.now() - t0 };
}

/**
 * 화면이 안정될 때까지(연속 두 번 같은 요약) 기다린다 — 탭·입력 뒤 기본 대기.
 * 최소 minMs 후 확인하고 maxMs 를 넘기면 그 시점 화면을 쓴다.
 */
export async function settle(minMs = 300, maxMs = 3000, intervalMs = 350) {
  const t0 = Date.now();
  await sleep(minMs);
  let els = await screen();
  let prev = summarize(els, 200);
  while (Date.now() - t0 < maxMs) {
    await sleep(intervalMs);
    els = await screen();
    const cur = summarize(els, 200);
    if (cur.replace(/r\d+ /g, "") === prev.replace(/r\d+ /g, "")) break;
    prev = cur;
  }
  return { els, elapsedMs: Date.now() - t0 };
}
