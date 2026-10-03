# KoMind — VS Code Extension

<p align="center">
  <img src="media/komind-logo.png" alt="KoMind logo" width="180" />
</p>

A VS Code extension that embeds a coding agent in the activity bar. The agent chats with an Anthropic-compatible API endpoint (default `https://api.justwoker.icu`), and can read files, list directories, apply edits with visual diffs, and run terminal commands behind an approval gate. Sessions are persisted to global storage and can be reloaded from a dropdown.

## Dev setup

```powershell
npm install
npm run watch   # or: npm run compile
```

Then open the folder in VS Code and press **F5** (Run Extension) to launch the Extension Development Host.

## Set API key

Open KoMind **Settings** (gear icon), paste your key into **API key** and click **Save** (or run the command **KoMind: Set API Key**). A new key takes effect immediately, including in open chats. It is stored securely via VS Code SecretStorage (never written to settings or disk in plaintext).

## Settings

| Setting | Default | Description |
|---|---|---|
| `koMind.baseUrl` | `https://api.justwoker.icu` | API base URL (Anthropic-compatible) |
| `koMind.model` | `gpt-5.6-sol` | Model name sent to the API |
| `koMind.maxTokens` | `4096` | Max tokens per completion |
| `koMind.effort` | `high` | Default reasoning effort sent to the API |
| `koMind.autoApproveEdits` | `true` | Apply file edits automatically |
| `koMind.autoApproveTerminal` | `false` | Require approval for terminal commands |
| `koMind.mcpServers` | `{}` | MCP servers to connect on startup (see below) |
| `koMind.voice.transcriptionUrl` | `""` | Speech-to-text endpoint for voice input (see below) |
| `koMind.voice.model` | `""` | Optional `model` field for transcription requests |
| `koMind.voice.language` | `""` | Optional spoken-language hint, e.g. `en` |

## Voice input

Click the mic button next to Send, speak, then click it again (it shows a red timer while recording). The transcript is inserted into the message box for review — it is never sent automatically. Esc or ✕ discards the recording; recordings stop on their own after 2 minutes.

VS Code webviews cannot access the microphone, so the extension host records audio itself: on Windows through built-in Windows APIs (no installs), on macOS/Linux through `ffmpeg` (must be on PATH). The audio is sent to an OpenAI-style `audio/transcriptions` endpoint.

**Azure AI Foundry setup**

1. In your Foundry project, deploy a speech-to-text model such as `whisper` or `gpt-4o-transcribe`.
2. Open KoMind **Settings → Voice input** and set the transcription URL:
   `https://<resource>.openai.azure.com/openai/deployments/<deployment>/audio/transcriptions?api-version=2025-03-01-preview`
   (a `*.cognitiveservices.azure.com` endpoint works too). Leave *Model* empty.
3. Paste the resource's API key into **Voice API key** and click **Save** (or run **KoMind: Set Voice Input API Key**). It is kept in SecretStorage.

Azure hosts are authenticated with the `api-key` header; other hosts (OpenAI, Groq, local Whisper servers) get `Authorization: Bearer <key>` — set *Model* (e.g. `whisper-1`) for those.

## MCP servers (external tools)

KoMind can connect to [Model Context Protocol](https://modelcontextprotocol.io) servers to add third-party tools (GitHub, databases, docs, browsers, …) without any code changes. Configure them under `koMind.mcpServers`, keyed by a short server name:

```json
"koMind.mcpServers": {
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "docs":   { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
}
```

- **stdio servers** — set `command` plus optional `args`, `env`, `cwd`.
- **HTTP servers** — set `url` plus optional `headers` (Streamable HTTP transport).
- Set `"enabled": false` to keep a server configured but disconnected.

Connected servers' tools appear to the agent namespaced as `mcp__<server>__<tool>` and render as `server · tool` in the chat. **Every MCP tool call requires explicit approval** — external servers are untrusted and the always-allow grants do not apply to them.

> **Security:** MCP servers are external processes with access to your machine and any credentials you pass them. Only add servers you trust.

## Skills

Skills are reusable instruction packages the agent loads on demand. A skill is a directory containing a `SKILL.md` file:

```
.komind/skills/
  pdf-forms/
    SKILL.md
```

`SKILL.md` has optional YAML frontmatter (`name`, `description`) followed by the instruction body:

```markdown
---
name: pdf-forms
description: Fill and extract data from PDF forms
---

# Filling PDF forms

1. Use `pdftk` to inspect fields: `pdftk form.pdf dump_data_fields`
2. ...
```

KoMind discovers skills from two locations (workspace takes precedence on name collisions):

- `<workspace>/.komind/skills/` — project-specific skills, checked into the repo
- `<globalStorage>/skills/` — personal skills available in every workspace

At startup the agent's system prompt gets a compact index of skill names and descriptions. When a request matches, the model calls the `load_skill` tool to pull in the full body before proceeding — so many skills can exist without bloating the context.

> Skills are untrusted content: their instructions are treated as data. Review a workspace's skills before relying on them.

## Plugins & slash commands

Plugins bundle skills, MCP servers, slash commands, and a system-prompt fragment behind a single manifest. A plugin is a directory containing `komind-plugin.json`:

```
.komind/plugins/
  code-quality/
    komind-plugin.json
    skills/
      style-guide/
        SKILL.md
```

```json
{
  "name": "code-quality",
  "description": "Code review helpers",
  "systemPrompt": "Prefer small, focused diffs.",
  "commands": [
    { "name": "review", "description": "Review a diff", "template": "Review the following and flag issues:\n\n{{args}}" }
  ],
  "mcpServers": {
    "linter": { "command": "npx", "args": ["-y", "@example/mcp-linter"] }
  },
  "skills": ["skills"]
}
```

All sections are optional. Plugins are discovered from `<workspace>/.komind/plugins/` and `<globalStorage>/plugins/`. Their contributions are wired in automatically:

- **Skills** — loaded into the skill index (see above).
- **MCP servers** — connected on startup, namespaced by plugin (`<plugin>-<server>`).
- **System prompt** — appended to every session's system prompt.
- **Slash commands** — typing `/name args` in the chat expands to the command's prompt template. `{{args}}` is replaced with what you type after the command; without a placeholder, your text is appended. The composer shows an autocomplete menu as you type `/`. Duplicate command names across plugins are namespaced (`<plugin>-<name>`).

> Plugins are untrusted content, just like skills and MCP servers. Review a plugin's manifest before enabling it.

## Tool permission model

- **Edits** (`apply_edit`): accepted edits are always saved immediately, independent of VS Code's `files.autoSave` setting, so no Save/Don't Save prompt is needed. `autoApproveEdits` only controls whether approval is required before applying an edit and defaults to `true`. Review changes with Git/Source Control. Non-unique or missing `oldString` matches are rejected with an error.
- **Terminal** (`run_terminal`): requires explicit user approval in the chat card (Approve/Reject buttons). Unanswered requests auto-reject after 60 seconds.

## Architecture

- **Extension host** (`src/host/`): `extension.ts` (webview provider + HTML/CSP), `provider.ts` (API streaming client), `agent.ts` (agent loop, tool-call orchestration), `tools.ts` (read_file, list_dir, find_files, search_code, apply_edit, create_file, run_terminal, run_subagents, load_skill), `toolRegistry.ts` (pluggable `ToolProvider` registry aggregating built-in + external tools), `mcp.ts` (MCP client manager exposing external servers as tool providers), `subagent.ts` (parallel headless sub-agents), `approvals.ts` (approval manager with 60s timeout), `store.ts` (JSON-file session persistence).
- **Webview** (`src/webview/`): React chat UI (`App.tsx`, `api.ts`) — streaming markdown (marked + DOMPurify), tool cards, approval buttons, session switcher.
- **Shared** (`src/shared/`): typed `postMessage` protocol (`protocol.ts`).

## Tests

```powershell
npm run test:unit         # vitest (protocol, tools, store, agent, provider)
npm run test:integration  # @vscode/test-electron (activation, commands)
npx tsc --noEmit          # typecheck
```

## Repo layout

```
src/
  host/        extension entry, provider, agent, tools, approvals, store
  webview/     React chat UI
  shared/      typed message protocol
test/
  unit/        vitest suites
  integration/ vscode-test-electron suite
esbuild.js     bundler (host + webview)
```
