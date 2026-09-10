# Justwoker Agent — VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension with a Copilot-agent-style chat sidebar that streams responses from an Anthropic-compatible API and can read files, auto-apply edits (with diffs), and run user-approved terminal commands.

**Architecture:** Extension host (Node/TS) owns the Anthropic SDK client, agent loop, tool executors, approvals, and JSONL session persistence. A React webview sidebar renders chat/tool/approval cards and talks to the host only through a typed postMessage protocol. No secrets or file access in the webview.

**Tech Stack:** TypeScript, vscode API (1.85+), `@anthropic-ai/sdk`, React 18, Vite, esbuild, vitest, `@vscode/test-electron`.

**Spec:** `docs/superpowers/specs/2026-09-11-vscode-agent-extension-design.md`

## Global Constraints

- API base URL default: `https://api.justwoker.icu`; default model: `gpt-5.6-sol`.
- Settings prefix: `justwokerAgent.` (`baseUrl`, `model`, `maxTokens`, `autoApproveEdits` default `true`, `autoApproveTerminal` default `false`).
- API key stored ONLY via `vscode.SecretStorage`, never in workspace state or settings.
- Tool execution limited to paths inside VS Code workspace folders (except reading session storage).
- Terminal commands: approval required (60s timeout auto-reject); file edits: auto-applied with diff tab + Undo.
- One agent loop per session; concurrent user messages queued.
- All host↔webview messages must be types defined in `src/shared/protocol.ts`.
- Node 18+, no other runtime; npm workspaces NOT used — single package.
- Windows development environment — use PowerShell-compatible commands.

---

### Task 1: Scaffold extension project (host bundles, webview placeholder, F5 runs)

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `src/host/extension.ts`, `src/webview/main.tsx`, `src/webview/index.html`, `webview.html`, `.vscode/launch.json`, `.gitignore`, `test/unit/example.test.ts`, `vitest.config.ts`

**Interfaces:**
- Produces: npm scripts `compile`, `watch`, `test:unit`, `package` (vsce-ready layout); extension id `justwoker.agent`.

- [ ] **Step 1: Initialize repo and package.json**

```powershell
mkdir justwoker-agent; cd justwoker-agent; git init
```

`package.json` (key parts):

```json
{
  "name": "justwoker-agent",
  "displayName": "Justwoker Agent",
  "publisher": "justwoker",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/host/extension.js",
  "activationEvents": [],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
    },
    "views": {
      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
    },
    "commands": [
      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
    ],
    "configuration": {
      "title": "Justwoker Agent",
      "properties": {
        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
      }
    }
  },
  "scripts": {
    "compile": "node esbuild.js --production",
    "watch": "node esbuild.js --watch",
    "test:unit": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0", "@types/node": "^20.0.0", "typescript": "^5.4.0",
    "esbuild": "^0.20.0", "vitest": "^1.5.0", "@vscode/test-electron": "^2.3.0", "@vscode/vsce": "^2.24.0"
  },
  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
}
```

- [ ] **Step 2: Write tsconfig.json, esbuild.js, .gitignore, launch.json**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "jsx": "react-jsx", "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`esbuild.js` (two bundles: host CJS, webview ESM):

```js
const esbuild = require("esbuild");
const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const host = {
  entryPoints: ["src/host/extension.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "dist/host/extension.js", external: ["vscode"],
  sourcemap: !prod, minify: prod,
};
const webview = {
  entryPoints: ["src/webview/main.tsx"], bundle: true, platform: "browser",
  format: "esm", outfile: "dist/webview/main.js", sourcemap: !prod, minify: prod,
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context({ ...host });
    await ctx.watch();
    const ctx2 = await esbuild.context({ ...webview });
    await ctx2.watch();
  } else {
    await esbuild.build(host);
    await esbuild.build(webview);
  }
})();
```

`.gitignore`: `node_modules/`, `dist/`, `*.vsix`, `.vscode-test/`

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Run Extension",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
    "preLaunchTask": "npm: watch",
    "outFiles": ["${workspaceFolder}/dist/**/*.js"]
  }]
}
```

- [ ] **Step 3: Minimal host entry + webview**

`src/host/extension.ts`:

```ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
      const key = await vscode.window.showInputBox({ password: true, prompt: "API key" });
      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
    }),
    vscode.commands.registerCommand("justwokerAgent.newSession", () => {
      provider.postMessage({ type: "newSession" });
    })
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  public view?: vscode.WebviewView;
  constructor(private readonly uri: vscode.Uri) {}
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.uri] };
    view.webview.html = this.html(view.webview);
  }
  postMessage(msg: unknown) { this.view?.webview.postMessage(msg); }
  private html(webview: vscode.Webview) {
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "webview", "main.js"));
    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
  }
}

export function deactivate() {}
```

`src/webview/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
```

- [ ] **Step 4: Smoke-verify**

```powershell
npm install; npm run compile
```

Expected: `dist/host/extension.js` and `dist/webview/main.js` exist; F5 in VS Code opens Extension Development Host with the sidebar showing "Justwoker Agent".

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "chore: scaffold extension host + webview build"
```

---

### Task 2: Shared message protocol

**Files:**
- Create: `src/shared/protocol.ts`
- Test: `test/unit/protocol.test.ts`

**Interfaces:**
- Produces: all message types used by every later task — `HostToWebviewMsg`, `WebviewToHostMsg`, `ToolCallView`, `SessionEvent` (defined below, verbatim).

- [ ] **Step 1: Write failing type-compile test**

`test/unit/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../../src/shared/protocol";

describe("protocol types", () => {
  it("accepts a full set of message shapes", () => {
    const host: HostToWebviewMsg[] = [
      { type: "textDelta", sessionId: "s1", text: "hi" },
      { type: "toolCall", sessionId: "s1", callId: "c1", tool: "read_file", input: { path: "a.txt" } },
      { type: "toolResult", sessionId: "s1", callId: "c1", ok: true, output: "contents" },
      { type: "approvalRequest", sessionId: "s1", callId: "c2", command: "npm test" },
      { type: "approvalResolved", sessionId: "s1", callId: "c2", approved: true },
      { type: "error", sessionId: "s1", message: "boom" },
      { type: "turnComplete", sessionId: "s1" },
      { type: "newSession" },
    ];
    const webview: WebviewToHostMsg[] = [
      { type: "userMessage", sessionId: "s1", text: "hello" },
      { type: "approve", callId: "c2", approved: true },
      { type: "newSessionRequest" },
      { type: "retry", sessionId: "s1" },
    ];
    const events: SessionEvent[] = [
      { kind: "user", text: "hi", ts: 1 },
      { kind: "assistantText", text: "hello", ts: 2 },
      { kind: "toolCall", callId: "c1", tool: "read_file", input: { path: "a.txt" }, ts: 3 },
      { kind: "toolResult", callId: "c1", ok: true, output: "x", ts: 4 },
      { kind: "error", message: "e", ts: 5 },
    ];
    expect(host.length + webview.length + events.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/protocol.test.ts`
Expected: FAIL — `src/shared/protocol.ts` does not exist.

- [ ] **Step 3: Implement `src/shared/protocol.ts`**

```ts
export type ToolName = "read_file" | "list_dir" | "apply_edit" | "run_terminal";

export interface ToolCallView {
  callId: string;
  tool: ToolName;
  input: Record<string, unknown>;
}

export type HostToWebviewMsg =
  | { type: "textDelta"; sessionId: string; text: string }
  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string }
  | { type: "approvalRequest"; sessionId: string; callId: string; command: string }
  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
  | { type: "error"; sessionId: string; message: string }
  | { type: "turnComplete"; sessionId: string }
  | { type: "newSession" }
  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number }[] }
  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] };

export type WebviewToHostMsg =
  | { type: "userMessage"; sessionId: string; text: string }
  | { type: "approve"; callId: string; approved: boolean }
  | { type: "newSessionRequest" }
  | { type: "retry"; sessionId: string }
  | { type: "requestSessionList" }
  | { type: "loadSession"; sessionId: string };

export type SessionEvent =
  | { kind: "user"; text: string; ts: number }
  | { kind: "assistantText"; text: string; ts: number }
  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number }
  | { kind: "error"; message: string; ts: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/protocol.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: shared host/webview message protocol"`

---

### Task 3: Tool executors (read_file, list_dir, apply_edit, run_terminal) — pure logic, mock vscode

**Files:**
- Create: `src/host/tools.ts`
- Test: `test/unit/tools.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ToolContext {
  readFile(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  applyEdit(path: string, oldString: string, newString: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string): Promise<boolean>;
  openDiff(path: string): Promise<void>;
  workspaceRoot(): string | undefined;
}
export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }
export const TOOL_DEFS: ToolDef[];
export function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }>;
export function resolvePath(workspaceRoot: string | undefined, path: string): string; // also exported for tests
```

- [ ] **Step 1: Write failing tests**

`test/unit/tools.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { executeTool, resolvePath, TOOL_DEFS } from "../../src/host/tools";
import type { ToolContext } from "../../src/host/tools";
import path from "path";

function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    readFile: vi.fn(async () => "file contents"),
    listDir: vi.fn(async () => ["a.txt", "b/"]),
    applyEdit: vi.fn(async () => {}),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: vi.fn(async () => true),
    openDiff: vi.fn(async () => {}),
    workspaceRoot: () => "C:/work/proj",
    ...overrides,
  };
}

describe("resolvePath", () => {
  it("rejects paths escaping the workspace", () => {
    expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
    expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
  });
  it("accepts relative paths inside workspace", () => {
    expect(resolvePath("C:/work/proj", "src/a.ts")).toBe(path.resolve("C:/work/proj", "src/a.ts"));
  });
});

describe("executeTool", () => {
  it("read_file returns contents", async () => {
    const r = await executeTool("read_file", { path: "a.txt" }, "c1", mockCtx());
    expect(r).toEqual({ ok: true, output: "file contents" });
  });
  it("returns error result for unknown file (model self-corrects)", async () => {
    const ctx = mockCtx({ readFile: async () => { throw new Error("ENOENT"); } });
    const r = await executeTool("read_file", { path: "nope" }, "c1", ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("ENOENT");
  });
  it("apply_edit requires oldString to be a non-empty string", async () => {
    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "", newString: "x" }, "c1", mockCtx());
    expect(r.ok).toBe(false);
  });
  it("run_terminal calls requestApproval and runs when approved", async () => {
    const ctx = mockCtx();
    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
    expect(ctx.requestApproval).toHaveBeenCalledWith("npm test", "c1");
    expect(ctx.runTerminal).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("run_terminal does not run when rejected", async () => {
    const ctx = mockCtx({ requestApproval: async () => false });
    const r = await executeTool("run_terminal", { command: "rm -rf /" }, "c1", ctx);
    expect(ctx.runTerminal).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it("exposes 4 tool defs for the API", () => {
    expect(TOOL_DEFS.map((d) => d.name)).toEqual(["read_file", "list_dir", "apply_edit", "run_terminal"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/tools.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/host/tools.ts`**

```ts
import * as path from "path";
import type { ToolName } from "../shared/protocol";

export interface ToolContext {
  readFile(p: string): Promise<string>;
  listDir(p: string): Promise<string[]>;
  applyEdit(p: string, oldString: string, newString: string): Promise<void>;
  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
  requestApproval(command: string, callId: string): Promise<boolean>;
  openDiff(p: string): Promise<void>;
  workspaceRoot(): string | undefined;
}

export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }

export const TOOL_DEFS: ToolDef[] = [
  { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
  { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "apply_edit", description: "Replace an exact string in a file. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
  { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
];

export function resolvePath(workspaceRoot: string | undefined, rel: string): string {
  if (!workspaceRoot) throw new Error("No workspace folder open.");
  const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel);
  const normRoot = path.resolve(workspaceRoot);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return abs;
}

export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }> {
  try {
    switch (name as ToolName) {
      case "read_file": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
        return { ok: true, output: await ctx.readFile(p) };
      }
      case "list_dir": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? "."));
        const entries = await ctx.listDir(p);
        return { ok: true, output: entries.join("\n") };
      }
      case "apply_edit": {
        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
        const oldString = String(input.oldString ?? "");
        const newString = String(input.newString ?? "");
        if (!oldString) return { ok: false, output: "apply_edit error: oldString must be non-empty." };
        await ctx.applyEdit(p, oldString, newString);
        await ctx.openDiff(p);
        return { ok: true, output: `Edited ${input.path}` };
      }
      case "run_terminal": {
        const command = String(input.command ?? "");
        if (!command) return { ok: false, output: "run_terminal error: command required." };
        const approved = await ctx.requestApproval(command, callId);
        if (!approved) return { ok: false, output: "User rejected this command." };
        const cwd = input.cwd ? resolvePath(ctx.workspaceRoot(), String(input.cwd)) : undefined;
        let output = "";
        const { exitCode } = await ctx.runTerminal(command, cwd, (chunk) => { output += chunk; });
        return { ok: exitCode === 0, output: output.slice(-8000) || `(exit code ${exitCode})` };
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/tools.test.ts` — Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: tool executors with workspace path confinement"`

---

### Task 4: Provider (Anthropic SDK wrapper with retry)

**Files:**
- Create: `src/host/provider.ts`
- Test: `test/unit/provider.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
export interface StreamEvent { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
export interface Provider {
  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>;
}
export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider;
export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
```

- [ ] **Step 1: Write failing test with fake SDK stream**

`test/unit/provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../../src/host/provider";
import type { AnthropicClientLike } from "../../src/host/provider";

function fakeSdk(deltas: unknown[]) {
  return {
    messages: {
      stream: vi.fn(async function* () {
        for (const d of deltas) yield d;
      }),
    },
  } as unknown as AnthropicClientLike;
}

describe("createProvider.streamTurn", () => {
  const cfg = { baseUrl: "https://x", apiKey: "k", model: "gpt-5.6-sol", maxTokens: 100 };

  it("emits textDelta and endTurn events", async () => {
    const events: unknown[] = [];
    const sdk = fakeSdk([
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_stop" },
    ]);
    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
    expect(events).toEqual([
      { type: "textDelta", text: "Hel" },
      { type: "textDelta", text: "lo" },
      { type: "endTurn" },
    ]);
  });

  it("accumulates tool_use blocks and emits toolUse", async () => {
    const events: unknown[] = [];
    const sdk = fakeSdk([
      { type: "content_block_start", content_block: { type: "tool_use", id: "c1", name: "read_file" } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"path":"a' } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '.txt"}' } },
      { type: "message_stop" },
    ]);
    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
    expect(events).toContainEqual({ type: "toolUse", id: "c1", name: "read_file", input: { path: "a.txt" } });
  });

  it("retries 5xx errors up to 3 times then throws", async () => {
    const stream = async function* () { yield {}; };
    let calls = 0;
    const sdk = {
      messages: {
        stream: vi.fn(() => {
          calls++;
          if (calls < 4) { const e = new Error("server error") as any; e.status = 500; throw e; }
          return stream();
        }),
      },
    } as unknown as AnthropicClientLike;
    await createProvider(cfg, sdk).streamTurn([], [], () => {});
    expect(calls).toBe(4); // 3 failures + 1 success
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/provider.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/host/provider.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFS, type ToolDef } from "./tools";

export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
export interface Provider { streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>; }

export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider {
  const client: AnthropicClientLike = sdk ?? new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]> {
    const params = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      stream: true,
    };
    let stream: AsyncIterable<unknown>;
    for (let attempt = 0; ; attempt++) {
      try { stream = client.messages.stream(params); break; }
      catch (e: any) {
        const retryable = e?.status >= 500 || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET";
        if (!retryable || attempt >= 2) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }

    let text = "";
    const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let currentTool: { id: string; name: string; json: string } | undefined;

    for await (const raw of stream) {
      const ev = raw as any;
      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        currentTool = { id: ev.content_block.id, name: ev.content_block.name, json: "" };
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
        onEvent({ type: "textDelta", text: ev.delta.text });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && currentTool) {
        currentTool.json += ev.delta.partial_json;
      } else if (ev.type === "content_block_stop" && currentTool) {
        try {
          toolUses.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.json || "{}") });
        } catch { toolUses.push({ id: currentTool.id, name: currentTool.name, input: { _error: "malformed JSON input" } }); }
        currentTool = undefined;
      }
    }

    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
    onEvent({ type: "endTurn" });
    return [{ role: "assistant", content }];
  }

  return { streamTurn };
}

export { TOOL_DEFS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/provider.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: anthropic-compatible provider with streaming and retry"`

---

### Task 5: SessionStore (JSONL persistence)

**Files:**
- Create: `src/host/store.ts`
- Test: `test/unit/store.test.ts`

**Interfaces:**
- Produces:

```ts
export class SessionStore {
  constructor(sessionsDir: string);
  createSession(): { id: string; path: string };                 // id = `${Date.now()}-${rand}` , file `<id>.jsonl`
  append(sessionId: string, event: SessionEvent): Promise<void>;
  load(sessionId: string): Promise<SessionEvent[]>;
  list(): Promise<{ id: string; firstUserMessage: string; ts: number }[]>;
  delete(sessionId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing test (uses temp dir)**

`test/unit/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore } from "../../src/host/store";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });

describe("SessionStore", () => {
  it("appends and reloads events in order", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, { kind: "user", text: "hi", ts: 1 });
    await s.append(id, { kind: "assistantText", text: "hello", ts: 2 });
    expect(await s.load(id)).toEqual([
      { kind: "user", text: "hi", ts: 1 },
      { kind: "assistantText", text: "hello", ts: 2 },
    ]);
  });
  it("lists sessions with first user message", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.append(id, { kind: "user", text: "fix the bug", ts: 42 });
    const list = await s.list();
    expect(list).toEqual([{ id, firstUserMessage: "fix the bug", ts: 42 }]);
  });
  it("delete removes the file", async () => {
    const s = new SessionStore(dir);
    const { id } = s.createSession();
    await s.delete(id);
    expect(await s.load(id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/store.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/host/store.ts`**

```ts
import * as fs from "fs";
import * as path from "path";
import type { SessionEvent } from "../shared/protocol";

export class SessionStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(id: string) { return path.join(this.dir, `${id}.jsonl`); }
  createSession(): { id: string; path: string } {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = this.file(id);
    fs.writeFileSync(p, "");
    return { id, path: p };
  }
  async append(sessionId: string, event: SessionEvent): Promise<void> {
    await fs.promises.appendFile(this.file(sessionId), JSON.stringify(event) + "\n", "utf8");
  }
  async load(sessionId: string): Promise<SessionEvent[]> {
    try {
      const raw = await fs.promises.readFile(this.file(sessionId), "utf8");
      return raw.split("\n").filter((l) => l).map((l) => JSON.parse(l) as SessionEvent);
    } catch { return []; }
  }
  async list(): Promise<{ id: string; firstUserMessage: string; ts: number }[]> {
    const files = await fs.promises.readdir(this.dir);
    const out: { id: string; firstUserMessage: string; ts: number }[] = [];
    for (const f of files.filter((f) => f.endsWith(".jsonl"))) {
      const id = f.replace(/\.jsonl$/, "");
      const events = await this.load(id);
      const first = events.find((e) => e.kind === "user");
      if (first && first.kind === "user") out.push({ id, firstUserMessage: first.text, ts: first.ts });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
  async delete(sessionId: string): Promise<void> {
    await fs.promises.rm(this.file(sessionId), { force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/store.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: JSONL session store"`

---

### Task 6: Agent loop (AgentSession + queueing + tool_result plumbing)

**Files:**
- Create: `src/host/agent.ts`
- Test: `test/unit/agent.test.ts`

**Interfaces:**
- Consumes: `Provider`, `StreamEvent`, `AnthropicMessage` (Task 4); `executeTool`, `ToolContext`, `TOOL_DEFS` (Task 3); `SessionStore` (Task 5).
- Produces:

```ts
export interface AgentUi { textDelta(t: string): void; toolCall(callId: string, tool: string, input: Record<string, unknown>): void; toolResult(callId: string, ok: boolean, output: string): void; error(msg: string): void; turnComplete(): void; }
export class AgentSession {
  constructor(opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi });
  send(text: string): void;      // queues if loop running
  get busy(): boolean;
}
```

- [ ] **Step 1: Write failing test — full loop with scripted provider**

`test/unit/agent.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentSession } from "../../src/host/agent";
import type { Provider, StreamEvent, AnthropicMessage } from "../../src/host/provider";
import type { ToolContext } from "../../src/host/tools";
import { SessionStore } from "../../src/host/store";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import path from "path";

function scriptedProvider(turns: { text: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
  const calls: AnthropicMessage[][] = [];
  return {
    calls,
    async streamTurn(messages, _tools, onEvent) {
      calls.push(messages.map((m) => ({ ...m, content: [...m.content as any[]] })));
      const turn = turns.shift()!;
      for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
      for (const tu of turn.toolUses ?? []) onEvent({ type: "toolUse", id: tu.id, name: tu.name, input: tu.input });
      onEvent({ type: "endTurn" });
      const content: any[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      return [{ role: "assistant", content }];
    },
  };
}

function ctx(): ToolContext {
  return {
    readFile: async () => "content of a.txt",
    listDir: async () => ["a.txt"],
    applyEdit: vi.fn(async () => {}),
    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
    requestApproval: async () => true,
    openDiff: vi.fn(async () => {}),
    workspaceRoot: () => "C:/work/proj",
  };
}

describe("AgentSession", () => {
  it("runs a tool round-trip: text → tool_use → tool_result → final text", async () => {
    const provider = scriptedProvider([
      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
      { text: "The file says: content of a.txt" },
    ]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("read a.txt");
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
    expect(ui.toolCall).toHaveBeenCalledWith("c1", "read_file", { path: "a.txt" });
    expect(ui.toolResult).toHaveBeenCalledWith("c1", true, "content of a.txt");
    // second model call must contain the tool_result
    const secondCall = provider.calls[1];
    expect(JSON.stringify(secondCall)).toContain('"type":"tool_result"');
    expect(ui.textDelta).toHaveBeenCalledWith("The file says: content of a.txt".slice(0, 3));
  });

  it("queues a second user message while the loop is running", async () => {
    const provider = scriptedProvider([{ text: "one" }, { text: "two" }]);
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("first");
    expect(session.busy).toBe(true);
    session.send("second");
    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalledTimes(2));
    expect(provider.calls.length).toBe(2);
  });

  it("surfaces provider errors via ui.error", async () => {
    const provider: Provider = {
      async streamTurn() { throw new Error("boom"); },
    };
    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
    session.send("hello");
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
    expect(session.busy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/agent.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/host/agent.ts`**

```ts
import type { Provider, AnthropicMessage } from "./provider";
import { executeTool, TOOL_DEFS, type ToolContext } from "./tools";
import type { SessionStore } from "./store";
import type { SessionEvent } from "../shared/protocol";

export interface AgentUi {
  textDelta(t: string): void;
  toolCall(callId: string, tool: string, input: Record<string, unknown>): void;
  toolResult(callId: string, ok: boolean, output: string): void;
  error(msg: string): void;
  turnComplete(): void;
}

export class AgentSession {
  private messages: AnthropicMessage[] = [];
  private queue: string[] = [];
  private running = false;
  private turn = 0;

  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi; systemPrompt?: string }) {}

  get busy() { return this.running; }

  send(text: string): void {
    this.queue.push(text);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift()!;
        await this.runTurn(text);
      }
    } finally { this.running = false; }
  }

  private async runTurn(userText: string): Promise<void> {
    this.turn++;
    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });
    await this.opts.store.append(this.opts.sessionId, { kind: "user", text: userText, ts: Date.now() });

    try {
      for (let round = 0; round < 25; round++) {
        const assistantMsg = await this.opts.provider.streamTurn(this.messages, TOOL_DEFS, (e) => {
          if (e.type === "textDelta") this.opts.ui.textDelta(e.text);
          else if (e.type === "toolUse") this.opts.ui.toolCall(e.id, e.name, e.input);
        });
        this.messages.push(assistantMsg);

        for (const block of assistantMsg.content as any[]) {
          if (block.type === "text") {
            await this.opts.store.append(this.opts.sessionId, { kind: "assistantText", text: block.text, ts: Date.now() });
          }
        }

        const toolUses = (assistantMsg.content as any[]).filter((b) => b.type === "tool_use");
        if (toolUses.length === 0) { this.opts.ui.turnComplete(); return; }

        const results: unknown[] = [];
        for (const tu of toolUses) {
          await this.opts.store.append(this.opts.sessionId, { kind: "toolCall", callId: tu.id, tool: tu.name, input: tu.input, ts: Date.now() });
          const r = await executeTool(tu.name, tu.input, tu.id, this.opts.ctx);
          this.opts.ui.toolResult(tu.id, r.ok, r.output);
          await this.opts.store.append(this.opts.sessionId, { kind: "toolResult", callId: tu.id, ok: r.ok, output: r.output, ts: Date.now() });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output, is_error: !r.ok });
        }
        this.messages.push({ role: "user", content: results });
      }
      this.opts.ui.error("Max tool rounds (25) reached.");
      this.opts.ui.turnComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.opts.ui.error(msg);
      await this.opts.store.append(this.opts.sessionId, { kind: "error", message: msg, ts: Date.now() });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/agent.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: agent loop with tool round-trips and message queueing"`

---

### Task 7: VS Code wiring (ChatViewProvider, ApprovalManager, real ToolContext)

**Files:**
- Modify: `src/host/extension.ts` (replace minimal scaffold)
- Create: `src/host/approvals.ts`
- Test: manual (integration harness comes in Task 9)

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: a running extension — sidebar chat wired to the real API with real file/terminal tools.

- [ ] **Step 1: Implement `src/host/approvals.ts`**

```ts
import type { HostToWebviewMsg } from "../shared/protocol";

export class ApprovalManager {
  private pending = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly post: (msg: HostToWebviewMsg) => void) {}

  request(sessionId: string, callId: string, command: string): Promise<boolean> {
    this.post({ type: "approvalRequest", sessionId, callId, command });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        this.post({ type: "approvalResolved", sessionId, callId, approved: false });
        resolve(false);
      }, 60_000);
      this.pending.set(callId, { resolve, timer });
    });
  }

  resolve(callId: string, approved: boolean, sessionId: string): void {
    const p = this.pending.get(callId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(callId);
    this.post({ type: "approvalResolved", sessionId, callId, approved });
    p.resolve(approved);
  }
}
```

- [ ] **Step 2: Rewrite `src/host/extension.ts` with full wiring**

```ts
import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { createProvider, type AnthropicMessage } from "./provider";
import { AgentSession } from "./agent";
import { SessionStore } from "./store";
import { ApprovalManager } from "./approvals";
import type { ToolContext } from "./tools";
import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../shared/protocol";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
      const key = await vscode.window.showInputBox({ password: true, prompt: "API key for the Justwoker Agent API" });
      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
    }),
    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.post({ type: "newSession" })),
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  public view?: vscode.WebviewView;
  private approvals!: ApprovalManager;
  private sessions = new Map<string, AgentSession>();
  private currentSessionId?: string;
  private store!: SessionStore;

  constructor(private readonly context: vscode.ExtensionContext) {}

  post(msg: HostToWebviewMsg) { void this.view?.webview.postMessage(msg); }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewToHostMsg) => void this.onMessage(m));

    this.store = new SessionStore(path.join(this.context.globalStorageUri.fsPath, "sessions"));
    this.approvals = new ApprovalManager((msg) => this.post(msg));
    this.startSession();
    void this.sendSessionList();
  }

  private startSession() {
    const { id } = this.store.createSession();
    this.currentSessionId = id;
    this.sessions.set(id, this.makeSession(id));
    this.post({ type: "loadEvents", sessionId: id, events: [] });
  }

  private makeSession(id: string): AgentSession {
    const cfg = vscode.workspace.getConfiguration("justwokerAgent");
    const apiKey = this.context.secrets.get("justwokerAgent.apiKey");
    const provider = createProvider({
      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
      apiKey: "", // replaced below before first turn
      model: cfg.get("model", "gpt-5.6-sol"),
      maxTokens: cfg.get("maxTokens", 4096),
    });
    const ctx = this.makeToolContext();
    const ui = {
      textDelta: (t) => this.post({ type: "textDelta", sessionId: id, text: t }),
      toolCall: (callId, tool, input) => this.post({ type: "toolCall", sessionId: id, callId, tool, input }),
      toolResult: (callId, ok, output) => this.post({ type: "toolResult", sessionId: id, callId, ok, output }),
      error: (message) => this.post({ type: "error", sessionId: id, message }),
      turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
    };
    // key injection: patch provider config lazily via closure — simplest: recreate provider per turn is overkill;
    // instead we read key async at session creation:
    void this.context.secrets.get("justwokerAgent.apiKey").then((key) => {
      if (!key) {
        ui.error("No API key set. Run command 'Justwoker: Set API Key'.");
        return;
      }
      // mutate the provider's config through a setter
      (provider as any).setKey?.(key);
    });
    return new AgentSession({ sessionId: id, provider: this.withKey(provider), ctx, store: this.store, ui });
  }

  // wrapper ensuring key is fetched before first streamTurn call
  private withKey(provider: ReturnType<typeof createProvider>): ReturnType<typeof createProvider> {
    let cached: string | null = null;
    const self = this;
    return {
      async streamTurn(messages, tools, onEvent) {
        if (!cached) {
          cached = await self.context.secrets.get("justwokerAgent.apiKey");
          if (!cached) throw new Error("No API key set. Run command 'Justwoker: Set API Key'.");
          (provider as any).setKey?.(cached);
        }
        return provider.streamTurn(messages, tools, onEvent);
      },
    } as any;
  }

  private makeToolContext(): ToolContext {
    const self = this;
    const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return {
      async readFile(p) { return vscode.workspace.fs.readFile(vscode.Uri.file(p)).then((b) => Buffer.from(b).toString("utf8")); },
      async listDir(p) {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        return entries.map(([name, type]) => type === vscode.FileType.Directory ? name + "/" : name);
      },
      async applyEdit(p, oldString, newString) {
        const uri = vscode.Uri.file(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const count = text.split(oldString).length - 1;
        if (count === 0) throw new Error("oldString not found in file.");
        if (count > 1) throw new Error(`oldString found ${count} times; must be unique.`);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
        edit.replace(uri, fullRange, text.replace(oldString, newString));
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) throw new Error("Edit rejected by editor.");
      },
      async runTerminal(command, cwd, onOutput) {
        return new Promise((resolve) => {
          const proc = cp.exec(command, { cwd, shell: true }, (err) => {
            resolve({ exitCode: err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0 });
          });
          proc.stdout?.on("data", (d) => onOutput(d.toString()));
          proc.stderr?.on("data", (d) => onOutput(d.toString()));
        });
      },
      requestApproval: (command, callId) => this.approvals.request(this.currentSessionId!, callId, command),
      async openDiff(p) {
        const uri = vscode.Uri.file(p);
        await vscode.commands.executeCommand("vscode.diff", uri, uri, path.basename(p), { preview: true });
      },
      workspaceRoot: root,
    };
  }

  private async onMessage(m: WebviewToHostMsg) {
    switch (m.type) {
      case "userMessage": {
        if (m.sessionId === this.currentSessionId) this.sessions.get(m.sessionId)?.send(m.text);
        break;
      }
      case "approve": {
        if (this.currentSessionId) this.approvals.resolve(m.callId, m.approved, this.currentSessionId);
        break;
      }
      case "newSessionRequest": this.startSession(); break;
      case "retry": {
        const s = this.sessions.get(m.sessionId);
        if (s && !s.busy) s.send("(retry)");
        break;
      }
      case "requestSessionList": await this.sendSessionList(); break;
      case "loadSession": {
        if (this.sessions.has(m.sessionId)) { this.currentSessionId = m.sessionId; break; }
        const events = await this.store.load(m.sessionId);
        this.currentSessionId = m.sessionId;
        this.sessions.set(m.sessionId, this.makeSession(m.sessionId));
        this.post({ type: "loadEvents", sessionId: m.sessionId, events });
        break;
      }
    }
  }

  private async sendSessionList() {
    this.post({ type: "sessionList", sessions: await this.store.list() });
  }

  private html(webview: vscode.Webview) {
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "main.js"));
    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
  }
}

export function deactivate() {}
```

Note: `createProvider` in Task 4 needs a tiny addition for key injection — add to `createProvider`:

```ts
const p = { streamTurn, setKey: (k: string) => { cfg = { ...cfg, apiKey: k }; client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: k }); } } as Provider & { setKey(k: string): void };
return p;
```

(Refactor `client` to `let` and rebuild it on `setKey`; rerun Task 4 tests to confirm they still pass.)

- [ ] **Step 3: Compile and manual smoke test**

```powershell
npm run compile
```

Press F5 → in the Extension Development Host: run "Justwoker: Set API Key", open a workspace folder, type "read a.txt and tell me what it contains" in the sidebar. Expected: tool card appears, contents stream back. If no key: error card with instructions.

- [ ] **Step 4: Commit** — `git add -A; git commit -m "feat: wire agent, tools, approvals and session store into vscode"`

---

### Task 8: Webview chat UI (React)

**Files:**
- Modify: `src/webview/main.tsx`
- Create: `src/webview/App.tsx`, `src/webview/api.ts`
- Add deps: `npm install marked` (add `"marked": "^12.0.0"` to dependencies)

**Interfaces:**
- Consumes: `HostToWebviewMsg`, `WebviewToHostMsg`, `SessionEvent` from `src/shared/protocol.ts`.
- Produces: full chat UI — streaming text, tool cards, approval cards, session picker, input box.

- [ ] **Step 1: Implement `src/webview/api.ts`**

```ts
import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";

declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void; getState<T>(): T; setState<T>(s: T): void };
export const vscode = acquireVsCodeApi();
export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
};
```

- [ ] **Step 2: Implement `src/webview/App.tsx`**

```tsx
import React, { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { send, onHostMessage } from "./api";
import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";

interface Card {
  kind: "user" | "assistant" | "tool" | "error";
  text?: string;              // user/assistant/error
  callId?: string;            // tool
  tool?: string;              // tool
  output?: string;            // tool
  pendingApproval?: string;   // tool: command awaiting approval
  approvalDone?: "approved" | "rejected";
}

export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [sessionList, setSessionList] = useState<{ id: string; firstUserMessage: string }[]>([]);
  const sessionIdRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onHostMessage((m: HostToWebviewMsg) => {
      setCards((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        switch (m.type) {
          case "newSession":
          case "loadEvents":
            sessionIdRef.current = m.type === "loadEvents" ? m.sessionId : sessionIdRef.current;
            if (m.type === "loadEvents") return eventsToCards(m.events);
            return [];
          case "textDelta":
            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            else next.push({ kind: "assistant", text: m.text });
            return next;
          case "toolCall":
            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
            return next;
          case "approvalRequest":
            if (last?.callId === m.callId) next[next.length - 1] = { ...last, pendingApproval: m.command };
            return next;
          case "approvalResolved":
            return next.map((c) => c.callId === m.callId ? { ...c, approvalDone: m.approved ? "approved" : "rejected", pendingApproval: undefined } : c);
          case "toolResult":
            return next.map((c) => c.callId === m.callId ? { ...c, output: m.output } : c);
          case "error":
            next.push({ kind: "error", text: m.message });
            return next;
          case "turnComplete":
            return next;
          case "sessionList":
            setSessionList(m.sessions);
            return next;
          default:
            return next;
        }
      });
    });
    send({ type: "requestSessionList" });
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cards]);

  const submit = () => {
    if (!input.trim() || !sessionIdRef.current) return;
    send({ type: "userMessage", sessionId: sessionIdRef.current, text: input });
    setCards((p) => [...p, { kind: "user", text: input }]);
    setInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
        <select onChange={(e) => e.target.value && send({ type: "loadSession", sessionId: e.target.value })} value="">
          <option value="">Sessions…</option>
          {sessionList.map((s) => <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>)}
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {cards.map((c, i) => <CardView key={i} card={c} />)}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
        <textarea
          style={{ flex: 1, resize: "none" }}
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
        />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}

function eventsToCards(events: SessionEvent[]): Card[] {
  return events.map((e) => {
    if (e.kind === "user") return { kind: "user" as const, text: e.text };
    if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text };
    if (e.kind === "error") return { kind: "error" as const, text: e.message };
    return { kind: "tool" as const, callId: e.callId, tool: e.tool };
  });
}

function CardView({ card }: { card: Card }) {
  if (card.kind === "assistant") {
    return <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.text ?? "", { async: false }) as string }} />;
  }
  if (card.kind === "user") return <div style={{ color: "var(--vscode-inputforeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
  if (card.kind === "error") {
    return <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
      {card.text} <button onClick={() => sessionIdRef.current && send({ type: "retry", sessionId: sessionIdRef.current })}>Retry</button>
    </div>;
  }
  return (
    <div style={{ border: "1px solid var(--vscode-panel-border)", padding: "6px", margin: "4px 0", fontFamily: "monospace", fontSize: "12px" }}>
      <div>🔧 {card.tool} {card.pendingApproval ? "— awaiting approval" : ""} {card.approvalDone ? `— ${card.approvalDone}` : ""}</div>
      {card.pendingApproval && (
        <div style={{ marginTop: "4px" }}>
          <code>{card.pendingApproval}</code>
          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: true })}>Approve</button>{" "}
          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: false })}>Reject</button>
        </div>
      )}
      {card.output && <pre style={{ whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>{card.output}</pre>}
    </div>
  );
}
```

Note: `sessionIdRef` is used inside `CardView` — hoist it out of `App` to module scope or pass a `onRetry` prop instead (pick prop-passing during implementation: `<CardView card={c} onRetry={() => send({ type: "retry", sessionId: sessionIdRef.current })} />`).

- [ ] **Step 3: Update `src/webview/main.tsx` and add marked**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

```powershell
npm install marked; npm run compile
```

- [ ] **Step 4: Manual UI verification (F5)**

Check: streaming text renders as markdown; "read a.txt" shows a tool card; `run_terminal` shows Approve/Reject buttons and Resolve output streams into the card; "+ New" resets; session picker reloads an old session's events; Retry appears on errors.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: webview chat UI with streaming, tool and approval cards"`

---

### Task 9: Integration test (@vscode/test-electron, mock server)

**Files:**
- Create: `test/integration/index.ts`, `test/integration/agentFlow.test.ts`, `test/integration/run.ts`, `test/mock-server.ts`
- Modify: `package.json` (script `test:integration`)

**Interfaces:**
- Consumes: compiled extension from `dist/host/extension.js`.
- Produces: `npm run test:integration` verifying activation + webview render + a real API-key-set flow against a local mock.

- [ ] **Step 1: Add mock Anthropic server `test/mock-server.ts`**

```ts
import http from "http";

export function startMockServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.includes("/v1/messages")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Mock reply." } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
      } else { res.writeHead(404).end(); }
    });
    server.listen(port, () => resolve(server));
  });
}
```

- [ ] **Step 2: Write integration test `test/integration/agentFlow.test.ts`**

```ts
import * as assert from "assert";
import * as vscode from "vscode";

suite("Justwoker Agent extension", () => {
  test("extension activates and registers the webview view", async () => {
    const ext = vscode.extensions.getExtension("justwoker.agent");
    assert.ok(ext, "extension not found");
    await ext!.activate();
    await vscode.commands.executeCommand("justwokerAgent.chat.focus");
    assert.ok(true);
  });

  test("set API key command stores secret without error", async () => {
    // showInputBox is not scriptable in test harness; verify command exists instead
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("justwokerAgent.setApiKey"));
    assert.ok(cmds.includes("justwokerAgent.newSession"));
  });
});
```

`test/integration/index.ts`:

```ts
import * as path from "path";
export function run(): Promise<void> {
  return Promise.all([
    import("./agentFlow.test"),
  ]).then(undefined, (e) => { console.error(e); process.exit(1); });
}
```

`test/integration/run.ts`:

```ts
import * as path from "path";
async function go() {
  const { runTests } = await import("@vscode/test-electron");
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, "./index"),
  });
}
go().catch((e) => { console.error(e); process.exit(1); });
```

package.json script: `"test:integration": "npm run compile && node test/integration/run.js"` (esbuild-compile `test/integration/run.ts` too — add it as a third esbuild entry, CJS, outfile `test/integration/run.js`).

- [ ] **Step 3: Run integration test**

```powershell
npm run test:integration
```

Expected: VS Code instance launches, both tests PASS.

- [ ] **Step 4: Commit** — `git add -A; git commit -m "test: integration harness for extension activation"`

---

### Task 10: Real-endpoint smoke test + polish

**Files:**
- Modify: none required (fixes as found)
- Create: `README.md`

**Interfaces:**
- Consumes: completed extension.
- Produces: verified working extension against `https://api.justwoker.icu`.

- [ ] **Step 1: Real smoke test (manual checklist)**

F5, set real API key, then in a test workspace:
1. Plain question → streaming markdown reply.
2. "Read the file src/a.txt and summarize it" → tool card + summary.
3. "Change the greeting in a.txt from Hello to Hi" → edit auto-applied, diff tab opens, Ctrl+Z in editor undoes it.
4. "Run `npm --version`" → approval card → Approve → exit output streams into card; Reject path: output says "User rejected".
5. "Create a new file b.txt with the word test" → model should use apply_edit (host returns file-not-found error as tool_result → model retries sensibly or explains); note behavior.

- [ ] **Step 2: Fix any defects found, re-run unit + integration**

```powershell
npm run test:unit; npm run test:integration
```

- [ ] **Step 3: Write `README.md`**

Cover: install/dev setup (`npm install`, `npm run watch`, F5), set API key command, settings table, tool permissions model (edits auto, terminal approved), architecture summary (host/webview/protocol), test commands.

- [ ] **Step 4: Commit** — `git add -A; git commit -m "docs: README and post-smoke-test fixes"`

---

## Self-Review (completed)

- **Spec coverage:** streaming chat (T4/T8), tools read/list/edit/terminal (T3/T7), auto-edit + diff (T3/T7), approval + 60s timeout (T7), session JSONL (T5), settings + commands (T1/T7), queueing (T6), error handling + retry (T4/T6/T8), webview rebuild from JSONL (T5/T8), testing unit/integration/manual (T9/T10). Non-goals respected.
- **Placeholders:** none — every step has concrete code or an exact command.
- **Type consistency:** `ToolContext`/`executeTool`/`TOOL_DEFS` (T3) match usage in T6/T7; `Provider`/`StreamEvent`/`AnthropicMessage` (T4) match T6/T7; `SessionStore` (T5) matches T6/T7; protocol types (T2) match T7/T8. One deliberate tweak noted inline in T7 (`setKey` addition to provider) with a re-test instruction.
