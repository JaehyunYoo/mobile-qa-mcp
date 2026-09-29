export const REPORT_LANGUAGES = ["en", "ko", "ja"] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export function resolveReportLanguage(value: unknown): ReportLanguage {
  if (value === undefined) return "en";
  if (REPORT_LANGUAGES.includes(value as ReportLanguage)) return value as ReportLanguage;
  throw new Error("reportLanguage must be en, ko, or ja");
}

export const REPORT_TEXT = {
  en: {
    title: "QA Run Results", runId: "Run ID", scenario: "Scenario", start: "Started", duration: "Duration", seconds: "s",
    device: "Device", app: "App", code: "Code", dirty: "uncommitted changes", results: "Results", toolErrors: "Tool errors",
    summary: "Summary", steps: "Steps", columns: "| # | Result | Step | Expected | Actual | ms | Evidence |",
    calls: "All tool calls", evidence: "Evidence",
  },
  ko: {
    title: "QA 실행 결과", runId: "실행 ID", scenario: "시나리오", start: "시작", duration: "소요", seconds: "초",
    device: "기기", app: "앱", code: "코드", dirty: "미커밋 변경 있음", results: "판정", toolErrors: "도구 오류",
    summary: "요약", steps: "단계", columns: "| # | 결과 | 단계 | 기대 | 실제 | ms | 증거 |",
    calls: "전체 도구 호출 기록", evidence: "증거",
  },
  ja: {
    title: "QA実行結果", runId: "実行ID", scenario: "シナリオ", start: "開始", duration: "所要時間", seconds: "秒",
    device: "端末", app: "アプリ", code: "コード", dirty: "未コミットの変更あり", results: "判定", toolErrors: "ツールエラー",
    summary: "要約", steps: "ステップ", columns: "| # | 結果 | ステップ | 期待値 | 実際 | ms | 証拠 |",
    calls: "全ツール呼び出し記録", evidence: "証拠",
  },
} satisfies Record<ReportLanguage, Record<string, string>>;
