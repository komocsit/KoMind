# Task 6 Report: Agent loop (AgentSession + queueing + tool_result plumbing)

**Status:** COMPLETE
**Commit:** 85d0ddc — `feat: agent loop with tool round-trips and message queueing`
**Files:** `src/host/agent.ts` (new), `test/unit/agent.test.ts` (new)

## TDD sequence

1. **Failing test** — wrote `test/unit/agent.test.ts` verbatim from the brief (4 tests: tool round-trip, JSONL persistence, queueing while busy, provider error surfacing). Verified FAIL: `Failed to load url ../../src/host/agent`.
2. **Implement** — wrote `src/host/agent.ts` per the brief's reference implementation.
3. **First run: 3 of 4 tests failed.** Root cause: the brief's reference code treats `provider.streamTurn()`'s return value as a single `AnthropicMessage`, but the `Provider` interface (provider.ts:9) returns `Promise<AnthropicMessage[]>`. The brief's code pushed the array itself as a message and iterated `.content` on it, throwing `assistantMsg.content is not iterable` (surfaced via `ui.error`, so `turnComplete` never fired). Diagnosed with a throwaway tsx debug script, then deleted it.
4. **Fix** (agent.ts:40-46): spread the returned messages into history and use the last one as the assistant message:
   ```ts
   const assistantMsgs = await this.opts.provider.streamTurn(...);
   this.messages.push(...assistantMsgs);
   const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
   ```
5. **Pass** — `npx vitest run test/unit/agent.test.ts`: 4/4 PASS.

## Verification

- `npx vitest run test/unit/agent.test.ts` — 4/4 PASS
- `npm run test:unit` (full suite) — 6 files, 24/24 PASS (no regressions)
- `npm run compile` (esbuild production) — clean
- No `typecheck` script exists in this repo; esbuild compile is the available build gate.

## Design notes

- `send()` sets `running = true` synchronously before any await, so `session.busy` is observable true immediately after `send()` (verified by the queueing test's synchronous assertion).
- Drain loop runs async via `void this.drain()`; queued messages are processed sequentially in a `while (queue.length)` loop; `running` reset in `finally` so it unlocks even on error.
- Tool round-trips: assistant `tool_use` blocks → `executeTool` per call → `tool_result` blocks pushed as a user message → next `streamTurn` round; capped at 25 rounds.
- Events persisted per the `SessionEvent` protocol: `user`, `assistantText`, `toolCall`, `toolResult`, `error`.
- Errors from provider/tools are caught in `runTurn`, surfaced via `ui.error`, and persisted as `error` events; the session unlocks afterward.

## Deviations from brief

- One deviation, required for correctness: fixed the `streamTurn` return-value handling described above (the brief's verbatim implementation did not compile against the actual `Provider` interface semantics and failed 3 of its own 4 tests). The test file is verbatim from the brief and unchanged; the produced `AgentUi`/`AgentSession` signatures match the Task 7 contract exactly.

## Concerns

- The brief's reference implementation contained a bug (see above) — later task briefs with verbatim code may need the same scrutiny.
- Max-rounds exhaustion (25) reports `ui.error` + `turnComplete` but does not persist an event; acceptable for now, flagged for Task 7 review.
