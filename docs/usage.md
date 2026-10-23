# Usage and development notes

These are the detailed setup, storage, and implementation notes for Agent Session Manager. For an overview, see the [README](../README.md).

## Setup

Use Windows 10 1809 or later, Node.js 22.12+ (Node 24 recommended), and npm. Install Claude Code and/or Codex CLI separately and authenticate using their normal setup. The app uses the CLI installations and credentials already on your machine.

Check discovery in PowerShell:

```powershell
where.exe claude
where.exe codex
npm install
npm run build
npm start
```

`npm install` uses node-pty's bundled Windows native prebuilds. If a native prebuild is unavailable, install Visual Studio Build Tools with Desktop development with C++, the matching Spectre-mitigated libraries, and Python. Restart the app after installing a CLI or changing PATH. `npm run dev` builds and launches the desktop app (no hot reload server).

To create a portable Windows executable:

```powershell
npm run package
```

Output is written to `release/`. The application is unsigned.

## Use

Choose **New session**, an agent, an optional session name, and a project folder. Launch starts the real CLI in that folder with no automatic prompts or permission bypasses. Codex receives process-scoped terminal-notification settings described below. Use the terminal to interact with it normally. Each session has its own PTY and mounted xterm terminal; switching sessions keeps processes and terminal state alive, and background output continues to accumulate.

The shared sidebar groups both providers by **Running**, **Stopped**, and **Error**. Running means the process is alive. The separate Needs me queue distinguishes observed events from inferred prompts. Rename sessions from the header. Stop terminates the process; start again launches a fresh CLI process. Remove is available only after stopping.

Metadata (IDs, names, providers, folders, selected session, creation dates) is stored in `workspace.json` under Electron's user data directory, normally `%APPDATA%/Agent Session Manager` or `%APPDATA%/agent-session-manager` depending on launch mode. Closing the app stops its processes. Reopening restores metadata as stopped sessions; it does not restore running processes or terminal transcripts. CLI conversation history remains managed by each provider.

## Monitor sessions started elsewhere

The **External sessions** sidebar automatically discovers running Claude Code and Codex CLI processes through a read-only Windows process inventory. It checks every five seconds while the app is open; **Refresh processes** requests another check (results are cached for two seconds). Select a discovered session to see its provider, PID, start time, process status, and last successful check. Processes that exit remain marked **Exited** for this app run, up to 100 historical entries. External sessions are rediscovered on reopening and are not saved as managed sessions.

This is monitor-only: use the original terminal for input, approvals, and stopping the agent. Closing Session Manager leaves external processes running. Running means the process exists, not that the agent is thinking or waiting for input. External terminal contents cannot be read or attached. A background service for reconnecting future managed sessions is not part of this version.

Windows process inventory does not expose working directories. A project folder is shown only if an absolute `-C` or `--cd` argument was explicitly provided; otherwise it is unavailable. Native CLI executables and standard npm Node entry points are recognized; Codex app-server/MCP-server and help/version processes are excluded when their arguments are readable. App-managed process trees and duplicate launcher/child pairs are excluded. Custom wrappers, restricted processes, and very short-lived commands may not be discovered. On inventory failure the app keeps the last successful results and shows a warning. Raw command lines are used only inside the main process for classification and are neither sent to the renderer nor persisted.

## Needs me

Open **Needs me** in the sidebar to see a durable queue of follow-ups, with resolved history and optional Windows notifications when the app is unfocused. Click a notification to return to the queue. Notifications are off by default. They use Windows' local notification mechanism; nothing is sent to a remote service.

Each item identifies its source:

- **You flagged this:** use **Flag needs me** on any managed or external session to record a decision, blocker, or reminder. These stay open until you resolve them.
- **CLI terminal notification:** a message emitted by an app-managed CLI using OSC 9. For Codex the app passes `-c tui.notifications=true -c tui.notification_method="osc9" -c tui.notification_condition="always"` to that process. Global configuration and approval policy are unchanged. A notification can mean a turn completed, not only that approval is required. See [official Codex terminal notification documentation](https://learn.chatgpt.com/docs/config-file/config-advanced?translationFallback=de-DE).
- **Inferred from terminal text:** a small set of explicit approval/input prompt phrases, including prompts split across chunks. This is a heuristic, not an authoritative provider state; terminal redraws or printed code can cause false positives, and other prompt formats can be missed. Claude uses this fallback unless it emits an OSC 9 notification itself. Idle time and ordinary terminal bells are not classified as waiting.
- **Process exit:** an app-managed CLI exited on its own. Check its output and preserve a handover. Explicitly stopping a session does not add an exit reminder.

Typing a response resolves that session's inferred/terminal-notification items; terminal device replies do not. Starting/stopping a session clears these automatic prompt items. Manual reminders and exit reminders require explicit resolution. Opening a session alone does not dismiss an item. Queue entries survive app restarts and retain the time they were observed; they are follow-ups, not guaranteed current provider state. External processes have no readable terminal stream here, so their approval/input state is unavailable and only manual flags are supported.

## Session checkpoints and sharing

From any session select **Save checkpoint**. Record the goal, progress, decisions/constraints, blockers, next steps, verification, and references. **Copy handover prompt** copies a request you can paste into the current agent to produce a useful summary; the app does not send prompts automatically or fabricate a summary. Paste its useful details into the fields and review them.

Drafts save locally as you type, including the last keystroke. Return via **Context library → Unfinished drafts** after navigating away or reopening. Starting a draft preserves its source metadata so it remains saveable even after the original session disappears or is removed. Saved checkpoints live in `context-library.json` next to `workspace.json`; editor drafts live in Electron's localStorage for this app. Back up the app's user data directory to preserve both. Saved checkpoint writes are atomic and keep a `.bak` recovery copy. If a library is damaged the app preserves a timestamped copy and tries the backup; it stops with an error if recovery is impossible rather than replacing the library with an empty one.

Checkpoints remain in the **Context library** after their session is removed. **Create revision** starts from the previous checkpoint's fields and saves a new linked snapshot, preserving the original. Search the library by task, project, goal, or next steps.

Optional captures are explicit:

- Git branch, commit, and changed-file names are captured at save time when checked. This is repository state, not proof those changes belong to this agent. It does not commit/stash changes or include file contents. An unavailable Git snapshot is recorded as such.
- Recent managed-terminal output can be included by checking the initially unchecked option. It is capped at 12,000 characters, has terminal control sequences removed, and may contain redraws. It is not a full conversation transcript. External terminal contents cannot be captured.

Review the saved checkpoint, then choose:

- **Copy handover** for Markdown you can paste into a new Claude/Codex session or share with a teammate.
- **Export Markdown** for a readable `.md` handover.
- **Export checkpoint** for a portable versioned JSON file; another copy of this app can **Import checkpoint**, preview its title/goal, and add it to its library. Import validates fields and size, creates a fresh checkpoint ID, and never executes commands or launches an imported session.

Files are saved only to the location selected in the native save dialog. Nothing is sent to another person automatically. Review notes, local paths, and optional output before sharing. A checkpoint preserves human-readable context; it does not recreate a provider's hidden context, restore code, or automatically resume a conversation. Store a known provider conversation ID or resume command under References if that is useful for continuing the same conversation.

## Implementation and security

- Electron keeps context isolation and renderer sandboxing enabled, with Node integration disabled. Navigation and new windows are blocked. A restrictive content security policy blocks network access in the renderer.
- The preload exposes named methods for metadata, the native folder dialog, session lifecycle, terminal input, and terminal resizing. It does not expose raw IPC, filesystem APIs, or arbitrary process spawning. Main-process handlers verify the sender/main frame and validate parameters.
- Executables are resolved from the local PATH using `where.exe`. Native `.exe` CLIs run directly. The standard npm Codex `.cmd` shim is handled by invoking its installed `@openai/codex/bin/codex.js` entry point with local Node, without shell command interpolation. Other batch launchers are rejected.
- CLI processes inherit your user environment and permissions, matching normal terminal use. Provider authentication and approvals happen in the embedded CLI.
- PTYs live in the main process; renderer output listeners unsubscribe on disposal. A bounded in-memory history supports renderer initialization with sequence numbers to avoid replay races. Session changes save metadata atomically through a temporary file.

## Verification

`npm run build` type-checks both processes and produces renderer and Electron output. A desktop smoke check should launch each provider, confirm its normal startup/authentication screen, switch sessions while output is running, rename, resize, stop/restart, and reopen to check restored metadata. Provider responses depend on your account and network access.

`npm run test:external` checks process classification, launcher deduplication, managed-process exclusion, PID reuse, and folder parsing with fixtures. After building, `node scripts/check-external.cjs --live` additionally checks the real Windows process inventory. To check the UI, start an agent in a separate terminal, open the app, select its External sessions row, then exit the agent in the original terminal and check that its row changes to Exited.

`npm test` additionally checks attention persistence and deduplication, manual/automatic resolution, checkpoint revisions, JSON round-trips, Markdown completeness, input validation, split/control-sequence terminal signals, and backup recovery. After building, run the real Electron desktop integration test with isolated temporary data:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList 'scripts/smoke-context.cjs','--smoke-test' -WindowStyle Hidden -Wait
```

It verifies renderer isolation, queue actions, draft restoration, saving/revising, clipboard handover, JSON export/import, and persistence after renderer reload. It uses stopped fixture sessions and does not send prompts to either provider. A preview screenshot is saved to `.scratch/`. Provider-specific prompt formats and delivery of Windows notification toasts still warrant checking with your normal interactive CLI workflow.
