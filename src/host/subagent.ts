import type { Provider, AnthropicMessage } from "./provider";
import { type ToolContext } from "./tools";
import { ToolRegistry } from "./toolRegistry";
import type { ToolName, SubagentStatus, SubagentStatusView } from "../shared/protocol";

export interface SubagentTask {
    /** Short label used to identify the sub-agent in the aggregated result. */
    name: string;
    /** The self-contained instruction the sub-agent should carry out. */
    prompt: string;
}

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
}

/** Notified whenever any sub-agent's status changes. Receives the full snapshot. */
export type SubagentStatusListener = (agents: SubagentStatusView[]) => void;

/** Default tool set for a sub-agent: everything except spawning further sub-agents. */
const DEFAULT_SUBAGENT_TOOLS: ToolName[] = ["read_file", "list_dir", "apply_edit", "create_file", "run_terminal", "load_skill"];

/**
 * Run a single sub-agent to completion. It is headless: it streams nothing to
 * the UI and does not persist to the session store. It runs its own tool loop
 * and returns the final assistant text (or an error) as a compact result.
 */
export async function runSubagent(task: SubagentTask, opts: SubagentOptions, signal?: AbortSignal): Promise<SubagentResult> {
    const allowed = opts.allowedTools ?? DEFAULT_SUBAGENT_TOOLS;
    const restricted = allowed.filter((t) => t !== "run_subagents");
    const registry = opts.registry ?? new ToolRegistry();
    const tools = registry.listTools(restricted);
    const maxRounds = opts.maxRounds ?? 25;
    const messages: AnthropicMessage[] = [{ role: "user", content: [{ type: "text", text: task.prompt }] }];
    let lastText = "";

    try {
        for (let round = 0; round < maxRounds; round++) {
            if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
            let text = "";
            const assistantMsgs = await opts.provider.streamTurn(messages, tools, (e) => {
                if (e.type === "textDelta") text += e.text;
            }, signal);
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
    const statuses: SubagentStatusView[] = tasks.map((t) => ({ name: t.name, status: "running" as SubagentStatus }));
    const emit = () => opts.onStatus?.(statuses.map((s) => ({ ...s })));
    emit();
    return Promise.all(tasks.map(async (task, i) => {
        const result = await runSubagent(task, opts, signal);
        statuses[i] = { name: task.name, status: result.ok ? "done" : "failed" };
        emit();
        return result;
    }));
}