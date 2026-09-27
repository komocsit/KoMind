import { describe, it, expect, vi } from "vitest";
import {
    McpManager,
    McpToolProvider,
    mcpToolName,
    isMcpToolName,
    parseMcpToolName,
    mcpResultToText,
    expandEnvString,
    resolveServerEnv,
    type McpClientLike,
} from "../../src/host/mcp";
import { ToolRegistry, BuiltinToolProvider } from "../../src/host/toolRegistry";
import type { ToolContext } from "../../src/host/tools";

function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        readFile: vi.fn(async () => ""),
        listDir: vi.fn(async () => []),
        applyEdit: vi.fn(async () => ({ before: "", after: "" })),
        createFile: vi.fn(async () => { }),
        runTerminal: vi.fn(async () => ({ exitCode: 0 })),
        requestApproval: vi.fn(async () => true),
        workspaceRoot: () => "C:/work/proj",
        autoApproveEdits: true,
        autoApproveTerminal: true,
        ...overrides,
    };
}

/** A fake MCP client that records calls and returns scripted results. */
function fakeClient(tools: { name: string; description?: string; inputSchema?: unknown }[], onCall?: (name: string, args: unknown) => unknown): McpClientLike & { calls: { name: string; args: unknown }[]; closed: boolean } {
    const calls: { name: string; args: unknown }[] = [];
    const client = {
        calls,
        closed: false,
        async listTools() { return { tools }; },
        async callTool(params: { name: string; arguments?: Record<string, unknown> }) {
            calls.push({ name: params.name, args: params.arguments });
            return onCall ? onCall(params.name, params.arguments) : { content: [{ type: "text", text: `ran ${params.name}` }] };
        },
        async close() { this.closed = true; },
    };
    return client;
}

describe("MCP tool name helpers", () => {
    it("round-trips server/tool through the namespaced name", () => {
        const name = mcpToolName("github", "create_issue");
        expect(isMcpToolName(name)).toBe(true);
        expect(parseMcpToolName(name)).toEqual({ server: "github", tool: "create_issue" });
    });
    it("returns undefined for non-MCP names", () => {
        expect(isMcpToolName("read_file")).toBe(false);
        expect(parseMcpToolName("read_file")).toBeUndefined();
    });
    it("handles tool names that themselves contain the separator", () => {
        const name = mcpToolName("srv", "a__b");
        expect(parseMcpToolName(name)).toEqual({ server: "srv", tool: "a__b" });
    });
});

describe("mcpResultToText", () => {
    it("joins text blocks", () => {
        const r = mcpResultToText({ content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] });
        expect(r).toEqual({ ok: true, text: "hello\nworld" });
    });
    it("marks isError results as not ok", () => {
        const r = mcpResultToText({ isError: true, content: [{ type: "text", text: "boom" }] });
        expect(r.ok).toBe(false);
        expect(r.text).toBe("boom");
    });
    it("summarizes non-text blocks", () => {
        const r = mcpResultToText({ content: [{ type: "image", mimeType: "image/png" }] });
        expect(r.text).toContain("image");
    });
    it("falls back to structuredContent when there are no blocks", () => {
        const r = mcpResultToText({ content: [], structuredContent: { a: 1 } });
        expect(r.text).toBe('{"a":1}');
    });
});

describe("McpManager", () => {
    it("connects a server and exposes its tools as a provider", async () => {
        const client = fakeClient([{ name: "search", description: "Search things" }]);
        const mgr = new McpManager(async () => client);
        const { result, provider } = await mgr.connect("docs", { url: "https://x" });
        expect(result).toEqual({ name: "docs", ok: true, toolCount: 1 });
        expect(provider).toBeInstanceOf(McpToolProvider);
        const names = provider!.listTools().map((t) => t.name);
        expect(names).toEqual([mcpToolName("docs", "search")]);
    });

    it("reports a failed connection without throwing", async () => {
        const mgr = new McpManager(async () => { throw new Error("spawn failed"); });
        const { result, provider } = await mgr.connect("bad", { command: "nope" });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("spawn failed");
        expect(provider).toBeUndefined();
    });

    it("skips a disabled server", async () => {
        const mgr = new McpManager(async () => fakeClient([]));
        const { result } = await mgr.connect("off", { url: "https://x", enabled: false });
        expect(result.ok).toBe(false);
        expect(result.error).toBe("disabled");
    });

    it("disconnect closes the client", async () => {
        const client = fakeClient([{ name: "t" }]);
        const mgr = new McpManager(async () => client);
        await mgr.connect("s", { url: "https://x" });
        expect(mgr.connectedNames()).toEqual(["s"]);
        await mgr.disconnect("s");
        expect(client.closed).toBe(true);
        expect(mgr.connectedNames()).toEqual([]);
    });
});

describe("McpToolProvider.execute", () => {
    it("requests approval, calls the tool, and returns its text", async () => {
        const client = fakeClient([{ name: "search" }]);
        const mgr = new McpManager(async () => client);
        const { provider } = await mgr.connect("docs", { url: "https://x" });
        const ctx = mockCtx();
        const r = await provider!.execute(mcpToolName("docs", "search"), { q: "hi" }, "c1", ctx);
        expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
        // MCP tools pass their namespaced name as the tool id so approvals can gate them
        expect((ctx.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(mcpToolName("docs", "search"));
        expect(client.calls).toEqual([{ name: "search", args: { q: "hi" } }]);
        expect(r).toEqual({ ok: true, output: "ran search" });
    });

    it("does not call the tool when approval is rejected", async () => {
        const client = fakeClient([{ name: "search" }]);
        const mgr = new McpManager(async () => client);
        const { provider } = await mgr.connect("docs", { url: "https://x" });
        const ctx = mockCtx({ requestApproval: vi.fn(async () => false) });
        const r = await provider!.execute(mcpToolName("docs", "search"), {}, "c1", ctx);
        expect(client.calls).toEqual([]);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("rejected");
    });

    it("surfaces a callTool error as a failed result", async () => {
        const client = fakeClient([{ name: "search" }], () => { throw new Error("upstream"); });
        const mgr = new McpManager(async () => client);
        const { provider } = await mgr.connect("docs", { url: "https://x" });
        const r = await provider!.execute(mcpToolName("docs", "search"), {}, "c1", mockCtx());
        expect(r.ok).toBe(false);
        expect(r.output).toContain("upstream");
    });

    it("propagates an isError tool result", async () => {
        const client = fakeClient([{ name: "search" }], () => ({ isError: true, content: [{ type: "text", text: "bad query" }] }));
        const mgr = new McpManager(async () => client);
        const { provider } = await mgr.connect("docs", { url: "https://x" });
        const r = await provider!.execute(mcpToolName("docs", "search"), {}, "c1", mockCtx());
        expect(r.ok).toBe(false);
        expect(r.output).toBe("bad query");
    });
});

describe("expandEnvString", () => {
    const src = { TOKEN: "abc123", USER: "alice", EMPTY: "" } as NodeJS.ProcessEnv;
    it("expands ${VAR} form", () => {
        expect(expandEnvString("${TOKEN}", src)).toBe("abc123");
        expect(expandEnvString("Bearer ${TOKEN}", src)).toBe("Bearer abc123");
    });
    it("expands $VAR form", () => {
        expect(expandEnvString("$USER", src)).toBe("alice");
        expect(expandEnvString("$USER/$TOKEN", src)).toBe("alice/abc123");
    });
    it("expands unknown vars to empty string", () => {
        expect(expandEnvString("${MISSING}", src)).toBe("");
        expect(expandEnvString("x${MISSING}y", src)).toBe("xy");
    });
    it("leaves escaped placeholders literal", () => {
        expect(expandEnvString("\\${TOKEN}", src)).toBe("${TOKEN}");
        expect(expandEnvString("\\$TOKEN", src)).toBe("$TOKEN");
    });
    it("returns non-placeholder strings unchanged", () => {
        expect(expandEnvString("plain value", src)).toBe("plain value");
    });
});

describe("resolveServerEnv", () => {
    const parent = { PATH: "/usr/bin", MY_TOKEN: "secret-pat" } as NodeJS.ProcessEnv;
    it("inherits the parent environment", () => {
        const env = resolveServerEnv(undefined, parent);
        expect(env.PATH).toBe("/usr/bin");
        expect(env.MY_TOKEN).toBe("secret-pat");
    });
    it("expands ${VAR} placeholders in configured values against the parent env", () => {
        const env = resolveServerEnv({ PERSONAL_ACCESS_TOKEN: "${MY_TOKEN}" }, parent);
        expect(env.PERSONAL_ACCESS_TOKEN).toBe("secret-pat");
    });
    it("lets configured values override inherited ones", () => {
        const env = resolveServerEnv({ PATH: "/custom" }, parent);
        expect(env.PATH).toBe("/custom");
    });
    it("keeps a literal value when no placeholder is present", () => {
        const env = resolveServerEnv({ FOO: "bar" }, parent);
        expect(env.FOO).toBe("bar");
    });
});

describe("MCP + ToolRegistry integration", () => {
    it("registers MCP tools alongside built-ins and dispatches to them", async () => {
        const client = fakeClient([{ name: "search" }]);
        const mgr = new McpManager(async () => client);
        const { provider } = await mgr.connect("docs", { url: "https://x" });
        const registry = new ToolRegistry([new BuiltinToolProvider()]);
        registry.addProvider(provider!);

        const names = registry.listTools().map((t) => t.name);
        expect(names).toContain("read_file");
        expect(names).toContain(mcpToolName("docs", "search"));

        const r = await registry.execute(mcpToolName("docs", "search"), { q: "x" }, "c1", mockCtx());
        expect(r).toEqual({ ok: true, output: "ran search" });
    });
});
