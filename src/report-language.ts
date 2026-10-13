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
    calls: "All tool calls", evidence: "Evidence", notFound: "Element not found", notFoundStep: "Locating the target",
    responseSize: "Response size: {chars} chars · {images} images (tool responses, excl. qa_step)",
    expect_present: "\"{target}\" is shown", expect_absent: "\"{target}\" is gone", expect_enabled: "\"{target}\" is enabled", expect_disabled: "\"{target}\" is disabled", expect_stable: "The screen settles",
    actionOn: "The action on \"{label}\"", actionTool: "The {tool} action",
    waitNotFound: "{action} went through, but \"{target}\" could not then be found by screen reading (accessibility). It may still be visible on screen — please check the screenshot.",
    targetNotFound: "The target could not be identified by screen reading (accessibility). This is not an app error. Detail: {detail}",
    notFoundNote: "Element not found = the target (text/id) was missing from the accessibility tree, or could not be tapped/typed into. This is not an app error; the screen itself may be fine — check the evidence screenshot.",
  },
  ko: {
    title: "QA 실행 결과", runId: "실행 ID", scenario: "시나리오", start: "시작", duration: "소요", seconds: "초",
    device: "기기", app: "앱", code: "코드", dirty: "미커밋 변경 있음", results: "판정", toolErrors: "도구 오류",
    summary: "요약", steps: "단계", columns: "| # | 결과 | 단계 | 기대 | 실제 | ms | 증거 |",
    calls: "전체 도구 호출 기록", evidence: "증거", notFound: "요소 못 찾음", notFoundStep: "화면 읽기로 대상 찾기",
    responseSize: "응답 크기: {chars}자 · 이미지 {images}장 (도구 응답 기준, qa_step 제외)",
    expect_present: "\"{target}\" 이(가) 화면에 보입니다", expect_absent: "\"{target}\" 이(가) 화면에서 사라집니다", expect_enabled: "\"{target}\" 이(가) 활성화됩니다", expect_disabled: "\"{target}\" 이(가) 비활성 상태입니다", expect_stable: "화면이 안정됩니다",
    actionOn: "\"{label}\" 조작", actionTool: "{tool} 조작",
    waitNotFound: "{action}까지는 정상적으로 진행됐지만, 이어서 \"{target}\" 을(를) 화면 읽기(접근성)로 찾지 못했습니다. 화면에는 보일 수 있으니 증거 스크린샷을 확인해 주세요.",
    targetNotFound: "조작 대상을 화면 읽기(접근성)로 특정하지 못했습니다. 앱 오류가 아니라 화면 읽기에 대상이 잡히지 않은 경우입니다. 상세: {detail}",
    notFoundNote: "요소 못 찾음 = 접근성 트리에서 대상(텍스트·id)을 찾지 못했거나 탭·입력 대상을 특정하지 못한 경우입니다. 앱 오류가 아니며 화면 자체는 정상일 수 있습니다 — 증거 스크린샷으로 확인하세요.",
  },
  ja: {
    title: "QA実行結果", runId: "実行ID", scenario: "シナリオ", start: "開始", duration: "所要時間", seconds: "秒",
    device: "端末", app: "アプリ", code: "コード", dirty: "未コミットの変更あり", results: "判定", toolErrors: "ツールエラー",
    summary: "要約", steps: "ステップ", columns: "| # | 結果 | ステップ | 期待値 | 実際 | ms | 証拠 |",
    calls: "全ツール呼び出し記録", evidence: "証拠", notFound: "要素未検出", notFoundStep: "画面読み取りで対象を検出",
    responseSize: "応答サイズ: {chars}文字 · 画像{images}枚（ツール応答、qa_step を除く）",
    expect_present: "「{target}」が表示される", expect_absent: "「{target}」が消える", expect_enabled: "「{target}」が有効になる", expect_disabled: "「{target}」が無効である", expect_stable: "画面が安定する",
    actionOn: "「{label}」の操作", actionTool: "{tool} の操作",
    waitNotFound: "{action}までは正常に進みましたが、続いて「{target}」を画面読み取り（アクセシビリティ）で見つけられませんでした。画面には表示されている可能性があるため、証拠スクリーンショットを確認してください。",
    targetNotFound: "操作対象を画面読み取り（アクセシビリティ）で特定できませんでした。アプリのエラーではありません。詳細: {detail}",
    notFoundNote: "要素未検出 = アクセシビリティツリーで対象（テキスト・id）が見つからない、またはタップ・入力対象を特定できなかった場合です。アプリのエラーではなく、画面自体は正常な可能性があります — 証拠スクリーンショットを確認してください。",
  },
} satisfies Record<ReportLanguage, Record<string, string>>;
