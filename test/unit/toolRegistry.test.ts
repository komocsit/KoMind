import { describe, it, expect, vi } from "vitest";
import { ToolRegistry, BuiltinToolProvider, type ToolProvider } from "../../src/host/toolRegistry";
import type { ToolContext, ToolDef } from "../../src/host/tools";

function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        readFile: vi.fn(async () => "file contents"),
        listDir: vi.fn(async () => ["a.txt"]),
        findFiles: async () => [],
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

/** A tiny stub provider for exercising registry composition. */
function stubProvider(id: string, defs: ToolDef[], run?: (name: string) => string): ToolProvider {
    return {
        id,
        listTools: () => defs,
        execute: async (name) => ({ ok: true, output: run ? run(name) : `${id}:${name}` }),
    };
}

describe("ToolRegistry", () => {
    it("defaults to the built-in tool provider", () => {
        const reg = new ToolRegistry();
        const names = reg.listTools().map((t) => t.name);
        expect(names).toEqual(["read_file", "list_dir", "find_files", "search_code", "apply_edit", "create_file", "run_terminal", "run_subagents", "load_skill"]);
    });

    it("filters tools by the allowed list (plan mode)", () => {
        const reg = new ToolRegistry();
        const names = reg.listTools(["read_file", "list_dir"]).map((t) => t.name);
        expect(names).toEqual(["read_file", "list_dir"]);
    });

    it("returns no tools when the allowed list is empty", () => {
        const reg = new ToolRegistry();
        expect(reg.listTools([])).toEqual([]);
    });

    it("dispatches built-in tool calls to the built-in provider", async () => {
        const reg = new ToolRegistry();
        const r = await reg.execute("read_file", { path: "a.txt" }, "c1", mockCtx());
        expect(r).toEqual({ ok: true, output: "file contents" });
    });

    it("returns an error result for an unknown tool", async () => {
        const reg = new ToolRegistry();
        const r = await reg.execute("does_not_exist", {}, "c1", mockCtx());
        expect(r.ok).toBe(false);
        expect(r.output).toContain("Unknown tool");
    });

    it("merges tools from multiple providers", () => {
        const reg = new ToolRegistry([
            new BuiltinToolProvider(),
            stubProvider("ext", [{ name: "ext_tool", description: "d", schema: { type: "object" } }]),
        ]);
        const names = reg.listTools().map((t) => t.name);
        expect(names).toContain("read_file");
        expect(names).toContain("ext_tool");
    });

    it("dispatches to the owning provider by tool name", async () => {
        const reg = new ToolRegistry([
            new BuiltinToolProvider(),
            stubProvider("ext", [{ name: "ext_tool", description: "d", schema: { type: "object" } }], () => "ran ext"),
        ]);
        const r = await reg.execute("ext_tool", {}, "c1", mockCtx());
        expect(r).toEqual({ ok: true, output: "ran ext" });
    });

    it("first provider wins when two providers claim the same tool name", async () => {
        const reg = new ToolRegistry([
            stubProvider("first", [{ name: "dup", description: "d", schema: { type: "object" } }], () => "from first"),
            stubProvider("second", [{ name: "dup", description: "d", schema: { type: "object" } }], () => "from second"),
        ]);
        // listed once only
        expect(reg.listTools().filter((t) => t.name === "dup")).toHaveLength(1);
        const r = await reg.execute("dup", {}, "c1", mockCtx());
        expect(r.output).toBe("from first");
    });

    it("addProvider exposes new tools at runtime", () => {
        const reg = new ToolRegistry();
        reg.addProvider(stubProvider("late", [{ name: "late_tool", description: "d", schema: { type: "object" } }]));
        expect(reg.listTools().map((t) => t.name)).toContain("late_tool");
    });

    it("addProvider rejects a duplicate provider id", () => {
        const reg = new ToolRegistry();
        expect(() => reg.addProvider(new BuiltinToolProvider())).toThrow(/already registered/);
    });

    it("removeProvider drops its tools", () => {
        const reg = new ToolRegistry();
        reg.addProvider(stubProvider("temp", [{ name: "temp_tool", description: "d", schema: { type: "object" } }]));
        expect(reg.listTools().map((t) => t.name)).toContain("temp_tool");
        reg.removeProvider("temp");
        expect(reg.listTools().map((t) => t.name)).not.toContain("temp_tool");
    });
});
