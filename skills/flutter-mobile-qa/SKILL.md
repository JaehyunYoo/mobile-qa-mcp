---
name: flutter-mobile-qa
description: Perform mobile app QA on physical devices and simulators, including scenario planning, execution, exploration, and reporting. Supports owned and third-party apps; optimized for Flutter, with native iOS, Android, and React Native support. Requires a connected flutter-mobile-qa MCP server with qa_* tools.
---

# Mobile App QA (optimized for Flutter)

Use the flutter-mobile-qa MCP tools (`qa_*`). Classify the request and follow the corresponding workflow.

| Request | Workflow | MCP prompt |
|---|---|---|
| "Write test scenarios", "What should I test?" | Plan | `plan_qa` |
| "Run this scenario", "QA this feature" with existing scenarios | Run | `run_qa` |
| "Explore the screens and find issues" | Explore | `explore_qa` |
| "Summarize the results", "Is this ready to release?" | Report | `report_qa` |

Recognize equivalent requests in the user's language, including Korean requests such as "QA 해줘" and "시나리오 짜줘". If no scenarios exist, **plan** first, show them to the user, and **run** after review.

## Language

- These instructions are maintained in English. Write user-facing explanations, scenarios, and reports in the user's requested language, or the conversation language when unspecified.
- Preserve exact UI labels, input hints, expected text, and test data in the app's language. Never translate a selector or expected value just because the instructions are in English.
- Keep tool names, argument names, IDs, paths, and enum values unchanged.
- Pass `reportLanguage: "en" | "ko" | "ja"` to `qa_run_start` (or `run_qa`/`explore_qa`) to match the requested or conversation language when supported. Otherwise omit it to use the project setting, which defaults to `en`. This localizes report headings; write step descriptions and summaries in that language yourself. Raw UI values and evidence are preserved.

## Shared principles

0. **Start with `qa_doctor`** to distinguish environment problems from app bugs. Use `qa_apps` if the app ID is unknown. Without source access, use the black-box inspection path in `plan_qa`.
1. **Confirm before interacting with a device.** Summarize intended actions, data changes, and dangerous steps (deletion, payment, logout).
2. **Read → decide → act → verify.** Use the current `qa_read_screen` result, preferably `ref` or `id`, instead of memorized coordinates. Use `waitFor`/`timeoutMs` rather than fixed waits. Record runs with `qa_run_start` → `qa_step` → `qa_run_end`.
3. **Prefer text.** Read with `qa_read_screen` and `filter`; use images for layout/color checks, coordinate targeting, and failure evidence.
4. **Clean up created data.** Use recognizable input such as "QA 테스트 {날짜}" when testing a Korean app.
5. **Hand off to a person** for passwords, verification codes, Face ID, personal account selection, and payment confirmation.
6. **Finish with `qa_finish`** to stop the device agent and clear iOS's 'Automation Running' indicator.
7. **Classify failures** as app bugs, scenario errors (such as changed screens), or environment problems (connections, permissions, missing data).

## Failure recovery

Allow **at most one corrective retry per failed step**. Keep the original failure and the recovery result in the run record.

| Failure | Recovery |
|---|---|
| `STALE_REF` | Read the screen again and identify the intended target with a fresh ref or stable id. For absence after deletion/navigation, use id or exact text; an old ref cannot prove absence. |
| Ambiguous or invalid selector | Inspect candidates and select a verified id/ref/index. Never guess the first match. Enabled/disabled assertions require a unique target. |
| `WAIT_TIMEOUT` | The action may have completed. Inspect the current screen and verify the expected result first. On animated screens, prefer a specific `waitFor` condition. |
| Input verification failure | Inspect the original field's value. Text elsewhere is not proof. Do not blindly retype: native input may append. If the field hides or does not expose its value, record the limitation and request human verification. |
| Connection/tool error | Run `qa_doctor` once. Resume only after required capabilities recover; otherwise record the environment failure and skip dependent steps. |

Before retrying Save, Send, Create, Delete, or payment actions, check whether the effect already occurred. If the outcome is uncertain, stop and report it. Every retry stays within the user's existing authorization. After a failed corrective retry, stop that path, skip dependent steps, and perform only authorized cleanup.

## Scenario format and storage

- Format: MCP resource `qa://guides/scenario-format` (repository file `guides/SCENARIO_FORMAT.md`).
- Example: `qa://guides/example-schedule-create`.
- Save scenarios in the app repository at `qa/scenarios/<feature>-<number>.md`; append a results table to the same file. For third-party apps without an app repository, use `qa/scenarios/` in the current working directory.

## When setup is incomplete

- Use the capabilities actually reported by `qa_doctor`. Missing Dart does not block device-only scenarios.
- For an owned Flutter build requiring Dart input/widget tools, ask the user to launch with `flutter run -t <driver-entry> --print-dtd > <log-file>` and pass the log to `qa_connect`.
- Native and third-party apps use device-only tools. Do not request a driver entry point for an app without source access. If an essential capability is unavailable, record the limitation and skip or hand off that step.
- Missing device or automation-agent errors: refer to README section 7 (Troubleshooting).
