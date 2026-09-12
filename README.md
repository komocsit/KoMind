# KoMind — VS Code Extension

<p align="center">
  <img src="media/komind-logo.png" alt="KoMind logo" width="180" />
</p>

A VS Code extension that embeds a coding agent in the activity bar. The agent chats with an Anthropic-compatible API endpoint (default `https://api.justwoker.icu`), and can read files, list directories, apply edits with visual diffs, and run terminal commands behind an approval gate. Sessions are persisted to global storage and can be reloaded from a dropdown.

## Dev setup

```powershell
npm install
npm run watch   # or: npm run compile
```

Then open the folder in VS Code and press **F5** (Run Extension) to launch the Extension Development Host.

## Set API key

In the Extension Development Host, run the command **KoMind: Set API Key** and paste your key. It is stored securely via VS Code SecretStorage (never written to settings or disk in plaintext).

## Settings

| Setting | Default | Description |
|---|---|---|
| `koMind.baseUrl` | `https://api.justwoker.icu` | API base URL (Anthropic-compatible) |
| `koMind.model` | `gpt-5.6-sol` | Model name sent to the API |
| `koMind.maxTokens` | `4096` | Max tokens per completion |
| `koMind.effort` | `high` | Default reasoning effort sent to the API |
| `koMind.autoApproveEdits` | `true` | Apply file edits automatically |
| `koMind.autoApproveTerminal` | `false` | Require approval for terminal commands |

## Tool permission model

- **Edits** (`apply_edit`): accepted edits are always saved immediately, independent of VS Code's `files.autoSave` setting, so no Save/Don't Save prompt is needed. `autoApproveEdits` only controls whether approval is required before applying an edit and defaults to `true`. Review changes with Git/Source Control. Non-unique or missing `oldString` matches are rejected with an error.
- **Terminal** (`run_terminal`): requires explicit user approval in the chat card (Approve/Reject buttons). Unanswered requests auto-reject after 60 seconds.

## Architecture

- **Extension host** (`src/host/`): `extension.ts` (webview provider + HTML/CSP), `provider.ts` (API streaming client), `agent.ts` (agent loop, tool-call orchestration), `tools.ts` (read_file, list_dir, apply_edit, run_terminal), `approvals.ts` (approval manager with 60s timeout), `store.ts` (JSON-file session persistence).
- **Webview** (`src/webview/`): React chat UI (`App.tsx`, `api.ts`) — streaming markdown (marked + DOMPurify), tool cards, approval buttons, session switcher.
- **Shared** (`src/shared/`): typed `postMessage` protocol (`protocol.ts`).

## Tests

```powershell
npm run test:unit         # vitest (protocol, tools, store, agent, provider)
npm run test:integration  # @vscode/test-electron (activation, commands)
npx tsc --noEmit          # typecheck
```

## Repo layout

```
src/
  host/        extension entry, provider, agent, tools, approvals, store
  webview/     React chat UI
  shared/      typed message protocol
test/
  unit/        vitest suites
  integration/ vscode-test-electron suite
esbuild.js     bundler (host + webview)
```
