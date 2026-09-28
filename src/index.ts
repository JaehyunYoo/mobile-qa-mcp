#!/usr/bin/env node
/**
 * flutter-mobile-qa-mcp — mobile-mcp(앱 밖: 화면·탭·시스템 창) + Dart MCP(앱 안: 입력·위젯·에러)를 묶은 QA 서버.
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
} from "./core.js";
import { activeRun, captureEvidence, endRun, logStep, startRun } from "./runlog.js";
import { runDoctor } from "./doctor.js";

type Out = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean };
const ok = (text: string): Out => ({ content: [{ type: "text", text }] });
const fail = (text: string): Out => ({ content: [{ type: "text", text }], isError: true });

const server = new McpServer({ name: "flutter-mobile-qa", version: "0.5.0" }, { instructions: SERVER_INSTRUCTIONS });
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
  text: z.string().optional().describe("보이는 텍스트(완전 일치 → 포함 순서로 찾음)"),
  id: z.string().optional().describe("접근성 식별자(iOS accessibilityIdentifier / Android resource-id / Flutter Semantics(identifier))"),
  ref: z.string().optional().describe("qa_read_screen 이 준 참조(예: r12)"),
  index: z.number().optional().describe("후보가 여럿일 때 0부터 몇 번째"),
  exact: z.boolean().optional().describe("true 면 완전 일치만"),
};
const condShape = z
  .object({
    text: z.string().optional(),
    id: z.string().optional(),
    state: z.enum(["present", "absent", "enabled", "disabled"]).optional(),
  })
  .optional()
  .describe("조작 뒤 이 조건이 될 때까지 기다린다(예: {text:'저장', state:'enabled'})");
const pick = (a: { text?: string; id?: string; ref?: string; index?: number; exact?: boolean }): Selector => ({
  text: a.text,
  id: a.id,
  ref: a.ref,
  index: a.index,
  exact: a.exact,
});
const labelOf = (e: El) => (e.label || e.value || e.id).replace(/\n/g, " / ");

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
  const s = await settle();
  return ok(`${action} (안정 ${s.elapsedMs}ms)\n--- 화면 ---\n${remember(s.els)}`);
}

// ---------------------------------------------------------------- tools: 진단·연결
tool(
  "qa_doctor",
  "환경 진단. 기기 연결 · mobile-mcp · 조작 에이전트 · 화면 읽기 · Dart/DTD · flutter_driver 확장을 차례로 확인하고, 지금 가능한 기능과 복구 방법을 표로 알려 준다. QA 시작 전, 또는 도구가 이상하게 실패할 때 먼저 실행(앱 버그와 환경 문제 구분). Flutter 앱이면 logFile 을 준다.",
  { logFile: z.string().optional(), dtdUri: z.string().optional() },
  async ({ logFile, dtdUri }) => ok(await runDoctor({ logFile, dtdUri })),
);

tool(
  "qa_connect",
  "QA 세션 준비. 기기를 고르고, (Flutter 앱이면) DTD(ws://…)에 연결해 flutter_driver 프레임 동기화를 끈다. dtdUri 를 주거나 `flutter run --print-dtd` 로그 경로(logFile)를 주면 거기서 찾는다. 네이티브 앱은 logFile 없이 호출.",
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
  "현재 화면 요약: 한 줄에 `ref [종류]텍스트 = 값 id=식별자 (비활성) @x,y`. ref(r12 등)는 이 화면에서 qa_tap/qa_type/qa_expect 에 그대로 쓸 수 있다. filter 로 일부만.",
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
  "요소를 찾아 탭한다. 선택자: text / id / ref / key(Flutter ValueKey 문자열, Dart 연결 필요). 후보가 여럿이면 누르지 않고 후보 목록을 돌려준다(ref·index 로 다시 지정). 텍스트를 접근성에서 못 찾으면 Flutter 위젯(텍스트·툴팁)으로 대체. 위험 단어(삭제·탈퇴·로그아웃·결제 등 — 기본 목록 + qa/qa.config.json 의 dangerWords)는 allowDanger=true 일 때만. 탭 뒤 waitFor 조건까지 기다리거나(권장), 없으면 화면이 안정될 때까지 기다린 뒤 화면 요약을 준다.",
  { ...sel, key: z.string().optional(), allowDanger: z.boolean().optional(), waitFor: condShape, timeoutMs: z.number().optional() },
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
  "좌표로 탭(아이콘만 있는 버튼 등 이름·id 가 없는 요소). 좌표는 qa_read_screen 의 @x,y 와 같은 기준. 위험 동작 차단이 적용되지 않으니 먼저 qa_screenshot 으로 확인.",
  { x: z.number(), y: z.number(), waitFor: condShape, timeoutMs: z.number().optional() },
  async ({ x, y, waitFor: w, timeoutMs }) => {
    await m("mobile_click_on_screen_at_coordinates", { x, y });
    return after(`탭: (${x}, ${y})`, w, timeoutMs);
  },
);

tool(
  "qa_type",
  "입력칸에 글자를 넣는다: 입력칸을 field(라벨·힌트·현재 값) / id / ref 로 찾아 탭(포커스) → 입력 → 값 확인. Dart 연결이 있으면 Dart enter_text(Flutter — 실기기 iOS 는 Flutter 입력칸에 키보드가 안 떠서 필수), 없으면 기기 키보드(네이티브 앱).",
  { field: z.string().optional(), id: z.string().optional(), ref: z.string().optional(), index: z.number().optional(), text: z.string() },
  async ({ field, id, ref, index, text }) => {
    const els = await screen();
    const inputs = els.filter((e) => /TextField|TextView|SearchField|EditText|SecureTextField/.test(e.type));
    let r = resolve(inputs, { text: field, id, ref, index });
    if (!r.el && !r.candidates) r = resolve(els, { text: field, id, ref, index });
    if (!r.el) return fail(r.candidates ? `${r.reason}\n${describeCandidates(r.candidates)}` : `입력칸: ${r.reason}\n${summarize(els, 30)}`);
    await m("mobile_click_on_screen_at_coordinates", { x: r.el.x + Math.min(r.el.w >> 2, 60), y: cy(r.el) });
    await sleep(800);
    let via: string;
    if (state.dartConnected) {
      const d = await driver({ command: "enter_text", text });
      if (driverFailed(d)) return fail(`enter_text 실패: ${d.slice(0, 200)}`);
      via = "Dart enter_text";
    } else {
      await m("mobile_type_keys", { text, submit: false });
      via = "기기 키보드";
    }
    const w = await waitFor({ sel: { text }, state: "present" }, 3000, 300);
    if (w.pass) return ok(`입력 완료(${via}): "${text}" (확인됨, ${w.elapsedMs}ms)\n--- 화면 ---\n${remember(w.els)}`);
    const hint = state.dartConnected ? "포커스 실패 가능" : "Flutter 앱이면 키보드가 안 떠서 입력이 안 들어갔을 수 있음 → flutter_driver entry + qa_connect(logFile)";
    return fail(`입력 후 값이 보이지 않음(${via}) — ${hint}\n${summarize(w.els, 30)}`);
  },
);

tool(
  "qa_expect",
  "화면 검증. 대상(text / id / ref)이 보이는지(present, 기본) · 안 보이는지(absent) · 활성(enabled) · 비활성(disabled). timeoutMs 를 주면 그때까지 조건이 될 때까지 기다린다(느린 화면·로딩). 실행 기록 중 FAIL 이면 증거(스크린샷·요소·에러)를 자동 저장.",
  { ...sel, state: z.enum(["present", "absent", "enabled", "disabled"]).optional(), timeoutMs: z.number().optional() },
  async (a) => {
    const st = a.state ?? "present";
    const cond = { sel: pick(a), state: st } as const;
    const r = a.timeoutMs ? await waitFor(cond, a.timeoutMs) : { ...check(await screen(), cond), elapsedMs: 0 };
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
  "조건이 될 때까지 기다린다(기본 10초): 대상(text / id)이 present·absent·enabled·disabled. 예: 로딩 표시가 사라질 때까지(absent), 저장 버튼이 활성될 때까지(enabled). stable=true 면 화면이 더 이상 바뀌지 않을 때까지.",
  { text: z.string().optional(), id: z.string().optional(), state: z.enum(["present", "absent", "enabled", "disabled"]).optional(), stable: z.boolean().optional(), timeoutMs: z.number().optional() },
  async ({ text, id, state: st, stable, timeoutMs }) => {
    if (stable || (!text && !id)) {
      const s = await settle(200, timeoutMs ?? 10000);
      return ok(`화면 안정 (${s.elapsedMs}ms)\n--- 화면 ---\n${remember(s.els)}`);
    }
    return after("대기", { text, id, state: st ?? "present" }, timeoutMs ?? 10000);
  },
);

tool(
  "qa_dismiss_system",
  "앱 흐름을 막는 창을 규칙대로 닫는다(최대 5개). 기본 규칙(한국어·영어·일본어): 앱 추적 → 추적 금지 요청, 알림·로컬 네트워크 권한 → 허용, 앱 팝업 → 닫기. 프로젝트 규칙은 qa/qa.config.json 의 dismissRules.",
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
      await settle(300, 2500);
    }
    return ok(done.length ? `닫음: ${done.join(" → ")}` : "닫을 창 없음");
  },
);

tool(
  "qa_swipe",
  "스와이프(스크롤). direction=up 이면 내용이 위로(아래 내용 보기). 당겨서 새로고침은 direction=down, fromY 를 화면 위쪽(헤더)으로 — 카드 위에서 시작하면 탭으로 인식될 수 있다.",
  { direction: z.enum(["up", "down", "left", "right"]), fromY: z.number().optional(), distance: z.number().optional(), waitFor: condShape, timeoutMs: z.number().optional() },
  async ({ direction, fromY, distance, waitFor: w, timeoutMs }) => {
    const x = fromY ? Math.round((await getScreenSize()).w / 2) : undefined;
    await m("mobile_swipe_on_screen", { direction, ...(fromY ? { x, y: fromY } : {}), ...(distance ? { distance } : {}) });
    return after(`스와이프 ${direction}`, w, timeoutMs);
  },
);

tool("qa_screenshot", "스크린샷(이미지). 텍스트로 충분하면 qa_read_screen 이 훨씬 가볍다.", {}, async () => {
  const r = await m("mobile_take_screenshot");
  return { content: (r.content ?? []) as Out["content"] };
});

tool("qa_errors", "문제 확인: Flutter 런타임 에러(Dart 연결 시) + 기기 크래시 목록.", {}, async () => {
  const parts: string[] = [];
  if (state.dartConnected) parts.push("[Flutter 런타임 에러]\n" + textOf(await callChild(dart(), "get_runtime_errors", {})).slice(0, 2000));
  parts.push("[기기 크래시]\n" + textOf(await m("mobile_list_crashes")).slice(0, 1000));
  return ok(parts.join("\n\n"));
});

tool(
  "qa_apps",
  "기기에 설치된 앱의 이름과 번들 ID(패키지명)를 찾는다 — 소스가 없는 다른 회사 앱을 QA 할 때 qa_launch 에 넣을 ID 확인용. filter 로 이름·ID 일부 검색.",
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
  "앱 실행(또는 restart=true 로 재실행). packageName 은 번들 ID(예: com.example.app.dev). 실행 뒤 화면이 안정될 때까지 기다린다.",
  { packageName: z.string(), restart: z.boolean().optional(), waitFor: condShape, timeoutMs: z.number().optional() },
  async ({ packageName, restart, waitFor: w, timeoutMs }) => {
    if (restart) await m("mobile_terminate_app", { packageName });
    await m("mobile_launch_app", { packageName });
    if (!w) {
      const s = await settle(1500, timeoutMs ?? 8000);
      return ok(`실행: ${packageName} (안정 ${s.elapsedMs}ms)\n--- 화면 ---\n${remember(s.els)}`);
    }
    return after(`실행: ${packageName}`, w, timeoutMs);
  },
);

// ---------------------------------------------------------------- tools: 실행 기록
tool(
  "qa_run_start",
  "실행 기록 시작. 실행 폴더(기본 <프로젝트>/qa/runs/<시각>-<name>/)를 만들고 meta.json(기기·앱·코드 커밋)을 남긴다. 이후 모든 qa_* 호출이 steps.jsonl 에 기록되고, 실패 시 evidence/ 에 스크린샷·화면 요소·에러가 저장된다.",
  { name: z.string(), scenario: z.string().optional(), app: z.string().optional(), appVersion: z.string().optional(), dir: z.string().optional() },
  async ({ name, scenario, app, appVersion, dir }) => {
    if (activeRun()) return fail(`이미 실행 중: ${activeRun()!.dir} — 먼저 qa_run_end`);
    const r = await startRun(name, { scenario, app, appVersion, dir });
    return ok(`실행 기록 시작: ${r.dir}`);
  },
);

tool(
  "qa_step",
  "시나리오 단계 판정을 기록한다(title · expected · result=pass/fail/skip · actual). fail 이면 증거를 자동 저장. qa_run_start 후에 쓴다.",
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
  "실행 기록 종료. report.md(요약·단계 표·증거 목록)를 만들고 경로와 PASS/FAIL 수를 돌려준다.",
  { summary: z.string().optional() },
  async ({ summary }) => {
    const r = endRun(summary);
    if (!r) return fail("실행 기록 중이 아님");
    return ok(`실행 종료: PASS ${r.pass} · FAIL ${r.fail} · SKIP ${r.skip} · 도구 오류 ${r.toolFails}\n보고서: ${r.dir}/report.md`);
  },
);

tool(
  "qa_finish",
  "QA 종료 정리: 기기의 조작 에이전트(iOS 상단 'Automation Running' 표시)와 Mac 의 mobilecli 데몬을 끄고, 내부 mobile-mcp·Dart 연결을 닫는다. 실행 기록이 열려 있으면 먼저 닫는다. 앱과 flutter run 은 건드리지 않는다. 다음 qa_* 호출 때 자동으로 다시 켜진다.",
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
