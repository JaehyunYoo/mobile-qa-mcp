#!/usr/bin/env node
/**
 * mobile-qa-mcp — shared device QA via mobile-mcp, with optional Dart capabilities for Flutter.
 *
 * 핵심은 "합치기"가 아니라 복합 도구 + 응답 요약 + 안정성:
 *  - qa_read_screen: 수천 줄 요소 목록을 "ref · 텍스트 · id · 상태 · 좌표" 몇 줄로 요약
 *  - 선택자: text / id(접근성 식별자) / ref(마지막 화면의 요소) / key(Flutter ValueKey). 후보가 여럿이면 누르지 않고 후보를 보여 줌
 *  - 대기: 고정 sleep 대신 조건 대기(waitFor/timeoutMs)와 화면 안정 대기(settle)
 *  - 실행 기록: qa_run_start ~ qa_run_end 사이의 모든 호출을 파일로, 실패 시 증거 자동 저장
 *  - qa_doctor: 환경 진단(앱 버그와 환경 문제 구분)
 *
 * 환경 변수: QA_DEVICE · QA_PROJECT_DIR · QA_DART_CMD · QA_MOBILE_MCP · QA_RUNS_DIR
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SERVER_INSTRUCTIONS, registerGuidance } from "./guidance.js";
import {
  DANGER,
  DISMISS_RULES,
  El,
  Selector,
  callChild,
  check,
  cx,
  cy,
  dart,
  describeCandidates,
  device,
  driver,
  driverFailed,
  getScreenSize,
  m,
  resetScreenSize,
  remember,
  resolve,
  screen,
  settle,
  sleep,
  state,
  summarize,
  textOf,
  waitFor,
  waitForInputValue,
} from "./core.js";
import { activeRun, captureEvidence, endRun, logStep, startRun } from "./runlog.js";
import { REPORT_LANGUAGES } from "./report-language.js";
import { runDoctor } from "./doctor.js";

type Out = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean };
const ok = (text: string): Out => ({ content: [{ type: "text", text }] });
const fail = (text: string): Out => ({ content: [{ type: "text", text }], isError: true });

const server = new McpServer({ name: "mobile-qa", version: "0.5.0" }, { instructions: SERVER_INSTRUCTIONS });
registerGuidance(server);

/** 도구 등록 + 실행 기록(실행 중일 때) + 예외를 도구 오류로 변환. */
function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Out>) {
  server.tool(name, description, shape, (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
    const t0 = Date.now();
    let out: Out;
    try {
      out = await fn(args);
    } catch (e) {
      out = fail(`${name} 오류: ${(e as Error).message}`);
      if (activeRun()) {
        const ev = await captureEvidence(`${name}-error`);
        logStep({ tool: name, args, result: "fail", ms: Date.now() - t0, actual: (e as Error).message, evidence: ev });
        return out;
      }
    }
    if (activeRun() && !["qa_run_start", "qa_run_end", "qa_step"].includes(name)) {
      const first = out.content.find((c) => c.type === "text") as { text: string } | undefined;
      logStep({ tool: name, args, result: out.isError ? "fail" : "ok", ms: Date.now() - t0, actual: first?.text.split("\n")[0]?.slice(0, 200) });
    }
    return out;
  }) as never);
}

// ---------------------------------------------------------------- shared schemas
const sel = {
  text: z.string().optional().describe("Visible text in the app language (exact match first, then substring)"),
  id: z.string().optional().describe("Accessibility identifier (iOS accessibilityIdentifier / Android resource-id / Flutter Semantics(identifier))"),
  ref: z.string().optional().describe("Reference returned by qa_read_screen, e.g. r12"),
  index: z.number().optional().describe("Zero-based index when multiple candidates match"),
  exact: z.boolean().optional().describe("If true, require an exact match"),
};
const condShape = z
  .object({
    text: z.string().optional(),
    id: z.string().optional(),
    state: z.enum(["present", "absent", "enabled", "disabled"]).optional(),
  })
  .optional()
  .describe("Wait for this condition after the action, e.g. {text:'저장', state:'enabled'} for a Korean Save button");
const pick = (a: { text?: string; id?: string; ref?: string; index?: number; exact?: boolean }): Selector => ({
  text: a.text,
  id: a.id,
  ref: a.ref,
  index: a.index,
  exact: a.exact,
});
const labelOf = (e: El) => (e.label || e.value || e.id).replace(/\n/g, " / ");

async function afterSettle(action: string, result: Awaited<ReturnType<typeof settle>>): Promise<Out> {
  const message = result.stable ? `Screen stable (${result.elapsedMs}ms)` : `WAIT_TIMEOUT: screen did not stabilize (${result.elapsedMs}ms). Read the screen before retrying any action.`;
  if (!result.stable && activeRun()) {
    const evidence = await captureEvidence("stability-timeout");
    logStep({ tool: "wait", result: "fail", ms: result.elapsedMs, expected: "stable screen", actual: message, evidence });
  }
  return (result.stable ? ok : fail)(`${action}\n${message}\n--- 화면 ---\n${remember(result.els)}`);
}

/** 조작 뒤 대기: 조건이 있으면 조건 대기, 없으면 화면 안정 대기. 결과 문구 + 화면 요약. */
async function after(action: string, cond?: { text?: string; id?: string; state?: "present" | "absent" | "enabled" | "disabled" }, timeoutMs?: number): Promise<Out> {
  if (cond && (cond.text || cond.id)) {
    const r = await waitFor({ sel: { text: cond.text, id: cond.id }, state: cond.state ?? "present" }, timeoutMs ?? 8000);
    const head = `${action}\n대기 ${r.pass ? "PASS" : "FAIL"} ${cond.state ?? "present"} ${cond.text ?? `id=${cond.id}`} — ${r.why} (${r.elapsedMs}ms)`;
    if (!r.pass && activeRun()) {
      const ev = await captureEvidence("wait-fail");
      logStep({ tool: "wait", result: "fail", ms: r.elapsedMs, expected: `${cond.state ?? "present"} ${cond.text ?? cond.id}`, actual: r.why, evidence: ev });
    }
    return (r.pass ? ok : fail)(`${head}\n--- 화면 ---\n${remember(r.els)}`);
  }
  return afterSettle(action, await settle(300, timeoutMs ?? 3000));
}

// ---------------------------------------------------------------- tools: 진단·연결
tool(
  "qa_doctor",
  "Diagnose the environment: device connection, mobile-mcp, automation agent, screen reading, Dart/DTD, and flutter_driver extension. Return available capabilities and recovery steps in a table. Run before QA or when tools fail unexpectedly to distinguish environment problems from app bugs. Provide logFile for Flutter apps.",
  { logFile: z.string().optional(), dtdUri: z.string().optional() },
  async ({ logFile, dtdUri }) => ok(await runDoctor({ logFile, dtdUri })),
);

tool(
  "qa_connect",
  "Prepare a QA session. Select a device and, for Flutter apps, connect to DTD (ws://…) and disable flutter_driver frame synchronization. Provide dtdUri directly or logFile from flutter run --print-dtd to discover it. Omit logFile for native apps.",
  { dtdUri: z.string().optional(), logFile: z.string().optional(), device: z.string().optional() },
  async ({ dtdUri, logFile, device: dev }) => {
    if (dev) {
      state.deviceId = dev;
      resetScreenSize();
    }
    const id = await device();
    let uri = dtdUri;
    if (!uri && logFile && existsSync(logFile)) uri = readFileSync(logFile, "utf8").match(/Dart Tooling Daemon is available at: (ws:\/\/\S+)/)?.[1];
    const lines = [`기기: ${id}`];
    if (uri) {
      const r = textOf(await callChild(dart(), "dtd", { command: "connect", uri }));
      state.dartConnected = /succeeded/i.test(r);
      if (state.dartConnected) await driver({ command: "set_frame_sync", enabled: "false" });
      lines.push(state.dartConnected ? `Dart 연결: ${uri} (frame sync off)` : `Dart 연결 실패: ${r.slice(0, 200)} — qa_doctor 로 진단`);
    } else {
      lines.push("Dart 미연결 — 네이티브 앱이면 정상. Flutter 앱이면 글자 입력·위젯 기준 탭을 위해 `flutter run --print-dtd` 로그를 logFile 로 주세요.");
    }
    return ok(lines.join("\n"));
  },
);

// ---------------------------------------------------------------- tools: 화면
tool(
  "qa_read_screen",
  "Summarize the current screen as one element per line: ref [type]text = value id=identifier (disabled) @x,y. Use refs such as r12 with qa_tap, qa_type, or qa_expect. Use filter to narrow the output. Preserve actual UI text in its original language.",
  { filter: z.string().optional(), limit: z.number().optional() },
  async ({ filter, limit }) => {
    const all = await screen();
    const els = filter ? all.filter((e) => `${e.label} ${e.value} ${e.id}`.includes(filter)) : all;
    state.lastRefs = new Map(all.map((e) => [e.ref, e]));
    return ok(summarize(els, limit ?? 60));
  },
);

tool(
  "qa_tap",
  "Find and tap an element using text, id, ref, or key (Flutter ValueKey string; requires Dart). Ambiguous matches return candidates without tapping; retry with ref/index. If accessibility text is not found, fall back to Flutter text/tooltip widgets. Danger words (deletion, account removal, logout, payment, etc.; defaults plus dangerWords in qa/qa.config.json) require allowDanger=true. After tapping, wait for waitFor (recommended), or screen stability if omitted, then return a screen summary.",
  { ...sel, key: z.string().optional(), allowDanger: z.boolean().optional(), waitFor: condShape, timeoutMs: z.number().int().nonnegative().optional() },
  async (a) => {
    const danger = (s: string) => !a.allowDanger && DANGER.some((d) => s.includes(d));
    if (a.text && danger(a.text)) return fail(`위험 동작으로 차단: "${a.text}" (allowDanger=true 필요)`);
    if (a.key) {
      if (!state.dartConnected) return fail("key(ValueKey) 선택은 Dart 연결이 필요합니다 — qa_connect(logFile)");
      const r = await driver({ command: "tap", finderType: "ByValueKey", keyValueString: a.key, keyValueType: "String", timeout: "5000" });
      if (driverFailed(r)) return fail(`ValueKey "${a.key}" 탭 실패: ${r.slice(0, 200)}`);
      return after(`탭: Flutter ValueKey "${a.key}"`, a.waitFor, a.timeoutMs);
    }
    const els = await screen();
    const r = resolve(els, pick(a));
    if (r.el) {
      if (danger(r.el.label)) return fail(`위험 동작으로 차단: "${r.el.label}"`);
      await m("mobile_click_on_screen_at_coordinates", { x: cx(r.el), y: cy(r.el) });
      return after(`탭: ${r.el.ref} "${labelOf(r.el)}"${r.el.disabled ? " (비활성 상태였음)" : ""}`, a.waitFor, a.timeoutMs);
    }
    if (r.candidates) return fail(`${r.reason}\n${describeCandidates(r.candidates)}`);
    if (a.text && state.dartConnected) {
      let d = await driver({ command: "tap", finderType: "ByText", text: a.text, timeout: "3000" });
      if (driverFailed(d)) d = await driver({ command: "tap", finderType: "ByTooltipMessage", text: a.text, timeout: "3000" });
      if (!driverFailed(d)) return after(`탭: Flutter 위젯 "${a.text}"`, a.waitFor, a.timeoutMs);
    }
    state.lastRefs = new Map(els.map((e) => [e.ref, e]));
    return fail(`${r.reason}${a.text && !state.dartConnected ? " (Dart 미연결 — 위젯 대체 불가)" : ""}\n현재 화면:\n${summarize(els, 30)}`);
  },
);

tool(
  "qa_tap_xy",
  "Tap coordinates for targets without a name or ID, such as unlabeled icons. Coordinates use the same space as @x,y from qa_read_screen. Danger-word blocking does not apply; inspect qa_screenshot first.",
  { x: z.number(), y: z.number(), waitFor: condShape, timeoutMs: z.number().int().nonnegative().optional() },
  async ({ x, y, waitFor: w, timeoutMs }) => {
    await m("mobile_click_on_screen_at_coordinates", { x, y });
    return after(`탭: (${x}, ${y})`, w, timeoutMs);
  },
);

tool(
  "qa_type",
  "Enter text in a field selected by field (label, hint, or current value), id, or ref, then verify the exact accessibility value of that same field. Prefer id because keyboard appearance can move fields. Missing or masked values cannot be verified; matching text elsewhere does not count. With Dart, use enter_text; otherwise use the device keyboard. Preserve selectors and input text in their original language. timeoutMs controls verification polling (default 3000), not input retries.",
  { field: z.string().optional(), id: z.string().optional(), ref: z.string().optional(), index: z.number().optional(), text: z.string(), timeoutMs: z.number().int().nonnegative().optional() },
  async ({ field, id, ref, index, text, timeoutMs }) => {
    const els = await screen();
    const inputs = els.filter((e) => /TextField|TextView|SearchField|EditText|SecureTextField/.test(e.type));
    let r = resolve(inputs, { text: field, id, ref, index });
    if (!r.el && !r.candidates) r = resolve(els, { text: field, id, ref, index });
    if (!r.el) return fail(r.candidates ? `${r.reason}\n${describeCandidates(r.candidates)}` : `입력칸: ${r.reason}\n${summarize(els, 30)}`);
    const focused = await m("mobile_click_on_screen_at_coordinates", { x: r.el.x + Math.min(r.el.w >> 2, 60), y: cy(r.el) });
    if (focused.isError) return fail(`INPUT_FOCUS_FAILED: ${textOf(focused)}`);
    await sleep(800);
    let via: string;
    if (state.dartConnected) {
      const d = await driver({ command: "enter_text", text });
      if (driverFailed(d)) return fail(`enter_text 실패: ${d.slice(0, 200)}`);
      via = "Dart enter_text";
    } else {
      const typed = await m("mobile_type_keys", { text, submit: false });
      if (typed.isError) return fail(`INPUT_FAILED: ${textOf(typed)}`);
      via = "기기 키보드";
    }
    const w = await waitForInputValue(r.el, text, timeoutMs ?? 3000);
    if (w.pass) return ok(`입력 완료(${via}): "${text}" (확인됨, ${w.elapsedMs}ms)\n--- 화면 ---\n${remember(w.els)}`);
    return fail(`${w.code}: ${w.why} (${via}, ${w.elapsedMs}ms). Inspect the field before retrying; device keyboard input may append text.\n${remember(w.els, 30)}`);
  },
);

tool(
  "qa_expect",
  "Verify that a target (text/id/ref) is present (default), absent, enabled, or disabled. Invalid selectors and stale refs fail; they never prove absence. Use id or exact text for absence checks after navigation/deletion. Enabled/disabled checks require a unique match or explicit index. With timeoutMs, poll the condition. During a recorded run, capture evidence on failure.",
  { ...sel, state: z.enum(["present", "absent", "enabled", "disabled"]).optional(), timeoutMs: z.number().int().nonnegative().optional() },
  async (a) => {
    const st = a.state ?? "present";
    const cond = { sel: pick(a), state: st } as const;
    const r = a.timeoutMs !== undefined ? await waitFor(cond, a.timeoutMs) : { ...check(await screen(), cond), elapsedMs: 0 };
    const target = a.text ?? (a.id ? `id=${a.id}` : a.ref);
    const line = `${r.pass ? "PASS" : "FAIL"} ${st} "${target}" — ${r.why}${r.elapsedMs ? ` (${r.elapsedMs}ms)` : ""}`;
    if (!r.pass && activeRun()) {
      const ev = await captureEvidence(`expect-${target}`);
      return fail(`${line}\n증거: ${ev.join(", ")}`);
    }
    return (r.pass ? ok : fail)(line);
  },
);

tool(
  "qa_wait_until",
  "Wait for a target (text/id) to be present, absent, enabled, or disabled (default timeout: 10 seconds). With stable=true, require two identical consecutive screen reads. Return WAIT_TIMEOUT as an error if the screen does not stabilize; inspect the screen before retrying actions.",
  { text: z.string().optional(), id: z.string().optional(), state: z.enum(["present", "absent", "enabled", "disabled"]).optional(), stable: z.boolean().optional(), timeoutMs: z.number().int().nonnegative().optional() },
  async ({ text, id, state: st, stable, timeoutMs }) => {
    if (stable || (!text && !id)) {
      return afterSettle("대기", await settle(200, timeoutMs ?? 10000));
    }
    return after("대기", { text, id, state: st ?? "present" }, timeoutMs ?? 10000);
  },
);

tool(
  "qa_dismiss_system",
  "Dismiss up to five blocking dialogs using rules. Korean, English, and Japanese defaults deny app tracking, allow notification/local-network permissions, and close app popups. Configure app-specific dismissRules in qa/qa.config.json.",
  {},
  async () => {
    const done: string[] = [];
    for (let i = 0; i < 5; i++) {
      const els = await screen();
      const all = els.map((e) => `${e.label} ${e.value}`).join(" ");
      let target: El | undefined;
      for (const rule of DISMISS_RULES) {
        if (rule.when && !all.includes(rule.when)) continue;
        target = resolve(els, { text: rule.tap, exact: true, index: 0 }).el;
        if (target) break;
      }
      if (!target) break;
      await m("mobile_click_on_screen_at_coordinates", { x: cx(target), y: cy(target) });
      done.push(target.label);
      const settled = await settle(300, 2500);
      if (!settled.stable) return afterSettle(`닫음: ${done.join(" → ")}`, settled);
    }
    return ok(done.length ? `닫음: ${done.join(" → ")}` : "닫을 창 없음");
  },
);

tool(
  "qa_swipe",
  "Swipe to scroll. direction=up moves content upward to reveal content below. For pull to refresh, use direction=down and fromY near the top/header; starting over a card may be interpreted as a tap.",
  { direction: z.enum(["up", "down", "left", "right"]), fromY: z.number().optional(), distance: z.number().optional(), waitFor: condShape, timeoutMs: z.number().int().nonnegative().optional() },
  async ({ direction, fromY, distance, waitFor: w, timeoutMs }) => {
    const x = fromY ? Math.round((await getScreenSize()).w / 2) : undefined;
    await m("mobile_swipe_on_screen", { direction, ...(fromY ? { x, y: fromY } : {}), ...(distance ? { distance } : {}) });
    return after(`스와이프 ${direction}`, w, timeoutMs);
  },
);

tool("qa_screenshot", "Capture a screenshot image. Prefer qa_read_screen when text is sufficient to reduce token usage.", {}, async () => {
  const r = await m("mobile_take_screenshot");
  return { content: (r.content ?? []) as Out["content"] };
});

tool("qa_errors", "Inspect Flutter runtime errors when Dart is connected, plus the device crash list.", {}, async () => {
  const parts: string[] = [];
  if (state.dartConnected) parts.push("[Flutter 런타임 에러]\n" + textOf(await callChild(dart(), "get_runtime_errors", {})).slice(0, 2000));
  parts.push("[기기 크래시]\n" + textOf(await m("mobile_list_crashes")).slice(0, 1000));
  return ok(parts.join("\n\n"));
});

tool(
  "qa_apps",
  "Find installed app names and bundle IDs (package names), including IDs to pass to qa_launch for third-party apps without source access. Use filter to match part of a name or ID.",
  { filter: z.string().optional() },
  async ({ filter }) => {
    const t = textOf(await m("mobile_list_apps"));
    const apps = [...t.matchAll(/([^,:]+?) \(([\w.\-]+)\)/g)].map((x) => ({ name: x[1].trim(), id: x[2] }));
    const f = filter?.toLowerCase();
    const hits = apps.filter((a) => !f || a.name.toLowerCase().includes(f) || a.id.toLowerCase().includes(f));
    const user = hits.filter((a) => !a.id.startsWith("com.apple.") || f);
    return ok(user.length ? user.slice(0, 50).map((a) => `${a.name} — ${a.id}`).join("\n") : `찾지 못함${filter ? ` (filter: ${filter})` : ""} — 전체 ${apps.length}개`);
  },
);

tool(
  "qa_launch",
  "Launch an app, or restart it with restart=true. packageName is the bundle ID, e.g. com.example.app.dev. Wait for screen stability or the supplied waitFor condition after launch.",
  { packageName: z.string(), restart: z.boolean().optional(), waitFor: condShape, timeoutMs: z.number().int().nonnegative().optional() },
  async ({ packageName, restart, waitFor: w, timeoutMs }) => {
    if (restart) await m("mobile_terminate_app", { packageName });
    await m("mobile_launch_app", { packageName });
    if (!w) {
      return afterSettle(`실행: ${packageName}`, await settle(1500, timeoutMs ?? 8000));
    }
    return after(`실행: ${packageName}`, w, timeoutMs);
  },
);

// ---------------------------------------------------------------- tools: 실행 기록
tool(
  "qa_run_start",
  "Start recording a run with meta.json, steps.jsonl, and failure evidence. reportLanguage (en/ko/ja) selects report headings; precedence: this argument, project config reportLanguage, then en. Raw UI text and caller-provided step text are preserved. Write step descriptions in the user's report language.",
  { name: z.string(), scenario: z.string().optional(), app: z.string().optional(), appVersion: z.string().optional(), dir: z.string().optional(), reportLanguage: z.enum(REPORT_LANGUAGES).optional() },
  async ({ name, scenario, app, appVersion, dir, reportLanguage }) => {
    if (activeRun()) return fail(`이미 실행 중: ${activeRun()!.dir} — 먼저 qa_run_end`);
    const r = await startRun(name, { scenario, app, appVersion, dir, reportLanguage });
    return ok(`실행 기록 시작: ${r.dir}\nreportLanguage: ${r.reportLanguage}`);
  },
);

tool(
  "qa_step",
  "Record a scenario step result: title, expected, result (pass/fail/skip), and actual. Automatically capture evidence on failure. Requires qa_run_start.",
  { title: z.string(), expected: z.string().optional(), result: z.enum(["pass", "fail", "skip"]), actual: z.string().optional(), note: z.string().optional() },
  async ({ title, expected, result, actual, note }) => {
    if (!activeRun()) return fail("실행 기록 중이 아님 — qa_run_start 먼저");
    const ev = result === "fail" ? await captureEvidence(`step-${title}`) : [];
    const s = logStep({ tool: "qa_step", result, ms: 0, title, expected, actual, note, evidence: ev });
    return ok(`#${s?.i} ${result.toUpperCase()} ${title}${ev.length ? `\n증거: ${ev.join(", ")}` : ""}`);
  },
);

tool(
  "qa_run_end",
  "Finish recording. Generate report.md with a summary, step table, and evidence list, then return its path and PASS/FAIL counts.",
  { summary: z.string().optional() },
  async ({ summary }) => {
    const r = endRun(summary);
    if (!r) return fail("실행 기록 중이 아님");
    return ok(`실행 종료: PASS ${r.pass} · FAIL ${r.fail} · SKIP ${r.skip} · 도구 오류 ${r.toolFails}\n보고서: ${r.dir}/report.md`);
  },
);

tool(
  "qa_finish",
  "Clean up after QA: stop the device automation agent (iOS Automation Running indicator) and the Mac mobilecli daemon, then close internal mobile-mcp and Dart connections. Close any active run first. Leave the app and flutter run running. Underlying connections restart on the next qa_* call.",
  {},
  async () => {
    const done: string[] = [];
    if (activeRun()) {
      const r = endRun("qa_finish 로 종료");
      done.push(`실행 기록 닫음(${r?.dir}/report.md)`);
    }
    if (state.dartConnected) {
      try {
        await callChild(dart(), "dtd", { command: "disconnect" });
      } catch {}
      state.dartConnected = false;
      done.push("Dart 연결 해제");
    }
    for (const [name, p] of [
      ["mobile-mcp", state.mobileP],
      ["dart mcp", state.dartP],
    ] as const) {
      if (!p) continue;
      try {
        await (await p).close();
        done.push(`${name} 종료`);
      } catch {}
    }
    state.mobileP = undefined;
    state.dartP = undefined;
    state.lastRefs.clear();
    resetScreenSize();
    // mobilecli 데몬이 기기 에이전트(XCUITest)를 붙잡고 있다 — 데몬을 끄면 기기 쪽 에이전트도 함께 종료된다.
    try {
      execFileSync("pkill", ["-f", "mobilecli.*daemon"]);
      done.push("mobilecli 데몬·기기 에이전트 종료");
    } catch {
      done.push("mobilecli 데몬 없음");
    }
    return ok(`정리 완료: ${done.join(" · ")}`);
  },
);

await server.connect(new StdioServerTransport());
