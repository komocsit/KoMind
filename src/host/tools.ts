import * as path from "path";
import type { ToolName, ToolId, EditInfo, DiffLine, SubagentType } from "../shared/protocol";

export interface SubagentTaskInput { name: string; prompt: string; type?: SubagentType; skill?: string; }
export interface SubagentRunResult { name: string; ok: boolean; output: string; }
export interface SubagentStatusInput { name: string; type?: SubagentType; skill?: string; status: "running" | "done" | "failed"; }

const SUBAGENT_TYPE_NAMES: SubagentType[] = ["general", "explore", "plan", "review", "test", "debug", "docs"];

export interface ToolContext {
  readFile(p: string): Promise<string>;
  listDir(p: string): Promise<string[]>;
  /** Workspace-relative paths of files matching a glob, skipping dependency/build dirs and files.exclude. */
  findFiles(glob: string, maxResults: number): Promise<string[]>;
  applyEdit(p: string, oldString: string, newString: string): Promise<{ before: string; after: string }>;
  /** Create a new file with the given contents and save it. Fails if the file already exists. */
  createFile(p: string, content: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void, signal?: AbortSignal): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string, tool?: ToolId, signal?: AbortSignal): Promise<boolean>;
  workspaceRoot(): string | undefined;
  autoApproveEdits: boolean;
  autoApproveTerminal: boolean;
  /** Run several sub-agents concurrently. Absent when sub-agents are disabled (e.g. inside a sub-agent). */
  runSubagents?(tasks: SubagentTaskInput[], signal?: AbortSignal, onStatus?: (agents: SubagentStatusInput[]) => void): Promise<SubagentRunResult[]>;
  /** Return the full instructions for a named skill, or undefined if unknown. Absent when skills are disabled. */
  loadSkill?(name: string): string | undefined;
}

export interface ToolDef { name: string; description: string; schema: Record<string, unknown>; }

/** Built-in tool definitions. Their names are the fixed `ToolName` literals. */
export const TOOL_DEFS: (ToolDef & { name: ToolName })[] = [
  { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
  { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "find_files", description: "Find files recursively by glob pattern (e.g. 'src/**/*.ts', '**/*config*'). Skips node_modules, .git, dist and out. Use this to map the project structure in one call.", schema: { type: "object", properties: { glob: { type: "string", description: "Glob relative to the workspace root" } }, required: ["glob"] } },
  { name: "search_code", description: "Search file CONTENTS across the workspace with a regular expression. Returns path:line: text for each match. Use this FIRST to locate code (symbols, strings, call sites) before reading whole files.", schema: { type: "object", properties: { pattern: { type: "string", description: "JavaScript regular expression to search for" }, glob: { type: "string", description: "Optional file filter, e.g. '**/*.ts'. Defaults to all files." }, ignoreCase: { type: "boolean", description: "Case-insensitive match. Default false." } }, required: ["pattern"] } },
  { name: "apply_edit", description: "Replace an exact string in a file and save it immediately. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
  { name: "create_file", description: "Create a new file with the given contents and save it. Fails if the file already exists — use apply_edit to modify existing files.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path of the new file" }, content: { type: "string", description: "Full contents of the new file" } }, required: ["path", "content"] } },
  { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
  {
    name: "run_subagents",
    description: "Spawn one or more independent sub-agents that run in parallel, each with its own context. Give each a task type: 'explore' (read-only: locate code and report path:line findings), 'plan' (read-only: produce an implementation plan), 'review' (read-only: find bugs and risks), 'test' (run build/tests and diagnose failures, no edits), 'debug' (reproduce a bug, find the root cause, apply a minimal fix and verify it), 'docs' (write or update documentation, comments and changelogs), or 'general' (default: full tools — read, search, edit, create files, terminal — to implement a change). Use this to fan out independent parts of a task, e.g. exploring several areas at once, implementing separate modules, or reviewing and testing in parallel. Each sub-agent gets a self-contained prompt and returns a text result. Optionally assign a 'skill' to start a sub-agent with that skill's instructions. Sub-agents cannot spawn further sub-agents. Prefer this over doing independent work sequentially.",
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
              type: { type: "string", enum: SUBAGENT_TYPE_NAMES, description: "Kind of task; selects the sub-agent's tools and instructions. Defaults to 'general'." },
              skill: { type: "string", description: "Optional exact name of a skill from the skills list. Its full instructions are preloaded into the sub-agent." },
            },
            required: ["name", "prompt"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "load_skill",
    description: "Load the full instructions for a Skill by name. Skills are reusable instruction packages; the available ones are listed in your system prompt. Call this when a task matches a skill, then follow the returned instructions. Returns an error if the skill name is unknown.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The exact name of the skill to load, as shown in the skills list." },
      },
      required: ["name"],
    },
  },
];

const MAX_READ_CHARS = 100_000;
const MAX_FIND_RESULTS = 500;
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_FILE_CHARS = 1_000_000;
const MAX_SEARCH_HITS = 200;

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
        const content = await ctx.readFile(p);
        if (content.length <= MAX_READ_CHARS) return { ok: true, output: content };
        return { ok: true, output: `${content.slice(0, MAX_READ_CHARS)}\n\n[truncated: file is ${content.length} chars, showing the first ${MAX_READ_CHARS}. Use search_code to find the part you need.]` };
      }
      case "list_dir": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? "."));
        const entries = await ctx.listDir(p);
        return { ok: true, output: entries.join("\n") };
      }
      case "find_files": {
        const glob = String(input.glob ?? "").trim();
        if (!glob) return { ok: false, output: "find_files error: glob required." };
        const files = await ctx.findFiles(glob, MAX_FIND_RESULTS + 1);
        if (files.length === 0) return { ok: true, output: "(no files matched)" };
        const more = files.length > MAX_FIND_RESULTS ? `\n[more than ${MAX_FIND_RESULTS} files matched; narrow the glob]` : "";
        return { ok: true, output: files.slice(0, MAX_FIND_RESULTS).sort().join("\n") + more };
      }
      case "search_code": {
        const pattern = String(input.pattern ?? "");
        if (!pattern) return { ok: false, output: "search_code error: pattern required." };
        let re: RegExp;
        try { re = new RegExp(pattern, input.ignoreCase ? "i" : ""); } catch (e) { return { ok: false, output: `search_code error: invalid regex: ${e instanceof Error ? e.message : String(e)}` }; }
        const root = ctx.workspaceRoot();
        const files = await ctx.findFiles(String(input.glob ?? "").trim() || "**/*", MAX_SEARCH_FILES);
        const hits: string[] = [];
        for (const rel of files) {
          if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
          let text: string;
          try { text = await ctx.readFile(resolvePath(root, rel)); } catch { continue; }
          // skip binaries and huge generated files (bundles, lockfiles)
          if (text.length > MAX_SEARCH_FILE_CHARS || text.includes("\0")) continue;
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (!re.test(lines[i])) continue;
            hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (hits.length >= MAX_SEARCH_HITS) {
              return { ok: true, output: hits.join("\n") + `\n[stopped at ${MAX_SEARCH_HITS} matches; narrow the pattern or glob]` };
            }
          }
        }
        return { ok: true, output: hits.length ? hits.join("\n") : "(no matches)" };
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
          .map((t, i) => ({
            name: String(t.name ?? `agent-${i + 1}`).slice(0, 60),
            prompt: String(t.prompt),
            type: SUBAGENT_TYPE_NAMES.includes(t.type as SubagentType) ? t.type as SubagentType : "general",
            skill: typeof t.skill === "string" && t.skill.trim() ? t.skill.trim() : undefined,
          }));
        if (tasks.length === 0) return { ok: false, output: "run_subagents error: provide at least one task with a non-empty prompt." };
        const MAX_SUBAGENTS = 6;
        if (tasks.length > MAX_SUBAGENTS) return { ok: false, output: `run_subagents error: at most ${MAX_SUBAGENTS} sub-agents may run at once (got ${tasks.length}).` };
        // fail fast on a mistyped skill so the orchestrator can correct it before anything runs
        const unknownSkill = tasks.find((t) => t.skill && ctx.loadSkill?.(t.skill) === undefined);
        if (unknownSkill) return { ok: false, output: `run_subagents error: no skill named "${unknownSkill.skill}" (task "${unknownSkill.name}"). Check the skills list in your system prompt.` };
        const results = await ctx.runSubagents(tasks, signal, onSubagentStatus);
        if (stopped()) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
        const allOk = results.every((r) => r.ok);
        const body = results
          .map((r, i) => `### Sub-agent: ${r.name} [${tasks[i].type}${tasks[i].skill ? `, skill: ${tasks[i].skill}` : ""}] ${r.ok ? "(completed)" : "(failed)"}\n${r.output}`)
          .join("\n\n");
        return { ok: allOk, output: body };
      }
      case "load_skill": {
        if (!ctx.loadSkill) return { ok: false, output: "Skills are not available in this context." };
        const skillName = String(input.name ?? "").trim();
        if (!skillName) return { ok: false, output: "load_skill error: provide the name of the skill to load." };
        const skillBody = ctx.loadSkill(skillName);
        if (skillBody === undefined) return { ok: false, output: `load_skill error: no skill named "${skillName}". Check the skills list in your system prompt.` };
        return { ok: true, output: skillBody };
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
    return { ok: false, output: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
