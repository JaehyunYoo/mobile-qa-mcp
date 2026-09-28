/**
 * QA 를 "어떻게 스토리텔링 하는지" 에이전트에게 알려 주는 내장 가이드.
 *  - SERVER_INSTRUCTIONS: 서버 연결 시 에이전트가 자동으로 받는 원칙(짧게)
 *  - registerPrompts: `/` 명령으로 부르는 워크플로 — plan_qa · run_qa · explore_qa · report_qa
 *  - 시나리오 형식·예시는 guides/ 폴더를 리소스로 노출
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDES = join(dirname(fileURLToPath(import.meta.url)), "..", "guides");
const guide = (f: string) => readFileSync(join(GUIDES, f), "utf8");

export const SERVER_INSTRUCTIONS = `모바일 앱 QA 서버 — 어떤 앱이든(직접 만든 앱·다른 회사 앱, Flutter·네이티브 iOS/Android·React Native). Flutter 앱은 Dart 연결로 입력·위젯 기능이 추가된다. 원칙:
0) 준비: qa_doctor(Flutter 면 logFile)로 환경부터 확인. 도구가 이상하게 실패하면 앱 버그로 단정하기 전에 qa_doctor. 앱 ID 를 모르면 qa_apps.
1) 루프: qa_read_screen 으로 읽고 → 판단 → qa_tap/qa_type 으로 조작 → 검증. 좌표를 외워서 누르지 말 것(한 번만 뜨는 가이드·팝업이 흐름을 바꾼다).
2) 선택: ref(방금 읽은 화면의 r12 등) · id(접근성 식별자) · text 순으로 정확하다. 후보가 여럿이라고 하면 ref/index 로 다시 지정. 이름이 없는 아이콘만 qa_tap_xy.
3) 대기: 고정 대기 대신 조건 대기 — qa_tap(waitFor: {text, state}) 또는 qa_expect(timeoutMs) / qa_wait_until(로딩 사라짐 등).
4) 기록: 시나리오 실행은 qa_run_start → 단계마다 qa_step(title, expected, result, actual) → qa_run_end. 실패 증거(스크린샷·요소·에러)는 자동 저장되니 대화에는 경로만.
5) 텍스트 우선: 이미지(qa_screenshot)는 레이아웃·색 확인과 좌표가 필요할 때만.
6) 안전: 데이터를 만들면 정리까지. 위험 동작(삭제·결제·로그아웃 등, 프로젝트 설정 qa/qa.config.json 에 추가 가능)은 사용자 승인 후에만 allowDanger. 비밀번호·인증 코드·생체 인증·개인 계정 선택은 사람에게 넘긴다. 다른 회사 앱이면 실제 결제·게시·메시지 전송 같은 외부 영향 동작은 특히 조심.
7) 기기 조작 시작 전에 무엇을 할지 알리고 확인받는다. 끝나면 qa_finish.
워크플로 프롬프트: plan_qa(시나리오 작성) · run_qa(실행) · explore_qa(탐색) · report_qa(보고서). 형식: 리소스 qa://guides/scenario-format`;

export function registerGuidance(server: McpServer) {
  server.registerResource(
    "scenario-format",
    "qa://guides/scenario-format",
    { title: "QA 시나리오 형식", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide("SCENARIO_FORMAT.md") }] }),
  );
  server.registerResource(
    "scenario-example",
    "qa://guides/example-schedule-create",
    { title: "시나리오 예시: 일정 생성", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide("example-schedule-create.md") }] }),
  );

  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "plan_qa",
    {
      title: "QA 시나리오 작성",
      description: "기능 설명(또는 화면 이름·PR·이슈)으로 QA 시나리오 세트를 만든다. 기기는 조작하지 않는다.",
      argsSchema: {
        feature: z.string().describe("무엇을 QA 할지 — 기능/화면/변경 내용"),
        depth: z.string().optional().describe("smoke(기본 흐름만) | standard(기본) | deep(경계값·권한·회귀까지)"),
        source: z.string().optional().describe("참고할 코드 경로·PR·이슈·기획 문서(있으면). 없으면 기기에서 화면을 둘러보는 블랙박스 방식"),
      },
    },
    ({ feature, depth, source }) =>
      user(`QA 시나리오를 작성해 줘. **기기는 조작하지 말고 문서만.**

대상: ${feature}
깊이: ${depth ?? "standard"}${source ? `\n참고: ${source}` : ""}

순서:
1. 이해 — 둘 중 가능한 방식으로:
   - **소스가 있으면(화이트박스)**: ${source ? "참고 자료와 " : ""}관련 코드(화면·상태 관리·API)를 읽고 사용자가 이 기능으로 하는 일을 3~5줄로 요약. 화면 문구(버튼·힌트)는 앱의 문자열/다국어 리소스에서 실제 문구를 찾아 쓴다.
   - **소스가 없으면(블랙박스 — 다른 회사 앱 등)**: 기기 조작이 필요하므로 먼저 나에게 확인받고, 데이터를 바꾸지 않는 선에서 qa_read_screen·qa_tap(뒤로 나오기)으로 해당 기능 화면들을 둘러보며 실제 문구·흐름을 수집. 저장·전송·결제 버튼은 누르지 않는다.
2. 위험 파악: 데이터가 바뀌는 동작, 다른 사용자에게 영향(알림·공유), 권한·외부 연동, 과거 버그(이슈 문서)를 나열.
3. 세트 구성: 아래 형식의 "시나리오 종류" 표에서 깊이에 맞게 고른다.
   - smoke: 기본 흐름 1~2개
   - standard: + 검증·경계값, 상태 반영, 되돌리기
   - deep: + 권한·외부, 회귀
4. 각 시나리오를 형식대로 작성. 동작은 사람이 화면에서 보는 말로, 모든 단계에 qa_expect 로 판정 가능한 기대 결과. 데이터를 만들면 정리 단계까지.
5. 저장: 앱 저장소가 있으면 그 안의 qa/scenarios/<기능>-<번호>.md, 없으면(다른 회사 앱) 지금 작업 폴더의 qa/scenarios/ (폴더 없으면 만든다). 마지막에 목록 표(ID·제목·우선순위·데이터 변경·위험 동작)를 보여 주고, 실행 전에 사람이 검토하도록 요청.

형식:
${guide("SCENARIO_FORMAT.md")}

예시:
${guide("example-schedule-create.md")}`),
  );

  server.registerPrompt(
    "run_qa",
    {
      title: "QA 시나리오 실행",
      description: "시나리오 파일을 기기에서 단계별로 실행하고 결과를 파일에 기록한다.",
      argsSchema: {
        scenario: z.string().describe("시나리오 파일 경로(여러 개면 쉼표) 또는 폴더"),
        logFile: z.string().optional().describe("flutter run --print-dtd 로그 경로(글자 입력에 필요)"),
        allowDanger: z.string().optional().describe("yes 면 시나리오에 표시된 위험 단계를 허용"),
      },
    },
    ({ scenario, logFile, allowDanger }) =>
      user(`QA 시나리오를 실행해 줘: ${scenario}

시작 전:
- 시나리오를 읽고 **무엇을 할지(데이터 변경·위험 단계 포함) 요약해서 나에게 확인받은 뒤** 시작.
- qa_doctor(${logFile ? `logFile: "${logFile}"` : "Flutter 앱이면 logFile 을 나에게 물어볼 것, 네이티브면 생략"}) 로 환경 확인 → 문제가 있으면 복구 방법을 알려 주고 멈춤.
- qa_connect(같은 logFile) → qa_run_start(name: 시나리오 ID, scenario: 파일 경로) → qa_dismiss_system.
- 전제 조건이 화면과 맞는지 qa_read_screen 으로 확인. 안 맞으면 멈추고 알려 줘.

단계마다:
1. qa_read_screen(필요한 부분만 filter)으로 현재 화면 확인
2. 동작 수행(qa_tap / qa_type / qa_swipe). 선택은 ref·id 우선, 후보가 여럿이면 다시 지정. 다음 화면이 기대되면 waitFor 로 기다림. 이름 없는 아이콘은 qa_screenshot 보고 qa_tap_xy
3. 기대 결과를 qa_expect(느린 화면이면 timeoutMs)로 판정 → qa_step(title, expected, result, actual) 로 기록
4. FAIL 이면: 증거는 자동 저장됨. 이후 단계를 계속할 수 있는지 판단(불가하면 정리 단계로 건너뜀). 도구 오류가 환경 때문 같으면 qa_doctor
- 예상 못 한 창(가이드·팝업·권한)이 뜨면 qa_dismiss_system 후 해당 단계를 다시.
- 위험 단계: ${allowDanger === "yes" ? "시나리오에 명시된 단계만 allowDanger 사용." : "allowDanger 쓰기 전에 나에게 확인."}
- 비밀번호·Face ID·계정 선택이 나오면 멈추고 나에게 넘길 것.

끝나면:
- 정리 단계 실행(만든 데이터 삭제 등) 후 정말 없어졌는지 qa_expect(absent)
- qa_run_end(summary) → report.md 경로. 시나리오 파일 끝에도 "## 실행 결과 — 날짜, 기기" 요약 표와 report.md 링크를 추가
- 요약: PASS/FAIL 수, FAIL 원인 추정(앱 버그 / 시나리오 오류 / 환경 문제 구분), 다음에 할 것
- 마지막에 qa_finish 로 기기 에이전트 정리`),
  );

  server.registerPrompt(
    "explore_qa",
    {
      title: "탐색형 QA",
      description: "시나리오 없이 화면을 돌아다니며 이상한 곳을 찾는다(데이터는 바꾸지 않음).",
      argsSchema: {
        area: z.string().describe("탐색할 범위 — 예: 마이 탭 전체, 일정 편집기"),
        focus: z.string().optional().describe("중점 — 예: 깨진 텍스트, 빈 화면, 에러, 레이아웃, 번역"),
        logFile: z.string().optional(),
      },
    },
    ({ area, focus, logFile }) =>
      user(`탐색형 QA 를 해 줘. 범위: ${area}${focus ? `, 중점: ${focus}` : ""}
**데이터를 바꾸는 동작(저장·삭제·전송·결제·토글 변경)은 하지 마.** 들어갔다 나오기만.

시작 전 무엇을 볼지 나에게 알리고 확인받기. qa_doctor → qa_connect(${logFile ? `logFile: "${logFile}"` : "Flutter 면 logFile"}) → qa_run_start(name: "explore-…") → qa_dismiss_system. 발견 사항마다 qa_step(result: fail)로 기록하면 증거가 저장된다.
화면마다:
- qa_read_screen 으로 텍스트 확인: 키가 그대로 노출(예: home_title), 잘린 문구, 빈 값, "null"/"undefined", 날짜·시간 이상(예: 시간대 어긋남), 숫자 형식
- 들어갈 수 있는 항목(메뉴·탭·카드)을 목록으로 만들고 차례로 들어갔다 뒤로
- 레이아웃 의심이 있을 때만 qa_screenshot
- 화면 전환 후 qa_errors 로 런타임 에러 확인(에러가 늘었는지)
발견 사항은 표로: 화면 · 무엇이 이상한가 · 근거(텍스트/스크린샷) · 심각도(P0~P2) · 재현 단계.
끝나면 qa_run_end → qa_finish.`),
  );

  server.registerPrompt(
    "report_qa",
    {
      title: "QA 결과 보고서",
      description: "실행 결과(qa/runs/*/report.md 와 시나리오 파일의 실행 결과 표)를 모아 보고서를 만든다.",
      argsSchema: {
        scenarios: z.string().describe("시나리오 파일·폴더 또는 실행 기록 폴더(qa/runs)"),
        audience: z.string().optional().describe("누구에게 — 개발팀 / 기획 / 출시 판단"),
      },
    },
    ({ scenarios, audience }) =>
      user(`QA 결과 보고서를 만들어 줘. 대상 파일: ${scenarios}${audience ? `, 읽는 사람: ${audience}` : ""}
기기는 조작하지 말고 파일만 읽어서(실행 기록이 있으면 report.md·steps.jsonl·evidence/ 를 근거로).
- 맨 위: 결론 한 줄(출시 가능 / 차단 이슈 있음) + PASS/FAIL/미실행 수
- 차단 이슈(P0 FAIL): 재현 단계·근거·추정 원인
- 기타 FAIL, 환경 문제로 못 한 것(구분해서)
- 자동화 한계로 사람이 확인해야 할 항목(아이콘 버튼 좌표 의존, 웹뷰, 실기기 전용)
- 다음 액션`),
  );
}
