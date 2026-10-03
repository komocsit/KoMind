import type { Provider, AnthropicMessage } from "./provider";
import { type ToolContext } from "./tools";
import { ToolRegistry } from "./toolRegistry";
import type { ToolName, SubagentStatus, SubagentStatusView, SubagentType } from "../shared/protocol";

export interface SubagentTask {
    /** Short label used to identify the sub-agent in the aggregated result. */
    name: string;
    /** The self-contained instruction the sub-agent should carry out. */
    prompt: string;
    /** Task type: picks the sub-agent's tool set and instructions. Defaults to "general". */
    type?: SubagentType;
    /** Skill whose full instructions are preloaded into the sub-agent's system prompt. */
    skill?: string;
}

/**
 * System prompt for the top-level agent: it is the orchestrator (Hermes) and
 * decides when to delegate and which type and/or skill each sub-agent gets.
 */
export const ORCHESTRATOR_PROMPT = [
    "You are Hermes, the orchestrator. Handle small, single-step requests yourself. For larger work, break it into independent tasks and delegate them in parallel with run_subagents.",
    "For each task choose who does it:",
    "- By task type: 'explore' to locate code, 'plan' to design a change, 'general' to implement it, 'review' to check it, 'test' to run the build/tests, 'debug' to fix a failure, 'docs' to write documentation.",
    "- By skill: when a task matches a skill from the skills list, set 'skill' to its exact name so the sub-agent starts with those instructions. Combine it with the type that fits the work.",
    "Give each sub-agent a complete, self-contained prompt. Sequence dependent work across calls (e.g. explore → implement → review/test), then verify and summarize the combined results for the user.",
].join("\n");

const READ_TOOLS: ToolName[] = ["read_file", "list_dir", "find_files", "search_code", "load_skill"];

/**
 * Task-based sub-agent types. Each one narrows the tool set and adds a focused
 * system prompt, so the parent can delegate by kind of work, not just by text.
 */
export const SUBAGENT_TYPES: Record<SubagentType, { tools: ToolName[] | null; prompt: string }> = {
    general: {
        tools: null,
        prompt: "You are a sub-agent completing one self-contained task. Do the work, then reply with a concise report of what you did and anything the caller must know.",
    },
    explore: {
        tools: READ_TOOLS,
        prompt: "You are a read-only exploration sub-agent. Locate the code relevant to the task: start with search_code and find_files, then read only what you need. Reply with findings citing path:line. Do not propose edits unless asked.",
    },
    plan: {
        tools: READ_TOOLS,
        prompt: "You are a read-only planning sub-agent. Investigate the codebase, then reply with a concrete step-by-step implementation plan: files to change, what to change in each, and risks. Do not edit files.",
    },
    review: {
        tools: READ_TOOLS,
        prompt: "You are a read-only code review sub-agent. Inspect the code named in the task for bugs, edge cases, security issues and needless complexity. Reply with a list of findings, most severe first, each with path:line and a suggested fix. Do not edit files.",
    },
    test: {
        tools: [...READ_TOOLS, "run_terminal"],
        prompt: "You are a testing sub-agent. Run the project's build, tests or linters as the task asks, then reply with pass/fail and, for each failure, the cause with path:line. Do not edit files.",
    },
    debug: {
        tools: null,
        prompt: "You are a debugging sub-agent. Reproduce the problem, trace it to its root cause, apply the smallest fix that addresses that cause, then re-run the reproduction to verify. Reply with the root cause (path:line), the fix, and how you verified it.",
    },
    docs: {
        tools: [...READ_TOOLS, "apply_edit", "create_file"],
        prompt: "You are a documentation sub-agent. Read the relevant code first, then write or update the documentation, comments or changelog the task asks for. Keep it accurate to the code and match the existing style. Do not change code behavior. Reply with the files you changed.",
    },
};

export interface SubagentResult {
    name: string;
    ok: boolean;
    output: string;
}

export interface SubagentOptions {
    provider: Provider;
    ctx: ToolContext;
    /** Tools a sub-agent may use. `run_subagents` is always excluded to prevent nesting. */
    allowedTools?: ToolName[] | null;
    /** Maximum tool rounds a single sub-agent may run before it is stopped. */
    maxRounds?: number;
    /** Called whenever a sub-agent starts or finishes so the UI can show live progress. */
    onStatus?: SubagentStatusListener;
    /** Tool registry the sub-agent runs against. Defaults to built-in tools only. */
    registry?: ToolRegistry;
    /** Shared system prompt (e.g. the skills index), appended after the type's instructions. */
    system?: string;
}

/** Notified whenever any sub-agent's status changes. Receives the full snapshot. */
export type SubagentStatusListener = (agents: SubagentStatusView[]) => void;

/** Default tool set for a sub-agent: everything except spawning further sub-agents. */
const DEFAULT_SUBAGENT_TOOLS: ToolName[] = ["read_file", "list_dir", "find_files", "search_code", "apply_edit", "create_file", "run_terminal", "load_skill"];

/**
 * Run a single sub-agent to completion. It is headless: it streams nothing to
 * the UI and does not persist to the session store. It runs its own tool loop
 * and returns the final assistant text (or an error) as a compact result.
 */
export async function runSubagent(task: SubagentTask, opts: SubagentOptions, signal?: AbortSignal): Promise<SubagentResult> {
    const kind = SUBAGENT_TYPES[task.type ?? "general"] ?? SUBAGENT_TYPES.general;
    const allowed = opts.allowedTools ?? DEFAULT_SUBAGENT_TOOLS;
    // mode restrictions (plan mode) and the type's tool set both apply
    const restricted = allowed.filter((t) => t !== "run_subagents" && (!kind.tools || kind.tools.includes(t)));
    const registry = opts.registry ?? new ToolRegistry();
    const tools = registry.listTools(restricted);
    const skillBody = task.skill ? opts.ctx.loadSkill?.(task.skill) : undefined;
    const skillSection = skillBody ? `Follow the instructions of the "${task.skill}" skill:\n\n${skillBody}` : undefined;
    const system = [kind.prompt, skillSection, opts.system].filter(Boolean).join("\n\n");
    const maxRounds = opts.maxRounds ?? 25;
    const messages: AnthropicMessage[] = [{ role: "user", content: [{ type: "text", text: task.prompt }] }];
    let lastText = "";

    try {
        for (let round = 0; round < maxRounds; round++) {
            if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
            let text = "";
            const assistantMsgs = await opts.provider.streamTurn(messages, tools, (e) => {
                if (e.type === "textDelta") text += e.text;
            }, signal, system);
            messages.push(...assistantMsgs);
            const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
            if (text) lastText = text;

            const toolUses = (assistantMsg.content as any[]).filter((b) => b.type === "tool_use");
            if (toolUses.length === 0) {
                return { name: task.name, ok: true, output: lastText || "(sub-agent produced no text output)" };
            }

            const results: unknown[] = [];
            for (const tu of toolUses) {
                if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
                const r = await registry.execute(tu.name, tu.input, tu.id, opts.ctx, signal);
                results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output, is_error: !r.ok });
            }
            messages.push({ role: "user", content: results });
        }
        return { name: task.name, ok: false, output: `Sub-agent "${task.name}" reached the ${maxRounds}-round limit without finishing.` };
    } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
            return { name: task.name, ok: false, output: `Sub-agent "${task.name}" was stopped.` };
        }
        const msg = e instanceof Error ? e.message : String(e);
        return { name: task.name, ok: false, output: `Sub-agent "${task.name}" failed: ${msg}` };
    }
}

/** Run several sub-agents concurrently and collect their results in order. */
export async function runSubagents(tasks: SubagentTask[], opts: SubagentOptions, signal?: AbortSignal): Promise<SubagentResult[]> {
    // Track a live status per sub-agent so the UI can render which ones are
    // running vs. finished. All start "running"; each flips to done/failed as it settles.
    const statuses: SubagentStatusView[] = tasks.map((t) => ({ name: t.name, type: t.type ?? "general", skill: t.skill, status: "running" as SubagentStatus }));
    const emit = () => opts.onStatus?.(statuses.map((s) => ({ ...s })));
    emit();
    return Promise.all(tasks.map(async (task, i) => {
        const result = await runSubagent(task, opts, signal);
        statuses[i] = { ...statuses[i], status: result.ok ? "done" : "failed" };
        emit();
        return result;
    }));
}