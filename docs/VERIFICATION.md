# Verification record

## Public-repository access hardening — September 12, 2026

- All 41 integration tests pass. Hosted security tests cover feedback/start/reset authentication, forged sessions, wrong origin, key rotation, and fail-closed behavior without configuration.
- Verified on the live deployment: anonymous feedback, workflow start, and reset return 401; the previous session is rejected; the rotated private code authenticates; invalid authorized input reaches validation without creating feedback.
- Secret scan found no matches among 190 reachable historical file objects and no tracked secret paths. Local credentials remain ignored and have owner-only file permissions.
- The demo code was rotated in Vercel; its value is never embedded in browser assets. See SECURITY.md for operation and publishing guidance.

## Current hosted workflow — September 12, 2026

- Real Codex SDK investigation, one engineer-requested revision, v2 approval, implementation, six passing product regression tests, and actual Vercel publication completed for task `e30174d7-2f46-46b0-8abc-281ea2fe361a`.
- Model: `gpt-6-astra`, reasoning `low`. Implementation thread: `01a0971e-6ff5-7db3-9798-2af41174b39f`.
- Verified an actual downloaded `contacts.csv` containing `name,email` after the empty-export fix, and the bot's real “Fix is live” Discord message `1548417373281714279`.
- Revision and approval used authenticated local engineer controls because native Discord UI automation was unavailable. Actual Discord delivery was verified through Discord REST; this does not claim a live Discord button click test. Discord interaction handlers are covered by integration tests.
- `npm run check` passes; all 39 application integration tests pass, including reset archiving, delivery receipts, tenant scoping, and publication checks. Tests require permission to listen on localhost.
- Public feedback queues automatically for investigation. Bulk reviews start manually. The laptop worker must remain running for Codex, Discord, and publishing.
- Vercel alias propagation initially delayed release verification; bounded retries and hash-checked reconciliation handle that without repeating implementation.

- Reset `edeb97de-134e-4e6b-ab7d-347969264a67` published successfully. It archived the prior workflow, removed 13 messages belonging to this bot, and restored a clean inbox with 120 authored reviews and zero active tasks. Discord REST confirmed all three demo channels were empty afterward.
- Live browser verification reproduced the three independent baseline bugs: status selection leaves Active contacts in Trial results; search still showed all six contacts after 100 ms and updated after the two-second timer; exporting zero results showed the intended error. There were no uncaught browser errors. Raw CSV is no longer printed in the UI.
- Product / Feedback / Reviews navigation and Reviews start/reset buttons verified live. No new workflow was started after reset, leaving the demo ready to present.
- Non-spam confidence now uses content relevance assessment for both authored and submitted reports; no hardcoded sample-confidence override. Provenance remains recorded separately, and no real-user identity or AI-authorship claim is made.

## Earlier local verification (historical)


Validated locally on 2026-09-12 using Node.js 22.20.0.

| Check | Result |
| --- | --- |
| `npm run check` | Pass |
| `npm test` | 26 passed; 0 failed, including HTTP intake, Discord routing, complaint escalation, MCP, and OpenRouter contract tests |
| `npm run demo` | Pass; real isolated Git edit and three passing repository tests |
| CLI init → submit → run → list | Pass; persistent task reaches discussion |
| Feedback API | HTTP acceptance, auth, schema/body limits, duplicate/conflicting IDs, and status retrieval pass |
| Inngest adapter startup | Pass; local HTTP server starts |
| `GET /health` | 200 with `status: ok` |
| `GET /api/inngest` | 200; one registered function in development mode |
| Slack startup without credentials | Expected clear error requesting `SLACK_BOT_TOKEN` |
| npm install audit | 0 reported vulnerabilities at installation |
| Discord controller | Investigation alerts, team routing, channel/author checks, reply routing, versioned approval, and duplicate events pass with a fake transport |
| Complaint threshold | Three reports trigger one task; retry delivery does not inflate counts; organization/repository/window filtering passes |
| Local logs MCP | Actual stdio client connects, lists the one read-only tool, and retrieves filtered evidence |
| OpenRouter conversation | Request/response validation, separate model selection, advisory brief storage, no model approval, and handoff ordering pass with stubbed HTTP |
| Product browser | Desktop/mobile layout renders; empty-export failure and telemetry captured; no uncaught page errors |
| Live Codex investigation | Real authenticated call returns code-grounded proposal citing the captured error; engineer comment changes the next proposal |
| Live Codex implementation | Fresh v3 approval produces the scoped one-line fix and regression tests; all five product tests pass and original checkout stays clean |
| Live fixed browser preview | Archived → Export CSV downloads a real file containing exactly `name,email,company,status,revenue`; no uncaught page errors |

Not validated against external accounts: Discord/Slack event delivery, OpenRouter model responses, Inngest event execution, and Brave live searches. Discord and OpenRouter credentials were not configured. The offline `npm run demo` uses deterministic fixtures; the new `demo:live` verification used real Codex calls and a local operator simulating engineer comments/approval. No remote GitHub PR was created and no deployment was performed.

Live verification task: `378aa3ad-a7b4-4ebf-b139-968a7cf10fe7` under `.local/discord-demo/` (a separate verification dataset; normal new runs use `.local/auto-iteration-demo/`). The first implementation run correctly retained a failure when the executor reported missing browser tooling. The completion contract was clarified: repository tests precede host-served browser verification; no browser check is claimed by the coding worker.

The Inngest HTTP smoke test establishes that the adapter loads and advertises its function; it does not establish successful workflow execution through an Inngest server. The local test worker was stopped after verification.

## Northstar company feedback demo — 2026-09-12

- Simplified the public site to Northstar company branding, name + feedback, a thank-you response, and an optional contact-export control. Workflow steps, model labels, task progress, and approvals are absent from the public UI.
- Added a separate loopback engineer console. Browser verification exercised feedback → proposal → engineer comment → revised plan v2 → explicit approval → tests → fixed preview. The verified empty CSV contains `name,email`.
- Desktop and 390px mobile pages were visually inspected. No horizontal overflow or browser errors were observed.
- `npm run check` passed. All 29 tests passed, including separate-origin approval protection, duplicate submissions, retained spam/sample feedback, stale-plan rejection, and Discord request-changes handoff.
- A real Codex SDK investigation authenticated with the configured ChatGPT login, inspected the fresh Northstar fixture, reproduced the `Object.keys(rows[0])` error, and returned a structured plan with test criteria. It stopped at discussion and did not implement or publish.
- The live Discord runtime successfully connected as the configured bot. Discord message formatting and versioned button/controller behavior were tested with a transport fixture; an actual button click in Discord and the OpenRouter live API were not exercised in this verification run.
- The full implementation/preview browser rehearsal used the explicitly labeled scripted provider. Remote PR publication remains unimplemented.

## Feedback categories and Discord summaries

Type checking and all 35 tests passed. Tests cover HTTP category validation/persistence, all three routing destinations even when the model suggests another team, separation of otherwise identical reports across categories, one message per proposal across repeated syncs/restarts, no approval controls for clarification/non-code results, and bounded message formatting. The configured channel names were verified through read-only Discord API requests: ui-ux-team, performance-team, and core-engineering-team.

Prepared sample batch verification: all 36 tests pass. The six samples remain unsubmitted until Start workflow. Repeating the same batch request preserves the same three task IDs, each containing two reports. Browser checks confirmed a blank public name, three category choices, hidden demo controls on the public page, six visible samples in the separate console, and no browser errors. These verification requests did not send new sample messages to Discord.
