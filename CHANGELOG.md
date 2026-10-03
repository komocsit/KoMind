# Changelog

## 1.4.0

- Redesigned the chat as a timeline: each agent step (reply, thought, tool call, error) is a status dot on a vertical rail (green done, red failed, amber awaiting approval, pulsing while running). Tool steps read like `Edit src/app.ts` with a one-line outcome ("Added 2 lines", "Modified · +3 −1", "12 matches"); file paths open the file. Diffs show inline and collapse long changes behind "Click to expand"; terminal steps show IN/OUT blocks; reasoning is a compact "Thought for Ns" row. The composer is a single rounded input with attach, mic and send inside.

- API keys (chat and voice) can be entered directly in the Settings window as password fields with a show/hide toggle, saved with the Save button. Saved keys are never sent back to the webview.
- Fixed: replacing the API key now takes effect immediately in open chats instead of after a reload. Registered the **KoMind: Set API Key** command, which the "no API key" error pointed to but did not exist.

- Voice input: a mic button in the composer records speech and inserts the transcript into the message box for review. Transcription uses an OpenAI-style endpoint — Azure AI Foundry / Azure OpenAI Whisper or gpt-4o-transcribe deployments (api-key auth), OpenAI, or compatible servers — configured under Settings → Voice input with its own key (**KoMind: Set Voice Input API Key**). Windows records with no extra installs; macOS/Linux use ffmpeg. Recordings stop after 2 minutes; Esc discards.

- Added `find_files` (recursive glob) and `search_code` (regex content search) tools so the agent can locate code without walking directories file by file. Both skip node_modules, .git, dist and out, and are available in plan mode and to sub-agents.
- `read_file` now truncates files over 100K characters instead of flooding the context.
- Task-based sub-agents: each `run_subagents` task takes a `type` — `explore`, `plan`, `review` (read-only), `test` (runs build/tests, no edits), `debug` (root-cause fix and verify), `docs` (read + edit, no behavior changes) or `general` (full tools, the default). Each type has its own tool set and instructions; plan-mode restrictions still apply on top.
- Sub-agents now receive the skills index and plugin system prompts, so they can find and load skills.
- Orchestrator: outside plan mode the main agent acts as Hermes, delegating work to sub-agents by task type and/or by skill. A `run_subagents` task can set `skill` to preload that skill's instructions into the sub-agent; unknown skill names are rejected before any sub-agent starts. The sub-agent card shows Hermes at the top with each agent's type and skill beneath.
- Sub-agent cards show agent icons and Greek codenames matched to the task type (Hephaestus builds, Artemis explores, Athena plans, Argus reviews, Nemesis tests, Ariadne debugs, Calliope writes docs), replacing the animal avatars.

## 1.3.0

- Introduced a pluggable tool registry: built-in tools are now one `ToolProvider` among many, so external tool sources can be added without touching the agent loop.
- Added MCP (Model Context Protocol) support via `koMind.mcpServers`. Connect stdio or Streamable HTTP servers to expose third-party tools to the agent. MCP tools are namespaced `mcp__<server>__<tool>` and always require explicit approval.
- Added Skills: reusable instruction packages discovered from <workspace>/.komind/skills/ and global storage. Skill names and descriptions are indexed in the system prompt and the agent pulls in full instructions on demand via the load_skill tool.
- Added Plugins: bundle skills, MCP servers, slash commands, and a system-prompt fragment behind a komind-plugin.json manifest, discovered from <workspace>/.komind/plugins/ and global storage. Slash commands (/name args) expand to prompt templates with an autocomplete menu in the composer.

## 1.2.0

- Added a `create_file` tool so the agent can create new files (with approval routing when auto-approve is off).
- Edits and new files now show inline diffs with added/removed line counts.
- Improved network resilience: up to 5 retries with rate-limit (429) and connection error (ECONNRESET/ETIMEDOUT) handling, and no retry once output has started streaming.

## 1.1.0

- Added image uploads through the attachment menu.
- Added controls to create and delete sessions.
- Added the ability to stop an in-progress agent turn.
- Improved chat initialization and session switching.

## 1.0.0

- Model reasoning effort now defaults to High.
- Initial Marketplace release.
- Added configurable API, model, token, effort, and approval settings.
- Added file tools, terminal approvals, session history, and plan/build modes.
- Agent file edits are saved immediately and remain reviewable through Git/Source Control without an editor save prompt.
