# Task 4 Report: Provider (Anthropic SDK wrapper with retry)

## Status: COMPLETE

## Files created
- `src/host/provider.ts` — implementation
- `test/unit/provider.test.ts` — verbatim from brief

## Commands + outputs

### Step 2 — failing test (TDD red)
`npx vitest run test/unit/provider.test.ts`
```
Error: Failed to load url ../../src/host/provider ... Does the file exist?
Test Files  1 failed (1)
```

### Step 4 — passing tests (TDD green)
`npx vitest run test/unit/provider.test.ts`
```
✓ test/unit/provider.test.ts (5 tests) 3540ms
Test Files  1 passed (1) | Tests  5 passed (5)
```

`npm run test:unit` (full suite)
```
✓ test/unit/example.test.ts
✓ test/unit/protocol.test.ts
✓ test/unit/tools.test.ts (9 tests)
✓ test/unit/provider.test.ts (5 tests)
Test Files  4 passed (4) | Tests  16 passed (16)
```

## Deviations from brief (2, both required — the brief's verbatim implementation contradicted its own verbatim tests)

1. **Retry budget: `attempt >= 3` instead of `attempt >= 2`** (src/host/provider.ts:33)
   The test "retries 5xx errors up to 3 times then succeeds" requires 4 total calls (3 failures + 1 success) and asserts `calls === 4`. The brief's `attempt >= 2` caps at 3 calls and throws on the 3rd failure, so the verbatim code failed its own test. Changed to `attempt >= 3` → 3 retries (4 attempts max), matching both the test title and the assertion. Backoff stays 500·2^attempt.

2. **Tool-use flush on `message_stop` and at stream end** (src/host/provider.ts:~50-70)
   The "accumulates tool_use blocks" test stream contains no `content_block_stop` event — only `message_stop` — so the brief's code never finalized the pending tool and the test failed with only `{type:"endTurn"}` emitted. Refactored finalization into a `flushTool()` helper called on `content_block_stop`, on `message_stop`, and once after the stream ends (defensive). Same JSON-parse + malformed-JSON fallback behavior as the brief.

All other code is verbatim from the brief, including exported signatures (verified against the interface block — `ProviderConfig`, `StreamEvent`, `Provider`, `AnthropicMessage`, `createProvider`, `AnthropicClientLike` all match exactly).

## Self-review against brief checklist
- [x] Step 1: failing test written verbatim (only removed a stray unused `const factory = () => current;` line? No — kept verbatim including the unused line; test compiles and passes as-is)
- [x] Step 2: test run, failed (module missing)
- [x] Step 3: `src/host/provider.ts` implemented; `ToolDef` imported as type from `./tools`; TOOL_DEFS NOT exported from provider.ts (confirmed — Task 6 imports from ./tools)
- [x] Step 4: 5/5 provider tests pass; full suite 16/16 passes
- [x] Step 5: committed with explicit paths `git add src/host/provider.ts test/unit/provider.test.ts`
- Retry test sleeps real ms (500 + 1000 + 2000 = 3.5s total with 3 retries); chose to keep real timers — deterministic on this machine, adds ~3.5s to suite runtime. Documented per brief note.
- Pre-existing, unrelated: `npx tsc --noEmit` fails in `src/webview/main.tsx` (missing `@types/react` / `@types/react-dom`) — existed before this task; not fixed without approval.
