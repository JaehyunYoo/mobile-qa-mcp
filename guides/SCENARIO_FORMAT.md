# QA Scenario Format

Scenarios are **Markdown documents that people can read and edit**. The agent drafts them with `plan_qa`; a person reviews them before execution with `run_qa`.
Recommended location: `qa/scenarios/<feature>-<number>.md` in the app repository.

Write scenario prose and result summaries in the user's requested language, or the conversation language when unspecified. Keep exact UI strings, input values, IDs, and paths unchanged. The Korean strings below are example app labels, not instructions to translate them.

## Structure

```markdown
# <ID> <Title>

- Purpose: What this scenario verifies, in one sentence
- Priority: P0 (release blocker) / P1 (major) / P2 (minor)
- Preconditions: Login/account state (such as a linked partner) and required data
- Data changes: None / Yes (what is created and how to undo it afterward)
- Dangerous actions: None / Yes (step numbers requiring allowDanger)

## Steps
| # | Action | Expected result |
|---|---|---|
| 1 | On Home, tap "일정을 공유해보세요" | Schedule creation screen; "일정을 생성할게요" is disabled |
| 2 | Enter "QA 테스트" in the title field | "일정을 생성할게요" is enabled |
| … | … | … |

## Cleanup
- Steps to undo changes, such as deleting created data

## Notes
- Design/product references, known issue IDs, etc.
```

## Writing principles

1. **Describe actions using what a person sees on screen.** Use "title field", "Save button", or "My bottom tab" in the app's actual language. Avoid coordinates and widget names, which break when screens change.
2. **Give every step an expected result.** Prefer conditions that `qa_expect` can evaluate: text is visible, a button is disabled, or a field shows the exact string "오후 12:00".
3. **Use recognizable input**, such as "QA 테스트 20260928", so test data can be found and removed later.
4. **Include cleanup when creating data.** Deleting created data is a dangerous action; declare it in the scenario metadata.
5. **One scenario, one purpose.** Aim for roughly ten steps; split longer flows.
6. **Separate boundary cases** such as empty input, maximum length, future/past dates, denied permissions, and network loss.
7. **Make verification explicit.** Check the value of the target input field, not matching text elsewhere. For absence after deletion or navigation, use a stable ID or exact UI text; an old screen ref cannot prove absence. Distinguish an app failure from an unavailable/hidden value that needs human verification.
8. **Record bounded recovery.** Allow at most one corrective retry per failed step. Keep the initial failure and recovery outcome. Before repeating an action that changes data, verify whether its effect already occurred; stop if the outcome is uncertain.

## Scenario categories for plan_qa

| Category | What to verify | Example |
|---|---|---|
| Happy path | The common flow works end to end | Create a schedule → it appears on Home |
| Validation and boundaries | Invalid input is rejected; limits behave correctly | Save is disabled for an empty title; input longer than 18 characters |
| State propagation | A change appears consistently across screens | The schedule has the same values on Calendar and Details |
| Undo and cancellation | Cancel/back leaves data unchanged | Close the editor without saving; exit confirmation dialog |
| Permissions and external flows | Permission denial, notifications, deep links, returning to the app | Reminder toggle explains what to do after notification permission is denied |
| Regression | A previously fixed bug does not recur | Saved times stay identical across screens (time-zone conversion regression) |

## Run results appended by run_qa

Set `reportLanguage` (`en`, `ko`, or `ja`) when starting the run to match the user's language. This selects the generated report headings; write scenario results and step descriptions in that language while preserving UI quotes and evidence.

```markdown
## Run results — 2026-09-28 11:20, iPhone 14 Plus (iOS 26.6.1)
| # | Result | Evidence |
|---|---|---|
| 1 | PASS | Creation screen; "일정을 생성할게요" is disabled |
| 2 | FAIL | Button is still disabled after entering a title; screenshot attached |
```
