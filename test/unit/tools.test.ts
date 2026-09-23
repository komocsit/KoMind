import { describe, it, expect, vi } from "vitest";
import { executeTool, resolvePath, TOOL_DEFS } from "../../src/host/tools";
import type { ToolContext } from "../../src/host/tools";
import path from "path";

function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    readFile: vi.fn(async () => "file contents"),
    listDir: vi.fn(async () => ["a.txt", "b/"]),
    applyEdit: vi.fn(async () => { }),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: vi.fn(async () => true),
    workspaceRoot: () => "C:/work/proj",
    autoApproveEdits: true,
    autoApproveTerminal: false,
    ...overrides,
  };
}

describe("resolvePath", () => {
  it("rejects paths escaping the workspace", () => {
    expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
    expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
  });
  it("rejects absolute paths with traversal escaping the workspace", () => {
    expect(() => resolvePath("C:/work/proj", "C:/work/proj/../evil.txt")).toThrow();
  });
  it("accepts relative paths inside workspace", () => {
    expect(resolvePath("C:/work/proj", "src/a.ts")).toBe(path.resolve("C:/work/proj", "src/a.ts"));
  });
});

describe("executeTool", () => {
  it("read_file returns contents", async () => {
    const r = await executeTool("read_file", { path: "a.txt" }, "c1", mockCtx());
    expect(r).toEqual({ ok: true, output: "file contents" });
  });
  it("returns error result for unknown file (model self-corrects)", async () => {
    const ctx = mockCtx({ readFile: async () => { throw new Error("ENOENT"); } });
    const r = await executeTool("read_file", { path: "nope" }, "c1", ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("ENOENT");
  });
  it("apply_edit requires oldString to be a non-empty string", async () => {
    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "", newString: "x" }, "c1", mockCtx());
    expect(r.ok).toBe(false);
  });
  it("apply_edit auto-applies and reports that the file was saved when autoApproveEdits is true", async () => {
    const ctx = mockCtx();
    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old", newString: "new" }, "c1", ctx);
    expect(ctx.requestApproval).not.toHaveBeenCalled();
    expect(ctx.applyEdit).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, output: "Edited and saved a.txt" });
  });
  it("apply_edit routes through approval when autoApproveEdits is false", async () => {
    const ctx = mockCtx({ autoApproveEdits: false });
    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old text here", newString: "new text here" }, "c1", ctx);
    expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
    expect(String((ctx.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("a.txt");
    expect(String((ctx.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("old text here");
    expect(ctx.applyEdit).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("apply_edit does not apply when approval is rejected", async () => {
    const ctx = mockCtx({ autoApproveEdits: false, requestApproval: async () => false });
    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old", newString: "new" }, "c1", ctx);
    expect(ctx.applyEdit).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it("run_terminal skips approval when autoApproveTerminal is true", async () => {
    const ctx = mockCtx({ autoApproveTerminal: true });
    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
    expect(ctx.requestApproval).not.toHaveBeenCalled();
    expect(ctx.runTerminal).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("run_terminal calls requestApproval and runs when approved", async () => {
    const ctx = mockCtx();
    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
    expect(ctx.requestApproval).toHaveBeenCalledWith("npm test", "c1", "run_terminal");
    expect(ctx.runTerminal).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("run_terminal does not run when rejected", async () => {
    const ctx = mockCtx({ requestApproval: async () => false });
    const r = await executeTool("run_terminal", { command: "rm -rf /" }, "c1", ctx);
    expect(ctx.runTerminal).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it("exposes the tool defs for the API", () => {
    expect(TOOL_DEFS.map((d) => d.name)).toEqual(["read_file", "list_dir", "apply_edit", "run_terminal", "run_subagents"]);
  });

  it("run_subagents reports when sub-agents are unavailable", async () => {
    const r = await executeTool("run_subagents", { tasks: [{ name: "a", prompt: "do x" }] }, "c1", mockCtx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("not available");
  });

  it("run_subagents rejects an empty task list", async () => {
    const runSubagents = vi.fn(async () => []);
    const r = await executeTool("run_subagents", { tasks: [] }, "c1", mockCtx({ runSubagents }));
    expect(runSubagents).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it("run_subagents runs tasks and aggregates their results", async () => {
    const runSubagents = vi.fn(async (tasks: { name: string; prompt: string }[]) =>
      tasks.map((t) => ({ name: t.name, ok: true, output: `result for ${t.name}` })));
    const ctx = mockCtx({ runSubagents });
    const r = await executeTool("run_subagents", { tasks: [{ name: "alpha", prompt: "p1" }, { name: "beta", prompt: "p2" }] }, "c1", ctx);
    expect(runSubagents).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Sub-agent: alpha");
    expect(r.output).toContain("result for alpha");
    expect(r.output).toContain("Sub-agent: beta");
  });

  it("run_subagents reports failure when any sub-agent fails", async () => {
    const runSubagents = vi.fn(async () => [
      { name: "alpha", ok: true, output: "ok" },
      { name: "beta", ok: false, output: "boom" },
    ]);
    const r = await executeTool("run_subagents", { tasks: [{ name: "alpha", prompt: "p1" }, { name: "beta", prompt: "p2" }] }, "c1", mockCtx({ runSubagents }));
    expect(r.ok).toBe(false);
    expect(r.output).toContain("(failed)");
  });

  it("run_subagents caps the number of concurrent sub-agents", async () => {
    const runSubagents = vi.fn(async () => []);
    const tasks = Array.from({ length: 7 }, (_, i) => ({ name: `a${i}`, prompt: "p" }));
    const r = await executeTool("run_subagents", { tasks }, "c1", mockCtx({ runSubagents }));
    expect(runSubagents).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("at most");
  });
});
