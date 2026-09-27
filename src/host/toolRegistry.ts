import { executeTool, TOOL_DEFS, type ToolContext, type ToolDef, type SubagentStatusInput } from "./tools";
import type { EditInfo } from "../shared/protocol";

/** The result shape every tool execution returns. */
export interface ToolExecResult { ok: boolean; output: string; editInfo?: EditInfo }

/**
 * A source of tools. Built-in tools, MCP servers, skills, and plugins each
 * implement this so the agent can discover and run their tools uniformly.
 * Providers are the extension point that lets the harness grow new
 * capabilities without touching the agent loop.
 */
export interface ToolProvider {
    /** Stable identifier for the provider (e.g. "builtin", "mcp:github"). */
    readonly id: string;
    /** Tool definitions this provider currently exposes. May change over time. */
    listTools(): ToolDef[];
    /** Run one of this provider's tools. Only called for names this provider lists. */
    execute(
        name: string,
        input: Record<string, unknown>,
        callId: string,
        ctx: ToolContext,
        signal?: AbortSignal,
        onSubagentStatus?: (agents: SubagentStatusInput[]) => void,
    ): Promise<ToolExecResult>;
}

/** Wraps the built-in tool set (read_file, apply_edit, run_terminal, …). */
export class BuiltinToolProvider implements ToolProvider {
    readonly id = "builtin";
    listTools(): ToolDef[] { return TOOL_DEFS; }
    execute(
        name: string,
        input: Record<string, unknown>,
        callId: string,
        ctx: ToolContext,
        signal?: AbortSignal,
        onSubagentStatus?: (agents: SubagentStatusInput[]) => void,
    ): Promise<ToolExecResult> {
        return executeTool(name, input, callId, ctx, signal, onSubagentStatus);
    }
}

/**
 * Aggregates several tool providers into one lookup surface. Tool names must be
 * unique across providers; the first provider to claim a name wins and any
 * later duplicate is dropped so the model never sees an ambiguous tool. This is
 * the seam future layers (MCP servers, skills, plugins) plug into.
 */
export class ToolRegistry {
    private readonly providers: ToolProvider[];

    constructor(providers: ToolProvider[] = [new BuiltinToolProvider()]) {
        this.providers = providers;
    }

    /** Add a provider at runtime (e.g. when an MCP server connects). */
    addProvider(provider: ToolProvider): void {
        if (this.providers.some((p) => p.id === provider.id)) {
            throw new Error(`Tool provider already registered: ${provider.id}`);
        }
        this.providers.push(provider);
    }

    /** Remove a provider by id (e.g. when an MCP server disconnects). */
    removeProvider(id: string): void {
        const i = this.providers.findIndex((p) => p.id === id);
        if (i >= 0) this.providers.splice(i, 1);
    }

    /**
     * All tools across every provider, de-duplicated by name (first wins).
     * When `allowed` is provided, only tools whose name is in that list are
     * returned — this is how plan mode and per-sub-agent restrictions apply.
     */
    listTools(allowed?: readonly string[] | null): ToolDef[] {
        const seen = new Set<string>();
        const out: ToolDef[] = [];
        for (const provider of this.providers) {
            for (const def of provider.listTools()) {
                if (seen.has(def.name)) continue;
                if (allowed && !allowed.includes(def.name)) continue;
                seen.add(def.name);
                out.push(def);
            }
        }
        return out;
    }

    /** Find the provider that owns a tool name (respecting first-wins). */
    private ownerOf(name: string): ToolProvider | undefined {
        const claimed = new Set<string>();
        for (const provider of this.providers) {
            for (const def of provider.listTools()) {
                if (claimed.has(def.name)) continue;
                claimed.add(def.name);
                if (def.name === name) return provider;
            }
        }
        return undefined;
    }

    /** Dispatch a tool call to whichever provider owns the tool name. */
    async execute(
        name: string,
        input: Record<string, unknown>,
        callId: string,
        ctx: ToolContext,
        signal?: AbortSignal,
        onSubagentStatus?: (agents: SubagentStatusInput[]) => void,
    ): Promise<ToolExecResult> {
        const provider = this.ownerOf(name);
        if (!provider) return { ok: false, output: `Unknown tool: ${name}` };
        return provider.execute(name, input, callId, ctx, signal, onSubagentStatus);
    }
}
