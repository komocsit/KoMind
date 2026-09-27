import * as path from "path";

/**
 * A loadable instruction package. A skill lives in its own directory as a
 * `SKILL.md` file: YAML-ish frontmatter (name, description) followed by the
 * markdown body of instructions. The model only sees each skill's name and
 * description up front (a compact index in the system prompt); it pulls in the
 * full body on demand via the `load_skill` tool. This keeps context small while
 * letting skills scale in number.
 */
export interface Skill {
    /** Unique skill name, used as the `load_skill` argument. */
    name: string;
    /** One-line summary shown in the index so the model knows when to load it. */
    description: string;
    /** Full markdown instructions returned when the skill is loaded. */
    body: string;
    /** Absolute directory the skill was loaded from (for resolving its files). */
    dir?: string;
}

/**
 * Parse a SKILL.md document into a Skill. Supports a leading YAML frontmatter
 * block delimited by `---` lines with `name:` and `description:` keys. When no
 * frontmatter is present, the name falls back to `fallbackName` and the
 * description to the first non-empty body line. Returns undefined only when a
 * usable name cannot be determined.
 */
export function parseSkill(raw: string, fallbackName: string, dir?: string): Skill | undefined {
    let name = "";
    let description = "";
    let body = raw;

    const fm = matchFrontmatter(raw);
    if (fm) {
        body = fm.body;
        for (const [key, value] of fm.entries) {
            if (key === "name") name = value;
            else if (key === "description") description = value;
        }
    }

    if (!name) name = fallbackName;
    name = name.trim();
    if (!name) return undefined;

    if (!description) {
        const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
        description = firstLine ?? "";
    }

    return { name, description: description.trim(), body: body.trim(), dir };
}

/** Extract a leading `---` frontmatter block and its key/value entries. */
function matchFrontmatter(raw: string): { entries: [string, string][]; body: string } | undefined {
    const normalized = raw.replace(/^\uFEFF/, "");
    if (!/^---\s*\r?\n/.test(normalized)) return undefined;
    const end = normalized.indexOf("\n---", 4);
    if (end < 0) return undefined;
    const header = normalized.slice(normalized.indexOf("\n") + 1, end);
    const afterMarker = normalized.indexOf("\n", end + 1);
    const body = afterMarker >= 0 ? normalized.slice(afterMarker + 1) : "";
    const entries: [string, string][] = [];
    for (const line of header.split(/\r?\n/)) {
        const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
        if (m) entries.push([m[1].toLowerCase(), stripQuotes(m[2].trim())]);
    }
    return { entries, body };
}

function stripQuotes(s: string): string {
    if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
        return s.slice(1, -1);
    }
    return s;
}

/** Filesystem access a skill loader needs, injectable for testing. */
export interface SkillFs {
    /** Directory entries as [name, isDirectory] pairs. */
    readDir(dir: string): Promise<[string, boolean][]>;
    readFile(path: string): Promise<string>;
    /** True if the path exists. */
    exists(path: string): Promise<boolean>;
}

/**
 * Discover skills under a set of root directories. Each immediate subdirectory
 * of a root that contains a `SKILL.md` is loaded as one skill. Later roots win
 * on name collisions is NOT applied here — the caller (SkillManager) enforces
 * first-wins ordering so precedence is explicit.
 */
export async function discoverSkills(roots: string[], fs: SkillFs): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const root of roots) {
        if (!(await fs.exists(root))) continue;
        let entries: [string, boolean][];
        try { entries = await fs.readDir(root); } catch { continue; }
        for (const [entryName, isDir] of entries) {
            if (!isDir) continue;
            const dir = path.join(root, entryName);
            const skillFile = path.join(dir, "SKILL.md");
            if (!(await fs.exists(skillFile))) continue;
            try {
                const raw = await fs.readFile(skillFile);
                const skill = parseSkill(raw, entryName, dir);
                if (skill) skills.push(skill);
            } catch { /* skip unreadable skill */ }
        }
    }
    return skills;
}

/**
 * Holds the discovered skills and produces the compact index injected into the
 * system prompt plus on-demand lookup for the `load_skill` tool. Names are
 * unique (first wins) so the model never sees an ambiguous skill.
 */
export class SkillManager {
    private readonly byName = new Map<string, Skill>();

    constructor(skills: Skill[] = []) {
        this.setSkills(skills);
    }

    /** Replace the current skill set (e.g. after a re-scan). */
    setSkills(skills: Skill[]): void {
        this.byName.clear();
        for (const skill of skills) {
            if (!this.byName.has(skill.name)) this.byName.set(skill.name, skill);
        }
    }

    /** All skills in discovery order. */
    list(): Skill[] { return [...this.byName.values()]; }

    /** Number of loaded skills. */
    get size(): number { return this.byName.size; }

    /** Full body of a skill, or undefined if the name is unknown. */
    body(name: string): string | undefined {
        return this.byName.get(name)?.body;
    }

    /**
     * A compact skill index for the system prompt. Empty string when there are no
     * skills, so callers can concatenate unconditionally. The model is told to
     * call `load_skill` to read a skill's full instructions when relevant.
     */
    indexText(): string {
        if (this.byName.size === 0) return "";
        const lines = this.list().map((s) => `- ${s.name}: ${s.description || "(no description)"}`);
        return [
            "You have access to Skills — reusable instruction packages for specific tasks.",
            "When a user's request matches one, call the `load_skill` tool with its name to read its full instructions before proceeding.",
            "Available skills:",
            ...lines,
        ].join("\n");
    }
}
