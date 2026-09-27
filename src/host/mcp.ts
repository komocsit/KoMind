import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolContext, ToolDef, SubagentStatusInput } from "./tools";
import type { ToolProvider, ToolExecResult } from "./toolRegistry";

/**
 * Configuration for a single MCP server. Mirrors the widely used
 * `mcpServers` config shape (Claude Desktop / Cursor) so users can reuse an
 * existing config:
 *   - stdio: provide `command` (+ optional `args`, `env`, `cwd`)
 *   - http:  provide `url` (Streamable HTTP transport, optional `headers`)
 */
export interface McpServerConfig {
    /** Command to spawn for a stdio server. Mutually exclusive with `url`. */
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    /** URL of a Streamable HTTP server. Mutually exclusive with `command`. */
    url?: string;
    headers?: Record<string, string>;
    /** Set false to skip connecting this server. Defaults to true. */
    enabled?: boolean;
}

/** The separator between a server name and a tool name in a namespaced id. */
export const MCP_NAME_SEP = "__";

/** Build the namespaced tool name the model sees for an MCP tool. */
export function mcpToolName(server: string, tool: string): string {
    return `mcp${MCP_NAME_SEP}${server}${MCP_NAME_SEP}${tool}`;
}

/** True when a tool name refers to an MCP-contributed tool. */
export function isMcpToolName(name: string): boolean {
    return name.startsWith(`mcp${MCP_NAME_SEP}`);
}

/**
 * Parse a namespaced MCP tool name back into its server and tool parts.
 * Returns undefined for names that are not MCP tools.
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
    if (!isMcpToolName(name)) return undefined;
    const rest = name.slice(`mcp${MCP_NAME_SEP}`.length);
    const idx = rest.indexOf(MCP_NAME_SEP);
    if (idx < 0) return undefined;
    return { server: rest.slice(0, idx), tool: rest.slice(idx + MCP_NAME_SEP.length) };
}

/** Minimal shape of an MCP client we depend on (for testability). */
export interface McpClientLike {
    listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>;
    callTool(params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]): Promise<unknown>;
    close(): Promise<void>;
}

/** How a connected server is represented internally. */
interface ConnectedServer {
    name: string;
    client: McpClientLike;
    tools: ToolDef[];
}

/**
 * Flatten an MCP tool result (an array of content blocks) into plain text for
 * the model. Only text blocks are inlined; other block kinds are summarized so
 * the model knows something non-textual came back.
 */
export function mcpResultToText(result: unknown): { ok: boolean; text: string } {
    const r = result as { isError?: boolean; content?: unknown[]; structuredContent?: unknown } | null;
    const isError = Boolean(r?.isError);
    const blocks = Array.isArray(r?.content) ? r!.content! : [];
    const parts: string[] = [];
    for (const b of blocks) {
        const block = b as { type?: string; text?: string; mimeType?: string; resource?: { uri?: string } };
        if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
        else if (block.type === "image") parts.push(`[image${block.mimeType ? ` ${block.mimeType}` : ""}]`);
        else if (block.type === "audio") parts.push(`[audio${block.mimeType ? ` ${block.mimeType}` : ""}]`);
        else if (block.type === "resource" || block.type === "resource_link") parts.push(`[resource ${block.resource?.uri ?? ""}]`.trim());
        else parts.push(`[${block.type ?? "unknown"} content]`);
    }
    if (parts.length === 0 && r?.structuredContent !== undefined) {
        try { parts.push(JSON.stringify(r.structuredContent)); } catch { /* ignore */ }
    }
    const text = parts.join("\n").trim() || (isError ? "(MCP tool reported an error with no message)" : "(MCP tool returned no content)");
    return { ok: !isError, text };
}

/**
 * Wraps a single connected MCP server as a ToolProvider. Tool names are
 * namespaced (`mcp__<server>__<tool>`) so they never collide with built-ins or
 * other servers. Every MCP call routes through the approval gate first —
 * external servers are untrusted, so the user must approve each call unless a
 * broader "always allow" grant is configured elsewhere.
 */
export class McpToolProvider implements ToolProvider {
    readonly id: string;
    constructor(private readonly server: ConnectedServer) {
        this.id = `mcp:${server.name}`;
    }
    listTools(): ToolDef[] { return this.server.tools; }

    async execute(
        name: string,
        input: Record<string, unknown>,
        callId: string,
        ctx: ToolContext,
        signal?: AbortSignal,
        _onSubagentStatus?: (agents: SubagentStatusInput[]) => void,
    ): Promise<ToolExecResult> {
        const parsed = parseMcpToolName(name);
        if (!parsed) return { ok: false, output: `Not an MCP tool: ${name}` };
        if (signal?.aborted) return { ok: false, output: "Stopped." };

        // External tool — always gated behind explicit approval by default.
        const summary = `MCP tool ${parsed.server} · ${parsed.tool}\n${safeArgs(input)}`;
        const approved = await ctx.requestApproval(summary, callId, name, signal);
        if (signal?.aborted) return { ok: false, output: "Stopped." };
        if (!approved) return { ok: false, output: "User rejected this MCP tool call." };

        try {
            const result = await this.server.client.callTool({ name: parsed.tool, arguments: input });
            const { ok, text } = mcpResultToText(result);
            return { ok, output: text.slice(0, 16000) };
        } catch (e) {
            return { ok: false, output: `MCP tool error: ${e instanceof Error ? e.message : String(e)}` };
        }
    }
}

/** Serialize tool arguments for the approval card, guarding against huge blobs. */
function safeArgs(input: Record<string, unknown>): string {
    try {
        const json = JSON.stringify(input, null, 2);
        return json.length > 2000 ? json.slice(0, 2000) + "\n… (truncated)" : json;
    } catch {
        return "(unserializable arguments)";
    }
}

/** Convert an MCP tool descriptor into our ToolDef shape. */
function toToolDef(server: string, tool: { name: string; description?: string; inputSchema?: unknown }): ToolDef {
    const schema = (tool.inputSchema && typeof tool.inputSchema === "object")
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} };
    const description = `[MCP:${server}] ${tool.description ?? tool.name}`;
    return { name: mcpToolName(server, tool.name), description, schema };
}

/**
 * Expand `${VAR}` and `$VAR` references in a string against a source
 * environment (defaults to `process.env`). Unknown variables expand to an
 * empty string, matching common shell behavior. Escaped `\${...}` / `\$VAR` is
 * left literal (the backslash is consumed) so a literal value can be forced.
 * Done in a single pass so an escaped placeholder is never re-expanded.
 */
export function expandEnvString(value: string, source: NodeJS.ProcessEnv = process.env): string {
    // One combined pattern: optional leading backslash escape, then either the
    // ${VAR} or $VAR form. A matched escape emits the literal text; otherwise the
    // variable is resolved. Scanning left-to-right in one pass means output text
    // (including a freshly de-escaped `${VAR}`) is never re-examined.
    const re = /(\\?)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
    return value.replace(re, (match, escape: string, braced: string | undefined, bare: string | undefined) => {
        if (escape) return match.slice(1); // drop the backslash, keep "${VAR}"/"$VAR" literal
        const name = braced ?? bare!;
        return source[name] ?? "";
    });
}

/**
 * Resolve the child environment for a stdio MCP server. The MCP SDK's stdio
 * transport does NOT inherit the parent environment — it uses exactly the `env`
 * passed in. So we start from the parent `process.env`, then layer the
 * server's configured `env` on top, expanding any `${VAR}`/`$VAR` placeholders
 * in the configured values against the parent environment. This matches how
 * Claude Desktop / Cursor resolve `mcpServers` env entries, so an existing
 * config with `"TOKEN": "${MY_TOKEN}"` works unchanged.
 */
export function resolveServerEnv(cfgEnv: Record<string, string> | undefined, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parent)) {
        if (typeof v === "string") out[k] = v;
    }
    for (const [k, v] of Object.entries(cfgEnv ?? {})) {
        out[k] = expandEnvString(v, parent);
    }
    return out;
}

/** Injected factory so tests can supply a fake client without spawning processes. */
export type McpConnector = (name: string, cfg: McpServerConfig) => Promise<McpClientLike>;

/** Default connector: builds a real MCP client over stdio or Streamable HTTP. */
export const defaultConnector: McpConnector = async (name, cfg) => {
    let transport: Transport;
    if (cfg.url) {
        const headers = cfg.headers
            ? Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, expandEnvString(v)]))
            : undefined;
        const opts = headers ? { requestInit: { headers } } : undefined;
        transport = new StreamableHTTPClientTransport(new URL(cfg.url), opts);
    } else if (cfg.command) {
        transport = new StdioClientTransport({
            command: cfg.command,
            args: (cfg.args ?? []).map((a) => expandEnvString(a)),
            env: resolveServerEnv(cfg.env),
            cwd: cfg.cwd,
        });
    } else {
        throw new Error(`MCP server "${name}" must specify either "command" (stdio) or "url" (http).`);
    }
    const client = new Client({ name: "komind", version: "1.2.0" }, { capabilities: {} });
    await client.connect(transport);
    return client as unknown as McpClientLike;
};

export interface McpConnectResult {
    name: string;
    ok: boolean;
    toolCount: number;
    error?: string;
}

/**
 * Manages the lifecycle of configured MCP servers: connecting, listing tools,
 * exposing them as ToolProviders, and disconnecting. The manager owns the
 * providers but does not register them in the ToolRegistry itself — the caller
 * wires connected providers into the registry so registry ownership stays in
 * one place.
 */
export class McpManager {
    private servers = new Map<string, ConnectedServer>();

    constructor(private readonly connector: McpConnector = defaultConnector) { }

    /** Names of currently connected servers. */
    connectedNames(): string[] { return [...this.servers.keys()]; }

    /** The ToolProvider for a connected server, if any. */
    providerFor(name: string): McpToolProvider | undefined {
        const s = this.servers.get(name);
        return s ? new McpToolProvider(s) : undefined;
    }

    /**
     * Connect one server and register its tools. Returns a result describing the
     * outcome; a failed connection never throws so one bad server cannot stop the
     * others from connecting.
     */
    async connect(name: string, cfg: McpServerConfig): Promise<{ result: McpConnectResult; provider?: McpToolProvider }> {
        if (cfg.enabled === false) return { result: { name, ok: false, toolCount: 0, error: "disabled" } };
        if (this.servers.has(name)) return { result: { name, ok: false, toolCount: 0, error: "already connected" } };
        try {
            const client = await this.connector(name, cfg);
            const listed = await client.listTools();
            const tools = (listed.tools ?? []).map((t) => toToolDef(name, t));
            const server: ConnectedServer = { name, client, tools };
            this.servers.set(name, server);
            return { result: { name, ok: true, toolCount: tools.length }, provider: new McpToolProvider(server) };
        } catch (e) {
            return { result: { name, ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) } };
        }
    }

    /** Disconnect a single server and close its client. */
    async disconnect(name: string): Promise<void> {
        const s = this.servers.get(name);
        if (!s) return;
        this.servers.delete(name);
        try { await s.client.close(); } catch { /* best effort */ }
    }

    /** Disconnect all servers (e.g. on extension deactivation). */
    async disconnectAll(): Promise<void> {
        await Promise.all(this.connectedNames().map((n) => this.disconnect(n)));
    }
}
