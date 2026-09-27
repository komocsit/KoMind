import * as path from "path";
import type { Skill, SkillFs } from "./skills";
import { parseSkill } from "./skills";
import type { McpServerConfig } from "./mcp";

/**
 * A slash command exposed by a plugin. Typing `/name` in the chat expands to a
 * prompt template. `{{args}}` in the template is replaced with whatever the
 * user typed after the command name; if the template has no placeholder, the
 * arguments are appended on a new line.
 */
export interface SlashCommand {
    /** Command name without the leading slash (e.g. "review"). */
    name: string;
    /** One-line description shown in the slash-command menu. */
    description: string;
    /** Prompt template the command expands to. */
    template: string;
    /** Plugin the command came from, for display/disambiguation. */
    plugin?: string;
}

/**
 * A plugin manifest (`komind-plugin.json`). All sections are optional so a
 * plugin can contribute any mix of skills, MCP servers, slash commands, and a
 * system-prompt fragment.
 */
export interface PluginManifest {
    name: string;
    version?: string;
    description?: string;
    /** Extra system-prompt text contributed while the plugin is active. */
    systemPrompt?: string;
    /** MCP servers to connect, keyed by server name (namespaced by plugin). */
    mcpServers?: Record<string, McpServerConfig>;
    /** Slash commands contributed by the plugin. */
    commands?: { name: string; description?: string; template: string }[];
    /**
     * Subdirectories (relative to the plugin dir) that each contain a `SKILL.md`.
     * When omitted, a `skills/` subdirectory is scanned automatically.
     */
    skills?: string[];
}

/** A fully loaded plugin: its manifest plus resolved skills and commands. */
export interface LoadedPlugin {
    name: string;
    dir: string;
    manifest: PluginManifest;
    skills: Skill[];
    commands: SlashCommand[];
}

/** Result of loading plugins from disk, aggregated for wiring into the app. */
export interface PluginLoadResult {
    plugins: LoadedPlugin[];
    skills: Skill[];
    commands: SlashCommand[];
    mcpServers: Record<string, McpServerConfig>;
    systemPrompts: string[];
    errors: { name: string; error: string }[];
}

/** Validate + normalize a parsed manifest object. Returns undefined if invalid. */
export function normalizeManifest(raw: unknown, fallbackName: string): PluginManifest | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const o = raw as Record<string, unknown>;
    const name = (typeof o.name === "string" && o.name.trim()) ? o.name.trim() : fallbackName;
    if (!name) return undefined;
    const manifest: PluginManifest = { name };
    if (typeof o.version === "string") manifest.version = o.version;
    if (typeof o.description === "string") manifest.description = o.description;
    if (typeof o.systemPrompt === "string") manifest.systemPrompt = o.systemPrompt;
    if (o.mcpServers && typeof o.mcpServers === "object") {
        manifest.mcpServers = o.mcpServers as Record<string, McpServerConfig>;
    }
    if (Array.isArray(o.commands)) {
        manifest.commands = o.commands
            .map((c) => c as Record<string, unknown>)
            .filter((c) => c && typeof c.name === "string" && typeof c.template === "string")
            .map((c) => ({ name: String(c.name), description: typeof c.description === "string" ? c.description : "", template: String(c.template) }));
    }
    if (Array.isArray(o.skills)) {
        manifest.skills = o.skills.filter((s): s is string => typeof s === "string");
    }
    return manifest;
}

/** Sanitize a command name to `[a-z0-9-]` and lowercase it. */
export function normalizeCommandName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Expand a slash-command template with the user's arguments. `{{args}}` is
 * replaced inline; otherwise args are appended on a new line when present.
 */
export function expandCommand(template: string, args: string): string {
    if (template.includes("{{args}}")) return template.split("{{args}}").join(args);
    return args ? `${template}\n\n${args}` : template;
}

/**
 * Load all plugins under the given root directories. Each immediate
 * subdirectory containing a `komind-plugin.json` is one plugin. Its skills,
 * commands, MCP servers, and system prompt are collected. Server and command
 * names are namespaced by the plugin to avoid collisions across plugins.
 */
export async function loadPlugins(roots: string[], fs: SkillFs): Promise<PluginLoadResult> {
    const result: PluginLoadResult = { plugins: [], skills: [], commands: [], mcpServers: {}, systemPrompts: [], errors: [] };
    const seenCommands = new Set<string>();
    const seenSkills = new Set<string>();

    for (const root of roots) {
        if (!(await fs.exists(root))) continue;
        let entries: [string, boolean][];
        try { entries = await fs.readDir(root); } catch { continue; }

        for (const [entryName, isDir] of entries) {
            if (!isDir) continue;
            const dir = path.join(root, entryName);
            const manifestPath = path.join(dir, "komind-plugin.json");
            if (!(await fs.exists(manifestPath))) continue;

            try {
                const raw = await fs.readFile(manifestPath);
                const manifest = normalizeManifest(JSON.parse(raw), entryName);
                if (!manifest) { result.errors.push({ name: entryName, error: "invalid manifest" }); continue; }

                const plugin: LoadedPlugin = { name: manifest.name, dir, manifest, skills: [], commands: [] };

                // Skills: explicit list or a default `skills/` subdirectory.
                const skillDirs = manifest.skills ?? ["skills"];
                for (const rel of skillDirs) {
                    const skillRoot = path.join(dir, rel);
                    if (!(await fs.exists(skillRoot))) continue;
                    // A skill dir may itself be a single skill (contains SKILL.md) or a
                    // parent of many skill subdirectories.
                    const directSkill = path.join(skillRoot, "SKILL.md");
                    if (await fs.exists(directSkill)) {
                        const parsed = parseSkill(await fs.readFile(directSkill), path.basename(skillRoot), skillRoot);
                        if (parsed) plugin.skills.push(parsed);
                        continue;
                    }
                    let subEntries: [string, boolean][] = [];
                    try { subEntries = await fs.readDir(skillRoot); } catch { /* ignore */ }
                    for (const [subName, subIsDir] of subEntries) {
                        if (!subIsDir) continue;
                        const sd = path.join(skillRoot, subName);
                        const sf = path.join(sd, "SKILL.md");
                        if (!(await fs.exists(sf))) continue;
                        const parsed = parseSkill(await fs.readFile(sf), subName, sd);
                        if (parsed) plugin.skills.push(parsed);
                    }
                }

                // Commands: namespaced by plugin, first-wins across plugins.
                for (const c of manifest.commands ?? []) {
                    const base = normalizeCommandName(c.name);
                    if (!base) continue;
                    const name = seenCommands.has(base) ? `${normalizeCommandName(manifest.name)}-${base}` : base;
                    if (seenCommands.has(name)) continue;
                    seenCommands.add(name);
                    const cmd: SlashCommand = { name, description: c.description ?? "", template: c.template, plugin: manifest.name };
                    plugin.commands.push(cmd);
                    result.commands.push(cmd);
                }

                // MCP servers: namespaced by plugin so two plugins can't clash.
                for (const [serverName, cfg] of Object.entries(manifest.mcpServers ?? {})) {
                    result.mcpServers[`${normalizeCommandName(manifest.name)}-${serverName}`] = cfg;
                }

                // System prompt fragment.
                if (manifest.systemPrompt?.trim()) result.systemPrompts.push(manifest.systemPrompt.trim());

                // Roll skills up (first-wins on name across all plugins).
                for (const skill of plugin.skills) {
                    if (seenSkills.has(skill.name)) continue;
                    seenSkills.add(skill.name);
                    result.skills.push(skill);
                }

                result.plugins.push(plugin);
            } catch (e) {
                result.errors.push({ name: entryName, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    return result;
}

/**
 * Holds loaded slash commands and resolves `/name args` input into an expanded
 * prompt. Also produces the command list the webview shows in its slash menu.
 */
export class CommandRegistry {
    private readonly byName = new Map<string, SlashCommand>();

    constructor(commands: SlashCommand[] = []) { this.setCommands(commands); }

    setCommands(commands: SlashCommand[]): void {
        this.byName.clear();
        for (const c of commands) if (!this.byName.has(c.name)) this.byName.set(c.name, c);
    }

    list(): SlashCommand[] { return [...this.byName.values()]; }
    get size(): number { return this.byName.size; }
    get(name: string): SlashCommand | undefined { return this.byName.get(name); }

    /**
     * If `text` starts with a known `/command`, return the expanded prompt.
     * Returns undefined when the text is not a recognized slash command, so the
     * caller can send it through unchanged.
     */
    expand(text: string): string | undefined {
        const m = /^\/([A-Za-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
        if (!m) return undefined;
        const cmd = this.byName.get(m[1].toLowerCase());
        if (!cmd) return undefined;
        return expandCommand(cmd.template, (m[2] ?? "").trim());
    }
}
