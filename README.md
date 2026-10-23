# Agent Session Manager

A Windows desktop app for managing Claude Code and Codex CLI sessions in one place.

The part I care about most is preserving context. The goal, the decisions made along the way, what has actually been checked, and what needs to happen next can all get scattered across terminals and conversations. I want to make that easier to pick up again, whether I'm continuing the work myself, switching agents, or handing it over to someone else.

This is an early working version built with Electron, React, TypeScript, xterm.js, and node-pty. It runs the CLIs installed on your machine and uses their existing authentication.

## What it does

- Runs Claude Code and Codex in embedded terminals that stay alive when you switch sessions.
- Keeps both providers in one sidebar, with session names, project folders, provider badges, and process status.
- Discovers coding sessions started outside the app and shows them in a separate, monitor-only group.
- Collects prompts, process exits, and manual reminders in a **Needs me** queue, with optional Windows notifications.
- Saves **session checkpoints** covering the goal, progress, decisions, blockers, verification, references, and next steps.
- Keeps checkpoint drafts as you type and preserves earlier versions when you create a revision.
- Copies handovers as Markdown and exports readable Markdown or portable JSON checkpoints for sharing.

## Getting started

You'll need Windows 10 1809 or later, Node.js 22.12+ (Node 24 was used during development), and Claude Code and/or Codex CLI installed and authenticated.

Check that Windows can find your CLIs:

```powershell
where.exe claude
where.exe codex
```

Then, from the project folder:

```powershell
npm ci
npm run build
npm start
```

Choose **New session**, select an agent and project folder, and launch it. Interact with the CLI as you would in a normal terminal. Restart the app if you've just installed a CLI or changed your PATH.

node-pty includes native prebuilds for Windows. If your setup needs to compile it from source, see the [setup notes](docs/usage.md#setup).

## Keeping the context

From a session, choose **Save checkpoint** and record enough for someone to continue the work. I've separated the fields so that decisions, verification, and next steps have somewhere to go, rather than getting buried in a single summary.

**Copy handover prompt** gives you a prompt to paste into the current agent. You can use its response to help fill in the checkpoint, then review the details before saving.

Drafts are saved locally as you type. Saved checkpoints stay in the **Context library**, even after their session is removed. Creating a revision keeps the previous checkpoint intact.

To continue elsewhere:

1. Open a checkpoint and review the handover.
2. Use **Copy handover** to paste it into another conversation, or **Export Markdown** to share it as a document.
3. Use **Export checkpoint** if you want a JSON file that another copy of this app can import.

You can optionally capture the Git branch, commit, and changed-file names, or include a short terminal excerpt. Review these before sharing. A checkpoint preserves the handover you've written; it doesn't recreate an agent's full conversation state or restore your code.

## Knowing when a session needs you

The **Needs me** queue shows where an item came from:

| Source | What it means |
| --- | --- |
| Manual flag | A reminder or decision you've recorded yourself. |
| CLI notification | A notification emitted by the CLI, such as a completed turn or approval request. |
| Inferred prompt | Terminal text looks like an approval or input prompt. Check the terminal to confirm. |
| Process exit | An app-managed CLI exited and its result is ready to review. |

Codex sessions launched here receive process-scoped terminal-notification settings. Claude uses prompt-text detection unless it emits a compatible notification. Inferred prompts can be wrong or missed, so they're labelled explicitly. Nothing in the queue approves commands on your behalf.

Sessions started outside the app support manual flags and checkpoints. Their terminal contents and approval prompts aren't available to this app.

## Current limits

- Closing the app stops sessions launched inside it. Reopening restores their metadata as stopped sessions, rather than reconnecting to running terminals.
- External sessions are monitor-only. You still use the original terminal to interact with them.
- Windows process discovery usually can't identify an external session's project folder unless it was passed explicitly.
- Checkpoints are reviewed notes, with optional Git and terminal snapshots. Automatic conversation summaries and provider-history imports aren't implemented.
- Windows notifications are optional and off by default. Their delivery and provider-specific prompt formats still need checking in normal interactive use.

I want to build on this with background sessions that can be reconnected, better provider events, and more ways to carry useful context between pieces of work.

## Development

```powershell
npm test
npm run build
npm start
```

The tests cover process discovery, prompt detection, queue persistence, checkpoint revisions, export validation, and backup recovery. There's also an Electron integration check for the actual main/preload/renderer flow; the [development notes](docs/usage.md#verification) explain how to run it with isolated test data.

GitHub Actions is configured to run the tests and production build on Windows. To build a portable Windows executable locally:

```powershell
npm run package
```

The output goes into `release/`. It's unsigned.

## How it's put together

Electron's main process owns the PTYs, process discovery, and saved data. React renders the workspace and xterm.js terminals. The renderer has context isolation and sandboxing enabled, with Node integration disabled; a small preload bridge exposes named operations for session management, attention items, and checkpoints.

Workspace metadata and checkpoints are saved in Electron's user data directory. Drafts use the app's local storage. Back up that directory if you want to preserve the whole workspace. The app doesn't upload your checkpoints or send handovers to anyone automatically.

See [usage and development notes](docs/usage.md) for storage, recovery, notification behaviour, and IPC details. If you'd like to work on it, start with [CONTRIBUTING.md](CONTRIBUTING.md).
