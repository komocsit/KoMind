# Justwoker Agent — VS Code Extension

A VS Code extension that embeds a coding agent in the activity bar. The agent chats with a Justwoker API endpoint (default `https://api.justwoker.icu`, OpenAI-compatible streaming), and can read files, list directories, apply edits with visual diffs, and run terminal commands behind an approval gate. Sessions are persisted to global storage and can be reloaded from a dropdown.

## Dev setup

```powershell
npm install
npm run watch   # or: npm run compile
```

Then open the folder in VS Code and press **F5** (Run Extension) to launch the Extension Development Host.

## Set API key

In the Extension Development Host, run the command **Justwoker: Set API Key** and paste your key. It is stored securely via VS Code SecretStorage (never written to settings or disk in plaintext).

## Settings

| Setting | Default | Description |
|---|---|---|
| `justwokerAgent.baseUrl` | `https://api.justwoker.icu` | API base URL (OpenAI-compatible) |
| `justwokerAgent.model` | `gpt-5.6-sol` | Model name sent to the API |
| `justwokerAgent.maxTokens` | `4096` | Max tokens per completion |
| `justwokerAgent.autoApproveEdits` | `true` | Apply file edits automatically |
| `justwokerAgent.autoApproveTerminal` | `false` | Require approval for terminal commands |

## Tool permission model

- **Edits** (`apply_edit`): auto-applied by default (`autoApproveEdits`). The edit opens in a diff tab; Ctrl+Z in the editor undoes it. Non-unique or missing `oldString` matches are rejected with an error.
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
