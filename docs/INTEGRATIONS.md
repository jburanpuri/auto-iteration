# Connecting the MVP

For the current Discord + OpenRouter + Codex product demo, start with [DISCORD_DEMO.md](DISCORD_DEMO.md).

The keyless local demo works without these steps. Adapters are implemented and typechecked; their live account connections have not been validated in this workspace.

## Configuration

Copy `.env.example` to `.env` and fill the relevant values locally. Do not commit tokens. The `.local/` directory contains task data, customer checkouts, patches, and test output and is also excluded from Git.

Keep `EXECUTOR=demo` while verifying messaging. Run `npm run cli -- init` once to create its fixture repository. A separate process uses the same `DATA_DIR` and `ORGANIZATION_ID` to see the same tasks.

## Slack

1. Create a Slack app using `slack-manifest.json` in the Slack developer dashboard.
2. Install it in the test workspace and obtain its bot token (`xoxb-…`).
3. Generate an app-level token (`xapp-…`) with `connections:write` for Socket Mode.
4. Invite the bot to the engineering channel.
5. Set `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID`, and comma-separated `SLACK_APPROVER_IDS`.
6. Run `npm run slack`.

The manifest requests channel/private-channel history and app mentions so the bot can record discussion. The runtime accepts only the configured team and channel. Remove the private-channel scope/event if your pilot uses only a public channel.

Start a top-level message:

```text
@Auto Iteration feedback CSV export crashes when the customer list is empty.
```

The bot uses that message as the task thread. In the thread, discuss the proposal as normal, then send:

```text
@Auto Iteration revise 1
@Auto Iteration status
@Auto Iteration approve 2
```

Only configured approvers can run `approve`. Revisions and discussion are accepted from engineers in the configured channel. A plain sentence such as “looks good” does not approve anything. Use explicit commands in this version; buttons and free-form AI Q&A are not implemented.

The adapter processes jobs locally unless `JOB_RUNNER=inngest`. It posts state changes to the same thread. Local artifact paths are useful only on the worker's machine; file uploads or a remote PR link are needed for remote teammates in the connected milestone.

Slack message edits/deletions, out-of-order event reconciliation, and simultaneous discussion/approval across deliveries remain pilot-readiness work. Do not treat the current adapter as a production approval system.

[Slack Socket Mode setup](https://docs.slack.dev/apis/events-api/using-socket-mode/)

## Live Codex

Set:

```dotenv
EXECUTOR=codex
TARGET_REPO_PATH=/absolute/path/to/a/trusted/test-repo
TARGET_BASE_REF=main
TEST_COMMAND_JSON=["npm","test"]
```

Configure authentication for the installed Codex runtime, or supply `OPENAI_API_KEY` as appropriate for your account. `CODEX_MODEL` is optional; omitting it uses the runtime default.

Investigation uses a read-only coding session. Implementation starts only after application approval, in a separate writable checkout with network/web search disabled. Slack/Brave/Inngest secrets are not passed to the coding subprocess. Git and test commands also receive a reduced environment, but run on the host rather than in a container.

The checkouts include committed files only. This MVP does not install dependencies or fetch remote branches. Prefer a small self-contained test repository initially. For real applications, add an explicit trusted setup command or prepared sandbox image, then validate that test execution works in a fresh checkout. Never reuse an arbitrary setup command proposed in customer feedback.

The model may receive code context. Running Codex locally does not mean its inference happens locally or that source cannot leave the machine.

[Official OpenAI SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)

## Brave

Set `BRAVE_SEARCH_API_KEY`, then run:

```sh
npm run cli -- research TASK_ID "JavaScript Object.keys undefined empty array"
```

This sends exactly the supplied search query to Brave, attaches up to five HTTPS source snippets as discussion, and therefore requires a plan revision before approval. Use public technical terms; do not put private customer text, credentials, or code in the query. Search snippets are labeled unverified. Source-page retrieval and fact verification belong in the next web-specialist iteration.

[Brave Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get)

## Inngest

The CLI and Slack can execute persistent jobs directly. Inngest is an optional adapter over the same queue; it is not required for `npm run demo`.

For local Inngest development, set `INNGEST_DEV=1`. If Slack should delegate execution, also set `JOB_RUNNER=inngest`.

Terminal 1:

```sh
npm run worker
```

Terminal 2, with the Inngest CLI installed using its official setup guide:

```sh
inngest dev -u http://127.0.0.1:3000/api/inngest
```

The worker binds to localhost. `GET /health` reports that the adapter is running. The dispatcher sends persisted pending jobs to the local Inngest server every five seconds with stable event IDs. The handler claims each job atomically. Failed business operations are stored as failed and need a revised plan; they are not silently retried as successful operations.

For an eventual hosted setup, configure signing/event keys and an authenticated reachable Inngest endpoint. Keep SQLite and execution on a single host until the storage/worker model is migrated. Validate long-running coding jobs against the chosen hosting and Inngest execution transport before deployment.

[Inngest functions](https://www.inngest.com/docs/reference/functions/create), [Inngest CLI](https://www.inngest.com/docs/cli)

## GitHub publication — next milestone

The current executor produces a local branch and review bundle, not a remote PR. There is no publisher implementation yet. The future publisher should have its own scoped GitHub App credentials, fetch and verify the remote base, create a task/plan branch, push the tested change, and create or recover an existing draft PR idempotently.

Keep automatic merge and deployment outside this milestone. Plan approval authorizes preparation of a reviewable change, not shipping it to customers.
