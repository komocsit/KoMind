## git log
549b587 docs: README, smoke-test checklist, webview CSP hardening
f9b9690 test: integration harness for extension activation

## diff stat

 README.md             | 58 +++++++++++++++++++++++++++++++++++++++++++++++++++
 SMOKE-TEST.md         | 13 ++++++++++++
 package-lock.json     |  8 +++++++
 package.json          |  1 +
 src/host/extension.ts |  3 ++-
 5 files changed, 82 insertions(+), 1 deletion(-)

## diff

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
diff --git a/package.json b/package.json
index 314dd7a..2bf76de 100644
--- a/package.json
+++ b/package.json
@@ -65,20 +65,21 @@
   },
   "scripts": {
     "compile": "node esbuild.js --production",
     "watch": "node esbuild.js --watch",
     "test:unit": "vitest run",
     "test:integration": "npm run compile && node test/integration/run.js",
     "package": "vsce package"
   },
   "devDependencies": {
     "@types/dompurify": "^3.0.5",
+    "@types/mocha": "^10.0.10",
     "@types/node": "^20.0.0",
     "@types/react": "^18.3.31",
     "@types/react-dom": "^18.3.7",
     "@types/vscode": "^1.85.0",
     "@vscode/test-electron": "^2.3.0",
     "@vscode/vsce": "^2.24.0",
     "esbuild": "^0.20.0",
     "mocha": "^12.0.0",
     "typescript": "^5.4.0",
     "vitest": "^1.5.0"
diff --git a/src/host/extension.ts b/src/host/extension.ts
index b2bad2a..934658c 100644
--- a/src/host/extension.ts
+++ b/src/host/extension.ts
@@ -155,15 +155,16 @@ class ChatViewProvider implements vscode.WebviewViewProvider {
       }
     }
   }
 
   private async sendSessionList() {
     this.post({ type: "sessionList", sessions: await this.store.list() });
   }
 
   private html(webview: vscode.Webview) {
     const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "main.js"));
-    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">`;
+    return `<!DOCTYPE html><html><head>${csp}</head><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
   }
 }
 
 export function deactivate() {}
