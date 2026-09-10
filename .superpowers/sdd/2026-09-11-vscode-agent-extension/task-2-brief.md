# Task 2: Shared message protocol

**Files:**
- Create: `src/shared/protocol.ts`
- Test: `test/unit/protocol.test.ts`

**Interfaces:**
- Produces: all message types used by every later task — `HostToWebviewMsg`, `WebviewToHostMsg`, `ToolCallView`, `SessionEvent` (defined below, verbatim).

- [ ] **Step 1: Write failing type-compile test**

`test/unit/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../../src/shared/protocol";

describe("protocol types", () => {
  it("accepts a full set of message shapes", () => {
    const host: HostToWebviewMsg[] = [
      { type: "textDelta", sessionId: "s1", text: "hi" },
      { type: "toolCall", sessionId: "s1", callId: "c1", tool: "read_file", input: { path: "a.txt" } },
      { type: "toolResult", sessionId: "s1", callId: "c1", ok: true, output: "contents" },
      { type: "approvalRequest", sessionId: "s1", callId: "c2", command: "npm test" },
      { type: "approvalResolved", sessionId: "s1", callId: "c2", approved: true },
      { type: "error", sessionId: "s1", message: "boom" },
      { type: "turnComplete", sessionId: "s1" },
      { type: "newSession" },
    ];
    const webview: WebviewToHostMsg[] = [
      { type: "userMessage", sessionId: "s1", text: "hello" },
      { type: "approve", callId: "c2", approved: true },
      { type: "newSessionRequest" },
      { type: "retry", sessionId: "s1" },
    ];
    const events: SessionEvent[] = [
      { kind: "user", text: "hi", ts: 1 },
      { kind: "assistantText", text: "hello", ts: 2 },
      { kind: "toolCall", callId: "c1", tool: "read_file", input: { path: "a.txt" }, ts: 3 },
      { kind: "toolResult", callId: "c1", ok: true, output: "x", ts: 4 },
      { kind: "error", message: "e", ts: 5 },
    ];
    expect(host.length + webview.length + events.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/protocol.test.ts`
Expected: FAIL — `src/shared/protocol.ts` does not exist.

- [ ] **Step 3: Implement `src/shared/protocol.ts`**

```ts
export type ToolName = "read_file" | "list_dir" | "apply_edit" | "run_terminal";

export interface ToolCallView {
  callId: string;
  tool: ToolName;
  input: Record<string, unknown>;
}

export type HostToWebviewMsg =
  | { type: "textDelta"; sessionId: string; text: string }
  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string }
  | { type: "approvalRequest"; sessionId: string; callId: string; command: string }
  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
  | { type: "error"; sessionId: string; message: string }
  | { type: "turnComplete"; sessionId: string }
  | { type: "newSession" }
  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number }[] }
  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] };

export type WebviewToHostMsg =
  | { type: "userMessage"; sessionId: string; text: string }
  | { type: "approve"; callId: string; approved: boolean }
  | { type: "newSessionRequest" }
  | { type: "retry"; sessionId: string }
  | { type: "requestSessionList" }
  | { type: "loadSession"; sessionId: string };

export type SessionEvent =
  | { kind: "user"; text: string; ts: number }
  | { kind: "assistantText"; text: string; ts: number }
  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number }
  | { kind: "error"; message: string; ts: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/protocol.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: shared host/webview message protocol"`
