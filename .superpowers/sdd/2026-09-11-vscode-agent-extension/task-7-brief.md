# Task 7: VS Code wiring (ChatViewProvider, ApprovalManager, real ToolContext)

**Files:**
- Modify: `src/host/extension.ts` (replace minimal scaffold — full rewrite)
- Create: `src/host/approvals.ts`
- Test: manual (integration harness comes in Task 9). Unit compile + existing suite must still pass.

**Interfaces:**
- Consumes (already implemented): `createProvider` (src/host/provider.ts, note `setKey` exists), `AgentSession` + `AgentUi` (src/host/agent.ts), `SessionStore` (src/host/store.ts), `ToolContext` (src/host/tools.ts), protocol types (src/shared/protocol.ts).
- Produces: a running extension — sidebar chat wired to the real API with real file/terminal tools and approval flow.

Note on Task 6's AgentSession: its constructor takes `{sessionId, provider, ctx, store, ui}` — no systemPrompt. `streamTurn` returns `AnthropicMessage[]`.

- [ ] **Step 1: Implement `src/host/approvals.ts`** (verbatim):

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

- [ ] **Step 2: Rewrite `src/host/extension.ts`**

Requirements (adapt from the code below — the exact structure matters less than these binding behaviors):
1. Register webview view `justwokerAgent.chat`, commands `justwokerAgent.setApiKey` (SecretStorage) and `justwokerAgent.newSession`.
2. On webview resolve: create SessionStore at `globalStorageUri/sessions`, ApprovalManager, start a new session, post sessionList.
3. `makeSession(id)`: builds provider via `createProvider` with settings values (baseUrl default "https://api.justwoker.icu", model default "gpt-5.6-sol", maxTokens default 4096); wraps it so the API key is fetched from SecretStorage lazily before first streamTurn (use provider.setKey + a memoized key fetch); builds real ToolContext; builds AgentUi posting HostToWebviewMsg per AgentUi method; returns `new AgentSession({...})`.
4. Real ToolContext: readFile/listDir via vscode.workspace.fs; applyEdit = openTextDocument → verify oldString appears exactly once → WorkspaceEdit full-range replace; runTerminal via child_process.exec with shell, streaming stdout/stderr through onOutput; requestApproval → ApprovalManager.request(currentSessionId, callId, command); openDiff → `vscode.commands.executeCommand("vscode.diff", uri, uri, basename)`; workspaceRoot = first workspace folder fsPath.
5. onMessage handling for: userMessage (send if session exists), approve (ApprovalManager.resolve), newSessionRequest, retry (only if !busy), requestSessionList, loadSession (load events from store, make AgentSession, post loadEvents).
6. Webview HTML loads `dist/webview/main.js` as module with a #root div.

Reference implementation (use as the base; fix any integration bugs you find with the real Task 3-6 interfaces):

```ts
import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { createProvider, type Provider, type AnthropicMessage } from "./provider";
import { AgentSession } from "./agent";
import { SessionStore } from "./store";
import { ApprovalManager } from "./approvals";
import type { ToolContext, ToolDef } from "./tools";
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
    const baseProvider = createProvider({
      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
      apiKey: "",
      model: cfg.get("model", "gpt-5.6-sol"),
      maxTokens: cfg.get("maxTokens", 4096),
    });
    // lazy key injection wrapper
    let keyCached: string | null = null;
    const provider: Provider = {
      async streamTurn(messages, tools, onEvent) {
        if (!keyCached) {
          keyCached = await this.context.secrets.get("justwokerAgent.apiKey");
          if (!keyCached) throw new Error("No API key set. Run command 'Justwoker: Set API Key'.");
          baseProvider.setKey(keyCached);
        }
        return baseProvider.streamTurn(messages, tools, onEvent);
      },
      setKey: (k: string) => baseProvider.setKey(k),
    };
    const ui = {
      textDelta: (t: string) => this.post({ type: "textDelta", sessionId: id, text: t }),
      toolCall: (callId: string, tool: string, input: Record<string, unknown>) => this.post({ type: "toolCall", sessionId: id, callId, tool, input } as any),
      toolResult: (callId: string, ok: boolean, output: string) => this.post({ type: "toolResult", sessionId: id, callId, ok, output }),
      error: (message: string) => this.post({ type: "error", sessionId: id, message }),
      turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
    };
    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(), store: this.store, ui });
  }
  // NOTE: `this` inside the provider wrapper object literal — bind properly (arrow fns capture `this` of makeSession, which is the ChatViewProvider — verify).

  private makeToolContext(): ToolContext {
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
          const events = await this.store.load(m.sessionId);
          this.sessions.set(m.sessionId, this.makeSession(m.sessionId));
          this.post({ type: "loadEvents", sessionId: m.sessionId, events });
        }
        this.currentSessionId = m.sessionId;
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

Known issues in the reference code you MUST fix:
- The `provider` wrapper object literal uses `this.context` inside `streamTurn` — arrow functions inside an object literal capture the enclosing method's `this` (the ChatViewProvider) — verify and fix if wrong; safest is to capture `const secrets = this.context.secrets;` first.
- The `toolCall` ui post casts `as any` — the protocol's toolCall message takes `tool: ToolName`; map string→ToolName safely or adjust the ui signature.
- `loadSession` for an already-loaded session just sets currentSessionId — the webview still needs loadEvents to render history; post loadEvents from the store in both cases.

- [ ] **Step 3: Compile and verify no regressions**

```powershell
npm run compile; npm run test:unit
```

Expected: both bundles build; full suite passes. Also run `npx tsc --noEmit` — webview/main.tsx pre-existing @types/react errors are EXPECTED and allowed (Task 8 fixes); host files must be clean.

- [ ] **Step 4: Commit** — `git add src/host/extension.ts src/host/approvals.ts; git commit -m "feat: wire agent, tools, approvals and session store into vscode"`

(F5 manual smoke test is deferred to Task 10 — do not attempt here.)
