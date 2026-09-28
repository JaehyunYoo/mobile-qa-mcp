/**
 * 실행 기록 · 실패 증거.
 * qa_run_start 로 실행 폴더를 만들면, 이후 모든 도구 호출이 steps.jsonl 에 남고
 * 실패(qa_expect FAIL · qa_step fail · 도구 에러) 때는 스크린샷·화면 요소·런타임 에러를 자동 저장한다.
 * 대화로는 요약과 경로만 돌려줘 토큰을 늘리지 않는다.
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PROJECT_DIR, RUNS_DIR, callChild, dart, m, mobile, screenRaw, state, textOf } from "./core.js";

export type Step = {
  i: number;
  at: string;
  ms: number;
  tool: string;
  args?: unknown;
  result: "ok" | "fail" | "pass" | "skip";
  title?: string;
  expected?: string;
  actual?: string;
  note?: string;
  evidence?: string[];
};
type Run = { id: string; dir: string; name: string; startedAt: number; steps: Step[]; meta: Record<string, unknown> };

let run: Run | undefined;
export const activeRun = () => run;

const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 40);
const git = (args: string[]) => {
  try {
    return execFileSync("git", args, { cwd: PROJECT_DIR, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

export async function startRun(name: string, opts: { scenario?: string; app?: string; appVersion?: string; dir?: string }) {
  const id = stamp();
  const base = opts.dir ?? RUNS_DIR;
  const dir = join(base, `${id}-${safe(name)}`);
  mkdirSync(join(dir, "evidence"), { recursive: true });
  let deviceInfo = "";
  try {
    deviceInfo = textOf(await callChild(mobile(), "mobile_list_available_devices", {}));
  } catch {}
  const meta = {
    runId: id,
    name,
    scenario: opts.scenario,
    startedAt: new Date().toISOString(),
    device: state.deviceId,
    devices: deviceInfo.slice(0, 1000),
    app: opts.app,
    appVersion: opts.appVersion,
    dartConnected: state.dartConnected,
    git: { branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), commit: git(["rev-parse", "--short", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "" },
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  run = { id, dir, name, startedAt: Date.now(), steps: [], meta };
  return run;
}

/** 모든 도구 호출에서 자동으로 부른다(실행 중일 때만 기록). */
export function logStep(s: Omit<Step, "i" | "at">): Step | undefined {
  if (!run) return;
  const step: Step = { i: run.steps.length + 1, at: new Date().toISOString(), ...s };
  run.steps.push(step);
  appendFileSync(join(run.dir, "steps.jsonl"), JSON.stringify(step) + "\n");
  return step;
}

/** 실패 증거: 스크린샷 · 화면 요소 원본 · 런타임 에러. 파일 경로 목록을 돌려준다. */
export async function captureEvidence(tag: string): Promise<string[]> {
  if (!run) return [];
  const base = join(run.dir, "evidence", `${String(run.steps.length + 1).padStart(3, "0")}-${safe(tag)}`);
  const saved: string[] = [];
  try {
    await m("mobile_save_screenshot", { saveTo: `${base}.png` });
    if (existsSync(`${base}.png`)) saved.push(`${base}.png`);
  } catch {}
  try {
    writeFileSync(`${base}.elements.txt`, await screenRaw());
    saved.push(`${base}.elements.txt`);
  } catch {}
  try {
    const parts: string[] = [];
    if (state.dartConnected) parts.push("[Flutter 런타임 에러]\n" + textOf(await callChild(dart(), "get_runtime_errors", {})));
    parts.push("[기기 크래시]\n" + textOf(await m("mobile_list_crashes")));
    writeFileSync(`${base}.errors.txt`, parts.join("\n\n"));
    saved.push(`${base}.errors.txt`);
  } catch {}
  return saved;
}

export function endRun(summary?: string) {
  if (!run) return undefined;
  const r = run;
  const judged = r.steps.filter((s) => s.result === "pass" || s.result === "fail" || s.result === "skip");
  const count = (k: Step["result"]) => r.steps.filter((s) => s.result === k).length;
  const toolFails = r.steps.filter((s) => s.result === "fail" && !s.title).length;
  const lines = [
    `# QA 실행 결과 — ${r.name}`,
    "",
    `- 실행 ID: ${r.id}`,
    `- 시나리오: ${r.meta.scenario ?? "-"}`,
    `- 시작: ${r.meta.startedAt} · 소요: ${Math.round((Date.now() - r.startedAt) / 1000)}초`,
    `- 기기: ${r.meta.device ?? "-"} · 앱: ${r.meta.app ?? "-"} ${r.meta.appVersion ?? ""}`,
    `- 코드: ${(r.meta.git as { branch: string; commit: string; dirty: boolean }).branch}@${(r.meta.git as { commit: string }).commit}${(r.meta.git as { dirty: boolean }).dirty ? " (미커밋 변경 있음)" : ""}`,
    `- 판정: PASS ${count("pass")} · FAIL ${count("fail") - toolFails} · SKIP ${count("skip")} · 도구 오류 ${toolFails}`,
    summary ? `- 요약: ${summary}` : "",
    "",
    "## 단계",
    "| # | 결과 | 단계 | 기대 | 실제 | ms | 증거 |",
    "|---|---|---|---|---|---|---|",
    ...(judged.length ? judged : r.steps).map(
      (s) =>
        `| ${s.i} | ${s.result.toUpperCase()} | ${(s.title ?? s.tool).replace(/\|/g, "/")} | ${(s.expected ?? "").replace(/\|/g, "/")} | ${(s.actual ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} | ${s.ms} | ${(s.evidence ?? []).map((p) => p.split("/").pop()).join(", ")} |`,
    ),
    "",
    "전체 도구 호출 기록: `steps.jsonl` · 증거: `evidence/`",
  ];
  writeFileSync(join(r.dir, "report.md"), lines.filter((l) => l !== "").join("\n") + "\n");
  run = undefined;
  return { dir: r.dir, pass: count("pass"), fail: count("fail") - toolFails, skip: count("skip"), toolFails };
}
