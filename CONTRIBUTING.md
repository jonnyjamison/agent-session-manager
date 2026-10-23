# Working on this

This is an early project. Bug reports, practical suggestions, and contributions are welcome, particularly around keeping context useful when work moves between sessions.

## Local setup

Use Windows with Node.js 22.12 or later. Node 24 is used in CI.

```powershell
npm ci
npm test
npm run build
npm start
```

You need a locally installed and authenticated CLI to test an actual coding session. The automated tests use fixtures and don't send prompts to a provider.

## Making a change

Keep changes focused and explain the problem you're solving. Include how you checked the behaviour and anything still unverified. For visible changes, a screenshot using example data is useful.

For changes to sessions, switching views should keep existing terminals alive. For changes to checkpoints, keep old data readable, preserve earlier revisions, and make any migration recoverable. Keep Electron's context isolation and sandboxing enabled, and expose specific IPC operations rather than general filesystem or process access.

Run `npm test` and `npm run build` before opening a pull request. If you change the main/preload/renderer flow, also run the [desktop integration check](docs/usage.md#verification).

## Reporting a problem

Include your Windows, Node, and CLI versions, what you were trying to do, what happened, and steps to reproduce it. For attention detection, say whether the item was a CLI notification or an inferred prompt.

Please use example data in screenshots and logs. Terminal output and handovers can contain project paths, credentials, or details from private work.
