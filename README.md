# Auto Iteration

Auto Iteration turns customer feedback into tested product improvements, with engineers in control. It groups related reports, assesses relevance and code evidence, and uses the Codex SDK to propose a fix in the right Discord channel. Engineers can discuss the plan, request changes, approve, or decline. Once approved, Codex implements the change and runs tests, and the worker publishes the verified fix to Vercel.

Current hosted demo: **https://northstar-auto-iteration.vercel.app**. Product, Feedback, and Reviews are separate navbar pages. Individual feedback triggers investigation; a manual workflow groups the bulk review inbox, investigates code, and posts concise technical proposals with evidence-based confidence to Discord. Approved fixes are tested and published directly to this Vercel demo by the local worker. No PR is created. See [current test routes and runtime notes](docs/TEST_ROUTES.md).

The public demo requires a private demo access code to submit feedback, start a workflow, or reset. Browsing is public. Real credentials stay in ignored local files and Vercel's encrypted environment; copy `.env.example` and supply your own credentials when cloning. See [public repository security](docs/SECURITY.md).

Run `npm run demo:hosted` on the laptop that holds the Codex login. The worker uses **GPT-6 Astra with low reasoning**. Vercel stores queued submissions while the worker is offline.


Turn customer feedback into an engineering discussion, an approved solution, and a tested code change for review.

**Current demo:** one Northstar feedback page → one submission → Codex investigation → Discord proposal with **Approve** and **Request changes** buttons → tested local fix and preview. No revenue dashboard or unrelated company list.

## Demo it in two minutes

```sh
npm ci
npm run codex:status
npm run demo:live
```

Open `http://127.0.0.1:4318/`. Enter a name, write “Exporting an empty contact list shows an error instead of downloading a CSV,” then **Send feedback**. One submission starts the investigation. The public page only shows Northstar branding and a thank-you message; engineer details stay in Discord and the separate console. The optional **Export your contacts** section reproduces the real empty-export crash and records its error.

In Discord, the bot posts who reported the problem, what Codex found in the code, the proposed fix, and test criteria. Click **Request changes**, enter “Keep the column headers for empty exports,” and submit. Codex prepares a new version. Click **Approve v2** to implement exactly that plan, run tests, and expose the fixed preview. Only configured Discord approvers may approve.

Connect Discord with [the setup guide](docs/DISCORD_DEMO.md). The startup log confirms the connected bot. OpenRouter is optional for engineering conversation; Codex handles investigation and implementation. The server does not invent successful delivery if Discord is disconnected.

For a credential-free rehearsal:

```sh
DISCORD_BOT_TOKEN='' DEMO_EXECUTOR=demo CONVERSATION_PROVIDER=codex npm run demo:live
```

The engineer console explicitly says **Scripted rehearsal**. The public company page contains no agent or workflow explanation. Use `http://127.0.0.1:4319/` as the local engineer fallback to discuss, revise, and approve. These controls trust the laptop operator and live on a separate loopback origin; they are not production authentication. Generated previews are never served from that origin.

Optional **Behind the scenes** samples show two related export reports, a feature request held for product review, and promotional spam retained for inspection. Samples alone never launch an investigation. The demo uses explicit CSV category grouping and simple spam rules, not semantic clustering or AI-authorship detection. In live Codex mode, other feedback also starts an investigation; the scripted rehearsal only implements the CSV fixture and retains other feedback in the backlog.

The demo stores its state and isolated repository in `.local/northstar-company-demo`. For a fresh presentation, set `DEMO_DATA_DIR` to a new directory; existing runs are preserved. Set `FEEDBACK_PORT` and `DEMO_OPERATOR_PORT` if the default ports are occupied.

**Standard local mode creates a patch, test log, review summary, and preview. Hosted mode additionally publishes approved, tested static demo fixes to Vercel. Remote PR publishing is not used.**

Read [the project plan](docs/PROJECT_PLAN.md) for architecture and [the integration guide](docs/INTEGRATIONS.md) for optional services.

## Run the working demo

Requires Node.js **22.20+** and Git. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run demo
```

The demo:

1. Creates a separate, deliberately broken customer repository under `.local/runs/`.
2. Reproduces an empty CSV export crash.
3. Accepts a feedback report and recognizes a duplicate delivery.
4. Produces proposal v1: return an empty string.
5. Records an engineer asking to preserve column headers and produces v2.
6. Rejects stale/unauthorized approval attempts, then records the sample lead's approval of v2.
7. Fixes an isolated checkout, runs three repository tests, and writes a patch and review summary.

The proposal and sample conversation are deterministic fixtures for this one bug. The demo does not establish that the live LLM integrations work. Every run prints the exact artifact paths. `.local/last-demo.md` contains the latest demo transcript. Nothing changes in the original demo checkout or on GitHub.

## Try the workflow yourself

### Submit feedback through an API

The fictional **Demo CRM** product has a local-only feedback route. It reuses the real empty-export bug fixture and does not need a GitHub App, a deployed product, or external API keys.

Terminal 1:

```sh
npm run feedback:api
```

This creates the fixture repository if needed and starts `POST http://127.0.0.1:4318/api/feedback`. It creates a random intake token in `.local/feedback-api-token`; the sender reads it automatically. Investigations run in the background and stop at discussion. Approval still requires the CLI or a configured Slack approver.

Terminal 2:

```sh
npm run feedback:send -- examples/feedback-api.json
npm run feedback:send -- status TASK_ID
```

Edit `examples/feedback-api.json` to write your own report. Give each new report a new `externalId`; reuse the same ID only when retrying the same payload. The scripted provider only supports the CSV-export issue. The API body contains `externalId`, `title`, and `text`; organization, source, and repository routing are assigned by the server.

Then use `comment`, `revise`, and `approve` below. While the API server is running, it processes pending jobs automatically unless `JOB_RUNNER=inngest` is set. It exposes a token-protected task status route but no approval endpoint.

### Use only the CLI

```sh
npm run cli -- init
npm run cli -- submit examples/feedback.json
npm run cli -- run
npm run cli -- list
```

Copy the task ID printed by intake. Replace `TASK_ID` in the following commands:

```sh
npm run cli -- show TASK_ID
npm run cli -- comment TASK_ID "Keep column headers when the export has no rows."
npm run cli -- revise TASK_ID 1
npm run cli -- run
npm run cli -- show TASK_ID
npm run cli -- approve TASK_ID 2
npm run cli -- run
npm run cli -- show TASK_ID
```

`init` refuses to overwrite an existing demo repository. `show` includes the plan and audit history. Local CLI commands treat the machine owner as a trusted engineer/approver; this is not a public authenticated API.

If the worker dies mid-job, run `npm run cli -- recover`. On this single host, recovery checks whether the recorded worker PID is still alive. Interrupted jobs are marked for review, not automatically rerun. Inspect any partial checkout, then use `revise TASK_ID VERSION` and approve the new plan. Use version `0` if the task has no proposal yet.

## Stack

| Concern | Choice | Current implementation |
| --- | --- | --- |
| Backend | Node.js + TypeScript | One application and a company feedback page |
| Feedback intake | Product feedback form, local HTTP API, JSON file, or chat mention | Stable source ID, validation, duplicate delivery handling |
| Engineering discussion | Discord Gateway; optional Slack | Configured team channels, replies per task, human approver IDs |
| Workflow | Persisted jobs + optional Inngest | Transactional job enqueue, atomic claims, restart recovery |
| Proposals and coding | Provider interface + Codex SDK | Real Codex for demo:live; scripted offline demo retained |
| Web specialist | Brave Search API | Explicit public query → source snippets → discussion → revised plan |
| Storage | SQLite | Task state, plan history, approvals, job queue, audit and delivery receipts |
| Conversation | OpenRouter or Codex | Replies and advisory briefs; no approval or execution tools |
| Observability | Local read-only MCP | Task-scoped browser error/timing logs |
| Output | Local Git branch + patch + review summary + preview | Remote draft PR publishing is the next milestone |

Discord records engineers' discussion, answers through OpenRouter or Codex, and supports explicit `revise`, `approve`, and `decline` commands. Discord proposals include versioned approval buttons and a request-changes modal. Slack retains the earlier command-only adapter.

## Verify

```sh
npm run check
npm test
```

Tests cover the actual Git/test workflow, duplicate deliveries, conflicting source IDs, organization boundaries, plan versions, approval permissions and expiry, new discussion, base changes, failed tests, concurrent workers, restart recovery, Slack command parsing, and Brave response/error handling.

Discord/OpenRouter delivery requires credentials and separate live validation. See docs/VERIFICATION.md for the checks actually performed. The SQLite warning on Node 22 is expected because that runtime still labels `node:sqlite` experimental.

## Code map

```text
src/domain.ts          Task, plan, approval, and input contracts
src/store.ts           SQLite transactions, jobs, audit, and receipts
src/engine.ts          Business rules and workflow transitions
src/providers.ts       Scripted fixture and live Codex adapters
src/git.ts             Isolated checkouts, tests, review artifacts
src/cli.ts             Manual workflow commands
src/feedback-api.ts    Authenticated local demo feedback route
src/feedback-server.ts Demo HTTP server and background job processing
src/feedback-send.ts   Manual feedback submission/status client
src/slack.ts           Slack thread/command integration
src/worker.ts          Optional Inngest adapter and outbox dispatcher
src/research.ts        Brave Search adapter
src/demo.ts            Executable end-to-end demonstration
```

## Boundaries of this version

- One business, one trusted repository, one host. SQLite organization filtering is not enterprise tenant isolation.
- The local review bundle is not a remote pull request. No code here merges or deploys changes.
- A Git clone isolates edits, not arbitrary processes. Live tests execute on the host. Use only a repository you trust; isolated containers and restricted credentials are a requirement before customer onboarding.
- Live Codex may send repository context to the configured model provider. A local runner does not by itself guarantee that source code stays inside the customer's infrastructure.
- Fresh clones contain committed files only. Dependency setup for arbitrary real repositories is not implemented; missing dependencies fail visibly and require a configured setup strategy in the next milestone.
- Slack thread edits/deletions, delayed/out-of-order events, attachments, and rich interactive approvals need additional handling before a real team rollout.
