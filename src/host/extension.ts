import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { createProvider, type Provider } from "./provider";
import { AgentSession, messagesFromEvents } from "./agent";
import { SessionStore } from "./store";
import { runSubagents, ORCHESTRATOR_PROMPT } from "./subagent";
import { ToolRegistry } from "./toolRegistry";
import { McpManager, type McpServerConfig, isMcpToolName } from "./mcp";
import { SkillManager, discoverSkills, type SkillFs, type Skill } from "./skills";
import { CommandRegistry, loadPlugins } from "./plugins";
import { parseImport, type ImportedConversation } from "./sessionImport";
import { ApprovalManager } from "./approvals";
import { Recorder, transcribe, MAX_RECORDING_MS } from "./voice";
import type { ToolContext } from "./tools";
import { resolvePath } from "./tools";
import type { HostToWebviewMsg, WebviewToHostMsg, ToolName, Effort, Mode, FileAttachment, ImageAttachment, EditInfo } from "../shared/protocol";


const EFFORTS: Effort[] = ["low", "medium", "high", "extra", "max"];
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 5;

function validImages(images: ImageAttachment[]): ImageAttachment[] {
  let total = 0;
  return images.slice(0, MAX_IMAGES).filter((image) => {
    if (!IMAGE_TYPES.has(image.mediaType) || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return false;
    const bytes = Math.floor(image.data.length * 3 / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    if (bytes <= 0 || bytes > MAX_IMAGE_BYTES || total + bytes > MAX_TOTAL_IMAGE_BYTES) return false;
    total += bytes;
    return true;
  });
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("koMind.chat", provider),
    vscode.commands.registerCommand("koMind.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("koMind.resetPermissions", () => provider.resetPermissions()),
    vscode.commands.registerCommand("koMind.importSession", () => provider.importSession()),
    vscode.commands.registerCommand("koMind.setApiKey", () => provider.promptApiKey()),
    vscode.commands.registerCommand("koMind.setVoiceApiKey", () => provider.promptVoiceApiKey()),
    { dispose: () => void provider.dispose() },
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
  private currentEffort: Effort = "high";
  private models: string[] = [];
  private contextEnabled = false;
  private contextInjected = new Set<string>();
  private repoContextCache: { at: number; text: string } | null = null;
  private mode: Mode = "build";
  private alwaysAllow = { terminal: false, edits: false };
  private readonly registry = new ToolRegistry();
  private readonly mcp = new McpManager();
  private readonly skills = new SkillManager();
  private readonly commands = new CommandRegistry();
  private pluginSystemPrompts: string[] = [];
  private readonly recorder = new Recorder();
  private voiceTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly context: vscode.ExtensionContext) { }

  post(msg: HostToWebviewMsg) { void this.view?.webview.postMessage(msg); }

  newSession() { this.startSession(); }

  /** Store a key in SecretStorage. The chat key is applied immediately so open sessions use it on their next turn. */
  private async storeKey(name: "koMind.apiKey" | "koMind.voiceApiKey", key: string): Promise<void> {
    await this.context.secrets.store(name, key);
    if (name === "koMind.apiKey") this.baseProvider?.setKey(key);
  }

  async promptApiKey(): Promise<void> {
    const key = (await vscode.window.showInputBox({ password: true, prompt: "API key for the KoMind API" }))?.trim();
    if (key) {
      await this.storeKey("koMind.apiKey", key);
      vscode.window.showInformationMessage("KoMind API key saved.");
      this.postSettings();
    }
  }

  async promptVoiceApiKey(): Promise<void> {
    const key = (await vscode.window.showInputBox({ password: true, prompt: "API key for voice transcription (Azure AI Foundry / Azure OpenAI key, or OpenAI-compatible key)" }))?.trim();
    if (key) {
      await this.storeKey("koMind.voiceApiKey", key);
      vscode.window.showInformationMessage("KoMind voice API key saved.");
      this.postSettings();
    }
  }

  private postSettings() {
    const cfg = vscode.workspace.getConfiguration("koMind");
    const snapshot = (apiKeySet: boolean, voiceKeySet: boolean) => this.post({
      type: "settings",
      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
      maxTokens: cfg.get("maxTokens", 4096),
      autoApproveEdits: cfg.get("autoApproveEdits", true),
      autoApproveTerminal: cfg.get("autoApproveTerminal", false),
      models: this.extraModels(),
      apiKeySet,
      voiceUrl: cfg.get("voice.transcriptionUrl", ""),
      voiceModel: cfg.get("voice.model", ""),
      voiceLanguage: cfg.get("voice.language", ""),
      voiceKeySet,
    });
    snapshot(false, false);
    // key presence needs an async check — send a corrected snapshot after
    void Promise.all([this.context.secrets.get("koMind.apiKey"), this.context.secrets.get("koMind.voiceApiKey")])
      .then(([key, voiceKey]) => snapshot(Boolean(key), Boolean(voiceKey)));
  }

  /** Start/stop/cancel voice input. Recording happens in the host because webviews cannot open the microphone. */
  private async onVoice(action: "start" | "stop" | "cancel") {
    if (action === "cancel") {
      clearTimeout(this.voiceTimer);
      this.recorder.cancel();
      this.post({ type: "voiceState", state: "idle" });
      return;
    }
    if (action === "start") {
      if (this.recorder.active) return;
      const cfg = vscode.workspace.getConfiguration("koMind");
      const url = cfg.get<string>("voice.transcriptionUrl", "").trim();
      const apiKey = await this.context.secrets.get("koMind.voiceApiKey");
      if (!url || !apiKey) {
        this.post({ type: "voiceState", state: "idle", error: "Voice input isn't set up yet. Open Settings (gear icon) → Voice input to add your transcription URL and key." });
        return;
      }
      this.post({ type: "voiceState", state: "starting" });
      try {
        await this.recorder.start();
      } catch (e) {
        this.post({ type: "voiceState", state: "idle", error: e instanceof Error ? e.message : String(e) });
        return;
      }
      // cancelled while the mic was opening
      if (!this.recorder.active) return;
      this.post({ type: "voiceState", state: "recording" });
      this.voiceTimer = setTimeout(() => void this.onVoice("stop"), MAX_RECORDING_MS);
      return;
    }
    clearTimeout(this.voiceTimer);
    if (!this.recorder.active) return;
    this.post({ type: "voiceState", state: "transcribing" });
    try {
      const wav = await this.recorder.stop();
      const cfg = vscode.workspace.getConfiguration("koMind");
      const text = await transcribe(wav, {
        url: cfg.get<string>("voice.transcriptionUrl", "").trim(),
        apiKey: (await this.context.secrets.get("koMind.voiceApiKey")) ?? "",
        model: cfg.get<string>("voice.model", "").trim(),
        language: cfg.get<string>("voice.language", "").trim(),
      });
      if (text) this.post({ type: "voiceText", text });
      this.post({ type: "voiceState", state: "idle", error: text ? undefined : "No speech was recognized. Try again a little closer to the microphone." });
    } catch (e) {
      this.post({ type: "voiceState", state: "idle", error: e instanceof Error ? e.message : String(e) });
    }
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
    const settingsModel = cfg.get("model", "claude-opus-4-8");
    this.currentModel = this.context.workspaceState.get<string>("koMind.model") ?? settingsModel;
    const savedEffort = this.context.workspaceState.get<string>("koMind.effort");
    const settingsEffort = cfg.get<string>("effort", "high");
    this.currentEffort = EFFORTS.includes(savedEffort as Effort) ? (savedEffort as Effort)
      : EFFORTS.includes(settingsEffort as Effort) ? (settingsEffort as Effort) : "high";
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
    // connect configured MCP servers in the background so startup is not blocked
    void this.connectMcpServers();
    // discover skills from workspace + global storage
    void this.loadSkills();
  }

  /**
   * Discover skills and register them with the SkillManager. Skills are read
   * from `<workspace>/.komind/skills/` and the extension's global storage
   * (`<globalStorage>/skills/`). Each immediate subdirectory containing a
   * `SKILL.md` becomes one skill. Workspace skills take precedence over global
   * ones on name collisions (first root wins).
   */
  /** Shared filesystem adapter over vscode.workspace.fs for skills + plugins. */
  private skillFs(): SkillFs {
    return {
      async readDir(dir) {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
        return entries.map(([name, type]) => [name, type === vscode.FileType.Directory] as [string, boolean]);
      },
      async readFile(fp) {
        return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(fp))).toString("utf8");
      },
      async exists(fp) {
        try { await vscode.workspace.fs.stat(vscode.Uri.file(fp)); return true; } catch { return false; }
      },
    };
  }

  /** Roots to scan for standalone skills (workspace first, then global). */
  private skillRoots(): string[] {
    const roots: string[] = [];
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) roots.push(path.join(wsRoot, ".komind", "skills"));
    roots.push(path.join(this.context.globalStorageUri.fsPath, "skills"));
    return roots;
  }

  /** Roots to scan for plugins (workspace first, then global). */
  private pluginRoots(): string[] {
    const roots: string[] = [];
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) roots.push(path.join(wsRoot, ".komind", "plugins"));
    roots.push(path.join(this.context.globalStorageUri.fsPath, "plugins"));
    return roots;
  }

  /**
   * Discover plugins and standalone skills, then wire them into the app:
   * plugin skills + standalone skills feed the SkillManager, plugin slash
   * commands feed the CommandRegistry, plugin MCP servers are connected, and
   * plugin system-prompt fragments are appended to every session's prompt.
   * Plugin contributions take precedence over standalone skills on name
   * collisions (loaded first).
   */
  private async loadSkills(): Promise<void> {
    const fsAdapter = this.skillFs();
    let pluginSkills: Skill[] = [];
    let pluginCount = 0;
    try {
      const loaded = await loadPlugins(this.pluginRoots(), fsAdapter);
      pluginSkills = loaded.skills;
      pluginCount = loaded.plugins.length;
      this.commands.setCommands(loaded.commands);
      this.pluginSystemPrompts = loaded.systemPrompts;
      this.post({ type: "commands", commands: this.commands.list().map((c) => ({ name: c.name, description: c.description, plugin: c.plugin })) });
      // Connect plugin-contributed MCP servers alongside the settings ones.
      for (const [name, cfg] of Object.entries(loaded.mcpServers)) {
        const { provider } = await this.mcp.connect(name, cfg);
        if (provider) { try { this.registry.addProvider(provider); } catch { /* dup */ } }
      }
      for (const e of loaded.errors) {
        vscode.window.showWarningMessage(`KoMind: plugin "${e.name}" failed to load: ${e.error}`);
      }
    } catch { /* plugin loading is best-effort */ }

    try {
      const standalone = await discoverSkills(this.skillRoots(), fsAdapter);
      // Plugin skills win on name collisions (listed first).
      this.skills.setSkills([...pluginSkills, ...standalone]);
    } catch {
      this.skills.setSkills(pluginSkills);
    }
    this.postSkills();

    const skillCount = this.skills.size;
    const parts: string[] = [];
    if (skillCount > 0) parts.push(`${skillCount} skill(s)`);
    if (pluginCount > 0) parts.push(`${pluginCount} plugin(s)`);
    if (this.commands.size > 0) parts.push(`${this.commands.size} command(s)`);
    if (parts.length > 0) vscode.window.showInformationMessage(`KoMind: loaded ${parts.join(", ")}.`);
  }

  /**
   * The combined system prompt: the skill index plus any plugin system-prompt
   * fragments. Empty string when there is nothing to add.
   */
  private systemPrompt(): string | undefined {
    const sections = [this.skills.indexText(), ...this.pluginSystemPrompts].filter((s) => s && s.trim());
    return sections.length > 0 ? sections.join("\n\n") : undefined;
  }

  /** Top-level sessions act as the orchestrator, except in plan mode where they cannot delegate. */
  private mainSystemPrompt(): string | undefined {
    if (this.mode === "plan") return this.systemPrompt();
    return [ORCHESTRATOR_PROMPT, this.systemPrompt()].filter(Boolean).join("\n\n");
  }

  /**
   * Connect all MCP servers listed in `koMind.mcpServers` and register each
   * server's tools in the shared registry. Connections run concurrently and
   * failures are reported but never block the others. MCP tools always route
   * through the approval gate (see makeToolContext.requestApproval).
   */
  private async connectMcpServers(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("koMind");
    const servers = cfg.get<Record<string, McpServerConfig>>("mcpServers", {}) ?? {};
    const names = Object.keys(servers);
    if (names.length === 0) return;
    const results = await Promise.all(
      names.map(async (name) => {
        const { result, provider } = await this.mcp.connect(name, servers[name]);
        if (provider) {
          try { this.registry.addProvider(provider); } catch { /* already present */ }
        }
        return result;
      }),
    );
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok && r.error !== "disabled");
    if (ok.length > 0) {
      const total = ok.reduce((n, r) => n + r.toolCount, 0);
      vscode.window.showInformationMessage(`KoMind: connected ${ok.length} MCP server(s), ${total} tool(s) available.`);
    }
    for (const r of failed) {
      vscode.window.showWarningMessage(`KoMind: MCP server "${r.name}" failed to connect: ${r.error}`);
    }
  }

  /** union: current selection first, then extra models, then fetched — deduped */
  private mergeModels(extra: string[]): string[] {
    const all = [this.currentModel, ...this.extraModels(), ...extra];
    return [...new Set(all.filter(Boolean))];
  }

  private extraModels(): string[] {
    const fromSettings = vscode.workspace.getConfiguration("koMind").get<string[]>("models", []);
    // user-added models live in globalState so they persist across windows/workspaces
    // and survive the API model-list refresh; `workspaceState` is read only to migrate
    // models added by older versions.
    const saved = this.context.globalState.get<string[]>("koMind.extraModels") ?? [];
    const legacy = this.context.workspaceState.get<string[]>("koMind.extraModels") ?? [];
    return [...new Set([...fromSettings, ...saved, ...legacy].filter(Boolean))];
  }

  /** Send the current skill index to the webview for the `/` suggestion menu. */
  private postSkills() {
    this.post({ type: "skills", skills: this.skills.list().map((sk) => ({ name: sk.name, description: sk.description })) });
  }

  private postConfig() {
    this.post({ type: "config", model: this.currentModel, models: this.models, effort: this.currentEffort, mode: this.mode, alwaysAllow: this.alwaysAllow });
  }

  /** plan mode: sessions may only use read-only tools; build mode: all tools. */
  private applyMode() {
    const allowed: ToolName[] | null = this.mode === "plan" ? ["read_file", "list_dir", "find_files", "search_code", "load_skill"] : null;
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
      async streamTurn(messages, tools, onEvent, signal, system) {
        if (!keyCached) {
          keyCached = (await secrets.get("koMind.apiKey")) ?? null;
          if (!keyCached) throw new Error("No API key set. Open Settings (gear icon) and enter your API key.");
          baseProvider.setKey(keyCached);
        }
        return baseProvider.streamTurn(messages, tools, onEvent, signal, system);
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
      thinkingDelta: (t: string) => this.post({ type: "thinkingDelta", sessionId: id, text: t }),
      toolCall: (callId: string, tool: string, input: Record<string, unknown>) =>
        this.post({ type: "toolCall", sessionId: id, callId, tool, input }),
      toolResult: (callId: string, ok: boolean, output: string, editInfo?: EditInfo) => this.post({ type: "toolResult", sessionId: id, callId, ok, output, editInfo }),
      subagentStatus: (callId: string, agents: { name: string; status: "running" | "done" | "failed" }[]) => this.post({ type: "subagentStatus", sessionId: id, callId, agents }),
      error: (message: string) => this.post({ type: "error", sessionId: id, message }),
      turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
      turnStopped: () => this.post({ type: "turnStopped", sessionId: id }),
    };
    return new AgentSession({ sessionId: id, provider, ctx: this.makeToolContext(provider), store: this.store, ui, initialMessages, registry: this.registry, system: () => this.mainSystemPrompt() });
  }

  private makeToolContext(provider?: Provider): ToolContext {
    const cfg = vscode.workspace.getConfiguration("koMind");
    const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return {
      async readFile(p) { return vscode.workspace.fs.readFile(vscode.Uri.file(p)).then((b) => Buffer.from(b).toString("utf8")); },
      async listDir(p) {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        return entries.map(([name, type]) => type === vscode.FileType.Directory ? name + "/" : name);
      },
      async findFiles(glob, maxResults) {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) throw new Error("No workspace folder open.");
        // ponytail: fixed exclude list + files.exclude, not .gitignore; switch to bundled ripgrep if other ignored dirs get noisy
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), "**/{node_modules,.git,dist,out}/**", maxResults);
        return uris.map((u) => vscode.workspace.asRelativePath(u, false));
      },
      async applyEdit(p, oldString, newString) {
        const uri = vscode.Uri.file(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        // Save any existing in-editor changes first, then save the accepted agent edit.
        // This is explicit and does not depend on the user's files.autoSave setting.
        if (doc.isDirty && !await doc.save()) throw new Error("Existing file changes could not be saved.");
        const before = doc.getText();
        const count = before.split(oldString).length - 1;
        if (count === 0) throw new Error("oldString not found in file.");
        if (count > 1) throw new Error(`oldString found ${count} times; must be unique.`);
        const start = before.indexOf(oldString);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(doc.positionAt(start), doc.positionAt(start + oldString.length)), newString);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) throw new Error("Edit rejected by editor.");
        if (!await doc.save()) throw new Error("Edited file could not be saved.");
        const after = before.slice(0, start) + newString + before.slice(start + oldString.length);
        return { before, after };
      },
      async createFile(p, content) {
        const uri = vscode.Uri.file(p);
        // Fail if the file already exists so creation never clobbers existing content.
        let exists = false;
        try { await vscode.workspace.fs.stat(uri); exists = true; } catch { /* not found is expected */ }
        if (exists) throw new Error("File already exists. Use apply_edit to modify an existing file.");
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty) await doc.save();
      },
      async runTerminal(command, cwd, onOutput, signal) {
        return new Promise((resolve) => {
          let settled = false;
          const finish = (exitCode: number) => {
            if (settled) return;
            settled = true;
            resolve({ exitCode });
          };
          const opts: cp.ExecOptions = { cwd };
          const proc = cp.exec(command, opts, (err: cp.ExecException | null) => {
            const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
            finish(code);
          });
          const stop = () => {
            if (proc.pid === undefined) return finish(1);
            if (process.platform === "win32") {
              cp.execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => finish(1));
            } else {
              proc.kill("SIGTERM");
              finish(1);
            }
          };
          if (signal?.aborted) stop();
          else signal?.addEventListener("abort", stop, { once: true });
          proc.stdout?.on("data", (d) => onOutput(d.toString()));
          proc.stderr?.on("data", (d) => onOutput(d.toString()));
        });
      },
      requestApproval: (command, callId, tool, signal) => {
        // MCP (external) tools are always gated — no always-allow bypass.
        if (tool && isMcpToolName(tool)) {
          return this.approvals.request(this.currentSessionId ?? "", callId, command, tool, signal);
        }
        // persistent "always allow" grants bypass the approval card
        if (tool === "run_terminal" && this.alwaysAllow.terminal) return Promise.resolve(true);
        if ((tool === "apply_edit" || tool === "create_file") && this.alwaysAllow.edits) return Promise.resolve(true);
        return this.approvals.request(this.currentSessionId ?? "", callId, command, tool ?? "run_terminal", signal);
      },
      // Sub-agents inherit the current mode's tool restrictions and share the
      // parent's tool context (approvals, workspace access). They run headless
      // and concurrently. Only available when a provider is supplied — sub-agents
      // never receive a runSubagents context, so nesting is impossible.
      runSubagents: provider
        ? (tasks, signal, onStatus) => {
          const allowed: ToolName[] | null = this.mode === "plan" ? ["read_file", "list_dir", "find_files", "search_code", "load_skill"] : null;
          return runSubagents(tasks, { provider, ctx: this.makeToolContext(), allowedTools: allowed, onStatus, registry: this.registry, system: this.systemPrompt() }, signal);
        }
        : undefined,
      // Skills are available to top-level sessions and sub-agents alike so
      // either can pull in a skill's full instructions on demand.
      loadSkill: (name: string) => this.skills.body(name),
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
        // Slash commands (/name args) expand to their prompt template for the
        // model while the chat still shows what the user typed.
        const expanded = this.commands.expand(m.text);
        if (expanded !== undefined) modelText = expanded;
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
        session.send(modelText, displayText, validImages(m.images ?? []));
        break;
      }
      case "attachFiles": await this.pickFiles(); break;
      case "importSession": await this.importSession(); break;
      case "openFile": await this.openFile(m.path, m.view); break;
      case "stop": {
        const session = this.sessions.get(m.sessionId);
        if (!session?.stop()) this.post({ type: "turnStopped", sessionId: m.sessionId });
        break;
      }
      case "attachFolder": await this.pickFolder(); break;
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
          } else if (tool === "apply_edit" || tool === "create_file") {
            this.alwaysAllow.edits = true;
            void this.context.workspaceState.update("koMind.alwaysAllow.edits", true);
          }
          this.postConfig();
        }
        this.approvals.resolve(m.callId, m.approved, this.currentSessionId);
        break;
      }
      case "newSessionRequest": this.startSession(); break;
      case "requestCurrentSession": {
        if (!this.currentSessionId) {
          this.startSession();
          break;
        }
        const events = await this.store.load(this.currentSessionId);
        this.post({ type: "loadEvents", sessionId: this.currentSessionId, events });
        break;
      }
      case "retry": {
        const s = this.sessions.get(m.sessionId);
        if (s && !s.busy) s.send("(retry)");
        break;
      }
      case "requestSessionList": await this.sendSessionList(); break;
      case "deleteSession": {
        const session = this.sessions.get(m.sessionId);
        if (session?.busy) session.stop();
        this.sessions.delete(m.sessionId);
        this.contextInjected.delete(m.sessionId);
        await this.store.delete(m.sessionId);
        if (this.currentSessionId === m.sessionId) this.startSession();
        await this.sendSessionList();
        break;
      }
      case "setSessionArchived": {
        await this.store.setArchived(m.sessionId, m.archived);
        if (m.archived && this.currentSessionId === m.sessionId) this.startSession();
        await this.sendSessionList();
        break;
      }
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
      case "requestCommands": {
        this.post({ type: "commands", commands: this.commands.list().map((c) => ({ name: c.name, description: c.description, plugin: c.plugin })) });
        break;
      }
      case "requestSkills": this.postSkills(); break;
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
        const saved = this.context.globalState.get<string[]>("koMind.extraModels") ?? [];
        if (!saved.includes(name)) void this.context.globalState.update("koMind.extraModels", [...saved, name]);
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
        const saved = this.context.globalState.get<string[]>("koMind.extraModels") ?? [];
        const next = saved.filter((x) => x !== m.model);
        void this.context.globalState.update("koMind.extraModels", next);
        // also drop it from any legacy workspace-scoped list
        const legacy = this.context.workspaceState.get<string[]>("koMind.extraModels") ?? [];
        if (legacy.includes(m.model)) void this.context.workspaceState.update("koMind.extraModels", legacy.filter((x) => x !== m.model));
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
        if (m.voiceUrl !== undefined) await cfg.update("voice.transcriptionUrl", m.voiceUrl.trim(), targets);
        if (m.voiceModel !== undefined) await cfg.update("voice.model", m.voiceModel.trim(), targets);
        if (m.voiceLanguage !== undefined) await cfg.update("voice.language", m.voiceLanguage.trim(), targets);
        // keys are only sent when the user typed a new one; empty means "keep the saved key"
        if (m.apiKey?.trim()) await this.storeKey("koMind.apiKey", m.apiKey.trim());
        if (m.voiceApiKey?.trim()) await this.storeKey("koMind.voiceApiKey", m.voiceApiKey.trim());
        this.postSettings();
        break;
      }
      case "setApiKey": {
        await this.promptApiKey();
        break;
      }
      case "voice": await this.onVoice(m.action); break;
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

  /**
 * Open a workspace file in the editor from a tool card. view: "file" opens
 * the file directly; view: "diff" opens it against its last committed
 * version using Git built-in diff, falling back to opening the file when
 * no Git baseline is available.
   */
  async openFile(rel: string, view: "file" | "diff"): Promise<void> {
    let abs: string;
    try {
      abs = resolvePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, rel);
    } catch (e) {
      vscode.window.showErrorMessage(`KoMind: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const uri = vscode.Uri.file(abs);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      vscode.window.showErrorMessage(`KoMind: file not found: ${rel}`);
      return;
    }
    if (view === "diff") {
      const gitUri = uri.with({ scheme: "git", query: JSON.stringify({ path: uri.fsPath, ref: "HEAD" }) });
      try {
        await vscode.commands.executeCommand("vscode.diff", gitUri, uri, `${path.basename(abs)} (Working Tree)`);
        return;
      } catch {
        // No Git baseline (untracked/new file or no repo) — fall through to a plain open.
      }
    }
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  /**
   * Import a chat/coding session exported from another AI provider. Reads a
   * JSON export or plain-text transcript, normalizes it into KoMind session
   * events, persists it as a new session, and opens it so the conversation can
   * continue mid-thread with any configured model.
   */
  async importSession(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { "Chat exports": ["json", "txt", "md"], "All files": ["*"] },
      title: "Import chat from another AI provider",
      openLabel: "Import",
    });
    if (!uris?.[0]) return;

    let raw: string;
    try {
      const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
      const stat = await vscode.workspace.fs.stat(uris[0]);
      if (stat.size > MAX_IMPORT_BYTES) {
        this.post({ type: "importResult", ok: false, message: "That export is too large (over 25 MB)." });
        return;
      }
      raw = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString("utf8");
    } catch (e) {
      this.post({ type: "importResult", ok: false, message: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    let conversations: ImportedConversation[];
    try {
      conversations = parseImport(raw);
    } catch {
      conversations = [];
    }
    if (conversations.length === 0) {
      this.post({ type: "importResult", ok: false, message: "No conversation was found in that file. Supported: ChatGPT, Claude, Gemini, OpenAI/Anthropic API JSON, or a plain-text transcript." });
      return;
    }

    // A single export file can hold many conversations (e.g. a full ChatGPT
    // export). Let the user pick which to import when there is more than one.
    let chosen = conversations;
    if (conversations.length > 1) {
      const picks = await vscode.window.showQuickPick(
        conversations.map((c, i) => ({
          label: c.title || `Conversation ${i + 1}`,
          description: `${c.provider} · ${c.events.length} messages`,
          index: i,
          picked: conversations.length <= 20,
        })),
        { canPickMany: true, title: `Select conversations to import (${conversations.length} found)` }
      );
      if (!picks || picks.length === 0) return;
      chosen = picks.map((p) => conversations[p.index]);
    }

    let lastId: string | undefined;
    for (const conv of chosen) {
      const { id } = await this.store.importSession(conv.events);
      this.sessions.set(id, this.makeSession(id, messagesFromEvents(conv.events)));
      lastId = id;
    }

    await this.sendSessionList();
    if (lastId) {
      this.currentSessionId = lastId;
      const events = await this.store.load(lastId);
      this.post({ type: "loadEvents", sessionId: lastId, events });
    }
    const providers = [...new Set(chosen.map((c) => c.provider))].join(", ");
    this.post({
      type: "importResult",
      ok: true,
      count: chosen.length,
      message: chosen.length === 1
        ? `Imported a ${providers} conversation. You can continue it now.`
        : `Imported ${chosen.length} conversations from ${providers}.`,
    });
  }

  private async pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: {
        "Files and photos": ["txt", "md", "json", "jsonl", "js", "jsx", "ts", "tsx", "css", "scss", "html", "xml", "yaml", "yml", "toml", "py", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php", "sh", "sql", "csv", "log", "png", "jpg", "jpeg", "gif", "webp"],
        "All files": ["*"],
      },
      title: "Add files or photos",
      openLabel: "Add",
    });
    if (uris?.length) await this.attachUris(uris);
  }

  private async pickFolder(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false, canSelectFiles: false, canSelectFolders: true,
      title: "Add folder", openLabel: "Add Folder",
    });
    if (!selected?.[0]) return;
    const root = selected[0];
    const uris: vscode.Uri[] = [];
    const skippedDirs = new Set([".git", "node_modules", "dist", "out", "coverage", ".vscode-test"]);
    const walk = async (dir: vscode.Uri): Promise<void> => {
      if (uris.length >= 50) return;
      let entries: [string, vscode.FileType][];
      try { entries = await vscode.workspace.fs.readDirectory(dir); } catch { return; }
      for (const [name, type] of entries) {
        if (uris.length >= 50) return;
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory && !skippedDirs.has(name)) await walk(child);
        else if (type === vscode.FileType.File) uris.push(child);
      }
    };
    await walk(root);
    if (uris.length === 0) {
      this.post({ type: "attachmentError", message: "The selected folder has no readable files." });
      return;
    }
    await this.attachUris(uris, root);
  }

  private async attachUris(uris: vscode.Uri[], relativeRoot?: vscode.Uri): Promise<void> {
    const MAX_TEXT_CHARS = 100_000;
    const files: FileAttachment[] = [];
    const images: ImageAttachment[] = [];
    const skipped: string[] = [];
    let totalImageBytes = 0;
    const displayName = (uri: vscode.Uri) => relativeRoot
      ? path.basename(relativeRoot.fsPath) + "/" + path.relative(relativeRoot.fsPath, uri.fsPath).split(path.sep).join("/")
      : path.basename(uri.fsPath);
    const imageType = (filePath: string): ImageAttachment["mediaType"] | undefined => {
      switch (path.extname(filePath).toLowerCase()) {
        case ".jpg": case ".jpeg": return "image/jpeg";
        case ".png": return "image/png"; case ".gif": return "image/gif"; case ".webp": return "image/webp";
        default: return undefined;
      }
    };
    for (const uri of uris) {
      const name = displayName(uri);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const mediaType = imageType(uri.fsPath);
        if (mediaType) {
          if (images.length >= MAX_IMAGES || bytes.byteLength > MAX_IMAGE_BYTES || totalImageBytes + bytes.byteLength > MAX_TOTAL_IMAGE_BYTES) { skipped.push(name); continue; }
          images.push({ name, mediaType, data: Buffer.from(bytes).toString("base64") });
          totalImageBytes += bytes.byteLength;
          continue;
        }
        let content = Buffer.from(bytes).toString("utf8");
        if (content.includes("\u0000")) { skipped.push(name); continue; }
        const truncated = content.length > MAX_TEXT_CHARS;
        if (truncated) content = content.slice(0, MAX_TEXT_CHARS);
        files.push({ name, content, truncated });
      } catch { skipped.push(name); }
    }
    if (files.length > 0 || images.length > 0) {
      this.post({ type: "attachments", files, images, warning: skipped.length ? skipped.length + " unsupported, unreadable, or oversized file(s) were skipped." : undefined });
    } else {
      this.post({ type: "attachmentError", message: "No supported files were added. Images must be PNG, JPEG, GIF, or WebP and under 5 MB." });
    }
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

  /** Disconnect all MCP servers when the extension is torn down. */
  async dispose(): Promise<void> {
    clearTimeout(this.voiceTimer);
    this.recorder.cancel();
    await this.mcp.disconnectAll();
  }
}

export function deactivate() { }
