import * as path from "path";
import type { ToolName, EditInfo, DiffLine } from "../shared/protocol";

export interface SubagentTaskInput { name: string; prompt: string; }
export interface SubagentRunResult { name: string; ok: boolean; output: string; }
export interface SubagentStatusInput { name: string; status: "running" | "done" | "failed"; }

export interface ToolContext {
  readFile(p: string): Promise<string>;
  listDir(p: string): Promise<string[]>;
  applyEdit(p: string, oldString: string, newString: string): Promise<{ before: string; after: string }>;
  /** Create a new file with the given contents and save it. Fails if the file already exists. */
  createFile(p: string, content: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void, signal?: AbortSignal): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string, tool?: ToolName, signal?: AbortSignal): Promise<boolean>;
  workspaceRoot(): string | undefined;
  autoApproveEdits: boolean;
  autoApproveTerminal: boolean;
  /** Run several sub-agents concurrently. Absent when sub-agents are disabled (e.g. inside a sub-agent). */
  runSubagents?(tasks: SubagentTaskInput[], signal?: AbortSignal, onStatus?: (agents: SubagentStatusInput[]) => void): Promise<SubagentRunResult[]>;
}

export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }

export const TOOL_DEFS: ToolDef[] = [
  { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
  { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "apply_edit", description: "Replace an exact string in a file and save it immediately. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
  { name: "create_file", description: "Create a new file with the given contents and save it. Fails if the file already exists — use apply_edit to modify existing files.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path of the new file" }, content: { type: "string", description: "Full contents of the new file" } }, required: ["path", "content"] } },
  { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
  {
    name: "run_subagents",
    description: "Spawn one or more independent sub-agents that run in parallel, each with its own context and tools (read_file, list_dir, apply_edit, run_terminal). Use this to fan out independent parts of a task — e.g. investigating several files, implementing separate modules, or running checks concurrently. Each sub-agent gets a self-contained prompt and returns a text result. Sub-agents cannot spawn further sub-agents. Prefer this over doing independent work sequentially.",
    schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "The sub-agents to run concurrently. Provide 2 or more for parallel work.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short label identifying this sub-agent's job." },
              prompt: { type: "string", description: "A complete, self-contained instruction. The sub-agent has no access to this conversation, so include all needed context." },
            },
            required: ["name", "prompt"],
          },
        },
      },
      required: ["tasks"],
    },
  },
];

export function resolvePath(workspaceRoot: string | undefined, rel: string): string {
  if (!workspaceRoot) throw new Error("No workspace folder open.");
  const abs = path.resolve(workspaceRoot, rel);
  const normRoot = path.resolve(workspaceRoot);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return abs;
}

/**
 * Build a compact line-based diff between two versions of a file. Emits the
 * changed lines with a few lines of surrounding context so the webview can
 * render a focused, readable diff instead of the whole file.
 */
export function buildEditInfo(displayPath: string, before: string, after: string, created = false): EditInfo {
  const CONTEXT = 3;
  const oldLines = before.length === 0 && created ? [] : before.split("\n");
  const newLines = after.split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffLine[] = [];
  let i = 0, j = 0;
  let additions = 0, deletions = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "context", text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "del", text: oldLines[i], oldLine: i + 1 });
      deletions++; i++;
    } else {
      ops.push({ type: "add", text: newLines[j], newLine: j + 1 });
      additions++; j++;
    }
  }
  while (i < n) { ops.push({ type: "del", text: oldLines[i], oldLine: i + 1 }); deletions++; i++; }
  while (j < m) { ops.push({ type: "add", text: newLines[j], newLine: j + 1 }); additions++; j++; }
  const keep = new Array(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== "context") {
      for (let d = -CONTEXT; d <= CONTEXT; d++) {
        const idx = k + d;
        if (idx >= 0 && idx < ops.length) keep[idx] = true;
      }
    }
  }
  const lines: DiffLine[] = [];
  let gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      lines.push(ops[k]);
      gap = false;
    } else if (!gap) {
      lines.push({ type: "context", text: "\u2026" });
      gap = true;
    }
  }
  return { path: displayPath, created, additions, deletions, lines };
}

export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext, signal?: AbortSignal, onSubagentStatus?: (agents: SubagentStatusInput[]) => void): Promise<{ ok: boolean; output: string; editInfo?: EditInfo }> {
  const stopped = () => Boolean(signal?.aborted);
  try {
    if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
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
        if (!ctx.autoApproveEdits) {
          const snippet = (s: string) => s.slice(0, 80);
          const approved = await ctx.requestApproval(`Edit ${input.path}: replace "${snippet(oldString)}" with "${snippet(newString)}"`, callId, "apply_edit", signal);
          if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
          if (!approved) return { ok: false, output: "User rejected this edit." };
        }
        if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
        const { before, after } = await ctx.applyEdit(p, oldString, newString);
        const editInfo = buildEditInfo(String(input.path ?? ""), before, after, false);
        return { ok: true, output: `Edited and saved ${input.path} (+${editInfo.additions} \u2212${editInfo.deletions})`, editInfo };
      }
      case "create_file": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
        const content = String(input.content ?? "");
        if (!ctx.autoApproveEdits) {
          const approved = await ctx.requestApproval(`Create ${input.path}`, callId, "create_file", signal);
          if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
          if (!approved) return { ok: false, output: "User rejected creating this file." };
        }
        if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
        await ctx.createFile(p, content);
        const editInfo = buildEditInfo(String(input.path ?? ""), "", content, true);
        return { ok: true, output: `Created ${input.path} (+${editInfo.additions} lines)`, editInfo };
      }
      case "run_terminal": {
        const command = String(input.command ?? "");
        if (!command) return { ok: false, output: "run_terminal error: command required." };
        if (!ctx.autoApproveTerminal) {
          const approved = await ctx.requestApproval(command, callId, "run_terminal", signal);
          if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
          if (!approved) return { ok: false, output: "User rejected this command." };
        }
        const cwd = input.cwd ? resolvePath(ctx.workspaceRoot(), String(input.cwd)) : undefined;
        let output = "";
        const { exitCode } = await ctx.runTerminal(command, cwd, (chunk) => { output += chunk; }, signal);
        return { ok: exitCode === 0, output: output.slice(-8000) || `(exit code ${exitCode})` };
      }
      case "run_subagents": {
        if (!ctx.runSubagents) return { ok: false, output: "Sub-agents are not available in this context." };
        const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
        const tasks = rawTasks
          .map((t) => t as Record<string, unknown>)
          .filter((t) => t && typeof t.prompt === "string" && t.prompt.trim())
          .map((t, i) => ({ name: String(t.name ?? `agent-${i + 1}`).slice(0, 60), prompt: String(t.prompt) }));
        if (tasks.length === 0) return { ok: false, output: "run_subagents error: provide at least one task with a non-empty prompt." };
        const MAX_SUBAGENTS = 6;
        if (tasks.length > MAX_SUBAGENTS) return { ok: false, output: `run_subagents error: at most ${MAX_SUBAGENTS} sub-agents may run at once (got ${tasks.length}).` };
        const results = await ctx.runSubagents(tasks, signal, onSubagentStatus);
        if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
        const allOk = results.every((r) => r.ok);
        const body = results
          .map((r) => `### Sub-agent: ${r.name} ${r.ok ? "(completed)" : "(failed)"}\n${r.output}`)
          .join("\n\n");
        return { ok: allOk, output: body };
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
    return { ok: false, output: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
