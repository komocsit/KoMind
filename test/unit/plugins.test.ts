import { describe, it, expect } from "vitest";
import {
    normalizeManifest,
    normalizeCommandName,
    expandCommand,
    loadPlugins,
    CommandRegistry,
    type SlashCommand,
} from "../../src/host/plugins";
import type { SkillFs } from "../../src/host/skills";

/** In-memory SkillFs where dirs maps a path to its child names. */
function memFs(files: Record<string, string>, dirs: Record<string, string[]>): SkillFs {
    const norm = (p: string) => p.replace(/\\/g, "/");
    return {
        async readDir(dir) {
            return (dirs[norm(dir)] ?? []).map((name) => {
                const child = `${norm(dir)}/${name}`;
                return [name, Boolean(dirs[child])] as [string, boolean];
            });
        },
        async readFile(p) {
            const c = files[norm(p)];
            if (c === undefined) throw new Error("ENOENT");
            return c;
        },
        async exists(p) {
            const n = norm(p);
            return n in files || n in dirs;
        },
    };
}

describe("normalizeManifest", () => {
    it("keeps valid fields and falls back to the directory name", () => {
        const m = normalizeManifest({ description: "d" }, "my-plugin")!;
        expect(m.name).toBe("my-plugin");
        expect(m.description).toBe("d");
    });
    it("filters out malformed commands", () => {
        const m = normalizeManifest({ name: "p", commands: [{ name: "ok", template: "t" }, { name: "bad" }, { template: "x" }] }, "p")!;
        expect(m.commands).toEqual([{ name: "ok", description: "", template: "t" }]);
    });
    it("returns undefined for non-objects", () => {
        expect(normalizeManifest(null, "x")).toBeUndefined();
        expect(normalizeManifest("nope", "x")).toBeUndefined();
    });
});

describe("normalizeCommandName", () => {
    it("lowercases and slugifies", () => {
        expect(normalizeCommandName("Review Code!")).toBe("review-code");
        expect(normalizeCommandName("  --Fix--  ")).toBe("fix");
    });
});

describe("expandCommand", () => {
    it("substitutes {{args}} inline", () => {
        expect(expandCommand("Review {{args}} now", "the diff")).toBe("Review the diff now");
    });
    it("appends args when there is no placeholder", () => {
        expect(expandCommand("Review this", "extra")).toBe("Review this\n\nextra");
    });
    it("returns the template unchanged when there are no args and no placeholder", () => {
        expect(expandCommand("Just do it", "")).toBe("Just do it");
    });
});

describe("loadPlugins", () => {
    it("loads a plugin's manifest, skills, commands, MCP servers, and system prompt", async () => {
        const fs = memFs(
            {
                "/plugins/quality/komind-plugin.json": JSON.stringify({
                    name: "quality",
                    systemPrompt: "Prefer small diffs.",
                    commands: [{ name: "review", description: "Review a diff", template: "Review: {{args}}" }],
                    mcpServers: { linter: { url: "https://lint.example" } },
                }),
                "/plugins/quality/skills/style/SKILL.md": "---\nname: style-guide\ndescription: House style\n---\nUse tabs.",
            },
            {
                "/plugins": ["quality"],
                "/plugins/quality": ["komind-plugin.json", "skills"],
                "/plugins/quality/skills": ["style"],
                "/plugins/quality/skills/style": ["SKILL.md"],
            },
        );
        const res = await loadPlugins(["/plugins"], fs);
        expect(res.plugins).toHaveLength(1);
        expect(res.commands.map((c) => c.name)).toEqual(["review"]);
        expect(res.skills.map((s) => s.name)).toEqual(["style-guide"]);
        expect(res.systemPrompts).toEqual(["Prefer small diffs."]);
        // MCP server key is namespaced by plugin
        expect(Object.keys(res.mcpServers)).toEqual(["quality-linter"]);
    });

    it("records an error for an invalid manifest instead of throwing", async () => {
        const fs = memFs(
            { "/plugins/broken/komind-plugin.json": "{ not json" },
            { "/plugins": ["broken"], "/plugins/broken": ["komind-plugin.json"] },
        );
        const res = await loadPlugins(["/plugins"], fs);
        expect(res.plugins).toHaveLength(0);
        expect(res.errors[0].name).toBe("broken");
    });

    it("disambiguates a duplicate command name across plugins", async () => {
        const manifest = (name: string) => JSON.stringify({ name, commands: [{ name: "run", template: "t" }] });
        const fs = memFs(
            {
                "/plugins/a/komind-plugin.json": manifest("a"),
                "/plugins/b/komind-plugin.json": manifest("b"),
            },
            {
                "/plugins": ["a", "b"],
                "/plugins/a": ["komind-plugin.json"],
                "/plugins/b": ["komind-plugin.json"],
            },
        );
        const res = await loadPlugins(["/plugins"], fs);
        const names = res.commands.map((c) => c.name).sort();
        // first "run" keeps the base name; the second is namespaced by its plugin
        expect(names).toContain("run");
        expect(names).toContain("b-run");
    });
});

describe("CommandRegistry", () => {
    const cmds: SlashCommand[] = [
        { name: "review", description: "Review", template: "Review the following:\n{{args}}" },
        { name: "explain", description: "Explain", template: "Explain this code." },
    ];

    it("expands a known slash command with arguments", () => {
        const reg = new CommandRegistry(cmds);
        expect(reg.expand("/review the auth module")).toBe("Review the following:\nthe auth module");
    });
    it("expands a command with no args", () => {
        const reg = new CommandRegistry(cmds);
        expect(reg.expand("/explain")).toBe("Explain this code.");
    });
    it("returns undefined for unknown or non-slash text", () => {
        const reg = new CommandRegistry(cmds);
        expect(reg.expand("/nope")).toBeUndefined();
        expect(reg.expand("just a normal message")).toBeUndefined();
    });
    it("is case-insensitive on the command name", () => {
        const reg = new CommandRegistry(cmds);
        expect(reg.expand("/REVIEW x")).toBe("Review the following:\nx");
    });
    it("first command wins on a duplicate name", () => {
        const reg = new CommandRegistry([
            { name: "dup", description: "", template: "first" },
            { name: "dup", description: "", template: "second" },
        ]);
        expect(reg.size).toBe(1);
        expect(reg.expand("/dup")).toBe("first");
    });
});
