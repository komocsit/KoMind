# SDD ledger — plan: docs/superpowers/plans/2026-09-11-vscode-agent-extension.md

## Preflight conflict scan

| Tasks | Interface shared | Finding |
|---|---|---|
| 3/4 | ToolDef/TOOL_DEFS | Provider imports TOOL_DEFS from tools.ts — consistent signatures |
| 4/6 | Provider, StreamEvent, AnthropicMessage | match |
| 5/6 | SessionStore.append/load | match |
| 6/7 | AgentSession ctor, AgentUi | match |
| 7/4 | setKey addition | Plan itself mandates a provider refactor in Task 7 (setKey) — noted in plan; implementer must re-run Task 4 tests. Ruling: implement setKey in Task 4 directly to avoid churn — no, plan says add in Task 7; keep plan order. |
| 8/2 | protocol types | CardView uses sessionIdRef from App scope — plan notes to hoist/onRetry prop; implementer instructed to use onRetry prop |
| 1/9 | dist layout, esbuild | Task 9 adds third esbuild entry — extension of Task 1 scaffold, no conflict |

Scan clean apart from notes above. No spec contradictions found. Global Constraints re-checked against each task: settings prefix, defaults, SecretStorage-only keys, workspace path confinement, 60s approval timeout all carried in relevant briefs.

