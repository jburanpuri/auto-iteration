# Verification record

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
