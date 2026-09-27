# Claude Code → Kiro CLI conversion

Converts a Claude Code config tree (`C:\Users\VZK\.claude`) into Kiro CLI
equivalents. Kiro CLI has no separate "skills / commands / plugins" concepts —
they all collapse onto three native primitives:

| Claude concept            | Kiro CLI equivalent          | How you use it in `kiro-cli chat`        |
|---------------------------|------------------------------|------------------------------------------|
| `commands/*.md`           | `prompts/<name>.md`          | type `@<name>` (e.g. `@hunt`)            |
| `skills/<name>/SKILL.md`  | `prompts/skill-<name>.md`    | type `@skill-<name>` (e.g. `@skill-hunt-xss`) |
| skill resource files      | `resources/skill-<name>/…`   | referenced by the prompt as needed       |
| `agents/*.md`             | `cli-agents/<name>.json`     | `/agent <name>` or `--agent <name>`      |
| `CLAUDE.md`               | `rules/global.md`            | always-on steering context               |
| `plugins/cache/**`        | same rules, namespaced       | `--include-plugins` flag                 |

Kiro CLI has no plugin registry, so bundled plugin skills/commands/agents are
flattened into the same `prompts` / `cli-agents` folders (namespaced by plugin)
rather than kept as installable packages.

## Run

```bat
:: 1. convert (reads .claude, writes .\kiro-converted — never mutates source)
py tools\claude_to_kiro.py --src "C:\Users\VZK\.claude" --out ".\kiro-converted"

:: include plugin-bundled skills/commands/agents too
py tools\claude_to_kiro.py --src "C:\Users\VZK\.claude" --out ".\kiro-converted" --include-plugins

:: 2. preview the install (no writes)
powershell -ExecutionPolicy Bypass -File tools\install-to-kiro.ps1 -DryRun

:: 3. install into your Kiro CLI config home
powershell -ExecutionPolicy Bypass -File tools\install-to-kiro.ps1
```

If your Kiro CLI config home is not `%USERPROFILE%\.aws\amazonq`, pass it:

```bat
powershell -ExecutionPolicy Bypass -File tools\install-to-kiro.ps1 -ConfigRoot "C:\path\to\kiro\config"
```

## Notes

- Agents get conservative tool defaults (`fs_read`, `fs_write`, `execute_bash`
  granted; only `fs_read` auto-allowed). Review each `cli-agents/*.json` and
  widen/narrow `tools` / `allowedTools` to taste before trusting an agent to run
  unattended.
- Slash-command syntax inside skill/command bodies (e.g. `/hunt`, `/graphify`)
  is preserved verbatim as documentation, but in Kiro CLI you invoke the prompt
  with `@` instead of `/`.
- `CONVERSION_LOG.txt` in the output dir lists every file mapping.
