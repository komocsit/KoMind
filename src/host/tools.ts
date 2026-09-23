import * as path from "path";
import type { ToolName } from "../shared/protocol";

export interface SubagentTaskInput { name: string; prompt: string; }
export interface SubagentRunResult { name: string; ok: boolean; output: string; }
export interface SubagentStatusInput { name: string; status: "running" | "done" | "failed"; }

export interface ToolContext {
  readFile(p: string): Promise<string>;
  listDir(p: string): Promise<string[]>;
  applyEdit(p: string, oldString: string, newString: string): Promise<void>;
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

export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext, signal?: AbortSignal, onSubagentStatus?: (agents: SubagentStatusInput[]) => void): Promise<{ ok: boolean; output: string }> {
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
        await ctx.applyEdit(p, oldString, newString);
        return { ok: true, output: `Edited and saved ${input.path}` };
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
