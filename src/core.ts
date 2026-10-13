/**
 * 공통 기반: 자식 MCP 클라이언트(mobile-mcp · Dart MCP), 기기, 화면 모델, 선택자, 대기.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { statSync } from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ReportLanguage } from "./report-language.js";

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
type Config = { dangerWords?: string[]; replaceDangerWords?: boolean; dismissRules?: DismissRule[]; runsDir?: string; reportLanguage?: ReportLanguage };

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
    process.stderr.write(`[mobile-qa] 설정 파일 읽기 실패 ${path}: ${(e as Error).message}\n`);
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
  const client = new Client({ name: `mobile-qa/${name}`, version: "0.5.0" });
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
  const result = await callChild(dart(), "flutter_driver_command", args);
  if (result.isError) throw new Error(`DRIVER_FAILED: ${textOf(result)}`);
  return textOf(result);
}
export const driverFailed = (r: string) => /isError":true/.test(r);

// ---------------------------------------------------------------- screen model
export type El = {
  ref: string;
  type: string;
  label: string;
  value: string;
  /** Whether accessibility exposed a value, including an explicitly empty value. */
  hasValue: boolean;
  /** 접근성 식별자 — iOS accessibilityIdentifier / Android resource-id / Flutter `Semantics(identifier:)` */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
};
const unq = (s: string) => s.replace(/\\([\\"nrt])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" }[c] ?? c));
const attribute = (line: string, name: string) => line.match(new RegExp(` ${name}="((?:\\\\.|[^"\\\\])*)"`))?.[1];
export const cx = (e: El) => e.x + (e.w >> 1);
export const cy = (e: El) => e.y + (e.h >> 1);

export function parseElements(raw: string): El[] {
  const out: Omit<El, "ref">[] = [];
  for (const line of raw.split("\n")) {
    const pos = line.match(/at=(-?\d+),(-?\d+) size=(\d+)x(\d+)/);
    if (!line.startsWith("@") || !pos) continue;
    const type = line.split(" ")[1] ?? "";
    const label = unq(attribute(line, "label") ?? attribute(line, "name") ?? "");
    const rawValue = attribute(line, "value");
    const value = unq(rawValue ?? "");
    let id = unq(attribute(line, "id") ?? "");
    if (id === label) id = ""; // iOS 는 식별자가 없으면 라벨을 id 로 돌려준다 — 진짜 식별자만 남김
    if (!label && !value && !id) continue;
    out.push({ type, label, value, hasValue: rawValue !== undefined, id, x: +pos[1], y: +pos[2], w: +pos[3], h: +pos[4], disabled: / disabled\b/.test(line) });
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
        k.hasValue === e.hasValue &&
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
  const result = await m("mobile_list_elements_on_screen");
  if (result.isError) throw new Error(`SCREEN_READ_FAILED: ${textOf(result)}`);
  return textOf(result);
}
export async function screen(): Promise<El[]> {
  return parseElements(await screenRaw());
}

const NOISE = /^(Wi‑?Fi|총 \d|배터리|\d{1,2}:\d{2}$|Home screen icons|label-view)/;
const line = (e: El, coords: boolean) => {
  const text = [e.label, e.value && e.value !== e.label ? `= ${e.value}` : ""]
    .filter(Boolean)
    .join(" ")
    .replace(/\n/g, " / ");
  const kind = /Button|TextField|Switch|Cell|Icon|Image|EditText/.test(e.type) ? `[${e.type}]` : "";
  const id = e.id ? ` id=${e.id}` : "";
  return `${e.ref} ${kind}${text}${id}${e.disabled ? " (비활성)" : ""}${coords ? ` @${cx(e)},${cy(e)}` : ""}`;
};

/**
 * iOS 키보드 요소. 키보드 틀(inputView 등)이 보일 때만, 그 위쪽 경계 아래에 있는 기능 키(shift·삭제·이모지·space·받아쓰기·return)를 키보드로 본다.
 * 화면 요약·변경분에서는 이것들을 "⌨ 키보드" 한 줄로 접는다 — return 키만 ref 와 함께 남긴다(검색·완료를 눌러야 할 수 있으므로).
 */
const KB_FRAME = /^(SystemInputAssistantView|inputView|UIKeyboardLayoutStar Preview)$/;
const KB_LABEL = /^(CenterPageView|shift|다음 키보드|Next keyboard|次のキーボード)$/;
const KB_ID = /^(delete|more|emoji|space|dictation|shift)$/;
const KB_RETURN_ID = /^(Return|Go|Google|Join|Next|Route|Search|Send|Yahoo|Done|Emergency call|Continue)$/;
export function keyboardOf(els: El[]): { keys: Set<El>; returnKey?: El } {
  const frame = els.filter((e) => KB_FRAME.test(e.label));
  if (!frame.length) return { keys: new Set() };
  const top = Math.min(...frame.map((e) => e.y));
  const inside = els.filter((e) => e.y >= top);
  const returnKey = inside.find((e) => KB_RETURN_ID.test(e.id));
  const keys = new Set([...frame, ...inside.filter((e) => KB_LABEL.test(e.label) || KB_ID.test(e.id) || e === returnKey)]);
  return { keys, returnKey };
}
const keyboardLine = (kb: { returnKey?: El }) => `⌨ 키보드 열림${kb.returnKey ? ` — return 키: ${line(kb.returnKey, false)}` : ""}`;

/** 좌표(@x,y)는 기본으로 뺀다 — qa_tap_xy 를 쓸 때만 필요(coords=true). */
export function summarize(els: El[], limit = 60, coords = false): string {
  const kb = keyboardOf(els);
  const lines = els.filter((e) => !NOISE.test(e.label) && !kb.keys.has(e)).slice(0, limit).map((e) => line(e, coords));
  if (kb.keys.size) lines.push(keyboardLine(kb));
  return lines.join("\n") || "(읽을 수 있는 요소 없음 — 웹뷰/이미지 화면일 수 있음. qa_screenshot 사용)";
}

/**
 * 스냅샷을 ref 저장소에 기록한다. 같은 요소(type + id/label, 위치 근접)는 이전 ref 를 유지하고 새 요소만 새 ref 를 받는다 —
 * 그래서 에이전트가 이전에 본 ref 는 화면 일부만 바뀌어도 계속 유효하다. 요소 절반 이상이 새것이면(화면 이동) r1 부터 다시 매긴다.
 * 스크롤·키보드로 화면 전체가 밀리면 위치 비교가 깨지므로, 양쪽에서 유일한 요소(앵커)들의 이동량 중앙값만큼 보정해서 비교한다.
 * id 가 양쪽에서 유일한 요소는 위치와 무관하게 같은 요소로 본다.
 */
export type ScreenDiff = {
  added: El[];
  removed: El[];
  changed: Array<{ el: El; was: El }>;
  kept: number;
  shift: { dx: number; dy: number };
  /** 키보드가 새로 열렸거나(opened) 닫혔으면(closed) — 키보드 요소 자체는 added/removed 에서 뺀다. */
  keyboard?: { opened?: { returnKey?: El }; closed?: boolean };
};
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
export function snapshot(els: El[]): { els: El[]; diff?: ScreenDiff } {
  const prev = [...state.lastRefs.values()];
  const used = new Set<El>();
  const key = (e: El) => `${e.type}|${e.id || e.label}`;
  const counts = (list: El[]) => list.reduce((m, e) => m.set(key(e), (m.get(key(e)) ?? 0) + 1), new Map<string, number>());
  const nPrev = counts(prev);
  const nCur = counts(els);
  const unique = (e: El) => nPrev.get(key(e)) === 1 && nCur.get(key(e)) === 1;
  const anchors = els.filter(unique).map((e) => [e, prev.find((q) => key(q) === key(e))!] as const);
  const shift = { dx: median(anchors.map(([e, q]) => cx(e) - cx(q))), dy: median(anchors.map(([e, q]) => cy(e) - cy(q))) };
  const near = (q: El, e: El) => Math.abs(cx(q) + shift.dx - cx(e)) < 40 && Math.abs(cy(q) + shift.dy - cy(e)) < 40;
  const pairs = els.map((e) => {
    const p = prev.find((q) => !used.has(q) && key(q) === key(e) && ((e.id && unique(e)) || near(q, e)));
    if (p) used.add(p);
    return { e, p };
  });
  // 키보드가 열리면 기능 키가 한꺼번에 생긴다 — 화면이 바뀌었는지 판단할 때는 빼고 센다.
  const kbCur = keyboardOf(els);
  const kbPrev = keyboardOf(prev);
  const fresh = pairs.filter((x) => !x.p && !kbCur.keys.has(x.e)).length;
  if (!prev.length || fresh * 2 > els.length - kbCur.keys.size) {
    state.lastRefs = new Map(els.map((e) => [e.ref, e]));
    return { els };
  }
  let seq = Math.max(0, ...prev.map((q) => +q.ref.slice(1) || 0));
  const out = pairs.map(({ e, p }) => ({ ...e, ref: p ? p.ref : `r${++seq}` }));
  const quiet = (e: El) => !NOISE.test(e.label);
  const returnRef = kbCur.returnKey && out[els.indexOf(kbCur.returnKey)];
  const diff: ScreenDiff = {
    added: out.filter((e, i) => !pairs[i].p && !kbCur.keys.has(els[i])).filter(quiet),
    removed: prev.filter((q) => !used.has(q) && !kbPrev.keys.has(q)).filter(quiet),
    // 키보드 안의 변화는 return 키(입력하면 활성화되는 검색·완료 등)만 알린다.
    changed: out.flatMap((e, i) => {
      const p = pairs[i].p;
      const shown = !kbCur.keys.has(els[i]) || els[i] === kbCur.returnKey;
      return p && shown && quiet(e) && (p.value !== e.value || p.label !== e.label || p.disabled !== e.disabled) ? [{ el: e, was: p }] : [];
    }),
    kept: pairs.filter((x) => x.p).length,
    shift,
    keyboard: kbCur.keys.size && !kbPrev.keys.size ? { opened: { returnKey: returnRef } } : !kbCur.keys.size && kbPrev.keys.size ? { closed: true } : undefined,
  };
  state.lastRefs = new Map(out.map((e) => [e.ref, e]));
  return { els: out, diff };
}

export type ScreenMode = "diff" | "full" | "none";
/** 조작 뒤 화면 응답. diff=직전에 보여 준 화면 대비 변경분만, full=전체, none=아무것도 안 줌(상태 변경 없음). */
export function view(els: El[], mode: ScreenMode = "diff", limit = 40): string {
  if (mode === "none") return "";
  const snap = snapshot(els);
  if (mode === "full" || !snap.diff) return `--- 화면 ---\n${summarize(snap.els, limit)}`;
  const { added, removed, changed, kept, shift, keyboard } = snap.diff;
  // 요소는 그대로여도 화면이 밀렸으면(스크롤·키보드) 알려 준다 — 좌표를 쓰는 경우 다시 읽어야 한다.
  const moved = Math.abs(shift.dx) >= 10 || Math.abs(shift.dy) >= 10 ? `, 화면 이동 ${shift.dx ? `x${shift.dx > 0 ? "+" : ""}${shift.dx} ` : ""}y${shift.dy > 0 ? "+" : ""}${shift.dy}` : "";
  if (!added.length && !removed.length && !changed.length && !keyboard) return `--- 화면 변경 없음 (${kept}개 요소${moved}) ---`;
  const cap = 25;
  const rows = [
    ...(keyboard?.opened ? [`+ ${keyboardLine(keyboard.opened)}`] : keyboard?.closed ? ["- ⌨ 키보드 닫힘"] : []),
    ...added.map((e) => `+ ${line(e, false)}`),
    ...removed.map((e) => `- "${(e.label || e.value || e.id).replace(/\n/g, " / ")}"`),
    ...changed.map(({ el, was }) => `~ ${line(el, false)}${was.value !== el.value ? ` (이전: ${was.value || "빈 값"})` : ""}`),
  ];
  const shown = rows.slice(0, cap).join("\n");
  return `--- 화면 변경 (+${added.length} −${removed.length} ~${changed.length}, 유지 ${kept}${moved}) ---\n${shown}${rows.length > cap ? `\n…외 ${rows.length - cap}줄 (qa_read_screen 으로 전체 확인)` : ""}`;
}
/** 전체 화면을 보여 주고 ref 를 기록한다(qa_read_screen 용). */
export function remember(els: El[], limit = 40, coords = false): string {
  return summarize(snapshot(els).els, limit, coords);
}

// ---------------------------------------------------------------- selectors
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
export type Selector = { text?: string; id?: string; ref?: string; index?: number; exact?: boolean };
export type ResolveCode = "NOT_FOUND" | "INVALID_SELECTOR" | "STALE_REF" | "AMBIGUOUS_SELECTOR";
export type Resolved = { el?: El; candidates?: El[]; reason?: string; code?: ResolveCode };

/**
 * 선택자 해석. 우선순위 ref > id > text.
 * text 는 "완전 일치 → 포함" 순서로 찾고, 후보가 여럿이면 index 가 없을 때 후보 목록을 돌려준다(엉뚱한 버튼을 누르지 않도록).
 */
export function resolve(els: El[], sel: Selector): Resolved {
  if (sel.index !== undefined && (!Number.isInteger(sel.index) || sel.index < 0)) {
    return { code: "INVALID_SELECTOR", reason: "index must be a non-negative integer" };
  }
  if (sel.ref) {
    const prev = state.lastRefs.get(sel.ref);
    if (!prev) return { code: "STALE_REF", reason: `ref ${sel.ref} 를 모름 — qa_read_screen 을 다시 읽어 주세요` };
    const same = els.filter(
      (e) => e.label === prev.label && e.value === prev.value && e.id === prev.id && Math.abs(cx(e) - cx(prev)) < 40 && Math.abs(cy(e) - cy(prev)) < 40,
    );
    if (same.length === 1) return { el: same[0] };
    return { code: "STALE_REF", reason: `ref ${sel.ref}("${prev.label || prev.value}")가 화면에서 사라졌거나 움직임 — qa_read_screen 을 다시 읽어 주세요` };
  }
  let pool: El[];
  let what: string;
  if (sel.id?.trim()) {
    pool = els.filter((e) => e.id === sel.id);
    what = `id=${sel.id}`;
  } else if (sel.text && norm(sel.text)) {
    const t = norm(sel.text);
    pool = els.filter((e) => norm(e.label) === t || norm(e.value) === t);
    if (!pool.length && !sel.exact) pool = els.filter((e) => norm(e.label).includes(t) || norm(e.value).includes(t));
    what = `"${sel.text}"`;
  } else return { code: "INVALID_SELECTOR", reason: "text / id / ref 중 하나가 필요합니다" };
  if (!pool.length) return { code: "NOT_FOUND", reason: `${what} 를 찾지 못함` };
  if (sel.index !== undefined) return pool[sel.index] ? { el: pool[sel.index] } : { code: "INVALID_SELECTOR", reason: `${what} 후보 ${pool.length}개 — index ${sel.index} 없음`, candidates: pool };
  if (pool.length > 1) return { code: "AMBIGUOUS_SELECTOR", candidates: pool, reason: `${what} 후보가 ${pool.length}개 — ref 또는 index(0부터)로 지정해 주세요` };
  return { el: pool[0] };
}
export function describeCandidates(c: El[]): string {
  return c.map((e, i) => `  index ${i}: ${e.ref} ${(e.label || e.value).replace(/\n/g, " / ")}${e.id ? ` id=${e.id}` : ""} @${cx(e)},${cy(e)}`).join("\n");
}

// ---------------------------------------------------------------- crashes
const SESSION_START = Date.now();

/**
 * 기기 크래시 목록(JSON)에서 since 이후 것만 남긴다 — 예전 크래시(다른 앱 포함)가 응답을 채우지 않게.
 * ponytail: timestamp 를 이 Mac 의 로컬 시각으로 해석한다(기기와 시간대가 다르면 어긋남). 1분 여유를 둔다.
 */
export function crashesSince(raw: string, since: number): string {
  let list: { timestamp?: string }[];
  try {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) return raw.slice(0, 1000);
  } catch {
    return raw.slice(0, 1000);
  }
  const recent = list.filter((c) => !(new Date(String(c.timestamp).replace(" ", "T")).getTime() < since - 60_000));
  return recent.length ? JSON.stringify(recent).slice(0, 1000) : `없음 (이전 기록 ${list.length}건 제외)`;
}

/** 이 QA 세션(서버 시작) 이후의 기기 크래시만. */
export const recentCrashes = async () => crashesSince(textOf(await m("mobile_list_crashes")), SESSION_START);

// ---------------------------------------------------------------- waiting
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Cond = { sel: Selector; state: "present" | "absent" | "enabled" | "disabled" };

type CheckResult = { pass: boolean; why: string; code?: string };

export function check(els: El[], c: Cond): CheckResult {
  const r = resolve(els, c.sel);
  if (r.code === "AMBIGUOUS_SELECTOR" && (c.state === "present" || c.state === "absent")) {
    // Presence is existential; state checks need a unique target.
    return { pass: c.state === "present", why: `${r.candidates!.length} matching elements` };
  }
  if (r.code && r.code !== "NOT_FOUND") {
    return { pass: false, code: r.code, why: `${r.code}: ${r.reason}` };
  }
  const el = r.el;
  const pass =
    c.state === "present" ? !!el : c.state === "absent" ? !el : c.state === "enabled" ? !!el && !el.disabled : !!el && el.disabled;
  const why = el ? `"${(el.label || el.value || el.id).replace(/\n/g, " / ")}"${el.disabled ? " (비활성)" : ""}` : "없음";
  return { pass, why };
}

/** 조건이 맞을 때까지 화면을 다시 읽는다(최대 timeoutMs). 고정 대기 대신 쓴다. */
async function pollScreen(evaluate: (els: El[]) => CheckResult, timeoutMs: number, intervalMs: number) {
  const t0 = Date.now();
  let els = await screen();
  let r = evaluate(els);
  while (!r.pass && !["INVALID_SELECTOR", "STALE_REF", "AMBIGUOUS_SELECTOR"].includes(r.code ?? "") && Date.now() - t0 < timeoutMs) {
    await sleep(intervalMs);
    els = await screen();
    r = evaluate(els);
  }
  return { ...r, els, elapsedMs: Date.now() - t0 };
}

export const waitFor = (c: Cond, timeoutMs: number, intervalMs = 400) => pollScreen((els) => check(els, c), timeoutMs, intervalMs);

/** Reidentify the original field without relying on its old value or snapshot ref. */
export function checkInputValue(els: El[], target: El, expected: string): CheckResult {
  const candidates = els.filter((e) => e.type === target.type && (target.id
    ? e.id === target.id
    : e.label === target.label && Math.abs(cx(e) - cx(target)) < 40 && Math.abs(cy(e) - cy(target)) < 40));
  if (candidates.length !== 1) return { pass: false, code: "INPUT_TARGET_UNRESOLVED", why: "Cannot uniquely identify the original input field; read the screen again and prefer an accessibility id." };
  const field = candidates[0];
  if (!field.hasValue) return { pass: false, code: "INPUT_VALUE_UNAVAILABLE", why: "The target field does not expose an accessibility value; input cannot be verified." };
  return field.value === expected
    ? { pass: true, why: "Target field value matches exactly" }
    : { pass: false, code: "INPUT_VALUE_MISMATCH", why: "The target field value does not match the requested text." };
}

export const waitForInputValue = (target: El, expected: string, timeoutMs = 3000, intervalMs = 300) =>
  pollScreen((els) => checkInputValue(els, target, expected), timeoutMs, intervalMs);

/**
 * 화면이 안정될 때까지(연속 두 번 같은 요약) 기다린다 — 탭·입력 뒤 기본 대기.
 * Return an explicit timeout when two matching reads were not observed in time.
 */
export async function settle(minMs = 300, maxMs = 3000, intervalMs = 350) {
  const t0 = Date.now();
  await sleep(Math.min(minMs, maxMs));
  let els = await screen();
  const fingerprint = (items: El[]) => JSON.stringify(items.map(({ ref, ...e }) => e));
  let prev = fingerprint(els);
  while (Date.now() - t0 < maxMs) {
    await sleep(Math.min(intervalMs, maxMs - (Date.now() - t0)));
    if (Date.now() - t0 >= maxMs) break;
    els = await screen();
    const cur = fingerprint(els);
    if (cur === prev && Date.now() - t0 <= maxMs) return { els, elapsedMs: Date.now() - t0, stable: true, timedOut: false };
    prev = cur;
  }
  return { els, elapsedMs: Date.now() - t0, stable: false, timedOut: true };
}
