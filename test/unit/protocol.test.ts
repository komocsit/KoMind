import { describe, it, expect } from "vitest";
import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../../src/shared/protocol";

describe("protocol types", () => {
  it("accepts a full set of message shapes", () => {
    const host: HostToWebviewMsg[] = [
      { type: "textDelta", sessionId: "s1", text: "hi" },
      { type: "toolCall", sessionId: "s1", callId: "c1", tool: "read_file", input: { path: "a.txt" } },
      { type: "toolResult", sessionId: "s1", callId: "c1", ok: true, output: "contents" },
      { type: "approvalRequest", sessionId: "s1", callId: "c2", command: "npm test", tool: "run_terminal" },
      { type: "approvalResolved", sessionId: "s1", callId: "c2", approved: true },
      { type: "error", sessionId: "s1", message: "boom" },
      { type: "turnComplete", sessionId: "s1" },
      { type: "newSession" },
      { type: "config", model: "gpt-5.6-sol", models: ["gpt-5.6-sol"], effort: "medium", mode: "build", alwaysAllow: { terminal: false, edits: false } },
      { type: "settings", baseUrl: "https://x", maxTokens: 4096, autoApproveEdits: true, autoApproveTerminal: false, models: ["m1"], apiKeySet: true },
      { type: "attachments", files: [{ name: "a.txt", content: "x" }], images: [] },
      { type: "attachments", files: [{ name: "b.txt", content: "y", truncated: true }], images: [{ name: "photo.png", mediaType: "image/png", data: "aW1hZ2U=" }], warning: "one skipped" },
      { type: "attachmentError", message: "unsupported" },
      { type: "contextEnabled", enabled: true },
    ];
    const webview: WebviewToHostMsg[] = [
      { type: "userMessage", sessionId: "s1", text: "hello" },
      { type: "userMessage", sessionId: "s1", text: "with files", attachments: [{ name: "a.txt", content: "x" }] },
      { type: "userMessage", sessionId: "s1", text: "what is this?", images: [{ name: "paste.png", mediaType: "image/png", data: "aW1hZ2U=" }] },
      { type: "approve", callId: "c2", approved: true },
      { type: "approve", callId: "c3", approved: true, always: true },
      { type: "newSessionRequest" },
      { type: "retry", sessionId: "s1" },
      { type: "requestConfig" },
      { type: "setModel", model: "gpt-5.6-sol" },
      { type: "addModel", model: "claude-sonnet-4-5" },
      { type: "removeModel", model: "m1" },
      { type: "requestSettings" },
      { type: "updateSettings", baseUrl: "https://x", maxTokens: 8192, autoApproveEdits: false, autoApproveTerminal: true },
      { type: "updateSettings", autoApproveEdits: false },
      { type: "setApiKey" },
      { type: "setEffort", effort: "high" },
      { type: "setMode", mode: "plan" },
      { type: "resetPermissions" },
      { type: "attachFiles" },
      { type: "setContextEnabled", enabled: false },
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
