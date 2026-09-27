#!/usr/bin/env python3
"""
Transform an already-converted `kiro-converted/` tree (Kiro CLI layout) into a
KoMind VS Code extension plugin bundle.

Why this exists
---------------
`claude_to_kiro.py` targets the Kiro CLI (`kiro-cli chat`), which reads
`prompts/`, `cli-agents/`, `rules/`, and a standalone `mcp.json`. The KoMind
VS Code panel reads NONE of those. KoMind only discovers:

  * skills   -> <workspace>/.komind/skills/<name>/SKILL.md   (or a plugin's skills/)
  * plugins  -> <workspace>/.komind/plugins/<name>/komind-plugin.json
               (contributes slash commands, MCP servers, a systemPrompt, skills)

So this script re-shapes the Kiro output into a single KoMind plugin:

  kiro-converted/prompts/skill-<name>.md   -> plugins/<bundle>/skills/<name>/SKILL.md
  kiro-converted/prompts/<command>.md      -> plugin commands[] (slash commands)
  kiro-converted/cli-agents/<name>.json    -> plugins/<bundle>/skills/agent-<name>/SKILL.md
  kiro-converted/rules/global.md           -> plugin systemPrompt
  kiro-converted/mcp.json                  -> plugin mcpServers
  kiro-converted/resources/skill-<name>/*  -> plugins/<bundle>/skills/<name>/ (copied)

The result loads directly in the KoMind panel: skills appear in the skill index
(pull them in with the load_skill tool), commands show in the slash menu, and
MCP servers connect on startup.

Reads only from --src, writes only into --out. Never mutates the source.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

DESC_RE = re.compile(r"<!--\s*description:\s*(.*?)\s*-->", re.DOTALL)
CONVERTED_RE = re.compile(r"^<!--\s*converted from Claude .*?-->\s*$", re.MULTILINE)


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip().lower())
    return s.strip("-") or "unnamed"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def strip_conversion_header(text: str):
    """Return (description, body) from a converted prompt/skill markdown file.

    The converter left two HTML comments at the top:
      <!-- converted from Claude ... -->
      <!-- description: ... -->
    Pull the description out and drop both comments from the body.
    """
    m = DESC_RE.search(text)
    description = m.group(1).strip() if m else ""
    # remove the conversion + description comments, keep the rest as the body
    body = DESC_RE.sub("", text, count=1)
    body = CONVERTED_RE.sub("", body, count=1)
    return description, body.strip()


def derive_description(body: str) -> str:
    for line in body.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:300]
    return ""


def write_skill(skills_root: Path, name: str, description: str, body: str):
    """Write a KoMind SKILL.md (YAML frontmatter + markdown body)."""
    slug = slugify(name)
    skill_dir = skills_root / slug
    skill_dir.mkdir(parents=True, exist_ok=True)
    desc = (description or derive_description(body)).replace("\n", " ").strip()
    front = f"---\nname: {name}\ndescription: {desc}\n---\n\n"
    (skill_dir / "SKILL.md").write_text(front + body + "\n", encoding="utf-8")
    return slug


def convert_skills(src: Path, skills_root: Path, log: list):
    prompts = src / "prompts"
    if not prompts.is_dir():
        return
    for f in sorted(prompts.glob("skill-*.md")):
        name = f.stem[len("skill-"):]  # skill-hunt-xss -> hunt-xss
        description, body = strip_conversion_header(read(f))
        slug = write_skill(skills_root, name, description, body)
        # copy matching resource files: resources/skill-<name>/** -> skills/<slug>/**
        res_dir = src / "resources" / f.stem  # e.g. resources/skill-ui-ux-pro-max
        extras = 0
        if res_dir.is_dir():
            for p in res_dir.rglob("*"):
                if p.is_file():
                    dest = skills_root / slug / p.relative_to(res_dir)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, dest)
                    extras += 1
        log.append(f"skill    {f.name:<34} -> skills/{slug}/SKILL.md" + (f"  (+{extras} files)" if extras else ""))


def convert_agents(src: Path, skills_root: Path, log: list):
    """Agents have no native KoMind concept; expose each as a loadable skill."""
    agents = src / "cli-agents"
    if not agents.is_dir():
        return
    for f in sorted(agents.glob("*.json")):
        try:
            data = json.loads(read(f))
        except json.JSONDecodeError:
            log.append(f"agent    {f.name:<34} -> SKIPPED (invalid JSON)")
            continue
        name = f"agent-{slugify(data.get('name') or f.stem)}"
        description = (data.get("description") or "").strip()
        body = (data.get("prompt") or "").strip()
        if not body:
            log.append(f"agent    {f.name:<34} -> SKIPPED (empty prompt)")
            continue
        slug = write_skill(skills_root, name, description, body)
        log.append(f"agent    {f.name:<34} -> skills/{slug}/SKILL.md")


def collect_commands(src: Path, log: list):
    """Non-skill prompts become KoMind slash commands."""
    prompts = src / "prompts"
    commands = []
    if not prompts.is_dir():
        return commands
    for f in sorted(prompts.glob("*.md")):
        if f.name.startswith("skill-"):
            continue
        name = slugify(f.stem)
        description, body = strip_conversion_header(read(f))
        # user args are appended by KoMind when the template has no {{args}}
        commands.append({
            "name": name,
            "description": (description or derive_description(body))[:200],
            "template": body,
        })
        log.append(f"command  {f.name:<34} -> commands[] (/{name})")
    return commands


def load_mcp(src: Path, log: list):
    mcp_path = src / "mcp.json"
    if not mcp_path.is_file():
        return {}
    try:
        data = json.loads(read(mcp_path))
    except json.JSONDecodeError:
        log.append("mcp      mcp.json                          -> SKIPPED (invalid JSON)")
        return {}
    servers = data.get("mcpServers", data) if isinstance(data, dict) else {}
    if servers:
        log.append(f"mcp      mcp.json                          -> plugin mcpServers ({len(servers)} server(s))")
    return servers


def load_system_prompt(src: Path, log: list):
    f = src / "rules" / "global.md"
    if not f.is_file():
        return None
    _, body = strip_conversion_header(read(f))
    body = body.strip()
    if body:
        log.append("rules    global.md                         -> plugin systemPrompt")
    return body or None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="kiro-converted", help="the kiro-converted tree to read")
    ap.add_argument("--out", default=".komind", help="KoMind config root to write (workspace .komind)")
    ap.add_argument("--bundle", default="claude-import", help="plugin bundle name")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        sys.exit(f"source not found: {src}")

    plugin_dir = Path(args.out) / "plugins" / slugify(args.bundle)
    skills_root = plugin_dir / "skills"
    plugin_dir.mkdir(parents=True, exist_ok=True)

    log: list = []
    convert_skills(src, skills_root, log)
    convert_agents(src, skills_root, log)
    commands = collect_commands(src, log)
    mcp_servers = load_mcp(src, log)
    system_prompt = load_system_prompt(src, log)

    manifest = {
        "name": slugify(args.bundle),
        "version": "1.0.0",
        "description": "Skills, commands, and MCP servers imported from a Claude Code config.",
    }
    if system_prompt:
        manifest["systemPrompt"] = system_prompt
    if commands:
        manifest["commands"] = commands
    if mcp_servers:
        manifest["mcpServers"] = mcp_servers
    # skills live in the default "skills/" subdir, so no explicit list is needed.

    (plugin_dir / "komind-plugin.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    skill_count = len(list(skills_root.glob("*/SKILL.md"))) if skills_root.is_dir() else 0
    print("\n".join(log))
    print(f"\nSkills : {skill_count}")
    print(f"Commands: {len(commands)}")
    print(f"MCP    : {len(mcp_servers)}")
    print(f"Plugin : {plugin_dir / 'komind-plugin.json'}")
    print("\nReload the VS Code window so KoMind re-scans .komind/.")


if __name__ == "__main__":
    main()
