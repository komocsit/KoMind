# Final Fix Report — 2026-09-11

All three Important final-review findings fixed in one wave. Verification clean.

## Finding 1 — openDiff showed nothing (same URI on both diff sides)

**Files:** `src/host/extension.ts`, `src/host/tools.ts`

- `applyEdit` in the real ToolContext now captures the **original text** before applying the WorkspaceEdit.
- After the edit is applied, it opens an in-memory scratch document with the original content via `vscode.workspace.openTextDocument({ content: originalText, language: doc.languageId })` and diffs it against the live file: `vscode.diff(originalDoc.uri, fileUri, basename, { preview: true })` — a real pre-edit → post-edit diff.
- `openDiff` was removed from the `ToolContext` interface and from `executeTool` (it was only ever the broken `vscode.diff(uri, uri, ...)` call; the diff now lives inside `applyEdit`, which owns the original text). All test mocks updated accordingly.
- Verified by compile + reasoning (vscode API, host-side); visual confirmation in the human smoke test.

## Finding 2 — session resume lost model context

**Files:** `src/host/agent.ts`, `src/host/extension.ts`, `test/unit/agent.test.ts`

- Added exported `messagesFromEvents(events: SessionEvent[]): AnthropicMessage[]` in `agent.ts`:
  - `user` → `{role:"user", content:[{type:"text",text}]}`
  - `assistantText` → assistant text blocks (consecutive blocks grouped into one assistant message)
  - `toolCall` → assistant `tool_use` block (`id = callId`); `toolResult` → user `tool_result` block (`tool_use_id = callId`, `is_error = !ok`); consecutive results grouped into one user message
  - `error` events excluded from the model conversation
- `AgentSession` constructor accepts optional `initialMessages?: AnthropicMessage[]` (also a `seedFromEvents(events)` method for imperative seeding).
- `loadSession` in `extension.ts` now loads events first and seeds the new AgentSession via `makeSession(id, messagesFromEvents(events))`.
- New unit tests: end-to-end resume (session 1 runs a tool round-trip, session 2 seeded from JSONL — mock provider's first call contains prior user text, tool_use/tool_result, assistant text) and an exact-shape test for `messagesFromEvents`.

## Finding 3 — autoApproveEdits / autoApproveTerminal never read

**Files:** `src/host/tools.ts`, `src/host/extension.ts`, `test/unit/tools.test.ts`, `test/unit/agent.test.ts`

- `ToolContext` gained `autoApproveEdits: boolean` and `autoApproveTerminal: boolean`.
- `executeTool`:
  - `apply_edit`: when `autoApproveEdits` is false, routes through `ctx.requestApproval` with a synthetic card: ``Edit ${path}: replace "${oldString.slice(0,80)}" with "${newString.slice(0,80)}"``; edit is skipped on rejection (`ok:false, "User rejected this edit."`).
  - `run_terminal`: skips `requestApproval` entirely when `autoApproveTerminal` is true.
- `extension.ts` reads both settings (`justwokerAgent.autoApproveEdits`, default true; `justwokerAgent.autoApproveTerminal`, default false) via workspace configuration when building the ToolContext.
- New unit tests: auto-apply when true; approval routing + card content when false; rejection blocks the edit; terminal skips approval when true. All existing mocks updated with the flags.

## Verification

```
npm run compile          → clean (esbuild, pre-existing mocha external warnings only)
npm run test:unit        → 6 files, 30 tests passed (was 23; +7 new)
npm run test:integration → 2 passing (extension activation + commands)
npx tsc --noEmit         → exit 0
```

## Commit

- `fix: final-review findings — real edit diffs, session context resume, approval settings plumbed`
  (src/host/extension.ts, src/host/agent.ts, src/host/tools.ts, test/unit/agent.test.ts, test/unit/tools.test.ts)
