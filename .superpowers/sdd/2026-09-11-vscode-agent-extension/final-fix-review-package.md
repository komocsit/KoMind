## fix diff vs d321151^
diff --git a/src/host/agent.ts b/src/host/agent.ts
index 7fa0131..a51e933 100644
--- a/src/host/agent.ts
+++ b/src/host/agent.ts
@@ -9,21 +9,27 @@ export interface AgentUi {
   toolResult(callId: string, ok: boolean, output: string): void;
   error(msg: string): void;
   turnComplete(): void;
 }
 
 export class AgentSession {
   private messages: AnthropicMessage[] = [];
   private queue: string[] = [];
   private running = false;
 
-  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi }) {}
+  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi; initialMessages?: AnthropicMessage[] }) {
+    if (opts.initialMessages) this.messages.push(...opts.initialMessages);
+  }
+
+  seedFromEvents(events: SessionEvent[]): void {
+    this.messages.push(...messagesFromEvents(events));
+  }
 
   get busy() { return this.running; }
 
   send(text: string): void {
     this.queue.push(text);
     if (this.running) return;
     this.running = true;          // set synchronously so busy is observable immediately
     void this.drain();
   }
 
@@ -70,10 +76,38 @@ export class AgentSession {
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
+
+export function messagesFromEvents(events: SessionEvent[]): AnthropicMessage[] {
+  const messages: AnthropicMessage[] = [];
+  let textBuf: { type: "text"; text: string }[] = [];
+  let toolBuf: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }[] = [];
+  let resultBuf: { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }[] = [];
+  const flushText = () => { if (textBuf.length) { messages.push({ role: "assistant", content: textBuf }); textBuf = []; } };
+  const flushTools = () => { if (toolBuf.length) { messages.push({ role: "assistant", content: toolBuf }); toolBuf = []; } };
+  const flushResults = () => { if (resultBuf.length) { messages.push({ role: "user", content: resultBuf }); resultBuf = []; } };
+  for (const e of events) {
+    if (e.kind === "user") {
+      flushResults(); flushText(); flushTools();
+      messages.push({ role: "user", content: [{ type: "text", text: e.text }] });
+    } else if (e.kind === "assistantText") {
+      flushResults(); flushTools();
+      textBuf.push({ type: "text", text: e.text });
+    } else if (e.kind === "toolCall") {
+      flushResults(); flushText();
+      toolBuf.push({ type: "tool_use", id: e.callId, name: e.tool, input: e.input });
+    } else if (e.kind === "toolResult") {
+      flushText(); flushTools();
+      resultBuf.push({ type: "tool_result", tool_use_id: e.callId, content: e.output, is_error: !e.ok });
+    }
+    // "error" events are not part of the model conversation
+  }
+  flushResults(); flushText(); flushTools();
+  return messages;
+}
diff --git a/src/host/extension.ts b/src/host/extension.ts
index 5d51766..30aec7b 100644
--- a/src/host/extension.ts
+++ b/src/host/extension.ts
@@ -1,15 +1,15 @@
 import * as vscode from "vscode";
 import * as path from "path";
 import * as cp from "child_process";
 import { createProvider, type Provider } from "./provider";
-import { AgentSession } from "./agent";
+import { AgentSession, messagesFromEvents } from "./agent";
 import { SessionStore } from "./store";
 import { ApprovalManager } from "./approvals";
 import type { ToolContext } from "./tools";
 import type { HostToWebviewMsg, WebviewToHostMsg, ToolName } from "../shared/protocol";
 
 const TOOL_NAMES: ToolName[] = ["read_file", "list_dir", "apply_edit", "run_terminal"];
 
 function toToolName(name: string): ToolName {
   return (TOOL_NAMES as string[]).includes(name) ? (name as ToolName) : "read_file";
 }
@@ -53,21 +53,21 @@ class ChatViewProvider implements vscode.WebviewViewProvider {
     void this.sendSessionList();
   }
 
   private startSession() {
     const { id } = this.store.createSession();
     this.currentSessionId = id;
     this.sessions.set(id, this.makeSession(id));
     this.post({ type: "loadEvents", sessionId: id, events: [] });
   }
 
-  private makeSession(id: string): AgentSession {
+  private makeSession(id: string, initialMessages?: ConstructorParameters<typeof AgentSession>[0]["initialMessages"]): AgentSession {
     const cfg = vscode.workspace.getConfiguration("justwokerAgent");
     const baseProvider = createProvider({
       baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
       apiKey: "",
       model: cfg.get("model", "gpt-5.6-sol"),
       maxTokens: cfg.get("maxTokens", 4096),
     });
     // capture secrets before the wrapper so `this` binding cannot go wrong
     const secrets = this.context.secrets;
     let keyCached: string | null = null;
@@ -83,78 +83,81 @@ class ChatViewProvider implements vscode.WebviewViewProvider {
       setKey: (k: string) => baseProvider.setKey(k),
     };
     const ui = {
       textDelta: (t: string) => this.post({ type: "textDelta", sessionId: id, text: t }),
       toolCall: (callId: string, tool: string, input: Record<string, unknown>) =>
         this.post({ type: "toolCall", sessionId: id, callId, tool: toToolName(tool), input }),
       toolResult: (callId: string, ok: boolean, output: string) => this.post({ type: "toolResult", sessionId: id, callId, ok, output }),
       error: (message: string) => this.post({ type: "error", sessionId: id, message }),
       turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
     };
-    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(), store: this.store, ui });
+    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(), store: this.store, ui, initialMessages });
   }
 
   private makeToolContext(): ToolContext {
+    const cfg = vscode.workspace.getConfiguration("justwokerAgent");
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
+        // diff pre-edit content against the live edited file
+        const originalDoc = await vscode.workspace.openTextDocument({ content: text, language: doc.languageId });
+        await vscode.commands.executeCommand("vscode.diff", originalDoc.uri, uri, path.basename(p), { preview: true });
       },
       async runTerminal(command, cwd, onOutput) {
         return new Promise((resolve) => {
           const opts: cp.ExecOptions = { cwd };
           const proc = cp.exec(command, opts, (err: cp.ExecException | null) => {
             const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
             resolve({ exitCode: code });
           });
           proc.stdout?.on("data", (d) => onOutput(d.toString()));
           proc.stderr?.on("data", (d) => onOutput(d.toString()));
         });
       },
       requestApproval: (command, callId) => this.approvals.request(this.currentSessionId ?? "", callId, command),
-      async openDiff(p) {
-        const uri = vscode.Uri.file(p);
-        await vscode.commands.executeCommand("vscode.diff", uri, uri, path.basename(p), { preview: true });
-      },
       workspaceRoot: root,
+      autoApproveEdits: cfg.get("autoApproveEdits", true),
+      autoApproveTerminal: cfg.get("autoApproveTerminal", false),
     };
   }
 
   private async onMessage(m: WebviewToHostMsg) {
     switch (m.type) {
       case "userMessage": this.sessions.get(m.sessionId)?.send(m.text); break;
       case "approve": if (this.currentSessionId) this.approvals.resolve(m.callId, m.approved, this.currentSessionId); break;
       case "newSessionRequest": this.startSession(); break;
       case "retry": {
         const s = this.sessions.get(m.sessionId);
         if (s && !s.busy) s.send("(retry)");
         break;
       }
       case "requestSessionList": await this.sendSessionList(); break;
       case "loadSession": {
         if (!this.sessions.has(m.sessionId)) {
-          this.sessions.set(m.sessionId, this.makeSession(m.sessionId));
+          const events = await this.store.load(m.sessionId);
+          this.sessions.set(m.sessionId, this.makeSession(m.sessionId, messagesFromEvents(events)));
         }
         // always post events so the webview renders history for both fresh and cached sessions
         const events = await this.store.load(m.sessionId);
         this.post({ type: "loadEvents", sessionId: m.sessionId, events });
         this.currentSessionId = m.sessionId;
         break;
       }
     }
   }
 
diff --git a/src/host/tools.ts b/src/host/tools.ts
index 3a50a9c..3031936 100644
--- a/src/host/tools.ts
+++ b/src/host/tools.ts
@@ -1,21 +1,22 @@
 import * as path from "path";
 import type { ToolName } from "../shared/protocol";
 
 export interface ToolContext {
   readFile(p: string): Promise<string>;
   listDir(p: string): Promise<string[]>;
   applyEdit(p: string, oldString: string, newString: string): Promise<void>;
   runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
   requestApproval(command: string, callId: string): Promise<boolean>;
-  openDiff(p: string): Promise<void>;
   workspaceRoot(): string | undefined;
+  autoApproveEdits: boolean;
+  autoApproveTerminal: boolean;
 }
 
 export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }
 
 export const TOOL_DEFS: ToolDef[] = [
   { name: "read_file", description: "Read a text file from the workspace. Returns full contents.", schema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path" } }, required: ["path"] } },
   { name: "list_dir", description: "List entries of a workspace directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
   { name: "apply_edit", description: "Replace an exact string in a file. oldString must match exactly and appear exactly once.", schema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] } },
   { name: "run_terminal", description: "Run a shell command in the workspace. Requires user approval.", schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, required: ["command"] } },
 ];
@@ -40,29 +41,35 @@ export async function executeTool(name: string, input: Record<string, unknown>,
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
+        if (!ctx.autoApproveEdits) {
+          const snippet = (s: string) => s.slice(0, 80);
+          const approved = await ctx.requestApproval(`Edit ${input.path}: replace "${snippet(oldString)}" with "${snippet(newString)}"`, callId);
+          if (!approved) return { ok: false, output: "User rejected this edit." };
+        }
         await ctx.applyEdit(p, oldString, newString);
-        await ctx.openDiff(p);
         return { ok: true, output: `Edited ${input.path}` };
       }
       case "run_terminal": {
         const command = String(input.command ?? "");
         if (!command) return { ok: false, output: "run_terminal error: command required." };
-        const approved = await ctx.requestApproval(command, callId);
-        if (!approved) return { ok: false, output: "User rejected this command." };
+        if (!ctx.autoApproveTerminal) {
+          const approved = await ctx.requestApproval(command, callId);
+          if (!approved) return { ok: false, output: "User rejected this command." };
+        }
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
diff --git a/test/unit/agent.test.ts b/test/unit/agent.test.ts
index 316a8a8..dfdaeec 100644
--- a/test/unit/agent.test.ts
+++ b/test/unit/agent.test.ts
@@ -1,12 +1,12 @@
 import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
-import { AgentSession } from "../../src/host/agent";
+import { AgentSession, messagesFromEvents } from "../../src/host/agent";
 import type { Provider, AnthropicMessage } from "../../src/host/provider";
 import type { ToolContext } from "../../src/host/tools";
 import { SessionStore } from "../../src/host/store";
 import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";
 
 function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
   const calls: AnthropicMessage[][] = [];
   return {
     calls,
     setKey() {},
@@ -24,22 +24,23 @@ function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name:
   };
 }
 
 function ctx(): ToolContext {
   return {
     readFile: async () => "content of a.txt",
     listDir: async () => ["a.txt"],
     applyEdit: vi.fn(async () => {}),
     runTerminal: vi.fn(async () => ({ exitCode: 0 })),
     requestApproval: async () => true,
-    openDiff: vi.fn(async () => {}),
     workspaceRoot: () => "C:/work/proj",
+    autoApproveEdits: true,
+    autoApproveTerminal: false,
   };
 }
 
 let dir: string;
 beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
 afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
 
 describe("AgentSession", () => {
   it("runs a tool round-trip: tool_use ΓåÆ tool_result ΓåÆ final text", async () => {
     const provider = scriptedProvider([
@@ -88,11 +89,64 @@ describe("AgentSession", () => {
       async streamTurn() { throw new Error("boom"); },
       setKey() {},
     } as unknown as Provider;
     const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
     const store = new SessionStore(dir);
     const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
     session.send("hello");
     await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
     expect(session.busy).toBe(false);
   });
+
+  it("seeds message history from persisted events so resume keeps model context", async () => {
+    // session 1: user ΓåÆ tool round-trip ΓåÆ assistant text
+    const provider1 = scriptedProvider([
+      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
+      { text: "The file says: content of a.txt" },
+    ]);
+    const ui1 = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(dir);
+    const { id } = store.createSession();
+    const s1 = new AgentSession({ sessionId: id, provider: provider1, ctx: ctx(), store, ui: ui1 });
+    s1.send("read a.txt");
+    await vi.waitFor(() => expect(ui1.turnComplete).toHaveBeenCalled());
+
+    // resume: new session seeded from the persisted JSONL events
+    const events = await store.load(id);
+    const provider2 = scriptedProvider([{ text: "resumed" }]);
+    const ui2 = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const s2 = new AgentSession({ sessionId: id, provider: provider2, ctx: ctx(), store, ui: ui2, initialMessages: messagesFromEvents(events) });
+    s2.send("continue");
+    await vi.waitFor(() => expect(ui2.turnComplete).toHaveBeenCalled());
+
+    // first provider call of the resumed session must contain the full prior conversation
+    const firstCall = provider2.calls[0];
+    const json = JSON.stringify(firstCall);
+    expect(json).toContain('"role":"user"');
+    expect(json).toContain("read a.txt");
+    expect(json).toContain('"type":"tool_use"');
+    expect(json).toContain('"tool_use_id":"c1"');
+    expect(json).toContain("The file says: content of a.txt");
+    expect(json).toContain("continue");
+    // the last seeded message before "continue" must be the assistant text
+    const beforeNew = firstCall.slice(0, -1);
+    expect(beforeNew[beforeNew.length - 1].role).toBe("assistant");
+  });
+
+  it("messagesFromEvents reconstructs user/assistant/tool blocks in order", () => {
+    const msgs = messagesFromEvents([
+      { kind: "user", text: "hi", ts: 1 },
+      { kind: "assistantText", text: "let me check", ts: 2 },
+      { kind: "toolCall", callId: "t1", tool: "read_file", input: { path: "a.txt" }, ts: 3 },
+      { kind: "toolResult", callId: "t1", ok: true, output: "content", ts: 4 },
+      { kind: "assistantText", text: "done", ts: 5 },
+      { kind: "error", message: "ignored", ts: 6 },
+    ]);
+    expect(msgs).toEqual([
+      { role: "user", content: [{ type: "text", text: "hi" }] },
+      { role: "assistant", content: [{ type: "text", text: "let me check" }] },
+      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.txt" } }] },
+      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "content", is_error: false }] },
+      { role: "assistant", content: [{ type: "text", text: "done" }] },
+    ]);
+  });
 });
diff --git a/test/unit/tools.test.ts b/test/unit/tools.test.ts
index 5108f79..c899478 100644
--- a/test/unit/tools.test.ts
+++ b/test/unit/tools.test.ts
@@ -3,22 +3,23 @@ import { executeTool, resolvePath, TOOL_DEFS } from "../../src/host/tools";
 import type { ToolContext } from "../../src/host/tools";
 import path from "path";
 
 function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
   return {
     readFile: vi.fn(async () => "file contents"),
     listDir: vi.fn(async () => ["a.txt", "b/"]),
     applyEdit: vi.fn(async () => {}),
     runTerminal: vi.fn(async () => ({ exitCode: 0 })),
     requestApproval: vi.fn(async () => true),
-    openDiff: vi.fn(async () => {}),
     workspaceRoot: () => "C:/work/proj",
+    autoApproveEdits: true,
+    autoApproveTerminal: false,
     ...overrides,
   };
 }
 
 describe("resolvePath", () => {
   it("rejects paths escaping the workspace", () => {
     expect(() => resolvePath("C:/work/proj", "../outside.txt")).toThrow();
     expect(() => resolvePath("C:/work/proj", "C:/elsewhere/x.txt")).toThrow();
   });
   it("rejects absolute paths with traversal escaping the workspace", () => {
@@ -37,20 +38,49 @@ describe("executeTool", () => {
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
+  it("apply_edit auto-applies when autoApproveEdits is true", async () => {
+    const ctx = mockCtx();
+    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old", newString: "new" }, "c1", ctx);
+    expect(ctx.requestApproval).not.toHaveBeenCalled();
+    expect(ctx.applyEdit).toHaveBeenCalled();
+    expect(r.ok).toBe(true);
+  });
+  it("apply_edit routes through approval when autoApproveEdits is false", async () => {
+    const ctx = mockCtx({ autoApproveEdits: false });
+    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old text here", newString: "new text here" }, "c1", ctx);
+    expect(ctx.requestApproval).toHaveBeenCalledTimes(1);
+    expect(String((ctx.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("a.txt");
+    expect(String((ctx.requestApproval as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("old text here");
+    expect(ctx.applyEdit).toHaveBeenCalled();
+    expect(r.ok).toBe(true);
+  });
+  it("apply_edit does not apply when approval is rejected", async () => {
+    const ctx = mockCtx({ autoApproveEdits: false, requestApproval: async () => false });
+    const r = await executeTool("apply_edit", { path: "a.txt", oldString: "old", newString: "new" }, "c1", ctx);
+    expect(ctx.applyEdit).not.toHaveBeenCalled();
+    expect(r.ok).toBe(false);
+  });
+  it("run_terminal skips approval when autoApproveTerminal is true", async () => {
+    const ctx = mockCtx({ autoApproveTerminal: true });
+    const r = await executeTool("run_terminal", { command: "npm test" }, "c1", ctx);
+    expect(ctx.requestApproval).not.toHaveBeenCalled();
+    expect(ctx.runTerminal).toHaveBeenCalled();
+    expect(r.ok).toBe(true);
+  });
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
