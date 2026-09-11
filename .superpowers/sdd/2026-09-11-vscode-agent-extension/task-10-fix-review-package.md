## fix diff vs dd51cf4^
diff --git a/src/host/extension.ts b/src/host/extension.ts
index 934658c..5d51766 100644
--- a/src/host/extension.ts
+++ b/src/host/extension.ts
@@ -18,35 +18,37 @@ export function activate(context: vscode.ExtensionContext) {
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
-    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.post({ type: "newSession" })),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.newSession()),
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
 
+  newSession() { this.startSession(); }
+
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
