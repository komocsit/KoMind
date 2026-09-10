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
