/**
 * Built-in guidance for planning, running, exploring, and reporting mobile QA.
 * SERVER_INSTRUCTIONS is delivered when the agent connects.
 * Workflow prompts appear as slash commands; guides/ files are exposed as resources.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_LANGUAGES, type ReportLanguage } from "./report-language.js";

const GUIDES = join(dirname(fileURLToPath(import.meta.url)), "..", "guides");
const guide = (f: string) => readFileSync(join(GUIDES, f), "utf8");
const LANGUAGE_INSTRUCTIONS = "Write user-facing explanations, scenarios, and reports in the user's requested language, or the conversation language if unspecified. Preserve exact UI labels, input hints, expected text, test data, IDs, paths, tool names, and argument values in their original language; never translate selectors to match these English instructions.";
const reportLanguageInstruction = (language?: ReportLanguage) => language
  ? `Use reportLanguage: "${language}" in qa_run_start and write scenario result summaries, step descriptions, and the final report in that language. Preserve quoted UI text.`
  : "For qa_run_start, pass reportLanguage matching the user's requested language or conversation language when it is en, ko, or ja. Otherwise omit it to use the project reportLanguage setting (default en). Preserve quoted UI text.";
const RECOVERY_INSTRUCTIONS = `Failure recovery (at most one corrective retry per failed step):
- STALE_REF: read the screen again, identify the intended target, and use a fresh ref or stable id. A stale ref never proves absence; check absence with id or exact text.
- Ambiguous/invalid selector: inspect candidates and choose a verified id/ref/index. Do not guess the first candidate. Enabled/disabled checks need a unique target.
- WAIT_TIMEOUT: the preceding action may already have completed. Read the current screen and check its expected result before repeating any action. Prefer a specific waitFor condition over general stability on animated screens.
- INPUT_VALUE_MISMATCH / INPUT_TARGET_UNRESOLVED / INPUT_VALUE_UNAVAILABLE: inspect the original field and its current value. Text elsewhere is not proof of input. Do not blindly retype; native keyboard input may append. If no readable value exists, record the verification limitation and ask for human verification.
- Connection/tool error: run qa_doctor once. Continue only after required capabilities recover; otherwise record the environment failure and skip dependent steps.
- Before retrying Save, Send, Create, Delete, or payment actions, verify whether the effect already occurred. If the outcome is uncertain, stop and report it instead of replaying the action. Existing authorization still limits every retry.
- Keep the original failure and recovery outcome in the run record. If the corrective retry fails, stop that path, skip dependent steps, and perform only authorized cleanup. Never retry indefinitely.`;

export const SERVER_INSTRUCTIONS = `Mobile app QA server for owned and third-party apps: Flutter, native iOS/Android, and React Native. Flutter apps gain text input and widget capabilities through Dart. Principles:
0) Prepare: run qa_doctor first (provide logFile for a Flutter build with Dart access). Use the capabilities actually reported: native and third-party apps can use device-only tools without Dart. Do not request source-dependent setup for a third-party app. If tools fail unexpectedly, diagnose the environment before calling it an app bug. Use qa_apps if the app ID is unknown.
1) Loop: read with qa_read_screen → decide → act with qa_tap/qa_type → verify. Do not rely on memorized coordinates; one-time guides and popups can change the flow.
2) Select: prefer ref (e.g. r12 from the latest screen), then id (accessibility identifier), then text. Resolve ambiguous matches using ref/index. Use qa_tap_xy only for unlabeled icons.
3) Wait: use conditions instead of fixed delays: qa_tap(waitFor: {text, state}), qa_expect(timeoutMs), or qa_wait_until (e.g. until loading disappears).
4) Record: qa_run_start → qa_step(title, expected, result, actual) for each step → qa_run_end. Failure evidence (screenshots, elements, errors) is saved automatically; return paths in the conversation.
5) Prefer text: use qa_screenshot for layout/color checks or coordinate targeting.
6) Safety: clean up created data. Use allowDanger for dangerous actions (deletion, payment, logout, etc.; extend via qa/qa.config.json) only after user approval. Hand passwords, verification codes, biometrics, and personal account selection to a person. Take particular care with third-party app actions that affect real services, such as payments, posting, or sending messages.
7) Explain the intended actions and obtain confirmation before device interaction. Finish with qa_finish.
8) Language: ${LANGUAGE_INSTRUCTIONS}
${reportLanguageInstruction()}
${RECOVERY_INSTRUCTIONS}
Workflow prompts: plan_qa (scenarios), run_qa (execution), explore_qa (exploration), report_qa (reporting). Format: resource qa://guides/scenario-format`;

export function registerGuidance(server: McpServer) {
  server.registerResource(
    "scenario-format",
    "qa://guides/scenario-format",
    { title: "QA Scenario Format", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide("SCENARIO_FORMAT.md") }] }),
  );
  server.registerResource(
    "scenario-example",
    "qa://guides/example-schedule-create",
    { title: "Example Scenario: Create a Schedule", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide("example-schedule-create.md") }] }),
  );

  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `${LANGUAGE_INSTRUCTIONS}\n\n${text}` } }] });

  server.registerPrompt(
    "plan_qa",
    {
      title: "Plan QA Scenarios",
      description: "Create QA scenarios from a feature description, screen, PR, or issue. Use source files without device interaction when available; black-box inspection requires confirmation.",
      argsSchema: {
        feature: z.string().describe("What to test: feature, screen, or change"),
        depth: z.string().optional().describe("smoke (happy paths only) | standard (default) | deep (also boundaries, permissions, and regression)"),
        source: z.string().optional().describe("Reference code path, PR, issue, or product document, if available. Without source access, use black-box screen inspection"),
      },
    },
    ({ feature, depth, source }) =>
      user(`Write QA scenarios. **Produce documents only; do not execute the scenarios.** Device inspection for black-box planning requires separate confirmation as described below.

Target: ${feature}
Depth: ${depth ?? "standard"}${source ? `\nReference: ${source}` : ""}

Procedure:
1. Understand the feature using the available approach:
   - **With source access (white box)**: read ${source ? "the reference material and " : ""}related code (screens, state management, APIs). Summarize what users do with the feature in 3–5 lines. Find actual button labels and input hints in the app's string/localization resources.
   - **Without source access (black box, such as a third-party app)**: obtain my confirmation before interacting with the device. Browse relevant screens using qa_read_screen and qa_tap, including navigating back, without changing data. Collect the actual labels and flow. Do not press Save, Send, or payment buttons.
2. Identify risks: data changes, effects on other users (notifications/sharing), permissions, external integrations, and past bugs from issue documents.
3. Choose scenario categories from the format below according to depth:
   - smoke: 1–2 happy paths
   - standard: also validation/boundaries, state propagation, and undo
   - deep: also permissions/external flows and regression
4. Write each scenario in the specified format. Describe actions using visible UI terms, give every step an expected result that qa_expect can evaluate, and include cleanup for created data.
5. Save to qa/scenarios/<feature>-<number>.md in the app repository, or qa/scenarios/ in the current working directory for a third-party app without a repository. Create the directory if needed. Present a table of ID, title, priority, data changes, and dangerous actions, and request human review before execution.

Format:
${guide("SCENARIO_FORMAT.md")}

Example:
${guide("example-schedule-create.md")}`),
  );

  server.registerPrompt(
    "run_qa",
    {
      title: "Run QA Scenarios",
      description: "Execute scenario files step by step on a device and record the results in files.",
      argsSchema: {
        scenario: z.string().describe("Scenario file path, comma-separated paths, or a directory"),
        logFile: z.string().optional().describe("Path to the flutter run --print-dtd log, needed for Flutter text input"),
        allowDanger: z.string().optional().describe("Set to yes to allow dangerous steps explicitly listed in the scenario"),
        reportLanguage: z.enum(REPORT_LANGUAGES).optional().describe("Report language: en, ko, or ja. Otherwise use the user's language when supported, then project configuration"),
      },
    },
    ({ scenario, logFile, allowDanger, reportLanguage }) =>
      user(`Run QA scenarios: ${scenario}
${reportLanguageInstruction(reportLanguage)}

Before starting:
- Read the scenarios, **summarize the intended actions including data changes and dangerous steps, and obtain my confirmation**.
- Diagnose with qa_doctor(${logFile ? `logFile: "${logFile}"` : "request logFile only for an owned Flutter build that needs Dart; omit for native/third-party apps"}). Check capabilities needed by this scenario. A missing Dart connection alone does not block device-only scenarios; explain missing required capabilities and stop if they cannot be recovered.
- qa_connect with the same logFile → qa_run_start(name: scenario ID, scenario: file path) → qa_dismiss_system.
- Verify preconditions with qa_read_screen. Stop and tell me if they do not match.

For each step:
1. Read the current screen with qa_read_screen, using filter for the relevant area.
2. Act with qa_tap / qa_type / qa_swipe. Prefer ref/id and resolve ambiguous matches. Use waitFor for an expected screen transition. For unlabeled icons, inspect qa_screenshot before qa_tap_xy.
3. Evaluate the expected result with qa_expect (use timeoutMs for slow screens), then record it with qa_step(title, expected, result, actual).
4. On FAIL, evidence is saved automatically. Decide whether later steps can proceed; otherwise skip to cleanup. Run qa_doctor if a tool error appears environment-related.
- For unexpected guides, popups, or permission dialogs, use qa_dismiss_system, read the screen, and follow the bounded recovery rules below before retrying the step.
- Dangerous steps: ${allowDanger === "yes" ? "use allowDanger only for steps explicitly listed in the scenario." : "obtain my confirmation before using allowDanger."}
- Stop and hand control to me for passwords, Face ID, or account selection.

${RECOVERY_INSTRUCTIONS}

At the end:
- Run authorized cleanup (such as deleting created data), then verify absence with qa_expect(id: stable ID, state: "absent") or an exact text selector; do not reuse a ref from before deletion.
- qa_run_end(summary) returns the report.md path. Append a dated/device-labeled run results section in my language, a summary table, and the report.md link to the scenario file.
- Summarize PASS/FAIL counts, likely failure causes (app bug / scenario error / environment problem), and next actions.
- Finally, call qa_finish to stop the device agent.`),
  );

  server.registerPrompt(
    "explore_qa",
    {
      title: "Exploratory QA",
      description: "Browse screens without a predefined scenario to find issues, without changing data.",
      argsSchema: {
        area: z.string().describe("Scope to explore, e.g. the entire My tab or schedule editor"),
        focus: z.string().optional().describe("Focus, e.g. broken text, blank screens, errors, layout, or translations"),
        logFile: z.string().optional(),
        reportLanguage: z.enum(REPORT_LANGUAGES).optional().describe("Report language: en, ko, or ja; otherwise follow the user's language when supported"),
      },
    },
    ({ area, focus, logFile, reportLanguage }) =>
      user(`Perform exploratory QA. Scope: ${area}${focus ? `; focus: ${focus}` : ""}.
${reportLanguageInstruction(reportLanguage)}
**Do not change data: no saving, deleting, sending, payments, or toggle changes.** Navigate in and back only.

Explain what you will inspect and obtain my confirmation first. qa_doctor → qa_connect(${logFile ? `logFile: "${logFile}"` : "logFile only when Dart access is available and needed; omit for native/third-party apps"}) → qa_run_start(name: "explore-…", reportLanguage as above) → qa_dismiss_system. Use the capabilities reported by qa_doctor. Record each issue with qa_step(result: "fail") to capture evidence.
${RECOVERY_INSTRUCTIONS}
For each screen:
- Read text with qa_read_screen: exposed localization keys (e.g. home_title), truncated strings, empty values, "null"/"undefined", date/time anomalies (such as time-zone offsets), and number formatting.
- List navigable menus, tabs, and cards; visit them in turn and return.
- Use qa_screenshot only when a layout issue is suspected.
- After transitions, use qa_errors to check whether new runtime errors appeared.
Report findings in a table: screen, issue, evidence (text/screenshot), severity (P0–P2), reproduction steps.
Finish with qa_run_end → qa_finish.`),
  );

  server.registerPrompt(
    "report_qa",
    {
      title: "QA Results Report",
      description: "Combine run reports (qa/runs/*/report.md) and scenario result tables into a QA report.",
      argsSchema: {
        scenarios: z.string().describe("Scenario files/directory or run recording directory (qa/runs)"),
        audience: z.string().optional().describe("Intended audience, e.g. engineering, product, or release decision-makers"),
        reportLanguage: z.enum(REPORT_LANGUAGES).optional().describe("Language for the final report: en, ko, or ja; otherwise follow the user's requested or conversation language"),
      },
    },
    ({ scenarios, audience, reportLanguage }) =>
      user(`Create a QA results report. Input files: ${scenarios}${audience ? `; audience: ${audience}` : ""}.
${reportLanguage ? `Write the final report in ${reportLanguage}; preserve quoted UI strings and evidence.` : "Use the user's requested language or the conversation language for the final report."}
Read files only; do not interact with a device. Use report.md, steps.jsonl, and evidence/ when available.
- Start with a one-line release conclusion (ready / blocking issues) and PASS/FAIL/not-run counts.
- For blockers (P0 FAIL), include reproduction steps, evidence, and likely causes.
- Separate other failures from tests blocked by environment problems.
- List checks requiring a person due to automation limitations (coordinate-dependent icons, WebViews, physical-device-only behavior).
- End with next actions.`),
  );
}
