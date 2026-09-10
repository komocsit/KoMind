# Spec: Justwoker Agent — VS Code Agent Extension

Date: 2026-09-11
Status: Approved design, pre-implementation

## Purpose
A VS Code extension providing a Copilot-agent-mode-style chat sidebar, powered by an Anthropic-compatible API at `https://api.justwoker.icu` (model `gpt-5.6-sol`), supporting streaming chat, file read/edit tools (auto-applied with diffs), and terminal commands (user-approved).

## Architecture
- **Extension host (Node, TS)**: API client (`@anthropic-ai/sdk` with custom `baseURL`), agent loop, tool executors, approvals, session persistence. Holds API key via `SecretStorage`.
- **Webview (React 18 + Vite, TS)**: chat UI — streaming markdown, syntax-highlighted code blocks, tool-call cards, terminal approval cards, diff notifications, session list.
- **Shared module**: typed `postMessage` protocol (all request/response/notify message types), session types, config types.
- Communication strictly `webview ↔ host` via typed messages; webview never touches filesystem, API, or secrets.

## Components
1. **Provider** — wraps Anthropic TS SDK; `baseUrl`, `apiKey`, `model`, `maxTokens` from settings/SecretStorage.
2. **AgentSession** — message history + loop: send → stream deltas to UI → on `tool_use` execute tool → return `tool_result` → repeat until `end_turn`. One loop per session; user messages queued while running.
3. **Tools**:
   - `read_file(path)` — returns file content (paths constrained to workspace folders).
   - `list_dir(path)` — directory listing.
   - `apply_edit(path, oldString, newString)` — string-replace edit; auto-applied via `WorkspaceEdit`, shown as diff tab + chat card with Undo.
   - `run_terminal(command, cwd?)` — pauses loop, ApprovalManager pushes approval card; on Approve, executes via `child_process`, streams stdout/stderr to the card; auto-reject after 60s.
4. **ApprovalManager** — terminal approval lifecycle (request → user decision/timeout → resolve loop).
5. **SessionStore** — JSONL append per event in `globalStorage/sessions/<id>.jsonl`; session list, resume, delete.
6. **Settings & commands** — `justwokerAgent.baseUrl`, `.model`, `.maxTokens`, `.autoApproveEdits` (default `true`), `.autoApproveTerminal` (default `false`). Commands: set API key, new session, open settings, retry.

## Data flow (one turn)
`userMessage` → host appends to session → SDK call → stream `content_block_delta` → relay chunks to UI → `tool_use` block → execute tool (immediate or after approval) → `tool_result` appended → next SDK call → repeat → `end_turn` → persist final state.

## Error handling
- Network/5xx: retry ×3 with backoff; then error card with Retry button.
- Malformed tool call (missing file, bad params, `oldString` not found): returned as error `tool_result` so the model can self-correct.
- Concurrent user sends queued while a loop is running; no parallel loops per session.
- Webview reload reconstructs UI state from session JSONL.

## Non-goals (v1)
No multi-root awareness, no web portal, no marketplace publishing, no agent-side git operations, no context-window compaction.

## Testing
- Unit (vitest): agent loop state machine against a mock SDK stream; tool executors; edit application on a temp workspace.
- Integration: `@vscode/test-electron` full loop against a mock server.
- Manual: smoke test against the real endpoint (chat, one file edit, one approved terminal command).

## Repo layout
```
justwoker-agent/
├── src/host/        (extension.ts, provider, agent, tools, approvals, store)
├── src/webview/     (React app)
├── src/shared/      (protocol, types)
├── test/            (unit + integration)
├── esbuild.js, package.json, tsconfig.json
```

## Decisions confirmed
- Name: **Justwoker Agent**.
- Terminal execution: hidden `child_process` with output streamed to the chat card (integrated-terminal mode deferred).
- Edits auto-applied (with diff + undo); terminal commands require explicit approval.
