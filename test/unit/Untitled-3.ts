import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { createProvider, type Provider } from "./provider";
import { AgentSession, messagesFromEvents } from "./agent";
import { SessionStore } from "./store";
import { ApprovalManager } from "./approvals";
import type { ToolContext } from "./tools";
import type { HostToWebviewMsg, WebviewToHostMsg, ToolName, Effort, Mode, FileAttachment } from "../shared/protocol";

const TOOL_NAMES: ToolName[] = ["read_file", "list_dir", "apply_edit", "run_terminal"];

function toToolName(name: string): ToolName {
  return (TOOL_NAMES as string[]).includes(name) ? (name as ToolName) : "read_file";
}

const EFFORTS: Effort[] = ["low", "medium", "high"];

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("koMind.chat", provider),
    vscode.commands.registerCommand("koMind.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("koMind.resetPermissions", () => provider.resetPermissions()),
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  public view?: vscode.WebviewView;
  private approvals!: ApprovalManager;
  private sessions = new Map<string, AgentSession>();
  private currentSessionId?: string;
  private store!: SessionStore;
  private baseProvider!: Provider;
  private currentModel!: string;
  private currentEffort: Effort = "medium";
  private models: string[] = [];
  private contextEnabled = false;
  private contextInjected = new Set<string>();
  private repoContextCache: { at: number; text: string } | null = null;
  private mode: Mode = "build";
  private alwaysAllow = { terminal: false, edits: false };

  constructor(private readonly context: vscode.ExtensionContext) { }

  post(msg: HostToWebviewMsg) { void this.view?.webview.postMessage(msg); }

  newSession() { this.startSession(); }

  async promptApiKey(): Promise<void> {
    const key = await vscode.window.showInputBox({ password: true, prompt: "API key for the KoMind API" });
    if (key) {
      await this.context.secrets.store("koMind.apiKey", key);
      vscode.window.showInformationMessage("KoMind API key saved.");
    }
  }

  private postSettings() {
    const cfg = vscode.workspace.getConfiguration("koMind");
    this.post({
      type: "settings",
      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
      maxTokens: cfg.get("maxTokens", 4096),
      autoApproveEdits: cfg.get("autoApproveEdits", true),
      autoApproveTerminal: cfg.get("autoApproveTerminal", false),
      models: this.extraModels(),
      apiKeySet: false,
    });
    // apiKeySet needs an async check — send a corrected snapshot after
    void this.context.secrets.get("koMind.apiKey").then((key) => {
      this.post({
        type: "settings",
        baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
        maxTokens: cfg.get("maxTokens", 4096),
        autoApproveEdits: cfg.get("autoApproveEdits", true),
        autoApproveTerminal: cfg.get("autoApproveTerminal", false),
        models: this.extraModels(),
        apiKeySet: Boolean(key),
      });
    });
  }

  resetPermissions() {
    this.alwaysAllow = { terminal: false, edits: false };
    void this.context.workspaceState.update("koMind.alwaysAllow.terminal", false);
    void this.context.workspaceState.update("koMind.alwaysAllow.edits", false);
    this.postConfig();
    vscode.window.showInformationMessage("KoMind: always-allow permissions reset.");
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewToHostMsg) => void this.onMessage(m));
    this.store = new SessionStore(path.join(this.context.globalStorageUri.fsPath, "sessions"));
    this.approvals = new ApprovalManager((msg) => this.post(msg));

    const cfg = vscode.workspace.getConfiguration("koMind");
    const settingsModel = cfg.get("model", "gpt-5.6-sol");
    this.currentModel = this.context.workspaceState.get<string>("koMind.model") ?? settingsModel;
    const savedEffort = this.context.workspaceState.get<string>("koMind.effort");
    const settingsEffort = cfg.get<string>("effort", "medium");
    this.currentEffort = EFFORTS.includes(savedEffort as Effort) ? (savedEffort as Effort)
      : EFFORTS.includes(settingsEffort as Effort) ? (settingsEffort as Effort) : "medium";
    // base list: user-configured models from settings + current selection
    this.models = this.mergeModels(cfg.get<string[]>("models", []));

    // one shared base provider — model/effort changes apply to all sessions
    this.baseProvider = createProvider({
      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
      apiKey: "",
      model: this.currentModel,
      maxTokens: cfg.get("maxTokens", 4096),
      effort: this.currentEffort,
    });
    this.baseProvider.setModel(this.currentModel);
    this.baseProvider.setEffort(this.currentEffort);

    this.startSession();
    void this.sendSessionList();
    this.contextEnabled = this.context.workspaceState.get<boolean>("koMind.contextEnabled") ?? false;
    this.post({ type: "contextEnabled", enabled: this.contextEnabled });
    this.mode = this.context.workspaceState.get<Mode>("koMind.mode") ?? "build";
    this.alwaysAllow = {
      terminal: this.context.workspaceState.get<boolean>("koMind.alwaysAllow.terminal") ?? false,
      edits: this.context.workspaceState.get<boolean>("koMind.alwaysAllow.edits") ?? false,
    };
    this.applyMode();
    this.postConfig();
    // fetch the real model list from the API (settings models + current are always kept)
    void this.baseProvider.listModels().then((models) => {
      if (models.length > 0) { this.models = this.mergeModels(models); this.postConfig(); }
    });
  }

  /** union: current selection first, then extra models, then fetched — deduped */
  private mergeModels(extra: string[]): string[] {
    const all = [this.currentModel, ...this.extraModels(), ...extra];
    return [...new Set(all.filter(Boolean))];
  }

  private extraModels(): string[] {
    const fromSettings = vscode.workspace.getConfiguration("koMind").get<string[]>("models", []);
    const saved = this.context.workspaceState.get<string[]>("koMind.extraModels") ?? [];
    return [...fromSettings, ...saved];
  }

  private postConfig() {
    this.post({ type: "config", model: this.currentModel, models: this.models, effort: this.currentEffort, mode: this.mode, alwaysAllow: this.alwaysAllow });
  }

  /** plan mode: sessions may only use read-only tools; build mode: all tools. */
  private applyMode() {
    const allowed: ToolName[] | null = this.mode === "plan" ? ["read_file", "list_dir"] : null;
    for (const session of this.sessions.values()) session.allowedTools = allowed;
  }

  private startSession() {
    const { id } = this.store.createSession();
    this.currentSessionId = id;
    this.sessions.set(id, this.makeSession(id));
    this.post({ type: "loadEvents", sessionId: id, events: [] });
  }

  private makeSession(id: string, initialMessages?: ConstructorParameters<typeof AgentSession>[0]["initialMessages"]): AgentSession {
    const baseProvider = this.baseProvider;
    // capture secrets before the wrapper so `this` binding cannot go wrong
    const secrets = this.context.secrets;
    let keyCached: string | null = null;
    const provider: Provider = {
      async streamTurn(messages, tools, onEvent) {
        if (!keyCached) {
          keyCached = (await secrets.get("koMind.apiKey")) ?? null;
          if (!keyCached) throw new Error("No API key set. Run command 'KoMind: Set API Key'.");
          baseProvider.setKey(keyCached);
        }
        return baseProvider.streamTurn(messages, tools, onEvent);
      },
      setKey: (k: string) => baseProvider.setKey(k),
      setModel: (m: string) => baseProvider.setModel(m),
      setBaseUrl: (u: string) => baseProvider.setBaseUrl(u),
      setMaxTokens: (n: number) => baseProvider.setMaxTokens(n),
      setEffort: (e: Effort) => baseProvider.setEffort(e),
      listModels: () => baseProvider.listModels(),
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
    const cfg = vscode.workspace.getConfiguration("koMind");
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
        // Persist agent edits immediately. Git/Source Control remains the source of truth
        // for reviewing the diff, and no untitled preview document can trigger a save prompt.
        const saved = await doc.save();
        if (!saved) throw new Error("Edited file could not be saved.");
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
      requestApproval: (command, callId, tool) => {
        // persistent "always allow" grants bypass the approval card
        if (tool === "run_terminal" && this.alwaysAllow.terminal) return Promise.resolve(true);
        if (tool === "apply_edit" && this.alwaysAllow.edits) return Promise.resolve(true);
        return this.approvals.request(this.currentSessionId ?? "", callId, command, tool ?? "run_terminal");
      },
      workspaceRoot: root,
      autoApproveEdits: cfg.get("autoApproveEdits", true),
      autoApproveTerminal: cfg.get("autoApproveTerminal", false),
    };
  }

  private async onMessage(m: WebviewToHostMsg) {
    switch (m.type) {
      case "userMessage": {
        const session = this.sessions.get(m.sessionId);
        if (!session) break;
        let modelText = m.text;
        let displayText = m.text;
        // attachments → appended as fenced blocks for the model, chips noted in display text
        if (m.attachments && m.attachments.length > 0) {
          const blocks = m.attachments
            .map((f) => `### File: ${f.name}${f.truncated ? " (truncated)" : ""}\n\`\`\`\n${f.content}\n\`\`\``)
            .join("\n\n");
          modelText += `\n\n[Attached files]\n\n${blocks}`;
          displayText += `\n\n[${m.attachments.map((f) => `📎 ${f.name}`).join(" ")}]`;
        }
        // repo context → injected once per session when enabled
        if (this.contextEnabled && !this.contextInjected.has(m.sessionId)) {
          const ctxText = await this.getRepoContext();
          if (ctxText) {
            modelText = `${ctxText}\n\n---\n\n${modelText}`;
            displayText = `[Repo context attached]\n\n${displayText}`;
            this.contextInjected.add(m.sessionId);
          }
        }
        session.send(modelText, displayText, m.images ?? []);
        break;
      }
      case "attachFiles": await this.pickFiles(); break;
      case "setContextEnabled": {
        this.contextEnabled = m.enabled;
        void this.context.workspaceState.update("koMind.contextEnabled", m.enabled);
        this.post({ type: "contextEnabled", enabled: m.enabled });
        break;
      }
      case "approve": {
        if (!this.currentSessionId) break;
        // "always allow": persist a per-tool grant so future approvals are skipped
        if (m.always && m.approved) {
          const tool = this.approvals.toolOf(m.callId);
          if (tool === "run_terminal") {
            this.alwaysAllow.terminal = true;
            void this.context.workspaceState.update("koMind.alwaysAllow.terminal", true);
          } else if (tool === "apply_edit") {
            this.alwaysAllow.edits = true;
            void this.context.workspaceState.update("koMind.alwaysAllow.edits", true);
          }
          this.postConfig();
        }
        this.approvals.resolve(m.callId, m.approved, this.currentSessionId);
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
      case "requestConfig": this.postConfig(); break;
      case "setModel": {
        this.currentModel = m.model;
        this.baseProvider.setModel(m.model);
        void this.context.workspaceState.update("koMind.model", m.model);
        this.postConfig();
        break;
      }
      case "addModel": {
        const name = m.model.trim();
        if (!name) break;
        const saved = this.context.workspaceState.get<string[]>("koMind.extraModels") ?? [];
        if (!saved.includes(name)) void this.context.workspaceState.update("koMind.extraModels", [...saved, name]);
        this.currentModel = name;
        this.baseProvider.setModel(name);
        void this.context.workspaceState.update("koMind.model", name);
        this.models = this.mergeModels([]);
        this.postConfig();
        break;
      }
      case "setEffort": {
        this.currentEffort = m.effort;
        this.baseProvider.setEffort(m.effort);
        void this.context.workspaceState.update("koMind.effort", m.effort);
        this.postConfig();
        break;
      }
      case "removeModel": {
        const saved = this.context.workspaceState.get<string[]>("koMind.extraModels") ?? [];
        const next = saved.filter((x) => x !== m.model);
        void this.context.workspaceState.update("koMind.extraModels", next);
        this.models = this.mergeModels([]);
        this.postConfig();
        this.postSettings();
        break;
      }
      case "requestSettings": this.postSettings(); break;
      case "updateSettings": {
        const cfg = vscode.workspace.getConfiguration("koMind");
        const targets = vscode.ConfigurationTarget.Global;
        if (m.baseUrl !== undefined && m.baseUrl.trim()) {
          await cfg.update("baseUrl", m.baseUrl.trim(), targets);
          this.baseProvider.setBaseUrl(m.baseUrl.trim());
        }
        if (m.maxTokens !== undefined && Number.isFinite(m.maxTokens) && m.maxTokens > 0) {
          await cfg.update("maxTokens", Math.floor(m.maxTokens), targets);
          this.baseProvider.setMaxTokens(Math.floor(m.maxTokens));
        }
        if (m.autoApproveEdits !== undefined) await cfg.update("autoApproveEdits", m.autoApproveEdits, targets);
        if (m.autoApproveTerminal !== undefined) await cfg.update("autoApproveTerminal", m.autoApproveTerminal, targets);
        this.postSettings();
        break;
      }
      case "setApiKey": {
        await this.promptApiKey();
        this.postSettings();
        break;
      }
      case "setMode": {
        this.mode = m.mode;
        void this.context.workspaceState.update("koMind.mode", m.mode);
        this.applyMode();
        this.postConfig();
        break;
      }
      case "resetPermissions": {
        this.alwaysAllow = { terminal: false, edits: false };
        void this.context.workspaceState.update("koMind.alwaysAllow.terminal", false);
        void this.context.workspaceState.update("koMind.alwaysAllow.edits", false);
        this.postConfig();
        break;
      }
    }
  }

  private async sendSessionList() {
    this.post({ type: "sessionList", sessions: await this.store.list() });
  }

  private async pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      title: "Attach files to the next message",
    });
    if (!uris || uris.length === 0) return;
    const MAX = 100_000; // chars per file
    const files: FileAttachment[] = [];
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        let content = Buffer.from(bytes).toString("utf8");
        let truncated = false;
        if (content.length > MAX) { content = content.slice(0, MAX); truncated = true; }
        if (content.includes("\u0000")) continue; // skip binary files
        files.push({ name: path.basename(uri.fsPath), content, truncated });
      } catch { /* skip unreadable files */ }
    }
    if (files.length > 0) this.post({ type: "attachments", files });
  }

  private execGit(root: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      cp.execFile("git", args, { cwd: root, timeout: 4000, windowsHide: true }, (err, stdout) => {
        resolve(err ? "" : stdout.toString().trim());
      });
    });
  }

  private async getRepoContext(): Promise<string> {
    // cache for 5 minutes — collecting on every message would be wasteful
    if (this.repoContextCache && Date.now() - this.repoContextCache.at < 5 * 60_000) {
      return this.repoContextCache.text;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return "";
    const root = folder.uri.fsPath;

    const SKIP = new Set(["node_modules", ".git", "dist", "out", ".vscode-test", "coverage"]);
    const tree: string[] = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > 2 || tree.length > 150) return;
      let entries: [string, vscode.FileType][];
      try { entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(root, rel))); }
      catch { return; }
      entries.sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === vscode.FileType.Directory ? -1 : 1));
      for (const [name, type] of entries) {
        if (SKIP.has(name)) continue;
        if (tree.length > 150) { tree.push("…"); return; }
        const relPath = rel ? `${rel}/${name}` : name;
        tree.push(type === vscode.FileType.Directory ? `${relPath}/` : relPath);
        if (type === vscode.FileType.Directory) await walk(relPath, depth + 1);
      }
    };
    await walk("", 0);

    const [branch, status, log, remote] = await Promise.all([
      this.execGit(root, ["branch", "--show-current"]),
      this.execGit(root, ["status", "--short"]),
      this.execGit(root, ["log", "--oneline", "-5"]),
      this.execGit(root, ["remote", "get-url", "origin"]),
    ]);

    if (!branch && !status && !log && tree.length === 0) return "";
    const parts = [
      "<repo-context>",
      `Workspace: ${path.basename(root)}`,
      branch ? `Git branch: ${branch}` : "Git: not a repository",
      remote ? `Remote: ${remote}` : "",
      log ? `Recent commits:\n${log}` : "",
      status ? `Working tree changes:\n${status.slice(0, 2000)}` : "Working tree: clean",
      tree.length ? `File tree (depth 2):\n${tree.join("\n")}` : "",
      "</repo-context>",
    ].filter(Boolean);
    const text = parts.join("\n");
    this.repoContextCache = { at: Date.now(), text };
    return text;
  }

  private html(webview: vscode.Webview) {
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "main.js"));
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "komind-logo.png"));
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">`;
    return `<!DOCTYPE html><html><head>${csp}
<style>
  #splash { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    background: var(--vscode-sideBar-background, #1e1e1e); z-index: 999; transition: opacity 200ms ease; }
  #splash img { width: 96px; height: 96px; object-fit: contain; animation: km-logo-pulse 1.6s ease-in-out infinite; }
  #splash span { font-size: 12px; opacity: 0.6; font-family: var(--vscode-font-family, sans-serif); }
  @keyframes km-logo-pulse { 0%, 100% { opacity: 0.45; transform: scale(0.97); } 50% { opacity: 1; transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { #splash img { animation: none; } }
</style></head><body>
<div id="splash" role="status" aria-label="Loading KoMind"><img src="${logo}" alt="KoMind logo" /><span>Loading KoMind…</span></div>
<div id="root"></div>
<script type="module" src="${js}"></script></body></html>`;
  }
}

export function deactivate() { }
