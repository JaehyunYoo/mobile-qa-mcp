# SCH-001 Create a Schedule: Happy Path

> Example for a fictional scheduling app. Screens and labels vary by app. Korean UI labels and test values are intentionally preserved; write scenario prose in the user's requested language.

- Purpose: Verify that a schedule created from Home appears on its home card with the exact title and time entered
- Priority: P0
- Preconditions: Logged in; no schedules for today
- Data changes: Yes — create one schedule, then delete it during cleanup
- Dangerous actions: Yes — cleanup step 1 (deletion) requires allowDanger

## Steps

| # | Action | Expected result |
|---|---|---|
| 1 | Launch the app and dismiss blocking permission dialogs/home popups | Home screen with the "홈" bottom tab selected |
| 2 | Tap "일정을 공유해보세요" in the schedule area | Schedule creation screen; "일정을 생성할게요" is disabled |
| 3 | Record the start and end times shown in the editor | Reference values for later comparison, e.g. 오후 12:00 ~ 오후 1:00 |
| 4 | Enter "QA 테스트 {날짜}" in the title field, replacing {날짜} with the test date | Field shows that exact value; "일정을 생성할게요" is enabled |
| 5 | Tap "일정을 생성할게요" | Returns to Home |
| 6 | Inspect the home schedule card | Shows the test title and the exact times recorded in step 3 |
| 7 | Tap that card | Schedule details show the same title and times |

## Cleanup

1. Delete from Details (trash icon) → confirm → verify that the test title is absent from Home (`allowDanger`).

## Notes

- Regression check: a time-zone conversion mismatch between the server and app changes the displayed time in step 6. This approach has caught such a bug in practice.
