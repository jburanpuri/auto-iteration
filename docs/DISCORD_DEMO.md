# Northstar feedback walkthrough

The main demo uses one company feedback page. Run `npm run demo:live`, open `http://127.0.0.1:4318`, enter a name and any product feedback, and submit. A single real report triggers Codex classification and investigation. CSV export is an optional example, not an intake restriction.

The agent classifies each report as a bug, feature request, usability concern, performance problem, question, spam, or other issue, with a free-form issue description. It inspects the configured repository and available logs, chooses engineering, UI/UX, or performance, and explains its routing. Unclear or out-of-repository requests require clarification; classification does not imply the problem can be fixed. Spam and business-only requests can be marked non-code. Exact repeat reports share an open investigation; broad categories are never used to merge unrelated reports. Semantic clustering is not implemented.

The Discord proposal includes **Approve vN** and **Request changes** buttons. Request changes opens a text modal; submitting it records the engineer's feedback, gets a conversational handoff, and queues a new Codex plan. Approval is checked against the configured Discord user IDs and exact plan version. Plain discussion never authorizes coding. Existing mention commands still work.

The fixed preview, patch, tests, and local review summary appear in the separate engineer console on port 4319. Remote PR publication is not implemented. If Discord is disconnected, the separate local engineer console is available on port 4319 for rehearsal.

The setup instructions below still apply. Older three-report and CRM walkthrough references describe the earlier demo; the current feedback page needs only one submission.

# Auto Iteration: live team demo

Auto Iteration turns customer complaints into an evidence-backed engineering conversation and a tested code change. Five teammates and one bot share a private Discord server. The sample product is **Demo CRM**, a small, real codebase with fictional customers.

## What to demonstrate

1. Open the customer directory. Choose **Archived** and click **Export CSV**. The real exporter throws; the browser records the error, stack, and zero-row count.
2. Open **Feedback** and click **Simulate 3 customer reports**. These reports are explicitly labeled simulated. The button does not fabricate logs.
3. Three reports about the same issue within 30 minutes create an investigation. The bot tells `#engineering` it is investigating.
4. Codex uses a read-only `query_product_logs` MCP tool and inspects an isolated checkout. It proposes a fix, cites evidence, and chooses the owning team.
5. The proposal appears in `#engineering`, `#ui-ux`, or `#performance`. Reply to its message to discuss it. OpenRouter can handle that conversation and save a brief for the next Codex investigation.
6. Ask about compatibility, request a change, and send `@Auto Iteration revise 1`. Inspect v2, then an authorized teammate sends `@Auto Iteration approve 2`.
7. Codex edits a new checkout and runs repository tests. The Feedback page offers **Try fixed preview**, **Patch**, **Tests**, and **Review**. Repeat the empty export in the preview: the CSV now downloads.

Actual mentions are selected through Discord's mention picker. The bot is not invoked by typing plain `@Auto Iteration` text that does not resolve to the bot.

Other scenarios: **Hard to reset filters** asks for one Clear filters action (UI/UX). **Search feels slow** targets a deliberate 900 ms search delay (performance). Type into search first to capture a real timing event. Each scenario is investigated by Codex, not selected from a hard-coded solution. The optional `DEMO_EXECUTOR=demo` rehearsal only supports the CSV fixture.

## Accounts and configuration

Requires Node 22.20+, Git, and `npm ci`. Copy `.env.example` to `.env` if you do not already have one; preserve existing settings when editing.

### Discord

1. Create a private server and text channels `#engineering`, `#ui-ux`, and `#performance`. Invite your five teammates. For this demo, everyone can see all three.
2. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application named **Auto Iteration**.
3. Under **Bot**, generate a bot token and enable **Message Content Intent**. Keep the token in `.env`; never paste it into chat or commit it.
4. Under **Installation**, enable **Guild Install** with the `bot` scope. Grant **View Channels**, **Send Messages**, and **Read Message History**. Use the installation link to add it to your server. No Administrator permission, public webhook, or slash-command registration is needed.
5. In Discord user settings, enable **Advanced → Developer Mode**. Right-click your server, each channel, and the approving teammates to copy their IDs.
6. Set:

```dotenv
DISCORD_BOT_TOKEN=your-private-token
DISCORD_GUILD_ID=your-server-id
DISCORD_CHANNEL_ID=engineering-channel-id
DISCORD_UI_UX_CHANNEL_ID=ui-ux-channel-id
DISCORD_PERFORMANCE_CHANNEL_ID=performance-channel-id
DISCORD_APPROVER_IDS=lead-user-id,another-lead-user-id
```

Optional team channels fall back to engineering when omitted. The bot checks the configured server and channel IDs; it ignores bots and webhooks. One task has one owning channel. Revisions stay there even if the suggested team changes, preserving the discussion and approval history. When several tasks are open in a channel, use Discord **Reply** on the relevant proposal. With one open task, ordinary messages can be recorded as its discussion.

### Codex: investigation and code changes

```sh
npm run codex:status
# If not signed in:
npm run codex:login
```

The SDK uses the local Codex CLI's configured authentication. ChatGPT sign-in uses Codex account limits; API-key authentication uses API billing. No credentials are copied into the demo repository. Set `CODEX_MODEL` to override the configured model; no model name is hard-coded. See [Codex authentication](https://learn.chatgpt.com/docs/auth) and [the SDK](https://learn.chatgpt.com/docs/codex-sdk).

`npm run demo:live` defaults to real Codex even if the older CLI's `EXECUTOR=demo` setting exists. Use `DEMO_EXECUTOR=demo` only for an explicitly scripted rehearsal.

### OpenRouter: conversation and handoff

```dotenv
CONVERSATION_PROVIDER=openrouter
OPENROUTER_API_KEY=your-private-key
OPENROUTER_MODEL=provider/model-id
```

Choose an exact model ID supporting [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs). The application validates a `reply` for Discord and a `codexBrief` for the next investigation. Unsupported models or failed requests produce an explicit error while retaining the engineer's comment. There is no silent model substitution.

This model receives feedback, engineer discussion, the current Codex proposal, and task-scoped log evidence. It receives no filesystem or approval tools. Its brief is advisory; original engineer comments remain authoritative. It cannot authorize implementation, regardless of what it says in prose. If `CONVERSATION_PROVIDER` is omitted, Codex answers the discussion instead.

### Run

```sh
npm run demo:live
```

Open [the local demo](http://127.0.0.1:4318/). Product data and checkouts are stored under `.local/auto-iteration-demo/`; set `DEMO_DATA_DIR` to a new directory for a fresh run without deleting previous results. Keep this process and the laptop running. Discord uses an outbound Gateway connection; the CRM page is local to the demo laptop. Screen-share it with teammates. Do not expose the localhost server publicly; public hosting needs its own authentication and abuse controls.

Without Discord credentials, the product and Codex worker run locally and clearly show that Discord is disconnected. Local operator commands are available for testing:

```sh
npm run demo:cli -- list
npm run demo:cli -- show TASK_ID
npm run demo:cli -- comment TASK_ID "Preserve existing populated exports; keep headers for empty ones."
npm run demo:cli -- revise TASK_ID 1
npm run demo:cli -- approve TASK_ID 2
```

The CLI trusts the local machine owner. Human approvals are simulated when using it to verify a demo; it is not a Discord identity check.

## Inngest, Brave, and MCP

- **Inngest is optional for this local run.** SQLite already persists jobs and claims them atomically. To use it, set `JOB_RUNNER=inngest` and `INNGEST_DEV=1`, then run `npm run demo:worker` alongside `npm run demo:live`. The wrapper selects the same demo repository and database. Start the Inngest dev server as described in [INTEGRATIONS.md](INTEGRATIONS.md). Without the dev server running, jobs remain queued. Hosted use requires signing/event keys and a reachable worker endpoint.
- **Brave is optional research.** Set `BRAVE_SEARCH_API_KEY`, then `npm run demo:cli -- research TASK_ID "public CSV format guidance"`. It adds source snippets to discussion; request a new proposal afterward. Automatic web searching and source-page verification are not implemented.
- **The local observability MCP is included.** Codex receives a fixed snapshot of up to 50 recent logs scoped to the task's repository and issue. Its one read-only tool cannot select arbitrary files or other teams' data. Logs come from actual browser actions, but are client-reported evidence, not a trusted production monitoring service. The normal Codex MCP configuration is not permanently changed. External services such as Sentry need their own installation, credentials, and scope configuration.

## GitHub App or direct connection?

A GitHub App is useful when other organizations need to install Auto Iteration on selected repositories, grant scoped permissions, and revoke access. The work is installation-to-organization mapping, installation tokens, private-key storage, webhook verification, and handling permission changes. It is a separate onboarding milestone; none of that is needed to demonstrate an actual code fix locally.

GitHub Apps can be installed directly through an installation link; Marketplace listing is optional. Repository access still requires an authorized owner/admin to install the app. [GitHub's installation-link documentation](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app).

For a real hackathon PR, the shortest next step is a dedicated GitHub repository containing this seeded CRM baseline, plus a publisher using your GitHub authentication to push the reviewed branch and open a **draft** PR. That publisher is not implemented in this milestone. Current results are local patches and previews; the bot does not claim to have created a PR. Do not target the orchestrator repository with a patch meant for the CRM.

## Practical limits

- Complaint grouping uses explicit demo issue categories. Three reports in 30 minutes is a fixed threshold, not statistical anomaly detection, semantic deduplication, or verification of three distinct customers. Retries reuse a source ID; separate simulated customers use separate IDs.
- Cross-cutting or uncertain issues route to engineering. An initial investigation alert goes there before routing is known; the actionable proposal lives in one owning channel.
- Discussion starts when a proposal is ready. New comments require revision before approval. Natural-language replies and agent briefs cannot approve. Conversation replies are queued in memory; a process restart can lose an unfinished reply, but stored human comments remain.
- The original checkout remains unchanged. The preview serves frontend assets from the tested checkout. It does not execute an agent-written web server or deploy changes.
- Local tests execute trusted repository code on the host. The clone protects the original files; it is not a process sandbox. Codex's model calls can send code context to its provider, and OpenRouter conversation calls send the supplied discussion/evidence to the selected provider.
- Sending a Discord message and recording its delivery are not one atomic transaction. A crash between them can duplicate an announcement; task creation and implementation approvals are independently deduplicated. Missed Discord events during a long outage are not backfilled.
- Only the demo's own log MCP is supplied automatically. Enterprise isolation, external monitoring, robust customer identity, public intake, approval buttons, and automatic PR publication are future work.

## Categories and concise Discord updates

The feedback form offers **UI/UX issue**, **Performance**, and **General**. The selected category controls the initial destination: `DISCORD_UI_UX_CHANNEL_ID`, `DISCORD_PERFORMANCE_CHANNEL_ID`, or `DISCORD_CHANNEL_ID`, respectively. Once a discussion is attached, it stays in its channel. Older submissions without a category continue to use the agent's team suggestion. Identical feedback submitted under different categories remains separate.

Each completed investigation sends one concise message. Actionable fixes show the proposed change, a key code finding, planned validation, and versioned approval/change buttons. Clarification results show the unresolved question and an **Add details** button, never approval. Non-code results show a brief team-review note. Full evidence, acceptance criteria, audit history, and artifacts remain in the local engineer console. Routine investigation announcements and repeated feedback headers are no longer posted. Existing channel history is not deleted or replayed on restart.

## Start a prepared feedback batch

Open the separate engineer console (port 4319 by default; the current running demo uses 4349). Six labeled sample feedback entries are visible before anything is submitted. Click **Start workflow** to queue three issues: empty contact export (General), feedback confirmation (UI/UX issue), and unnecessary background polling (Performance). Each issue includes two sample participants' reports. Codex investigates and summarizes each issue, then the bot sends its result to the selected team. Every implementation still needs that team's authorized approval.

The public Northstar form starts with an empty name field and contains no batch/demo controls. Retrying the same batch request does not create extra tasks. Another deliberate click starts a fresh batch. The scripted provider only implements the CSV fixture; run live Codex to investigate all three examples.
