# Task 3: Tool executors (read_file, list_dir, apply_edit, run_terminal) — pure logic, mock vscode

**Files:**
- Create: `src/host/tools.ts`
- Test: `test/unit/tools.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ToolContext {
  readFile(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  applyEdit(path: string, oldString: string, newString: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string): Promise<boolean>;
  openDiff(path: string): Promise<void>;
  workspaceRoot(): string | undefined;
}
export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }
export const TOOL_DEFS: ToolDef[];
export function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }>;
export function resolvePath(workspaceRoot: string | undefined, path: string): string; // also exported for tests
```

- [ ] **Step 1: Write failing tests**

`test/unit/tools.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { executeTool, resolvePath, TOOL_DEFS } from "../../src/host/tools";
import type { ToolContext } from "../../src/host/tools";
import path from "path";

function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    readFile: vi.fn(async () => "file contents"),
    listDir: vi.fn(async () => ["a.txt", "b/"]),
    applyEdit: vi.fn(async () => {}),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: vi.fn(async () => true),
    openDiff: vi.fn(async () => {}),
    workspaceRoot: () => "C:/work/proj",
    ...overrides,
  };
}

describe("resolvePath", () => {
  it("rejects paths escaping the workspace", () => {
    expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
    expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
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
  it("run_terminal calls requestApproval and runs when approved", async () => {
    const ctx = mockCtx();
    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
    expect(ctx.requestApproval).toHaveBeenCalledWith("npm test", "c1");
    expect(ctx.runTerminal).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("run_terminal does not run when rejected", async () => {
    const ctx = mockCtx({ requestApproval: async () => false });
    const r = await executeTool("run_terminal", { command: "rm -rf /" }, "c1", ctx);
    expect(ctx.runTerminal).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it("exposes 4 tool defs for the API", () => {
    expect(TOOL_DEFS.map((d) => d.name)).toEqual(["read_file", "list_dir", "apply_edit", "run_terminal"]);
  });
});
```

Note: the Windows path test uses "C:/work/proj" with forward slashes — `path.resolve` handles this on Windows. On any platform quirk, keep the test semantics (rejection of escaping paths, acceptance of inside paths).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/tools.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/host/tools.ts`**

```ts
import * as path from "path";
import type { ToolName } from "../shared/protocol";

export interface ToolContext {
  readFile(p: string): Promise<string>;
  listDir(p: string): Promise<string[]>;
  applyEdit(p: string, oldString: string, newString: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string): Promise<boolean>;
  openDiff(p: string): Promise<void>;
  workspaceRoot(): string | undefined;
}

export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }

export const TOOL_DEFS: ToolDef[] = [
  { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
  { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "apply_edit", description: "Replace an exact string in a file. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
  { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
];

export function resolvePath(workspaceRoot: string | undefined, rel: string): string {
  if (!workspaceRoot) throw new Error("No workspace folder open.");
  const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel);
  const normRoot = path.resolve(workspaceRoot);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return abs;
}

export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }> {
  try {
    switch (name as ToolName) {
      case "read_file": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
        return { ok: true, output: await ctx.readFile(p) };
      }
      case "list_dir": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? "."));
        const entries = await ctx.listDir(p);
        return { ok: true, output: entries.join("\n") };
      }
      case "apply_edit": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
        const oldString = String(input.oldString ?? "");
        const newString = String(input.newString ?? "");
        if (!oldString) return { ok: false, output: "apply_edit error: oldString must be non-empty." };
        await ctx.applyEdit(p, oldString, newString);
        await ctx.openDiff(p);
        return { ok: true, output: `Edited ${input.path}` };
      }
      case "run_terminal": {
        const command = String(input.command ?? "");
        if (!command) return { ok: false, output: "run_terminal error: command required." };
        const approved = await ctx.requestApproval(command, callId);
        if (!approved) return { ok: false, output: "User rejected this command." };
        const cwd = input.cwd ? resolvePath(ctx.workspaceRoot(), String(input.cwd)) : undefined;
        let output = "";
        const { exitCode } = await ctx.runTerminal(command, cwd, (chunk) => { output += chunk; });
        return { ok: exitCode === 0, output: output.slice(-8000) || `(exit code ${exitCode})` };
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/tools.test.ts` — Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit** — `git add src/host/tools.ts test/unit/tools.test.ts; git commit -m "feat: tool executors with workspace path confinement"`

(Use explicit file adds, NOT `git add -A`, to avoid sweeping planning docs into the commit.)
