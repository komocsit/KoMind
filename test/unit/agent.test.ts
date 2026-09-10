import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSession } from "../../src/host/agent";
import type { Provider, AnthropicMessage } from "../../src/host/provider";
import type { ToolContext } from "../../src/host/tools";
import { SessionStore } from "../../src/host/store";
import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";

function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
  const calls: AnthropicMessage[][] = [];
  return {
    calls,
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
    applyEdit: vi.fn(async () => {}),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: async () => true,
    openDiff: vi.fn(async () => {}),
    workspaceRoot: () => "C:/work/proj",
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
      setKey() {},
    } as unknown as Provider;
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(dir);
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("hello");
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
    expect(session.busy).toBe(false);
  });
});
