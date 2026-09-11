## git log
85d0ddc feat: agent loop with tool round-trips and message queueing
939fd36 feat: JSONL session store

## diff stat

 src/host/agent.ts       | 79 ++++++++++++++++++++++++++++++++++++++++
 test/unit/agent.test.ts | 97 +++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 176 insertions(+)

## diff

diff --git a/src/host/agent.ts b/src/host/agent.ts
new file mode 100644
index 0000000..7fa0131
--- /dev/null
+++ b/src/host/agent.ts
@@ -0,0 +1,79 @@
+import type { Provider, AnthropicMessage } from "./provider";
+import { executeTool, TOOL_DEFS, type ToolContext } from "./tools";
+import type { SessionStore } from "./store";
+import type { SessionEvent } from "../shared/protocol";
+
+export interface AgentUi {
+  textDelta(t: string): void;
+  toolCall(callId: string, tool: string, input: Record<string, unknown>): void;
+  toolResult(callId: string, ok: boolean, output: string): void;
+  error(msg: string): void;
+  turnComplete(): void;
+}
+
+export class AgentSession {
+  private messages: AnthropicMessage[] = [];
+  private queue: string[] = [];
+  private running = false;
+
+  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi }) {}
+
+  get busy() { return this.running; }
+
+  send(text: string): void {
+    this.queue.push(text);
+    if (this.running) return;
+    this.running = true;          // set synchronously so busy is observable immediately
+    void this.drain();
+  }
+
+  private async drain(): Promise<void> {
+    try {
+      while (this.queue.length > 0) {
+        const text = this.queue.shift()!;
+        await this.runTurn(text);
+      }
+    } finally { this.running = false; }
+  }
+
+  private async runTurn(userText: string): Promise<void> {
+    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });
+    await this.opts.store.append(this.opts.sessionId, { kind: "user", text: userText, ts: Date.now() });
+
+    try {
+      for (let round = 0; round < 25; round++) {
+        const assistantMsgs = await this.opts.provider.streamTurn(this.messages, TOOL_DEFS, (e) => {
+          if (e.type === "textDelta") this.opts.ui.textDelta(e.text);
+          else if (e.type === "toolUse") this.opts.ui.toolCall(e.id, e.name, e.input);
+        });
+        this.messages.push(...assistantMsgs);
+        const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
+
+        for (const block of assistantMsg.content as any[]) {
+          if (block.type === "text") {
+            await this.opts.store.append(this.opts.sessionId, { kind: "assistantText", text: block.text, ts: Date.now() });
+          }
+        }
+
+        const toolUses = (assistantMsg.content as any[]).filter((b) => b.type === "tool_use");
+        if (toolUses.length === 0) { this.opts.ui.turnComplete(); return; }
+
+        const results: unknown[] = [];
+        for (const tu of toolUses) {
+          await this.opts.store.append(this.opts.sessionId, { kind: "toolCall", callId: tu.id, tool: tu.name, input: tu.input, ts: Date.now() });
+          const r = await executeTool(tu.name, tu.input, tu.id, this.opts.ctx);
+          this.opts.ui.toolResult(tu.id, r.ok, r.output);
+          await this.opts.store.append(this.opts.sessionId, { kind: "toolResult", callId: tu.id, ok: r.ok, output: r.output, ts: Date.now() });
+          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output, is_error: !r.ok });
+        }
+        this.messages.push({ role: "user", content: results });
+      }
+      this.opts.ui.error("Max tool rounds (25) reached.");
+      this.opts.ui.turnComplete();
+    } catch (e) {
+      const msg = e instanceof Error ? e.message : String(e);
+      this.opts.ui.error(msg);
+      await this.opts.store.append(this.opts.sessionId, { kind: "error", message: msg, ts: Date.now() });
+    }
+  }
+}
diff --git a/test/unit/agent.test.ts b/test/unit/agent.test.ts
new file mode 100644
index 0000000..e288985
--- /dev/null
+++ b/test/unit/agent.test.ts
@@ -0,0 +1,97 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
+import { AgentSession } from "../../src/host/agent";
+import type { Provider, AnthropicMessage } from "../../src/host/provider";
+import type { ToolContext } from "../../src/host/tools";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";
+
+function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
+  const calls: AnthropicMessage[][] = [];
+  return {
+    calls,
+    async streamTurn(messages, _tools, onEvent) {
+      calls.push(messages.map((m) => ({ ...m, content: [...m.content as any[]] })));
+      const turn = turns.shift()!;
+      for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
+      for (const tu of turn.toolUses ?? []) onEvent({ type: "toolUse", id: tu.id, name: tu.name, input: tu.input });
+      onEvent({ type: "endTurn" });
+      const content: any[] = [];
+      if (turn.text) content.push({ type: "text", text: turn.text });
+      for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
+      return [{ role: "assistant", content }];
+    },
+  };
+}
+
+function ctx(): ToolContext {
+  return {
+    readFile: async () => "content of a.txt",
+    listDir: async () => ["a.txt"],
+    applyEdit: vi.fn(async () => {}),
+    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
+    requestApproval: async () => true,
+    openDiff: vi.fn(async () => {}),
+    workspaceRoot: () => "C:/work/proj",
+  };
+}
+
+let dir: string;
+beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
+afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
+
+describe("AgentSession", () => {
+  it("runs a tool round-trip: tool_use ΓåÆ tool_result ΓåÆ final text", async () => {
+    const provider = scriptedProvider([
+      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
+      { text: "The file says: content of a.txt" },
+    ]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("read a.txt");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
+    expect(ui.toolCall).toHaveBeenCalledWith("c1", "read_file", { path: "a.txt" });
+    expect(ui.toolResult).toHaveBeenCalledWith("c1", true, "content of a.txt");
+    const secondCall = provider.calls[1];
+    expect(JSON.stringify(secondCall)).toContain('"type":"tool_result"');
+    expect(ui.textDelta).toHaveBeenCalledWith("The".slice(0, 3));
+  });
+
+  it("persists events to the session JSONL", async () => {
+    const provider = scriptedProvider([{ text: "ok" }]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const { id } = store.createSession();
+    const session = new AgentSession({ sessionId: id, provider, ctx: ctx(), store, ui });
+    session.send("hello");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
+    const events = await store.load(id);
+    expect(events[0]).toEqual({ kind: "user", text: "hello", ts: expect.any(Number) });
+    expect(events.some((e) => e.kind === "assistantText" && e.text === "ok")).toBe(true);
+  });
+
+  it("queues a second user message while the loop is running", async () => {
+    const provider = scriptedProvider([{ text: "one" }, { text: "two" }]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("first");
+    expect(session.busy).toBe(true);
+    session.send("second");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalledTimes(2));
+    expect(provider.calls.length).toBe(2);
+  });
+
+  it("surfaces provider errors via ui.error and unlocks", async () => {
+    const provider: Provider = {
+      async streamTurn() { throw new Error("boom"); },
+      setKey() {},
+    } as unknown as Provider;
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("hello");
+    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
+    expect(session.busy).toBe(false);
+  });
+});
