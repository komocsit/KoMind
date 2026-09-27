import { describe, it, expect } from "vitest";
import { parseSkill, discoverSkills, SkillManager, type SkillFs } from "../../src/host/skills";

describe("parseSkill", () => {
    it("reads name and description from frontmatter", () => {
        const raw = [
            "---",
            "name: pdf-tools",
            "description: Fill and extract PDF forms",
            "---",
            "# PDF Tools",
            "Use pdftk to ...",
        ].join("\n");
        const skill = parseSkill(raw, "fallback");
        expect(skill).toBeDefined();
        expect(skill!.name).toBe("pdf-tools");
        expect(skill!.description).toBe("Fill and extract PDF forms");
        expect(skill!.body).toContain("# PDF Tools");
        expect(skill!.body).toContain("pdftk");
    });

    it("strips quotes from frontmatter values", () => {
        const raw = ["---", 'name: "quoted"', "description: 'single'", "---", "body"].join("\n");
        const skill = parseSkill(raw, "fallback")!;
        expect(skill.name).toBe("quoted");
        expect(skill.description).toBe("single");
    });

    it("falls back to the directory name and first body line when no frontmatter", () => {
        const raw = "# Heading\n\nThis skill does a thing.\nMore detail.";
        const skill = parseSkill(raw, "my-skill")!;
        expect(skill.name).toBe("my-skill");
        expect(skill.description).toBe("This skill does a thing.");
    });

    it("returns the whole document as body when there is no frontmatter", () => {
        const raw = "just some text";
        const skill = parseSkill(raw, "s")!;
        expect(skill.body).toBe("just some text");
    });

    it("tolerates a leading BOM before frontmatter", () => {
        const raw = "\uFEFF---\nname: bom\ndescription: d\n---\nbody";
        const skill = parseSkill(raw, "fallback")!;
        expect(skill.name).toBe("bom");
    });
});

/** In-memory SkillFs for discovery tests. `files` maps absolute paths to contents; dirs are inferred. */
function memFs(files: Record<string, string>, dirs: Record<string, string[]>): SkillFs {
    const norm = (p: string) => p.replace(/\\/g, "/");
    return {
        async readDir(dir) {
            const entries = dirs[norm(dir)] ?? [];
            return entries.map((name) => {
                const child = `${norm(dir)}/${name}`;
                const isDir = Boolean(dirs[child]);
                return [name, isDir] as [string, boolean];
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

describe("discoverSkills", () => {
    it("loads every subdirectory containing a SKILL.md", async () => {
        const fs = memFs(
            {
                "/root/a/SKILL.md": "---\nname: alpha\ndescription: da\n---\nbody a",
                "/root/b/SKILL.md": "---\nname: beta\ndescription: db\n---\nbody b",
            },
            {
                "/root": ["a", "b", "notaskill"],
                "/root/a": ["SKILL.md"],
                "/root/b": ["SKILL.md"],
                "/root/notaskill": ["readme.txt"],
            },
        );
        const skills = await discoverSkills(["/root"], fs);
        expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("skips roots that do not exist", async () => {
        const fs = memFs({}, {});
        const skills = await discoverSkills(["/missing"], fs);
        expect(skills).toEqual([]);
    });

    it("uses the directory name as the skill name when frontmatter omits it", async () => {
        const fs = memFs(
            { "/root/my-skill/SKILL.md": "just instructions" },
            { "/root": ["my-skill"], "/root/my-skill": ["SKILL.md"] },
        );
        const skills = await discoverSkills(["/root"], fs);
        expect(skills[0].name).toBe("my-skill");
    });
});

describe("SkillManager", () => {
    const mk = (name: string, description = "d", body = "b") => ({ name, description, body });

    it("indexText is empty when there are no skills", () => {
        expect(new SkillManager().indexText()).toBe("");
    });

    it("indexText lists each skill name and description", () => {
        const mgr = new SkillManager([mk("alpha", "does A"), mk("beta", "does B")]);
        const text = mgr.indexText();
        expect(text).toContain("load_skill");
        expect(text).toContain("alpha: does A");
        expect(text).toContain("beta: does B");
    });

    it("body returns the full skill body and undefined for unknown names", () => {
        const mgr = new SkillManager([mk("alpha", "d", "the instructions")]);
        expect(mgr.body("alpha")).toBe("the instructions");
        expect(mgr.body("nope")).toBeUndefined();
    });

    it("first skill wins on a name collision", () => {
        const mgr = new SkillManager([mk("dup", "d", "first"), mk("dup", "d", "second")]);
        expect(mgr.size).toBe(1);
        expect(mgr.body("dup")).toBe("first");
    });

    it("setSkills replaces the current set", () => {
        const mgr = new SkillManager([mk("old")]);
        mgr.setSkills([mk("new")]);
        expect(mgr.body("old")).toBeUndefined();
        expect(mgr.body("new")).toBeDefined();
    });
});
