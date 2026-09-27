# Changelog

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
