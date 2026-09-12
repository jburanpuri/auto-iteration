# Auto Iteration

Turn customer feedback into an engineering discussion, an approved solution, and a tested code change for review.

**Current milestone:** a working local workflow plus optional Slack, Brave, Inngest, and Codex adapters. The default demo is explicitly scripted. It makes real Git checkouts, edits code, and runs regression tests; it does not call an AI model, send messages, or create a remote PR.

Read [the project plan](docs/PROJECT_PLAN.md) for product scope, architecture, build order, and implementation risks. Read [the integration guide](docs/INTEGRATIONS.md) when connecting services.

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
| Backend | Node.js + TypeScript | One application, no web dashboard |
| Feedback intake | JSON file or Slack mention | Stable source ID, validation, duplicate delivery handling |
| Engineering discussion | Slack Bolt + Socket Mode | One configured channel, one thread per task; CLI alternative |
| Workflow | Persisted jobs + optional Inngest | Transactional job enqueue, atomic claims, restart recovery |
| Proposals and coding | Provider interface + Codex SDK | Scripted fixture by default; optional live Codex adapter |
| Web specialist | Brave Search API | Explicit public query → source snippets → discussion → revised plan |
| Storage | SQLite | Task state, plan history, approvals, job queue, audit and delivery receipts |
| Output | Local Git branch + patch + review summary | Remote draft PR publishing is the next milestone |

The conversational interface currently records engineers' discussion and supports explicit `revise`, `approve`, and `decline` commands. Open-ended conversational AI answers and approval buttons are planned; they are not implemented yet.

## Verify

```sh
npm run check
npm test
```

Tests cover the actual Git/test workflow, duplicate deliveries, conflicting source IDs, organization boundaries, plan versions, approval permissions and expiry, new discussion, base changes, failed tests, concurrent workers, restart recovery, Slack command parsing, and Brave response/error handling.

External account integrations require credentials and separate live validation. The SQLite warning on Node 22 is expected because that runtime still labels `node:sqlite` experimental.

## Code map

```text
src/domain.ts          Task, plan, approval, and input contracts
src/store.ts           SQLite transactions, jobs, audit, and receipts
src/engine.ts          Business rules and workflow transitions
src/providers.ts       Scripted fixture and live Codex adapters
src/git.ts             Isolated checkouts, tests, review artifacts
src/cli.ts             Manual workflow commands
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
