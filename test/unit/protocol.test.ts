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
      { type: "config", model: "gpt-5.6-sol", models: ["gpt-5.6-sol"], effort: "medium" },
    ];
    const webview: WebviewToHostMsg[] = [
      { type: "userMessage", sessionId: "s1", text: "hello" },
      { type: "approve", callId: "c2", approved: true },
      { type: "newSessionRequest" },
      { type: "retry", sessionId: "s1" },
      { type: "requestConfig" },
      { type: "setModel", model: "gpt-5.6-sol" },
      { type: "setEffort", effort: "high" },
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
