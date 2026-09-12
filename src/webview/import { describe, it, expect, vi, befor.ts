import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSession, messagesFromEvents } from "../../src/host/agent";
import type { Provider, AnthropicMessage } from "../../src/host/provider";
import type { ToolContext } from "../../src/host/tools";
import { SessionStore } from "../../src/host/store";
import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";

function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
  const calls: AnthropicMessage[][] = [];
  return {
    calls,
    setKey() { },
    setModel() { },
    setEffort() { },
    setBaseUrl() { },
    setMaxTokens() { },
    async listModels() { return []; },
    async streamTurn(messages, _tools, onEvent) {
      calls.push(messages.map((m) => ({ ...m, content: [...m.content as any[]] })));
      const turn = turns.shift()!;
      for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
      for (const tu of turn.toolUses ?? []) onEvent({ type: "toolUse", id: tu.id, name: tu.name, input: tu.input });
      onEvent({ type: "endTurn" });
      const content: any[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      return [{ role: "assistant", content }];
    },
  };
}

function ctx(): ToolContext {
  return {
    readFile: async () => "content of a.txt",
    listDir: async () => ["a.txt"],
    applyEdit: vi.fn(async () => { }),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: async () => true,
    workspaceRoot: () => "C:/work/proj",
    autoApproveEdits: true,
    autoApproveTerminal: false,
  };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("AgentSession", () => {
  it("runs a tool round-trip: tool_use → tool_result → final text", async () => {
    const provider = scriptedProvider([
      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
      { text: "The file says: content of a.txt" },
    ]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("read a.txt");
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
    expect(ui.toolCall).toHaveBeenCalledWith("c1", "read_file", { path: "a.txt" });
    expect(ui.toolResult).toHaveBeenCalledWith("c1", true, "content of a.txt");
    const secondCall = provider.calls[1];
    expect(JSON.stringify(secondCall)).toContain('"type":"tool_result"');
    expect(ui.textDelta).toHaveBeenCalledWith("The".slice(0, 3));
  });

  it("sends pasted images as Anthropic base64 image blocks and persists them", async () => {
    const provider = scriptedProvider([{ text: "a diagram" }]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const { id } = store.createSession();
    const session = new AgentSession({ sessionId: id, provider, ctx: ctx(), store, ui });
    const image = { name: "pasted-image.png", mediaType: "image/png" as const, data: "aW1hZ2U=" };
    session.send("describe this", undefined, [image]);
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());

    expect(provider.calls[0][0]).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
        { type: "text", text: "describe this" },
      ],
    });
    const events = await store.load(id);
    expect(events[0]).toMatchObject({ kind: "user", text: "describe this", images: [image] });
  });

  it("persists events to the session JSONL", async () => {
    const provider = scriptedProvider([{ text: "ok" }]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const { id } = store.createSession();
    const session = new AgentSession({ sessionId: id, provider, ctx: ctx(), store, ui });
    session.send("hello");
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
    const events = await store.load(id);
    expect(events[0]).toEqual({ kind: "user", text: "hello", ts: expect.any(Number) });
    expect(events.some((e) => e.kind === "assistantText" && e.text === "ok")).toBe(true);
  });

  it("queues a second user message while the loop is running", async () => {
    const provider = scriptedProvider([{ text: "one" }, { text: "two" }]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("first");
    expect(session.busy).toBe(true);
    session.send("second");
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalledTimes(2));
    expect(provider.calls.length).toBe(2);
  });

  it("surfaces provider errors via ui.error and unlocks", async () => {
    const provider: Provider = {
      async streamTurn() { throw new Error("boom"); },
      setKey() { },
    } as unknown as Provider;
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("hello");
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
    expect(session.busy).toBe(false);
  });

  it("seeds message history from persisted events so resume keeps model context", async () => {
    // session 1: user → tool round-trip → assistant text
    const provider1 = scriptedProvider([
      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
      { text: "The file says: content of a.txt" },
    ]);
    const ui1 = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const { id } = store.createSession();
    const s1 = new AgentSession({ sessionId: id, provider: provider1, ctx: ctx(), store, ui: ui1 });
    s1.send("read a.txt");
    await vi.waitFor(() => expect(ui1.turnComplete).toHaveBeenCalled());

    // resume: new session seeded from the persisted JSONL events
    const events = await store.load(id);
    const provider2 = scriptedProvider([{ text: "resumed" }]);
    const ui2 = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const s2 = new AgentSession({ sessionId: id, provider: provider2, ctx: ctx(), store, ui: ui2, initialMessages: messagesFromEvents(events) });
    s2.send("continue");
    await vi.waitFor(() => expect(ui2.turnComplete).toHaveBeenCalled());

    // first provider call of the resumed session must contain the full prior conversation
    const firstCall = provider2.calls[0];
    const json = JSON.stringify(firstCall);
    expect(json).toContain('"role":"user"');
    expect(json).toContain("read a.txt");
    expect(json).toContain('"type":"tool_use"');
    expect(json).toContain('"tool_use_id":"c1"');
    expect(json).toContain("The file says: content of a.txt");
    expect(json).toContain("continue");
    // the last seeded message before "continue" must be the assistant text
    const beforeNew = firstCall.slice(0, -1);
    expect(beforeNew[beforeNew.length - 1].role).toBe("assistant");
  });

  it("messagesFromEvents reconstructs user/assistant/tool blocks in order", () => {
    const msgs = messagesFromEvents([
      { kind: "user", text: "hi", ts: 1 },
      { kind: "assistantText", text: "let me check", ts: 2 },
      { kind: "toolCall", callId: "t1", tool: "read_file", input: { path: "a.txt" }, ts: 3 },
      { kind: "toolResult", callId: "t1", ok: true, output: "content", ts: 4 },
      { kind: "assistantText", text: "done", ts: 5 },
      { kind: "error", message: "ignored", ts: 6 },
    ]);
    expect(msgs).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "let me check" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.txt" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "content", is_error: false }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });
});
