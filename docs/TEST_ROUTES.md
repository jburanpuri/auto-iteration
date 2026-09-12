# Northstar demo test routes

Production: https://northstar-auto-iteration.vercel.app

| Route | Purpose |
| --- | --- |
| `/` or `/reviews/` | Reviews, the manual workflow button, and concise Discord delivery status |
| `/product/` | Company product page and contact export |
| `/feedback/` | Separate company feedback form |
| `/health` | Hosted API health |
| `/api/tasks` | Slim review/task snapshot, worker heartbeat, and Discord connection |
| `/release.json` | Most recently published approved fix; exists after the first approved release |
| `/api/releases/:taskId/record` | Approved version, model, reasoning, patch/test hashes (demo session required) |
| `/api/releases/:taskId/patch` | Exact code patch (demo session required) |
| `/api/releases/:taskId/tests` | Test output (demo session required) |

The reviews page deliberately omits issue-summary cards; technical context and decisions are in Discord.

The workflow button asks for the demo access code stored locally in `.local/demo-access-code`. It starts a session via POST `/api/session`. Feedback submission (POST `/api/feedback`) also requires this session; the form asks for the code when needed. POST `/api/workflow/start` queues a manual summary and requires that session. There is no public approval endpoint.

Local routes:
- http://127.0.0.1:4348/product/ — product and export
- http://127.0.0.1:4348/feedback/ — feedback form (also the local root)
- http://127.0.0.1:4349/ — reviews and manual workflow
- http://127.0.0.1:4349/engineering/ — optional detailed local engineering view
- http://127.0.0.1:4348/preview/:taskId/ — a tested fix before/after publication
- http://127.0.0.1:4349/api/tasks/:taskId/patch — patch (open local reviews first for its cookie)
- http://127.0.0.1:4349/api/tasks/:taskId/tests — test output
- http://127.0.0.1:4349/api/tasks/:taskId/review — detailed review bundle

## Demo sequence

1. Open `/product/`. The three independent bugs are:
   - General: search `nobody`, wait for zero results, then click **Export contacts**. It errors instead of downloading an empty CSV with headers.
   - UI/UX: select **Trial**. Active contacts incorrectly remain visible.
   - Performance: type **Ada**. Six in-memory contacts take two seconds to filter.
   Use `/feedback/` to report one issue, selecting its category. Each report starts its own investigation automatically.
2. Open `/reviews/`. The 120 authored sample reviews are labeled as samples. Real submissions join the inbox. Click “Summarize & start workflow” and enter the demo code. Individual submissions trigger investigation as soon as the worker picks them up. The manual button summarizes the bulk sample reviews; no 24-hour timer is implemented.
3. Codex groups every unprocessed report once, separates clear promotional spam, then investigates each distinct issue. Reports with different selected categories stay separate. No new workflow repeats reports already processed.
4. Discord receives concise bullets: issue/report count, proposed fix, code evidence, qualitative non-spam confidence, issue confidence, and planned checks. Samples never count as verified users or evidence of authenticity. AI authorship is not detected.
5. General → `core-engineering-team`; UI/UX → `ui-ux-team`; Performance → `performance-team`. Use the proposal's Request changes button to revise the plan, or Reply to discuss. Approval applies only to the latest actionable version and to configured approvers.
6. Approval runs Codex implementation and repository tests, then publishes the static company page to Vercel. No PR is created. The orchestrator performs deployment; the coding subprocess has no deployment credentials.
7. “Fix is live” links to the company page. Inspect the release record, patch, tests, and changed behavior. Publication errors are shown separately from passing tests. If another fix changed the base first, request a revised plan before approving.

## Runtime

Start with `npm run demo:hosted`. This runs **GPT-6 Astra, low reasoning**, including summaries and discussion. `CODEX_MODEL` and `CODEX_REASONING_EFFORT` can override these defaults. Codex SDK is 0.154.0.

Vercel hosts the pages/API and a private Blob inbox. This laptop runs one persistent worker, SQLite state, Codex workspaces, and the Discord connection. Keep it running for investigation, discussion, and release. Hosted feedback and start requests remain stored while it is offline. The page marks a heartbeat older than 90 seconds as offline. This is a single-worker demo, not a distributed production queue.

Automatic publication is enabled by `AUTO_PUBLISH=1` in the hosted startup command. It is restricted to the bundled static product files and regression tests. It does not publish arbitrary backend/server code. Browser verification is separate from the repository test gate; a passed test suite alone does not prove every UI behavior is correct.

## Resetting for another presentation

Use **Reset demo** on Reviews (POST `/api/workflow/reset`, demo session required on Vercel). Wait for the completion message. This restores all three intentional bugs, republishes the baseline, archives the old workflow locally, and deletes only this app bot’s messages from the three configured engineering channels. Other members’ messages and the channels remain. Delivery receipts survive so old requests cannot restart the cleared demo. Reset is blocked while an investigation, discussion, or implementation is running. Archives are under `.local/northstar-company-demo/archives/`.

For the shortest demo: Reset → Product: search `nobody`, then export fails → Feedback report → Discord proposal → Approve → tested fix goes live. A separate manual summary step is only needed for bulk reviews.

Bulk demo runs process up to 20 unprocessed reviews per click, balanced across categories. All 120 remain visible. Repeated runs select the next unprocessed set; reset makes the full inbox available again.
