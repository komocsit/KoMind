import { describe, it, expect, vi } from "vitest";
import { runSubagent, runSubagents } from "../../src/host/subagent";
import type { Provider } from "../../src/host/provider";
import type { ToolContext } from "../../src/host/tools";

function scriptedProvider(turnsByCall: Record<string, { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]>): Provider {
    return {
        setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
        async listModels() { return []; },
        async streamTurn(messages, _tools, onEvent) {
            // Route by the first user prompt so parallel sub-agents get their own scripts.
            const firstUser = messages.find((m) => m.role === "user");
            const promptText = ((firstUser?.content as any[]) ?? []).map((b) => b.text ?? "").join("");
            const key = Object.keys(turnsByCall).find((k) => promptText.includes(k)) ?? Object.keys(turnsByCall)[0];
            const turn = turnsByCall[key].shift()!;
            for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
            onEvent({ type: "endTurn" });
            const content: any[] = [];
            if (turn.text) content.push({ type: "text", text: turn.text });
            for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
            return [{ role: "assistant", content }];
        },
    };
}

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        readFile: async () => "file body",
        listDir: async () => ["a.txt"],
        findFiles: async () => [],
        applyEdit: vi.fn(async () => ({ before: "", after: "" })),
    createFile: vi.fn(async () => { }),
        runTerminal: vi.fn(async () => ({ exitCode: 0 })),
        requestApproval: async () => true,
        workspaceRoot: () => "C:/work/proj",
        autoApproveEdits: true,
        autoApproveTerminal: true,
        ...overrides,
    };
}

describe("runSubagent", () => {
    it("returns the final assistant text when the sub-agent produces no tool calls", async () => {
        const provider = scriptedProvider({ "task A": [{ text: "done with A" }] });
        const result = await runSubagent({ name: "A", prompt: "task A" }, { provider, ctx: ctx() });
        expect(result).toEqual({ name: "A", ok: true, output: "done with A" });
    });

    it("runs a tool round-trip inside the sub-agent", async () => {
        const provider = scriptedProvider({
            "read it": [
                { toolUses: [{ id: "s1", name: "read_file", input: { path: "a.txt" } }] },
                { text: "the file said file body" },
            ],
        });
        const readFile = vi.fn(async () => "file body");
        const result = await runSubagent({ name: "reader", prompt: "read it" }, { provider, ctx: ctx({ readFile }) });
        expect(readFile).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.output).toContain("the file said file body");
    });

    it("never exposes the run_subagents tool to a sub-agent", async () => {
        let seenTools: string[] = [];
        const provider: Provider = {
            setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
            async listModels() { return []; },
            async streamTurn(_messages, tools, onEvent) {
                seenTools = tools.map((t) => t.name);
                onEvent({ type: "endTurn" });
                return [{ role: "assistant", content: [{ type: "text", text: "ok" }] }];
            },
        };
        await runSubagent({ name: "x", prompt: "p" }, { provider, ctx: ctx() });
        expect(seenTools).not.toContain("run_subagents");
    });

    it("surfaces provider errors as a failed result rather than throwing", async () => {
        const provider: Provider = {
            setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
            async listModels() { return []; },
            async streamTurn() { throw new Error("upstream boom"); },
        };
        const result = await runSubagent({ name: "y", prompt: "p" }, { provider, ctx: ctx() });
        expect(result.ok).toBe(false);
        expect(result.output).toContain("upstream boom");
    });

    it("respects allowedTools restrictions (plan mode)", async () => {
        let seenTools: string[] = [];
        const provider: Provider = {
            setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
            async listModels() { return []; },
            async streamTurn(_messages, tools, onEvent) {
                seenTools = tools.map((t) => t.name);
                onEvent({ type: "endTurn" });
                return [{ role: "assistant", content: [{ type: "text", text: "ok" }] }];
            },
        };
        await runSubagent({ name: "x", prompt: "p" }, { provider, ctx: ctx(), allowedTools: ["read_file", "list_dir"] });
        expect(seenTools).toEqual(["read_file", "list_dir"]);
    });
});

describe("sub-agent task types", () => {
    function capturingProvider(seen: { tools: string[]; system?: string }): Provider {
        return {
            setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
            async listModels() { return []; },
            async streamTurn(_messages, tools, onEvent, _signal, system) {
                seen.tools = tools.map((t) => t.name);
                seen.system = system;
                onEvent({ type: "endTurn" });
                return [{ role: "assistant", content: [{ type: "text", text: "ok" }] }];
            },
        };
    }

    it("explore agents are read-only and get their own instructions plus the shared system prompt", async () => {
        const seen: { tools: string[]; system?: string } = { tools: [] };
        await runSubagent({ name: "x", prompt: "p", type: "explore" }, { provider: capturingProvider(seen), ctx: ctx(), system: "SKILLS INDEX" });
        expect(seen.tools).toEqual(["read_file", "list_dir", "find_files", "search_code", "load_skill"]);
        expect(seen.system).toContain("exploration sub-agent");
        expect(seen.system).toContain("SKILLS INDEX");
    });

    it("test agents can run the terminal but not edit", async () => {
        const seen: { tools: string[]; system?: string } = { tools: [] };
        await runSubagent({ name: "x", prompt: "p", type: "test" }, { provider: capturingProvider(seen), ctx: ctx() });
        expect(seen.tools).toContain("run_terminal");
        expect(seen.tools).not.toContain("apply_edit");
    });

    it("preloads an assigned skill's instructions into the system prompt", async () => {
        const seen: { tools: string[]; system?: string } = { tools: [] };
        const loadSkill = (n: string) => (n === "react-style" ? "USE HOOKS ONLY" : undefined);
        await runSubagent({ name: "x", prompt: "p", type: "general", skill: "react-style" }, { provider: capturingProvider(seen), ctx: ctx({ loadSkill }) });
        expect(seen.system).toContain("USE HOOKS ONLY");
        expect(seen.system).toContain('"react-style" skill');
    });

    it("docs agents can edit files but not run the terminal", async () => {
        const seen: { tools: string[]; system?: string } = { tools: [] };
        await runSubagent({ name: "x", prompt: "p", type: "docs" }, { provider: capturingProvider(seen), ctx: ctx() });
        expect(seen.tools).toContain("apply_edit");
        expect(seen.tools).not.toContain("run_terminal");
    });

    it("type tools are intersected with mode restrictions", async () => {
        const seen: { tools: string[]; system?: string } = { tools: [] };
        await runSubagent({ name: "x", prompt: "p", type: "test" }, { provider: capturingProvider(seen), ctx: ctx(), allowedTools: ["read_file", "list_dir"] });
        expect(seen.tools).toEqual(["read_file", "list_dir"]);
    });
});

describe("runSubagents", () => {
    it("runs several sub-agents concurrently and preserves order", async () => {
        const provider = scriptedProvider({
            "job one": [{ text: "one done" }],
            "job two": [{ text: "two done" }],
        });
        const results = await runSubagents(
            [{ name: "first", prompt: "job one" }, { name: "second", prompt: "job two" }],
            { provider, ctx: ctx() }
        );
        expect(results.map((r) => r.name)).toEqual(["first", "second"]);
        expect(results[0].output).toContain("one done");
        expect(results[1].output).toContain("two done");
    });

    it("reports live status: all running first, then done per agent", async () => {
        const provider = scriptedProvider({ "ok job": [{ text: "fine" }, { text: "fine" }] });
        const snapshots: { name: string; status: string }[][] = [];
        await runSubagents(
            [{ name: "alpha", prompt: "ok job" }, { name: "beta", prompt: "ok job" }],
            { provider, ctx: ctx(), onStatus: (agents) => snapshots.push(agents.map((a) => ({ name: a.name, status: a.status }))) }
        );
        expect(snapshots[0]).toEqual([
            { name: "alpha", status: "running" },
            { name: "beta", status: "running" },
        ]);
        expect(snapshots[snapshots.length - 1]).toEqual([
            { name: "alpha", status: "done" },
            { name: "beta", status: "done" },
        ]);
    });

    it("marks a failed sub-agent as failed in the status snapshot", async () => {
        const provider: Provider = {
            setKey() { }, setModel() { }, setEffort() { }, setBaseUrl() { }, setMaxTokens() { },
            async listModels() { return []; },
            async streamTurn() { throw new Error("boom"); },
        };
        let last: { name: string; status: string }[] = [];
        await runSubagents(
            [{ name: "solo", prompt: "p" }],
            { provider, ctx: ctx(), onStatus: (agents) => { last = agents.map((a) => ({ name: a.name, status: a.status })); } }
        );
        expect(last).toEqual([{ name: "solo", status: "failed" }]);
    });
});