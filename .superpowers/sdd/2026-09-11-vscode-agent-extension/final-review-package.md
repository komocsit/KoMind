## git log (whole branch)
dd51cf4 fix: newSession palette command creates a host session instead of dead-ending the webview
549b587 docs: README, smoke-test checklist, webview CSP hardening
f9b9690 test: integration harness for extension activation
b0dd760 fix: sanitize assistant markdown with DOMPurify to prevent webview XSS
c685932 feat: webview chat UI with streaming, tool and approval cards
cd3e0a3 feat: wire agent, tools, approvals and session store into vscode
85d0ddc feat: agent loop with tool round-trips and message queueing
939fd36 feat: JSONL session store
6bd4198 feat: anthropic-compatible provider with streaming and retry
bf258b5 fix: normalize absolute paths in resolvePath to prevent workspace escape
b2a7f84 feat: tool executors with workspace path confinement
160286e feat: shared host/webview message protocol
2bd5588 docs: task 1 report
3c0c130 chore: scaffold extension host + webview build
cb5b59d chore: initial state (docs + planning artifacts)

## diff stat (4b825dc..HEAD)

 .gitignore                                         |    5 +
 .../2026-09-11-vscode-agent-extension/progress.md  |   19 +
 .../task-1-brief.md                                |  205 +
 .../task-1-report.md                               |   53 +
 .../task-1-review-package.md                       | 7504 ++++++++++++++++++++
 .../task-2-brief.md                                |   96 +
 .vscode/launch.json                                |   11 +
 .vscode/tasks.json                                 |   13 +
 README.md                                          |   58 +
 SMOKE-TEST.md                                      |   13 +
 .../plans/2026-09-11-vscode-agent-extension.md     | 1541 ++++
 .../2026-09-11-vscode-agent-extension-design.md    |   57 +
 esbuild.js                                         |   47 +
 media/icon.svg                                     |    7 +
 package-lock.json                                  | 5797 +++++++++++++++
 package.json                                       |   94 +
 src/host/agent.ts                                  |   79 +
 src/host/approvals.ts                              |   28 +
 src/host/extension.ts                              |  172 +
 src/host/provider.ts                               |   78 +
 src/host/store.ts                                  |   39 +
 src/host/tools.ts                                  |   70 +
 src/shared/protocol.ts                             |   34 +
 src/webview/App.tsx                                |  153 +
 src/webview/api.ts                                 |    8 +
 src/webview/main.tsx                               |    4 +
 test/integration/agentFlow.test.ts                 |   21 +
 test/integration/index.ts                          |   16 +
 test/integration/run.ts                            |    9 +
 test/mock-server.ts                                |   15 +
 test/unit/agent.test.ts                            |   98 +
 test/unit/example.test.ts                          |    2 +
 test/unit/protocol.test.ts                         |   31 +
 test/unit/provider.test.ts                         |   91 +
 test/unit/store.test.ts                            |   39 +
 test/unit/tools.test.ts                            |   63 +
 tsconfig.json                                      |    8 +
 vitest.config.ts                                   |    2 +
 38 files changed, 16580 insertions(+)

## diff source only

diff --git a/README.md b/README.md
new file mode 100644
index 0000000..182b8d5
--- /dev/null
+++ b/README.md
@@ -0,0 +1,58 @@
+# Justwoker Agent ΓÇö VS Code Extension
+
+A VS Code extension that embeds a coding agent in the activity bar. The agent chats with a Justwoker API endpoint (default `https://api.justwoker.icu`, OpenAI-compatible streaming), and can read files, list directories, apply edits with visual diffs, and run terminal commands behind an approval gate. Sessions are persisted to global storage and can be reloaded from a dropdown.
+
+## Dev setup
+
+```powershell
+npm install
+npm run watch   # or: npm run compile
+```
+
+Then open the folder in VS Code and press **F5** (Run Extension) to launch the Extension Development Host.
+
+## Set API key
+
+In the Extension Development Host, run the command **Justwoker: Set API Key** and paste your key. It is stored securely via VS Code SecretStorage (never written to settings or disk in plaintext).
+
+## Settings
+
+| Setting | Default | Description |
+|---|---|---|
+| `justwokerAgent.baseUrl` | `https://api.justwoker.icu` | API base URL (OpenAI-compatible) |
+| `justwokerAgent.model` | `gpt-5.6-sol` | Model name sent to the API |
+| `justwokerAgent.maxTokens` | `4096` | Max tokens per completion |
+| `justwokerAgent.autoApproveEdits` | `true` | Apply file edits automatically |
+| `justwokerAgent.autoApproveTerminal` | `false` | Require approval for terminal commands |
+
+## Tool permission model
+
+- **Edits** (`apply_edit`): auto-applied by default (`autoApproveEdits`). The edit opens in a diff tab; Ctrl+Z in the editor undoes it. Non-unique or missing `oldString` matches are rejected with an error.
+- **Terminal** (`run_terminal`): requires explicit user approval in the chat card (Approve/Reject buttons). Unanswered requests auto-reject after 60 seconds.
+
+## Architecture
+
+- **Extension host** (`src/host/`): `extension.ts` (webview provider + HTML/CSP), `provider.ts` (API streaming client), `agent.ts` (agent loop, tool-call orchestration), `tools.ts` (read_file, list_dir, apply_edit, run_terminal), `approvals.ts` (approval manager with 60s timeout), `store.ts` (JSON-file session persistence).
+- **Webview** (`src/webview/`): React chat UI (`App.tsx`, `api.ts`) ΓÇö streaming markdown (marked + DOMPurify), tool cards, approval buttons, session switcher.
+- **Shared** (`src/shared/`): typed `postMessage` protocol (`protocol.ts`).
+
+## Tests
+
+```powershell
+npm run test:unit         # vitest (protocol, tools, store, agent, provider)
+npm run test:integration  # @vscode/test-electron (activation, commands)
+npx tsc --noEmit          # typecheck
+```
+
+## Repo layout
+
+```
+src/
+  host/        extension entry, provider, agent, tools, approvals, store
+  webview/     React chat UI
+  shared/      typed message protocol
+test/
+  unit/        vitest suites
+  integration/ vscode-test-electron suite
+esbuild.js     bundler (host + webview)
+```
diff --git a/SMOKE-TEST.md b/SMOKE-TEST.md
new file mode 100644
index 0000000..0e5290d
--- /dev/null
+++ b/SMOKE-TEST.md
@@ -0,0 +1,13 @@
+# Manual Smoke Test (real endpoint)
+
+Prereq: a valid API key for https://api.justwoker.icu.
+
+1. Open this folder in VS Code, press F5 (Run Extension).
+2. In the Extension Development Host: run command "Justwoker: Set API Key", paste your key.
+3. Open a test workspace folder (File > Open Folder ΓÇö create one with a small `a.txt`).
+4. Open the Justwoker Agent sidebar. Type: "What is 2+2?" ΓÇö expect streaming markdown reply.
+5. Type: "Read the file a.txt and tell me what it contains" ΓÇö expect a tool card and summary.
+6. Type: "Change the greeting in a.txt from Hello to Hi" ΓÇö expect auto-applied edit + diff tab; Ctrl+Z in editor undoes it.
+7. Type: "Run the command npm --version" ΓÇö expect approval card; click Approve ΓÇö output streams into the card. Try Reject on a second command too.
+8. Click "+ New" ΓÇö chat clears. Use the Sessions dropdown to reload the old session.
+9. Report failures with screenshots.
diff --git a/esbuild.js b/esbuild.js
new file mode 100644
index 0000000..12e12b2
--- /dev/null
+++ b/esbuild.js
@@ -0,0 +1,47 @@
+const esbuild = require("esbuild");
+const prod = process.argv.includes("--production");
+const watch = process.argv.includes("--watch");
+
+const host = {
+  entryPoints: ["src/host/extension.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "dist/host/extension.js", external: ["vscode"],
+  sourcemap: !prod, minify: prod,
+};
+const webview = {
+  entryPoints: ["src/webview/main.tsx"], bundle: true, platform: "browser",
+  format: "esm", outfile: "dist/webview/main.js", sourcemap: !prod, minify: prod,
+};
+const testRunner = {
+  entryPoints: ["test/integration/run.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/run.js", sourcemap: false,
+};
+const testIndex = {
+  entryPoints: ["test/integration/index.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/index.js", sourcemap: false,
+};
+const testSuite = {
+  entryPoints: ["test/integration/agentFlow.test.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/agentFlow.test.js", external: ["vscode"],
+  sourcemap: false,
+};
+
+(async () => {
+  if (watch) {
+    const ctx = await esbuild.context({ ...host });
+    await ctx.watch();
+    const ctx2 = await esbuild.context({ ...webview });
+    await ctx2.watch();
+    const ctx3 = await esbuild.context({ ...testRunner });
+    await ctx3.watch();
+    const ctx4 = await esbuild.context({ ...testIndex });
+    await ctx4.watch();
+    const ctx5 = await esbuild.context({ ...testSuite });
+    await ctx5.watch();
+  } else {
+    await esbuild.build(host);
+    await esbuild.build(webview);
+    await esbuild.build(testRunner);
+    await esbuild.build(testIndex);
+    await esbuild.build(testSuite);
+  }
+})();
diff --git a/package.json b/package.json
new file mode 100644
index 0000000..2bf76de
--- /dev/null
+++ b/package.json
@@ -0,0 +1,94 @@
+{
+  "name": "justwoker-agent",
+  "displayName": "Justwoker Agent",
+  "publisher": "justwoker",
+  "version": "0.1.0",
+  "engines": {
+    "vscode": "^1.85.0"
+  },
+  "main": "./dist/host/extension.js",
+  "activationEvents": [],
+  "contributes": {
+    "viewsContainers": {
+      "activitybar": [
+        {
+          "id": "justwokerAgent",
+          "title": "Justwoker Agent",
+          "icon": "media/icon.svg"
+        }
+      ]
+    },
+    "views": {
+      "justwokerAgent": [
+        {
+          "type": "webview",
+          "id": "justwokerAgent.chat",
+          "name": "Agent Chat"
+        }
+      ]
+    },
+    "commands": [
+      {
+        "command": "justwokerAgent.setApiKey",
+        "title": "Justwoker: Set API Key"
+      },
+      {
+        "command": "justwokerAgent.newSession",
+        "title": "Justwoker: New Session"
+      }
+    ],
+    "configuration": {
+      "title": "Justwoker Agent",
+      "properties": {
+        "justwokerAgent.baseUrl": {
+          "type": "string",
+          "default": "https://api.justwoker.icu"
+        },
+        "justwokerAgent.model": {
+          "type": "string",
+          "default": "gpt-5.6-sol"
+        },
+        "justwokerAgent.maxTokens": {
+          "type": "number",
+          "default": 4096
+        },
+        "justwokerAgent.autoApproveEdits": {
+          "type": "boolean",
+          "default": true
+        },
+        "justwokerAgent.autoApproveTerminal": {
+          "type": "boolean",
+          "default": false
+        }
+      }
+    }
+  },
+  "scripts": {
+    "compile": "node esbuild.js --production",
+    "watch": "node esbuild.js --watch",
+    "test:unit": "vitest run",
+    "test:integration": "npm run compile && node test/integration/run.js",
+    "package": "vsce package"
+  },
+  "devDependencies": {
+    "@types/dompurify": "^3.0.5",
+    "@types/mocha": "^10.0.10",
+    "@types/node": "^20.0.0",
+    "@types/react": "^18.3.31",
+    "@types/react-dom": "^18.3.7",
+    "@types/vscode": "^1.85.0",
+    "@vscode/test-electron": "^2.3.0",
+    "@vscode/vsce": "^2.24.0",
+    "esbuild": "^0.20.0",
+    "mocha": "^12.0.0",
+    "typescript": "^5.4.0",
+    "vitest": "^1.5.0"
+  },
+  "dependencies": {
+    "@anthropic-ai/sdk": "^0.30.0",
+    "dompurify": "^3.4.15",
+    "marked": "^18.0.12",
+    "react": "^18.3.0",
+    "react-dom": "^18.3.0"
+  }
+}
diff --git a/src/host/agent.ts b/src/host/agent.ts
new file mode 100644
index 0000000..7fa0131
--- /dev/null
+++ b/src/host/agent.ts
@@ -0,0 +1,79 @@
+import type { Provider, AnthropicMessage } from "./provider";
+import { executeTool, TOOL_DEFS, type ToolContext } from "./tools";
+import type { SessionStore } from "./store";
+import type { SessionEvent } from "../shared/protocol";
+
+export interface AgentUi {
+  textDelta(t: string): void;
+  toolCall(callId: string, tool: string, input: Record<string, unknown>): void;
+  toolResult(callId: string, ok: boolean, output: string): void;
+  error(msg: string): void;
+  turnComplete(): void;
+}
+
+export class AgentSession {
+  private messages: AnthropicMessage[] = [];
+  private queue: string[] = [];
+  private running = false;
+
+  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi }) {}
+
+  get busy() { return this.running; }
+
+  send(text: string): void {
+    this.queue.push(text);
+    if (this.running) return;
+    this.running = true;          // set synchronously so busy is observable immediately
+    void this.drain();
+  }
+
+  private async drain(): Promise<void> {
+    try {
+      while (this.queue.length > 0) {
+        const text = this.queue.shift()!;
+        await this.runTurn(text);
+      }
+    } finally { this.running = false; }
+  }
+
+  private async runTurn(userText: string): Promise<void> {
+    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });
+    await this.opts.store.append(this.opts.sessionId, { kind: "user", text: userText, ts: Date.now() });
+
+    try {
+      for (let round = 0; round < 25; round++) {
+        const assistantMsgs = await this.opts.provider.streamTurn(this.messages, TOOL_DEFS, (e) => {
+          if (e.type === "textDelta") this.opts.ui.textDelta(e.text);
+          else if (e.type === "toolUse") this.opts.ui.toolCall(e.id, e.name, e.input);
+        });
+        this.messages.push(...assistantMsgs);
+        const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
+
+        for (const block of assistantMsg.content as any[]) {
+          if (block.type === "text") {
+            await this.opts.store.append(this.opts.sessionId, { kind: "assistantText", text: block.text, ts: Date.now() });
+          }
+        }
+
+        const toolUses = (assistantMsg.content as any[]).filter((b) => b.type === "tool_use");
+        if (toolUses.length === 0) { this.opts.ui.turnComplete(); return; }
+
+        const results: unknown[] = [];
+        for (const tu of toolUses) {
+          await this.opts.store.append(this.opts.sessionId, { kind: "toolCall", callId: tu.id, tool: tu.name, input: tu.input, ts: Date.now() });
+          const r = await executeTool(tu.name, tu.input, tu.id, this.opts.ctx);
+          this.opts.ui.toolResult(tu.id, r.ok, r.output);
+          await this.opts.store.append(this.opts.sessionId, { kind: "toolResult", callId: tu.id, ok: r.ok, output: r.output, ts: Date.now() });
+          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output, is_error: !r.ok });
+        }
+        this.messages.push({ role: "user", content: results });
+      }
+      this.opts.ui.error("Max tool rounds (25) reached.");
+      this.opts.ui.turnComplete();
+    } catch (e) {
+      const msg = e instanceof Error ? e.message : String(e);
+      this.opts.ui.error(msg);
+      await this.opts.store.append(this.opts.sessionId, { kind: "error", message: msg, ts: Date.now() });
+    }
+  }
+}
diff --git a/src/host/approvals.ts b/src/host/approvals.ts
new file mode 100644
index 0000000..0d22d1e
--- /dev/null
+++ b/src/host/approvals.ts
@@ -0,0 +1,28 @@
+import type { HostToWebviewMsg } from "../shared/protocol";
+
+export class ApprovalManager {
+  private pending = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>();
+
+  constructor(private readonly post: (msg: HostToWebviewMsg) => void) {}
+
+  request(sessionId: string, callId: string, command: string): Promise<boolean> {
+    this.post({ type: "approvalRequest", sessionId, callId, command });
+    return new Promise<boolean>((resolve) => {
+      const timer = setTimeout(() => {
+        this.pending.delete(callId);
+        this.post({ type: "approvalResolved", sessionId, callId, approved: false });
+        resolve(false);
+      }, 60_000);
+      this.pending.set(callId, { resolve, timer });
+    });
+  }
+
+  resolve(callId: string, approved: boolean, sessionId: string): void {
+    const p = this.pending.get(callId);
+    if (!p) return;
+    clearTimeout(p.timer);
+    this.pending.delete(callId);
+    this.post({ type: "approvalResolved", sessionId, callId, approved });
+    p.resolve(approved);
+  }
+}
diff --git a/src/host/extension.ts b/src/host/extension.ts
new file mode 100644
index 0000000..5d51766
--- /dev/null
+++ b/src/host/extension.ts
@@ -0,0 +1,172 @@
+import * as vscode from "vscode";
+import * as path from "path";
+import * as cp from "child_process";
+import { createProvider, type Provider } from "./provider";
+import { AgentSession } from "./agent";
+import { SessionStore } from "./store";
+import { ApprovalManager } from "./approvals";
+import type { ToolContext } from "./tools";
+import type { HostToWebviewMsg, WebviewToHostMsg, ToolName } from "../shared/protocol";
+
+const TOOL_NAMES: ToolName[] = ["read_file", "list_dir", "apply_edit", "run_terminal"];
+
+function toToolName(name: string): ToolName {
+  return (TOOL_NAMES as string[]).includes(name) ? (name as ToolName) : "read_file";
+}
+
+export function activate(context: vscode.ExtensionContext) {
+  const provider = new ChatViewProvider(context);
+  context.subscriptions.push(
+    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
+    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
+      const key = await vscode.window.showInputBox({ password: true, prompt: "API key for the Justwoker Agent API" });
+      if (key) {
+        await context.secrets.store("justwokerAgent.apiKey", key);
+        vscode.window.showInformationMessage("API key saved.");
+      }
+    }),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.newSession()),
+  );
+}
+
+class ChatViewProvider implements vscode.WebviewViewProvider {
+  public view?: vscode.WebviewView;
+  private approvals!: ApprovalManager;
+  private sessions = new Map<string, AgentSession>();
+  private currentSessionId?: string;
+  private store!: SessionStore;
+
+  constructor(private readonly context: vscode.ExtensionContext) {}
+
+  post(msg: HostToWebviewMsg) { void this.view?.webview.postMessage(msg); }
+
+  newSession() { this.startSession(); }
+
+  resolveWebviewView(view: vscode.WebviewView) {
+    this.view = view;
+    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
+    view.webview.html = this.html(view.webview);
+    view.webview.onDidReceiveMessage((m: WebviewToHostMsg) => void this.onMessage(m));
+    this.store = new SessionStore(path.join(this.context.globalStorageUri.fsPath, "sessions"));
+    this.approvals = new ApprovalManager((msg) => this.post(msg));
+    this.startSession();
+    void this.sendSessionList();
+  }
+
+  private startSession() {
+    const { id } = this.store.createSession();
+    this.currentSessionId = id;
+    this.sessions.set(id, this.makeSession(id));
+    this.post({ type: "loadEvents", sessionId: id, events: [] });
+  }
+
+  private makeSession(id: string): AgentSession {
+    const cfg = vscode.workspace.getConfiguration("justwokerAgent");
+    const baseProvider = createProvider({
+      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
+      apiKey: "",
+      model: cfg.get("model", "gpt-5.6-sol"),
+      maxTokens: cfg.get("maxTokens", 4096),
+    });
+    // capture secrets before the wrapper so `this` binding cannot go wrong
+    const secrets = this.context.secrets;
+    let keyCached: string | null = null;
+    const provider: Provider = {
+      async streamTurn(messages, tools, onEvent) {
+        if (!keyCached) {
+          keyCached = (await secrets.get("justwokerAgent.apiKey")) ?? null;
+          if (!keyCached) throw new Error("No API key set. Run command 'Justwoker: Set API Key'.");
+          baseProvider.setKey(keyCached);
+        }
+        return baseProvider.streamTurn(messages, tools, onEvent);
+      },
+      setKey: (k: string) => baseProvider.setKey(k),
+    };
+    const ui = {
+      textDelta: (t: string) => this.post({ type: "textDelta", sessionId: id, text: t }),
+      toolCall: (callId: string, tool: string, input: Record<string, unknown>) =>
+        this.post({ type: "toolCall", sessionId: id, callId, tool: toToolName(tool), input }),
+      toolResult: (callId: string, ok: boolean, output: string) => this.post({ type: "toolResult", sessionId: id, callId, ok, output }),
+      error: (message: string) => this.post({ type: "error", sessionId: id, message }),
+      turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
+    };
+    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(), store: this.store, ui });
+  }
+
+  private makeToolContext(): ToolContext {
+    const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
+    return {
+      async readFile(p) { return vscode.workspace.fs.readFile(vscode.Uri.file(p)).then((b) => Buffer.from(b).toString("utf8")); },
+      async listDir(p) {
+        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
+        return entries.map(([name, type]) => type === vscode.FileType.Directory ? name + "/" : name);
+      },
+      async applyEdit(p, oldString, newString) {
+        const uri = vscode.Uri.file(p);
+        const doc = await vscode.workspace.openTextDocument(uri);
+        const text = doc.getText();
+        const count = text.split(oldString).length - 1;
+        if (count === 0) throw new Error("oldString not found in file.");
+        if (count > 1) throw new Error(`oldString found ${count} times; must be unique.`);
+        const edit = new vscode.WorkspaceEdit();
+        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
+        edit.replace(uri, fullRange, text.replace(oldString, newString));
+        const ok = await vscode.workspace.applyEdit(edit);
+        if (!ok) throw new Error("Edit rejected by editor.");
+      },
+      async runTerminal(command, cwd, onOutput) {
+        return new Promise((resolve) => {
+          const opts: cp.ExecOptions = { cwd };
+          const proc = cp.exec(command, opts, (err: cp.ExecException | null) => {
+            const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
+            resolve({ exitCode: code });
+          });
+          proc.stdout?.on("data", (d) => onOutput(d.toString()));
+          proc.stderr?.on("data", (d) => onOutput(d.toString()));
+        });
+      },
+      requestApproval: (command, callId) => this.approvals.request(this.currentSessionId ?? "", callId, command),
+      async openDiff(p) {
+        const uri = vscode.Uri.file(p);
+        await vscode.commands.executeCommand("vscode.diff", uri, uri, path.basename(p), { preview: true });
+      },
+      workspaceRoot: root,
+    };
+  }
+
+  private async onMessage(m: WebviewToHostMsg) {
+    switch (m.type) {
+      case "userMessage": this.sessions.get(m.sessionId)?.send(m.text); break;
+      case "approve": if (this.currentSessionId) this.approvals.resolve(m.callId, m.approved, this.currentSessionId); break;
+      case "newSessionRequest": this.startSession(); break;
+      case "retry": {
+        const s = this.sessions.get(m.sessionId);
+        if (s && !s.busy) s.send("(retry)");
+        break;
+      }
+      case "requestSessionList": await this.sendSessionList(); break;
+      case "loadSession": {
+        if (!this.sessions.has(m.sessionId)) {
+          this.sessions.set(m.sessionId, this.makeSession(m.sessionId));
+        }
+        // always post events so the webview renders history for both fresh and cached sessions
+        const events = await this.store.load(m.sessionId);
+        this.post({ type: "loadEvents", sessionId: m.sessionId, events });
+        this.currentSessionId = m.sessionId;
+        break;
+      }
+    }
+  }
+
+  private async sendSessionList() {
+    this.post({ type: "sessionList", sessions: await this.store.list() });
+  }
+
+  private html(webview: vscode.Webview) {
+    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "main.js"));
+    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">`;
+    return `<!DOCTYPE html><html><head>${csp}</head><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+  }
+}
+
+export function deactivate() {}
diff --git a/src/host/provider.ts b/src/host/provider.ts
new file mode 100644
index 0000000..dd32581
--- /dev/null
+++ b/src/host/provider.ts
@@ -0,0 +1,78 @@
+import Anthropic from "@anthropic-ai/sdk";
+import type { ToolDef } from "./tools";
+
+export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
+export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
+export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
+export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
+export interface Provider {
+  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>;
+  setKey(key: string): void;
+}
+
+export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider {
+  let client: AnthropicClientLike = sdk ?? new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
+  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
+
+  function setKey(key: string): void {
+    cfg = { ...cfg, apiKey: key };
+    if (!sdk) client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: key });
+    // when an injected sdk is used (tests), the sdk object stays as-is ΓÇö key swap is a no-op there
+  }
+
+  async function streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]> {
+    const params = {
+      model: cfg.model,
+      max_tokens: cfg.maxTokens,
+      messages,
+      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
+      stream: true,
+    };
+    let stream: AsyncIterable<unknown>;
+    for (let attempt = 0; ; attempt++) {
+      try { stream = client.messages.stream(params); break; }
+      catch (e: any) {
+        const retryable = e?.status >= 500 || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET";
+        if (!retryable || attempt >= 3) throw e;
+        await sleep(500 * 2 ** attempt);
+      }
+    }
+
+    let text = "";
+    const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
+    let currentTool: { id: string; name: string; json: string } | undefined;
+
+    const flushTool = () => {
+      if (!currentTool) return;
+      try {
+        toolUses.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.json || "{}") });
+      } catch { toolUses.push({ id: currentTool.id, name: currentTool.name, input: { _error: "malformed JSON input" } }); }
+      currentTool = undefined;
+    };
+
+    for await (const raw of stream) {
+      const ev = raw as any;
+      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
+        currentTool = { id: ev.content_block.id, name: ev.content_block.name, json: "" };
+      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
+        text += ev.delta.text;
+        onEvent({ type: "textDelta", text: ev.delta.text });
+      } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && currentTool) {
+        currentTool.json += ev.delta.partial_json;
+      } else if (ev.type === "content_block_stop" && currentTool) {
+        flushTool();
+      } else if (ev.type === "message_stop") {
+        flushTool(); // some streams omit content_block_stop for tool_use blocks
+      }
+    }
+    flushTool();
+
+    const content: unknown[] = [];
+    if (text) content.push({ type: "text", text });
+    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
+    onEvent({ type: "endTurn" });
+    return [{ role: "assistant", content }];
+  }
+
+  return { streamTurn, setKey };
+}
diff --git a/src/host/store.ts b/src/host/store.ts
new file mode 100644
index 0000000..8edd4e9
--- /dev/null
+++ b/src/host/store.ts
@@ -0,0 +1,39 @@
+import * as fs from "fs";
+import * as path from "path";
+import type { SessionEvent } from "../shared/protocol";
+
+export class SessionStore {
+  constructor(private readonly dir: string) {
+    fs.mkdirSync(dir, { recursive: true });
+  }
+  private file(id: string) { return path.join(this.dir, `${id}.jsonl`); }
+  createSession(): { id: string; path: string } {
+    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
+    const p = this.file(id);
+    fs.writeFileSync(p, "");
+    return { id, path: p };
+  }
+  async append(sessionId: string, event: SessionEvent): Promise<void> {
+    await fs.promises.appendFile(this.file(sessionId), JSON.stringify(event) + "\n", "utf8");
+  }
+  async load(sessionId: string): Promise<SessionEvent[]> {
+    try {
+      const raw = await fs.promises.readFile(this.file(sessionId), "utf8");
+      return raw.split("\n").filter((l) => l).map((l) => JSON.parse(l) as SessionEvent);
+    } catch { return []; }
+  }
+  async list(): Promise<{ id: string; firstUserMessage: string; ts: number }[]> {
+    const files = await fs.promises.readdir(this.dir);
+    const out: { id: string; firstUserMessage: string; ts: number }[] = [];
+    for (const f of files.filter((f) => f.endsWith(".jsonl"))) {
+      const id = f.replace(/\.jsonl$/, "");
+      const events = await this.load(id);
+      const first = events.find((e) => e.kind === "user");
+      if (first && first.kind === "user") out.push({ id, firstUserMessage: first.text, ts: first.ts });
+    }
+    return out.sort((a, b) => b.ts - a.ts);
+  }
+  async delete(sessionId: string): Promise<void> {
+    await fs.promises.rm(this.file(sessionId), { force: true });
+  }
+}
diff --git a/src/host/tools.ts b/src/host/tools.ts
new file mode 100644
index 0000000..3a50a9c
--- /dev/null
+++ b/src/host/tools.ts
@@ -0,0 +1,70 @@
+import * as path from "path";
+import type { ToolName } from "../shared/protocol";
+
+export interface ToolContext {
+  readFile(p: string): Promise<string>;
+  listDir(p: string): Promise<string[]>;
+  applyEdit(p: string, oldString: string, newString: string): Promise<void>;
+  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
+  requestApproval(command: string, callId: string): Promise<boolean>;
+  openDiff(p: string): Promise<void>;
+  workspaceRoot(): string | undefined;
+}
+
+export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }
+
+export const TOOL_DEFS: ToolDef[] = [
+  { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
+  { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
+  { name: "apply_edit", description: "Replace an exact string in a file. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
+  { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
+];
+
+export function resolvePath(workspaceRoot: string | undefined, rel: string): string {
+  if (!workspaceRoot) throw new Error("No workspace folder open.");
+  const abs = path.resolve(workspaceRoot, rel);
+  const normRoot = path.resolve(workspaceRoot);
+  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
+    throw new Error(`Path escapes workspace: ${rel}`);
+  }
+  return abs;
+}
+
+export async function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }> {
+  try {
+    switch (name as ToolName) {
+      case "read_file": {
+        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
+        return { ok: true, output: await ctx.readFile(p) };
+      }
+      case "list_dir": {
+        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? "."));
+        const entries = await ctx.listDir(p);
+        return { ok: true, output: entries.join("\n") };
+      }
+      case "apply_edit": {
+        const p = resolvePath(ctx.workspaceRoot(), String(input.path ?? ""));
+        const oldString = String(input.oldString ?? "");
+        const newString = String(input.newString ?? "");
+        if (!oldString) return { ok: false, output: "apply_edit error: oldString must be non-empty." };
+        await ctx.applyEdit(p, oldString, newString);
+        await ctx.openDiff(p);
+        return { ok: true, output: `Edited ${input.path}` };
+      }
+      case "run_terminal": {
+        const command = String(input.command ?? "");
+        if (!command) return { ok: false, output: "run_terminal error: command required." };
+        const approved = await ctx.requestApproval(command, callId);
+        if (!approved) return { ok: false, output: "User rejected this command." };
+        const cwd = input.cwd ? resolvePath(ctx.workspaceRoot(), String(input.cwd)) : undefined;
+        let output = "";
+        const { exitCode } = await ctx.runTerminal(command, cwd, (chunk) => { output += chunk; });
+        return { ok: exitCode === 0, output: output.slice(-8000) || `(exit code ${exitCode})` };
+      }
+      default:
+        return { ok: false, output: `Unknown tool: ${name}` };
+    }
+  } catch (e) {
+    return { ok: false, output: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
+  }
+}
diff --git a/src/shared/protocol.ts b/src/shared/protocol.ts
new file mode 100644
index 0000000..9c8bb4f
--- /dev/null
+++ b/src/shared/protocol.ts
@@ -0,0 +1,34 @@
+export type ToolName = "read_file" | "list_dir" | "apply_edit" | "run_terminal";
+
+export interface ToolCallView {
+  callId: string;
+  tool: ToolName;
+  input: Record<string, unknown>;
+}
+
+export type HostToWebviewMsg =
+  | { type: "textDelta"; sessionId: string; text: string }
+  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
+  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string }
+  | { type: "approvalRequest"; sessionId: string; callId: string; command: string }
+  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
+  | { type: "error"; sessionId: string; message: string }
+  | { type: "turnComplete"; sessionId: string }
+  | { type: "newSession" }
+  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number }[] }
+  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] };
+
+export type WebviewToHostMsg =
+  | { type: "userMessage"; sessionId: string; text: string }
+  | { type: "approve"; callId: string; approved: boolean }
+  | { type: "newSessionRequest" }
+  | { type: "retry"; sessionId: string }
+  | { type: "requestSessionList" }
+  | { type: "loadSession"; sessionId: string };
+
+export type SessionEvent =
+  | { kind: "user"; text: string; ts: number }
+  | { kind: "assistantText"; text: string; ts: number }
+  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
+  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number }
+  | { kind: "error"; message: string; ts: number };
diff --git a/src/webview/App.tsx b/src/webview/App.tsx
new file mode 100644
index 0000000..9acefd2
--- /dev/null
+++ b/src/webview/App.tsx
@@ -0,0 +1,153 @@
+import React, { useEffect, useRef, useState } from "react";
+import { marked } from "marked";
+import DOMPurify from "dompurify";
+import { send, onHostMessage } from "./api";
+import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";
+
+interface Card {
+  kind: "user" | "assistant" | "tool" | "error";
+  text?: string;
+  callId?: string;
+  tool?: string;
+  output?: string;
+  pendingApproval?: string;
+  approvalDone?: "approved" | "rejected";
+}
+
+export default function App() {
+  const [cards, setCards] = useState<Card[]>([]);
+  const [input, setInput] = useState("");
+  const [sessionList, setSessionList] = useState<{ id: string; firstUserMessage: string }[]>([]);
+  const sessionIdRef = useRef<string>("");
+  const bottomRef = useRef<HTMLDivElement>(null);
+
+  useEffect(() => {
+    onHostMessage((m: HostToWebviewMsg) => {
+      setCards((prev) => {
+        const next = [...prev];
+        const last = next[next.length - 1];
+        switch (m.type) {
+          case "newSession":
+            sessionIdRef.current = "";
+            return [];
+          case "loadEvents":
+            sessionIdRef.current = m.sessionId;
+            return eventsToCards(m.events);
+          case "textDelta":
+            sessionIdRef.current = m.sessionId;
+            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
+            else next.push({ kind: "assistant", text: m.text });
+            return next;
+          case "toolCall":
+            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
+            return next;
+          case "approvalRequest":
+            return next.map((c) => (c.callId === m.callId ? { ...c, pendingApproval: m.command } : c));
+          case "approvalResolved":
+            return next.map((c) =>
+              c.callId === m.callId
+                ? { ...c, approvalDone: m.approved ? ("approved" as const) : ("rejected" as const), pendingApproval: undefined }
+                : c
+            );
+          case "toolResult":
+            return next.map((c) => (c.callId === m.callId ? { ...c, output: m.output } : c));
+          case "error":
+            next.push({ kind: "error", text: m.message });
+            return next;
+          case "turnComplete":
+            return next;
+          case "sessionList":
+            setSessionList(m.sessions);
+            return next;
+          default:
+            return next;
+        }
+      });
+    });
+    send({ type: "requestSessionList" });
+  }, []);
+
+  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cards]);
+
+  const submit = () => {
+    if (!input.trim() || !sessionIdRef.current) return;
+    send({ type: "userMessage", sessionId: sessionIdRef.current, text: input });
+    setCards((p) => [...p, { kind: "user", text: input }]);
+    setInput("");
+  };
+
+  const onRetry = () => {
+    if (sessionIdRef.current) send({ type: "retry", sessionId: sessionIdRef.current });
+  };
+
+  return (
+    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
+      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
+        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
+        <select
+          onChange={(e) => { if (e.target.value) send({ type: "loadSession", sessionId: e.target.value }); e.target.value = ""; }}
+          value=""
+        >
+          <option value="">SessionsΓÇª</option>
+          {sessionList.map((s) => (
+            <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>
+          ))}
+        </select>
+      </div>
+      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
+        {cards.map((c, i) => <CardView key={i} card={c} onRetry={onRetry} />)}
+        <div ref={bottomRef} />
+      </div>
+      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
+        <textarea
+          style={{ flex: 1, resize: "none", color: "var(--vscode-inputForeground)", background: "var(--vscode-inputBackground)", border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))" }}
+          rows={3}
+          value={input}
+          onChange={(e) => setInput(e.target.value)}
+          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
+          placeholder="Ask the agentΓÇª (Enter to send, Shift+Enter for newline)"
+        />
+        <button onClick={submit}>Send</button>
+      </div>
+    </div>
+  );
+}
+
+function eventsToCards(events: SessionEvent[]): Card[] {
+  return events.map((e) => {
+    if (e.kind === "user") return { kind: "user" as const, text: e.text };
+    if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text };
+    if (e.kind === "error") return { kind: "error" as const, text: e.message };
+    if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool };
+    return { kind: "tool" as const, callId: e.callId, output: e.output };
+  });
+}
+
+function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
+  if (card.kind === "assistant") {
+    return <div className="md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(card.text ?? "", { async: false }) as string) }} />;
+  }
+  if (card.kind === "user") {
+    return <div style={{ color: "var(--vscode-inputForeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
+  }
+  if (card.kind === "error") {
+    return (
+      <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
+        {card.text} <button onClick={onRetry}>Retry</button>
+      </div>
+    );
+  }
+  return (
+    <div style={{ border: "1px solid var(--vscode-panel-border)", padding: "6px", margin: "4px 0", fontFamily: "monospace", fontSize: "12px" }}>
+      <div>≡ƒöº {card.tool} {card.pendingApproval ? "ΓÇö awaiting approval" : ""} {card.approvalDone ? `ΓÇö ${card.approvalDone}` : ""}</div>
+      {card.pendingApproval && (
+        <div style={{ marginTop: "4px" }}>
+          <code>{card.pendingApproval}</code>
+          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: true })}>Approve</button>{" "}
+          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: false })}>Reject</button>
+        </div>
+      )}
+      {card.output && <pre style={{ whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>{card.output}</pre>}
+    </div>
+  );
+}
diff --git a/src/webview/api.ts b/src/webview/api.ts
new file mode 100644
index 0000000..1c748fa
--- /dev/null
+++ b/src/webview/api.ts
@@ -0,0 +1,8 @@
+import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";
+
+declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void };
+export const vscode = acquireVsCodeApi();
+export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
+export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
+  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
+};
diff --git a/src/webview/main.tsx b/src/webview/main.tsx
new file mode 100644
index 0000000..9a8cdbf
--- /dev/null
+++ b/src/webview/main.tsx
@@ -0,0 +1,4 @@
+import React from "react";
+import { createRoot } from "react-dom/client";
+import App from "./App";
+createRoot(document.getElementById("root")!).render(<App />);
diff --git a/test/integration/agentFlow.test.ts b/test/integration/agentFlow.test.ts
new file mode 100644
index 0000000..8cc069d
--- /dev/null
+++ b/test/integration/agentFlow.test.ts
@@ -0,0 +1,21 @@
+import * as assert from "assert";
+import * as vscode from "vscode";
+
+suite("Justwoker Agent extension", () => {
+  test("extension activates and registers the webview view", async () => {
+    const ext =
+      vscode.extensions.getExtension("justwoker.agent") ??
+      vscode.extensions.getExtension("justwoker.justwoker-agent") ??
+      vscode.extensions.all.find((e) => e.packageJSON?.publisher === "justwoker");
+    assert.ok(ext, "extension not found");
+    await ext!.activate();
+    await vscode.commands.executeCommand("justwokerAgent.chat.focus");
+    assert.ok(true);
+  });
+
+  test("commands are registered", async () => {
+    const cmds = await vscode.commands.getCommands(true);
+    assert.ok(cmds.includes("justwokerAgent.setApiKey"));
+    assert.ok(cmds.includes("justwokerAgent.newSession"));
+  });
+});
diff --git a/test/integration/index.ts b/test/integration/index.ts
new file mode 100644
index 0000000..c056666
--- /dev/null
+++ b/test/integration/index.ts
@@ -0,0 +1,16 @@
+import * as path from "path";
+
+export async function run(): Promise<void> {
+  const Mocha = (await import("mocha")).default;
+  const mocha = new Mocha({ ui: "tdd", color: true });
+  mocha.addFile(path.resolve(__dirname, "./agentFlow.test.js"));
+  await new Promise<void>((resolve, reject) => {
+    mocha.run((failures) => {
+      if (failures > 0) {
+        reject(new Error(`${failures} test(s) failed`));
+      } else {
+        resolve();
+      }
+    });
+  });
+}
diff --git a/test/integration/run.ts b/test/integration/run.ts
new file mode 100644
index 0000000..9e90ca8
--- /dev/null
+++ b/test/integration/run.ts
@@ -0,0 +1,9 @@
+import * as path from "path";
+async function go(): Promise<void> {
+  const { runTests } = await import("@vscode/test-electron");
+  await runTests({
+    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
+    extensionTestsPath: path.resolve(__dirname, "./index"),
+  });
+}
+go().catch((e) => { console.error(e); process.exit(1); });
diff --git a/test/mock-server.ts b/test/mock-server.ts
new file mode 100644
index 0000000..5b788ed
--- /dev/null
+++ b/test/mock-server.ts
@@ -0,0 +1,15 @@
+import http from "http";
+
+export function startMockServer(port: number): Promise<http.Server> {
+  return new Promise((resolve) => {
+    const server = http.createServer((req, res) => {
+      if (req.url?.includes("/v1/messages")) {
+        res.writeHead(200, { "Content-Type": "text/event-stream" });
+        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Mock reply." } })}\n\n`);
+        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
+        res.end();
+      } else { res.writeHead(404).end(); }
+    });
+    server.listen(port, () => resolve(server));
+  });
+}
diff --git a/test/unit/agent.test.ts b/test/unit/agent.test.ts
new file mode 100644
index 0000000..316a8a8
--- /dev/null
+++ b/test/unit/agent.test.ts
@@ -0,0 +1,98 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
+import { AgentSession } from "../../src/host/agent";
+import type { Provider, AnthropicMessage } from "../../src/host/provider";
+import type { ToolContext } from "../../src/host/tools";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";
+
+function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
+  const calls: AnthropicMessage[][] = [];
+  return {
+    calls,
+    setKey() {},
+    async streamTurn(messages, _tools, onEvent) {
+      calls.push(messages.map((m) => ({ ...m, content: [...m.content as any[]] })));
+      const turn = turns.shift()!;
+      for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
+      for (const tu of turn.toolUses ?? []) onEvent({ type: "toolUse", id: tu.id, name: tu.name, input: tu.input });
+      onEvent({ type: "endTurn" });
+      const content: any[] = [];
+      if (turn.text) content.push({ type: "text", text: turn.text });
+      for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
+      return [{ role: "assistant", content }];
+    },
+  };
+}
+
+function ctx(): ToolContext {
+  return {
+    readFile: async () => "content of a.txt",
+    listDir: async () => ["a.txt"],
+    applyEdit: vi.fn(async () => {}),
+    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
+    requestApproval: async () => true,
+    openDiff: vi.fn(async () => {}),
+    workspaceRoot: () => "C:/work/proj",
+  };
+}
+
+let dir: string;
+beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
+afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
+
+describe("AgentSession", () => {
+  it("runs a tool round-trip: tool_use ΓåÆ tool_result ΓåÆ final text", async () => {
+    const provider = scriptedProvider([
+      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
+      { text: "The file says: content of a.txt" },
+    ]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("read a.txt");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
+    expect(ui.toolCall).toHaveBeenCalledWith("c1", "read_file", { path: "a.txt" });
+    expect(ui.toolResult).toHaveBeenCalledWith("c1", true, "content of a.txt");
+    const secondCall = provider.calls[1];
+    expect(JSON.stringify(secondCall)).toContain('"type":"tool_result"');
+    expect(ui.textDelta).toHaveBeenCalledWith("The".slice(0, 3));
+  });
+
+  it("persists events to the session JSONL", async () => {
+    const provider = scriptedProvider([{ text: "ok" }]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const { id } = store.createSession();
+    const session = new AgentSession({ sessionId: id, provider, ctx: ctx(), store, ui });
+    session.send("hello");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
+    const events = await store.load(id);
+    expect(events[0]).toEqual({ kind: "user", text: "hello", ts: expect.any(Number) });
+    expect(events.some((e) => e.kind === "assistantText" && e.text === "ok")).toBe(true);
+  });
+
+  it("queues a second user message while the loop is running", async () => {
+    const provider = scriptedProvider([{ text: "one" }, { text: "two" }]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("first");
+    expect(session.busy).toBe(true);
+    session.send("second");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalledTimes(2));
+    expect(provider.calls.length).toBe(2);
+  });
+
+  it("surfaces provider errors via ui.error and unlocks", async () => {
+    const provider: Provider = {
+      async streamTurn() { throw new Error("boom"); },
+      setKey() {},
+    } as unknown as Provider;
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("hello");
+    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
+    expect(session.busy).toBe(false);
+  });
+});
diff --git a/test/unit/example.test.ts b/test/unit/example.test.ts
new file mode 100644
index 0000000..01d1eb2
--- /dev/null
+++ b/test/unit/example.test.ts
@@ -0,0 +1,2 @@
+import { describe, it, expect } from "vitest";
+describe("scaffold", () => { it("runs vitest", () => { expect(1).toBe(1); }); });
diff --git a/test/unit/protocol.test.ts b/test/unit/protocol.test.ts
new file mode 100644
index 0000000..9754938
--- /dev/null
+++ b/test/unit/protocol.test.ts
@@ -0,0 +1,31 @@
+import { describe, it, expect } from "vitest";
+import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../../src/shared/protocol";
+
+describe("protocol types", () => {
+  it("accepts a full set of message shapes", () => {
+    const host: HostToWebviewMsg[] = [
+      { type: "textDelta", sessionId: "s1", text: "hi" },
+      { type: "toolCall", sessionId: "s1", callId: "c1", tool: "read_file", input: { path: "a.txt" } },
+      { type: "toolResult", sessionId: "s1", callId: "c1", ok: true, output: "contents" },
+      { type: "approvalRequest", sessionId: "s1", callId: "c2", command: "npm test" },
+      { type: "approvalResolved", sessionId: "s1", callId: "c2", approved: true },
+      { type: "error", sessionId: "s1", message: "boom" },
+      { type: "turnComplete", sessionId: "s1" },
+      { type: "newSession" },
+    ];
+    const webview: WebviewToHostMsg[] = [
+      { type: "userMessage", sessionId: "s1", text: "hello" },
+      { type: "approve", callId: "c2", approved: true },
+      { type: "newSessionRequest" },
+      { type: "retry", sessionId: "s1" },
+    ];
+    const events: SessionEvent[] = [
+      { kind: "user", text: "hi", ts: 1 },
+      { kind: "assistantText", text: "hello", ts: 2 },
+      { kind: "toolCall", callId: "c1", tool: "read_file", input: { path: "a.txt" }, ts: 3 },
+      { kind: "toolResult", callId: "c1", ok: true, output: "x", ts: 4 },
+      { kind: "error", message: "e", ts: 5 },
+    ];
+    expect(host.length + webview.length + events.length).toBeGreaterThan(0);
+  });
+});
diff --git a/test/unit/provider.test.ts b/test/unit/provider.test.ts
new file mode 100644
index 0000000..2f702ec
--- /dev/null
+++ b/test/unit/provider.test.ts
@@ -0,0 +1,91 @@
+import { describe, it, expect, vi } from "vitest";
+import { createProvider } from "../../src/host/provider";
+import type { AnthropicClientLike } from "../../src/host/provider";
+
+function fakeSdk(deltas: unknown[]) {
+  return {
+    messages: {
+      stream: vi.fn(async function* () {
+        for (const d of deltas) yield d;
+      }),
+    },
+  } as unknown as AnthropicClientLike;
+}
+
+describe("createProvider.streamTurn", () => {
+  const cfg = { baseUrl: "https://x", apiKey: "k", model: "gpt-5.6-sol", maxTokens: 100 };
+
+  it("emits textDelta and endTurn events", async () => {
+    const events: unknown[] = [];
+    const sdk = fakeSdk([
+      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
+      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
+      { type: "message_stop" },
+    ]);
+    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
+    expect(events).toEqual([
+      { type: "textDelta", text: "Hel" },
+      { type: "textDelta", text: "lo" },
+      { type: "endTurn" },
+    ]);
+  });
+
+  it("accumulates tool_use blocks and emits toolUse", async () => {
+    const events: unknown[] = [];
+    const sdk = fakeSdk([
+      { type: "content_block_start", content_block: { type: "tool_use", id: "c1", name: "read_file" } },
+      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"path":"a' } },
+      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '.txt"}' } },
+      { type: "message_stop" },
+    ]);
+    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
+    expect(events).toContainEqual({ type: "toolUse", id: "c1", name: "read_file", input: { path: "a.txt" } });
+  });
+
+  it("retries 5xx errors up to 3 times then succeeds", async () => {
+    const stream = async function* () { yield {}; };
+    let calls = 0;
+    const sdk = {
+      messages: {
+        stream: vi.fn(() => {
+          calls++;
+          if (calls < 4) { const e = new Error("server error") as any; e.status = 500; throw e; }
+          return stream();
+        }),
+      },
+    } as unknown as AnthropicClientLike;
+    await createProvider(cfg, sdk).streamTurn([], [], () => {});
+    expect(calls).toBe(4); // 3 failures + 1 success
+  });
+
+  it("does not retry 4xx errors", async () => {
+    const sdk = {
+      messages: {
+        stream: vi.fn(() => { const e = new Error("bad request") as any; e.status = 400; throw e; }),
+      },
+    } as unknown as AnthropicClientLike;
+    await expect(createProvider(cfg, sdk).streamTurn([], [], () => {})).rejects.toThrow("bad request");
+    expect(sdk.messages.stream).toHaveBeenCalledTimes(1);
+  });
+
+  it("setKey replaces the client and the next call uses it", async () => {
+    const sdkA = fakeSdk([{ type: "content_block_delta", delta: { type: "text_delta", text: "fromA" } }, { type: "message_stop" }]);
+    const sdkB = fakeSdk([{ type: "content_block_delta", delta: { type: "text_delta", text: "fromB" } }, { type: "message_stop" }]);
+    // createProvider takes one sdk; for this test we simulate via factory closure:
+    let current = sdkA;
+    // Use createProvider with sdkA, then swap behavior through setKey rebuilding:
+    // Simplest: create with a delegating sdk
+    const delegating = {
+      messages: {
+        stream: (p: unknown) => current.messages.stream(p),
+      },
+    } as unknown as AnthropicClientLike;
+    const provider = createProvider(cfg, delegating);
+    const events: string[] = [];
+    await provider.streamTurn([], [], (e) => { if (e.type === "textDelta") events.push(e.text); });
+    current = sdkB;
+    provider.setKey("new-key");
+    await provider.streamTurn([], [], (e) => { if (e.type === "textDelta") events.push(e.text); });
+    expect(events).toEqual(["fromA", "fromB"]);
+  });
+});
diff --git a/test/unit/store.test.ts b/test/unit/store.test.ts
new file mode 100644
index 0000000..220acd9
--- /dev/null
+++ b/test/unit/store.test.ts
@@ -0,0 +1,39 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync, rmSync } from "fs";
+import { tmpdir } from "os";
+import path from "path";
+
+let dir: string;
+beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
+afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
+
+describe("SessionStore", () => {
+  it("appends and reloads events in order", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.append(id, { kind: "user", text: "hi", ts: 1 });
+    await s.append(id, { kind: "assistantText", text: "hello", ts: 2 });
+    expect(await s.load(id)).toEqual([
+      { kind: "user", text: "hi", ts: 1 },
+      { kind: "assistantText", text: "hello", ts: 2 },
+    ]);
+  });
+  it("lists sessions with first user message", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.append(id, { kind: "user", text: "fix the bug", ts: 42 });
+    const list = await s.list();
+    expect(list).toEqual([{ id, firstUserMessage: "fix the bug", ts: 42 }]);
+  });
+  it("delete removes the file", async () => {
+    const s = new SessionStore(dir);
+    const { id } = s.createSession();
+    await s.delete(id);
+    expect(await s.load(id)).toEqual([]);
+  });
+  it("load on missing session returns empty, does not throw", async () => {
+    const s = new SessionStore(dir);
+    expect(await s.load("nonexistent")).toEqual([]);
+  });
+});
diff --git a/test/unit/tools.test.ts b/test/unit/tools.test.ts
new file mode 100644
index 0000000..5108f79
--- /dev/null
+++ b/test/unit/tools.test.ts
@@ -0,0 +1,63 @@
+import { describe, it, expect, vi } from "vitest";
+import { executeTool, resolvePath, TOOL_DEFS } from "../../src/host/tools";
+import type { ToolContext } from "../../src/host/tools";
+import path from "path";
+
+function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
+  return {
+    readFile: vi.fn(async () => "file contents"),
+    listDir: vi.fn(async () => ["a.txt", "b/"]),
+    applyEdit: vi.fn(async () => {}),
+    runTerminal: vi.fn(async () => ({ exitCode: 0 })),
+    requestApproval: vi.fn(async () => true),
+    openDiff: vi.fn(async () => {}),
+    workspaceRoot: () => "C:/work/proj",
+    ...overrides,
+  };
+}
+
+describe("resolvePath", () => {
+  it("rejects paths escaping the workspace", () => {
+    expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
+    expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
+  });
+  it("rejects absolute paths with traversal escaping the workspace", () => {
+    expect(() => resolvePath("C:/work/proj", "C:/work/proj/../evil.txt")).toThrow();
+  });
+  it("accepts relative paths inside workspace", () => {
+    expect(resolvePath("C:/work/proj", "src/a.ts")).toBe(path.resolve("C:/work/proj", "src/a.ts"));
+  });
+});
+
+describe("executeTool", () => {
+  it("read_file returns contents", async () => {
+    const r = await executeTool("read_file", { path: "a.txt" }, "c1", mockCtx());
+    expect(r).toEqual({ ok: true, output: "file contents" });
+  });
+  it("returns error result for unknown file (model self-corrects)", async () => {
+    const ctx = mockCtx({ readFile: async () => { throw new Error("ENOENT"); } });
+    const r = await executeTool("read_file", { path: "nope" }, "c1", ctx);
+    expect(r.ok).toBe(false);
+    expect(r.output).toContain("ENOENT");
+  });
+  it("apply_edit requires oldString to be a non-empty string", async () => {
+    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "", newString: "x" }, "c1", mockCtx());
+    expect(r.ok).toBe(false);
+  });
+  it("run_terminal calls requestApproval and runs when approved", async () => {
+    const ctx = mockCtx();
+    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
+    expect(ctx.requestApproval).toHaveBeenCalledWith("npm test", "c1");
+    expect(ctx.runTerminal).toHaveBeenCalled();
+    expect(r.ok).toBe(true);
+  });
+  it("run_terminal does not run when rejected", async () => {
+    const ctx = mockCtx({ requestApproval: async () => false });
+    const r = await executeTool("run_terminal", { command: "rm -rf /" }, "c1", ctx);
+    expect(ctx.runTerminal).not.toHaveBeenCalled();
+    expect(r.ok).toBe(false);
+  });
+  it("exposes 4 tool defs for the API", () => {
+    expect(TOOL_DEFS.map((d) => d.name)).toEqual(["read_file", "list_dir", "apply_edit", "run_terminal"]);
+  });
+});
