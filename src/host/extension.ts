import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { createProvider, type Provider } from "./provider";
import { AgentSession, messagesFromEvents } from "./agent";
import { SessionStore } from "./store";
import { ApprovalManager } from "./approvals";
import type { ToolContext } from "./tools";
import type { HostToWebviewMsg, WebviewToHostMsg, ToolName } from "../shared/protocol";

const TOOL_NAMES: ToolName[] = ["read_file", "list_dir", "apply_edit", "run_terminal"];

function toToolName(name: string): ToolName {
  return (TOOL_NAMES as string[]).includes(name) ? (name as ToolName) : "read_file";
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
      const key = await vscode.window.showInputBox({ password: true, prompt: "API key for the Justwoker Agent API" });
      if (key) {
        await context.secrets.store("justwokerAgent.apiKey", key);
        vscode.window.showInformationMessage("API key saved.");
      }
    }),
    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.newSession()),
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

  newSession() { this.startSession(); }

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

  private makeSession(id: string, initialMessages?: ConstructorParameters<typeof AgentSession>[0]["initialMessages"]): AgentSession {
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
    const provider: Provider = {
      async streamTurn(messages, tools, onEvent) {
        if (!keyCached) {
          keyCached = (await secrets.get("justwokerAgent.apiKey")) ?? null;
          if (!keyCached) throw new Error("No API key set. Run command 'Justwoker: Set API Key'.");
          baseProvider.setKey(keyCached);
        }
        return baseProvider.streamTurn(messages, tools, onEvent);
      },
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
    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(), store: this.store, ui, initialMessages });
  }

  private makeToolContext(): ToolContext {
    const cfg = vscode.workspace.getConfiguration("justwokerAgent");
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
        // diff pre-edit content against the live edited file
        const originalDoc = await vscode.workspace.openTextDocument({ content: text, language: doc.languageId });
        await vscode.commands.executeCommand("vscode.diff", originalDoc.uri, uri, path.basename(p), { preview: true });
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
      workspaceRoot: root,
      autoApproveEdits: cfg.get("autoApproveEdits", true),
      autoApproveTerminal: cfg.get("autoApproveTerminal", false),
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
          this.sessions.set(m.sessionId, this.makeSession(m.sessionId, messagesFromEvents(events)));
        }
        // always post events so the webview renders history for both fresh and cached sessions
        const events = await this.store.load(m.sessionId);
        this.post({ type: "loadEvents", sessionId: m.sessionId, events });
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
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">`;
    return `<!DOCTYPE html><html><head>${csp}</head><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
  }
}

export function deactivate() {}
