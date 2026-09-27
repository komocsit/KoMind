#!/usr/bin/env python3
"""
Convert a Claude Code config tree (skills / commands / agents / plugins / CLAUDE.md)
into Kiro CLI equivalents.

Mapping
-------
  commands/*.md                 -> prompts/<name>.md            (invoke with @name)
  skills/<name>/SKILL.md        -> prompts/skill-<name>.md      (+ copy any sibling resource files)
  agents/*.md                   -> cli-agents/<name>.json       (frontmatter -> fields, body -> prompt)
  CLAUDE.md                     -> rules/global.md              (steering / always-on context)
  plugins/cache/**/{skills,commands,agents}  -> same rules as above, namespaced by plugin

The script only *reads* the source tree and *writes* into OUT_DIR. It never mutates the source.
Run it against a staging dir first, review, then copy into the live Kiro config directory.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def parse_frontmatter(text: str):
    """Return (meta: dict, body: str). Tolerates missing/partial frontmatter."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    raw, body = m.group(1), m.group(2)
    meta = {}
    key = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        # simple "key: value" — good enough for name/description style frontmatter
        mm = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if mm:
            key = mm.group(1).strip()
            val = mm.group(2).strip()
            # strip matching surrounding quotes
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            meta[key] = val
        elif key is not None:
            # continuation line for a folded value
            meta[key] = (meta[key] + " " + line.strip()).strip()
    return meta, body.strip()


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip().lower())
    return s.strip("-") or "unnamed"


def write_prompt(out_prompts: Path, name: str, meta: dict, body: str, origin: str):
    out_prompts.mkdir(parents=True, exist_ok=True)
    slug = slugify(name)
    desc = meta.get("description", "").strip()
    header = f"<!-- converted from Claude {origin} -->\n"
    if desc:
        header += f"<!-- description: {desc} -->\n"
    content = f"{header}\n# {meta.get('name', name)}\n\n{body}\n"
    (out_prompts / f"{slug}.md").write_text(content, encoding="utf-8")
    return slug


def derive_description(body: str) -> str:
    """First heading text, else first non-empty prose line — used when
    frontmatter provides no description."""
    for line in body.splitlines():
        s = line.strip()
        if not s:
            continue
        s = s.lstrip("#").strip()
        if s:
            return s[:200]
    return ""


def write_agent(out_agents: Path, name: str, meta: dict, body: str, origin: str):
    out_agents.mkdir(parents=True, exist_ok=True)
    slug = slugify(name)
    description = meta.get("description", "").strip() or derive_description(body)
    agent = {
        "name": meta.get("name", name),
        "description": description,
        "prompt": body,
        # Conservative defaults — Kiro agents opt into tools explicitly.
        "tools": ["fs_read", "fs_write", "execute_bash"],
        "allowedTools": ["fs_read"],
        "resources": [],
        "_convertedFrom": f"Claude {origin}",
    }
    (out_agents / f"{slug}.json").write_text(
        json.dumps(agent, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return slug


def convert_commands(src: Path, out: Path, log: list):
    d = src / "commands"
    if not d.is_dir():
        return
    for f in sorted(d.glob("*.md")):
        meta, body = parse_frontmatter(f.read_text(encoding="utf-8", errors="replace"))
        name = meta.get("name") or f.stem
        slug = write_prompt(out / "prompts", name, meta, body, f"command {f.name}")
        log.append(f"command  {f.name:<28} -> prompts/{slug}.md")


def convert_skills(src: Path, out: Path, log: list, plugin: str = ""):
    d = src / "skills"
    if not d.is_dir():
        return
    ns = f"{slugify(plugin)}-" if plugin else ""
    for skilldir in sorted(p for p in d.iterdir() if p.is_dir()):
        skillmd = skilldir / "SKILL.md"
        if not skillmd.is_file():
            # some entries use "<name>.skill" or a single md; try any *.md
            mds = list(skilldir.glob("*.md"))
            if not mds:
                continue
            skillmd = mds[0]
        meta, body = parse_frontmatter(skillmd.read_text(encoding="utf-8", errors="replace"))
        name = meta.get("name") or skilldir.name
        prompt_name = f"skill-{ns}{slugify(name)}"
        slug = write_prompt(out / "prompts", prompt_name, meta, body, f"skill {skilldir.name}")
        # copy any non-SKILL.md resource files (references, scripts, assets)
        extras = [p for p in skilldir.rglob("*") if p.is_file() and p.name.lower() != "skill.md"]
        if extras:
            res_root = out / "resources" / slug
            for p in extras:
                rel = p.relative_to(skilldir)
                dest = res_root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, dest)
            log.append(f"skill    {skilldir.name:<28} -> prompts/{slug}.md  (+{len(extras)} resource files)")
        else:
            log.append(f"skill    {skilldir.name:<28} -> prompts/{slug}.md")


def convert_agents(src: Path, out: Path, log: list):
    d = src / "agents"
    if not d.is_dir():
        return
    for f in sorted(d.glob("*.md")):
        meta, body = parse_frontmatter(f.read_text(encoding="utf-8", errors="replace"))
        name = meta.get("name") or f.stem.replace(".agent", "")
        slug = write_agent(out / "cli-agents", name, meta, body, f"agent {f.name}")
        log.append(f"agent    {f.name:<28} -> cli-agents/{slug}.json")


def convert_rules(src: Path, out: Path, log: list):
    f = src / "CLAUDE.md"
    if not f.is_file():
        return
    (out / "rules").mkdir(parents=True, exist_ok=True)
    body = f.read_text(encoding="utf-8", errors="replace")
    (out / "rules" / "global.md").write_text(
        "<!-- converted from Claude CLAUDE.md -->\n\n" + body, encoding="utf-8"
    )
    log.append("rules    CLAUDE.md                    -> rules/global.md")


def convert_plugins(src: Path, out: Path, log: list):
    cache = src / "plugins" / "cache"
    if not cache.is_dir():
        return
    # cache/<marketplace>/<plugin>/<version>/{skills,commands,agents}
    for version_dir in cache.glob("*/*/*"):
        if not version_dir.is_dir():
            continue
        plugin = version_dir.parent.name
        has_any = any((version_dir / s).is_dir() for s in ("skills", "commands", "agents"))
        if not has_any:
            continue
        log.append(f"--- plugin: {plugin} ({version_dir.relative_to(cache)}) ---")
        convert_skills(version_dir, out, log, plugin=plugin)
        # plugin commands / agents flow through the same converters
        convert_commands(version_dir, out, log)
        convert_agents(version_dir, out, log)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-plugins", action="store_true")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not src.is_dir():
        sys.exit(f"source not found: {src}")
    out.mkdir(parents=True, exist_ok=True)

    log: list = []
    convert_commands(src, out, log)
    convert_skills(src, out, log)
    convert_agents(src, out, log)
    convert_rules(src, out, log)
    if args.include_plugins:
        convert_plugins(src, out, log)

    (out / "CONVERSION_LOG.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))
    print(f"\nTotal entries: {len(log)}")
    print(f"Output: {out}")


if __name__ == "__main__":
    main()
