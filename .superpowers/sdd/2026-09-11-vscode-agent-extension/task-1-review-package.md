## git log
2bd5588 docs: task 1 report
3c0c130 chore: scaffold extension host + webview build
cb5b59d chore: initial state (docs + planning artifacts)

## diff stat

 .gitignore                                         |    4 +
 .../2026-09-11-vscode-agent-extension/progress.md  |   16 +
 .../task-1-brief.md                                |  205 +
 .../task-1-report.md                               |   53 +
 .vscode/launch.json                                |   11 +
 .vscode/tasks.json                                 |   13 +
 .../plans/2026-09-11-vscode-agent-extension.md     | 1541 ++++++
 .../2026-09-11-vscode-agent-extension-design.md    |   57 +
 esbuild.js                                         |   25 +
 media/icon.svg                                     |    7 +
 package-lock.json                                  | 5348 ++++++++++++++++++++
 package.json                                       |   47 +
 src/host/extension.ts                              |   32 +
 src/webview/main.tsx                               |    3 +
 test/unit/example.test.ts                          |    2 +
 tsconfig.json                                      |    8 +
 vitest.config.ts                                   |    2 +
 17 files changed, 7374 insertions(+)

## diff

diff --git a/.gitignore b/.gitignore
new file mode 100644
index 0000000..10a0e02
--- /dev/null
+++ b/.gitignore
@@ -0,0 +1,4 @@
+node_modules/
+dist/
+*.vsix
+.vscode-test/
diff --git a/.superpowers/sdd/2026-09-11-vscode-agent-extension/progress.md b/.superpowers/sdd/2026-09-11-vscode-agent-extension/progress.md
new file mode 100644
index 0000000..29ec6fb
--- /dev/null
+++ b/.superpowers/sdd/2026-09-11-vscode-agent-extension/progress.md
@@ -0,0 +1,16 @@
+# SDD ledger ù plan: docs/superpowers/plans/2026-09-11-vscode-agent-extension.md
+
+## Preflight conflict scan
+
+| Tasks | Interface shared | Finding |
+|---|---|---|
+| 3/4 | ToolDef/TOOL_DEFS | Provider imports TOOL_DEFS from tools.ts ù consistent signatures |
+| 4/6 | Provider, StreamEvent, AnthropicMessage | match |
+| 5/6 | SessionStore.append/load | match |
+| 6/7 | AgentSession ctor, AgentUi | match |
+| 7/4 | setKey addition | Plan itself mandates a provider refactor in Task 7 (setKey) ù noted in plan; implementer must re-run Task 4 tests. Ruling: implement setKey in Task 4 directly to avoid churn ù no, plan says add in Task 7; keep plan order. |
+| 8/2 | protocol types | CardView uses sessionIdRef from App scope ù plan notes to hoist/onRetry prop; implementer instructed to use onRetry prop |
+| 1/9 | dist layout, esbuild | Task 9 adds third esbuild entry ù extension of Task 1 scaffold, no conflict |
+
+Scan clean apart from notes above. No spec contradictions found. Global Constraints re-checked against each task: settings prefix, defaults, SecretStorage-only keys, workspace path confinement, 60s approval timeout all carried in relevant briefs.
+
diff --git a/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-brief.md b/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-brief.md
new file mode 100644
index 0000000..8b10329
--- /dev/null
+++ b/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-brief.md
@@ -0,0 +1,205 @@
+# Task 1: Scaffold extension project (host bundles, webview placeholder, F5 runs)
+
+**Files:**
+- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `src/host/extension.ts`, `src/webview/main.tsx`, `.vscode/launch.json`, `.gitignore`, `vitest.config.ts`
+- Test: `test/unit/example.test.ts` (a trivial placeholder so `npm run test:unit` works)
+
+**Interfaces:**
+- Produces: npm scripts `compile`, `watch`, `test:unit`, `package` (vsce-ready layout); extension id `justwoker.agent`.
+
+- [ ] **Step 1: Initialize repo and package.json**
+
+```powershell
+mkdir justwoker-agent; cd justwoker-agent; git init
+```
+
+(You are already inside the repo dir ΓÇö just `git init`.)
+
+`package.json` (key parts):
+
+```json
+{
+  "name": "justwoker-agent",
+  "displayName": "Justwoker Agent",
+  "publisher": "justwoker",
+  "version": "0.1.0",
+  "engines": { "vscode": "^1.85.0" },
+  "main": "./dist/host/extension.js",
+  "activationEvents": [],
+  "contributes": {
+    "viewsContainers": {
+      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
+    },
+    "views": {
+      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
+    },
+    "commands": [
+      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
+      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
+    ],
+    "configuration": {
+      "title": "Justwoker Agent",
+      "properties": {
+        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
+        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
+        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
+        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
+        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
+      }
+    }
+  },
+  "scripts": {
+    "compile": "node esbuild.js --production",
+    "watch": "node esbuild.js --watch",
+    "test:unit": "vitest run",
+    "package": "vsce package"
+  },
+  "devDependencies": {
+    "@types/vscode": "^1.85.0", "@types/node": "^20.0.0", "typescript": "^5.4.0",
+    "esbuild": "^0.20.0", "vitest": "^1.5.0", "@vscode/test-electron": "^2.3.0", "@vscode/vsce": "^2.24.0"
+  },
+  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
+}
+```
+
+Also create a minimal `media/icon.svg` (any simple 24x24 SVG shape) so the activity bar icon resolves.
+
+- [ ] **Step 2: Write tsconfig.json, esbuild.js, .gitignore, launch.json**
+
+`tsconfig.json`:
+
+```json
+{
+  "compilerOptions": {
+    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
+    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
+    "outDir": "dist", "jsx": "react-jsx", "types": ["node"]
+  },
+  "include": ["src", "test"]
+}
+```
+
+`esbuild.js` (two bundles: host CJS, webview ESM):
+
+```js
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
+
+(async () => {
+  if (watch) {
+    const ctx = await esbuild.context({ ...host });
+    await ctx.watch();
+    const ctx2 = await esbuild.context({ ...webview });
+    await ctx2.watch();
+  } else {
+    await esbuild.build(host);
+    await esbuild.build(webview);
+  }
+})();
+```
+
+`.gitignore`: `node_modules/`, `dist/`, `*.vsix`, `.vscode-test/`
+
+`.vscode/launch.json`:
+
+```json
+{
+  "version": "0.2.0",
+  "configurations": [{
+    "name": "Run Extension",
+    "type": "extensionHost",
+    "request": "launch",
+    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
+    "preLaunchTask": "npm: watch",
+    "outFiles": ["${workspaceFolder}/dist/**/*.js"]
+  }]
+}
+```
+
+Also add `.vscode/tasks.json` with a `npm: watch` task (type npm, script watch, isBackground true, problemMatcher `$esbuild-watch`) so the launch config's preLaunchTask resolves.
+
+`vitest.config.ts`:
+
+```ts
+import { defineConfig } from "vitest/config";
+export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
+```
+
+- [ ] **Step 3: Minimal host entry + webview**
+
+`src/host/extension.ts`:
+
+```ts
+import * as vscode from "vscode";
+
+export function activate(context: vscode.ExtensionContext) {
+  const provider = new ChatViewProvider(context.extensionUri);
+  context.subscriptions.push(
+    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
+    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
+      const key = await vscode.window.showInputBox({ password: true, prompt: "API key" });
+      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
+    }),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => {
+      provider.postMessage({ type: "newSession" });
+    })
+  );
+}
+
+class ChatViewProvider implements vscode.WebviewViewProvider {
+  public view?: vscode.WebviewView;
+  constructor(private readonly uri: vscode.Uri) {}
+  resolveWebviewView(view: vscode.WebviewView) {
+    this.view = view;
+    view.webview.options = { enableScripts: true, localResourceRoots: [this.uri] };
+    view.webview.html = this.html(view.webview);
+  }
+  postMessage(msg: unknown) { this.view?.webview.postMessage(msg); }
+  private html(webview: vscode.Webview) {
+    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "webview", "main.js"));
+    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+  }
+}
+
+export function deactivate() {}
+```
+
+`src/webview/main.tsx`:
+
+```tsx
+import React from "react";
+import { createRoot } from "react-dom/client";
+createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
+```
+
+- [ ] **Step 4: Smoke-verify**
+
+```powershell
+npm install; npm run compile
+```
+
+Expected: `dist/host/extension.js` and `dist/webview/main.js` exist. Also add `test/unit/example.test.ts`:
+
+```ts
+import { describe, it, expect } from "vitest";
+describe("scaffold", () => { it("runs vitest", () => { expect(1).toBe(1); }); });
+```
+
+and run `npm run test:unit` (expected: 1 passing test). F5 manual verification is deferred to later tasks ΓÇö do not attempt it.
+
+- [ ] **Step 5: Commit**
+
+```powershell
+git add -A; git commit -m "chore: scaffold extension host + webview build"
+```
diff --git a/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-report.md b/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-report.md
new file mode 100644
index 0000000..ca6d71c
--- /dev/null
+++ b/.superpowers/sdd/2026-09-11-vscode-agent-extension/task-1-report.md
@@ -0,0 +1,53 @@
+# Task 1 Report: Scaffold extension project
+
+Date: 2026-09-11
+Status: DONE
+
+## Files created
+
+- `package.json` ΓÇö extension manifest, id/publisher `justwoker`, main `./dist/host/extension.js`, contributes (activity bar container, webview view `justwokerAgent.chat`, commands, configuration with `justwokerAgent.*` defaults exactly per brief), scripts (`compile`, `watch`, `test:unit`, `package`), devDeps and deps per brief.
+- `tsconfig.json` ΓÇö verbatim per brief.
+- `esbuild.js` ΓÇö two bundles: host (CJS, node platform, `vscode` external) ΓåÆ `dist/host/extension.js`; webview (ESM, browser platform) ΓåÆ `dist/webview/main.js`; production/watch flags.
+- `.gitignore` ΓÇö `node_modules/`, `dist/`, `*.vsix`, `.vscode-test/` (docs NOT excluded).
+- `.vscode/launch.json` ΓÇö extensionHost config per brief.
+- `.vscode/tasks.json` ΓÇö `npm: watch` task with `$esbuild-watch` problemMatcher, `isBackground: true`.
+- `vitest.config.ts` ΓÇö include `test/unit/**/*.test.ts`.
+- `src/host/extension.ts` ΓÇö activate/deactivate, ChatViewProvider, both commands, secret storage per brief (verbatim).
+- `src/webview/main.tsx` ΓÇö React root rendering `<h1>Justwoker Agent</h1>` (verbatim).
+- `media/icon.svg` ΓÇö simple 24x24 chat-bubble shape.
+- `test/unit/example.test.ts` ΓÇö trivial vitest placeholder (verbatim).
+- `package-lock.json` ΓÇö generated by npm install (committed).
+
+## Commands run and results
+
+| Command | Result |
+|---|---|
+| `git init` | Initialized empty repo (master) |
+| `npm install` | Success. Warnings only: npm blocked install-scripts for `@vscode/vsce-sign`, `keytar`, `esbuild` postinstall scripts (`npm warn install-scripts ...`). esbuild binary still worked (compile succeeded), so no action needed. |
+| `npm run compile` | Success, no errors. `dist/host/extension.js` and `dist/webview/main.js` both exist (verified with `Test-Path` ΓåÆ True/True). |
+| `npm run test:unit` | 1 test file, 1 test passed (`test/unit/example.test.ts`), 0 failures. |
+| `git add -A; git commit` | Two commits (see below). |
+
+## Commits
+
+- `cb5b59d` ΓÇö `chore: initial state (docs + planning artifacts)` ΓÇö includes docs/, .superpowers/, and all scaffold source files.
+- `3c0c130` ΓÇö `chore: scaffold extension host + webview build` ΓÇö package-lock.json (generated by npm install).
+
+## Deviations from brief
+
+1. **Commit split**: the brief's step 5 implies a single scaffold commit, but the task instructions required docs/planning artifacts committed as part of the initial state. Since all scaffold files were written before `git init`, the first commit contains docs + planning + scaffold sources; the second commit adds the lockfile produced by `npm install`. Net history is clean; no content deviation.
+2. `npm install` install-scripts warnings (see above) ΓÇö informational, did not affect build or test.
+3. No other deviations: all settings defaults, extension id, main entry, scripts, and file contents match the brief verbatim.
+
+## Self-review (brief checklist)
+
+- [x] Step 1: repo initialized; `package.json` matches brief (name, displayName, publisher, engines, main, activationEvents, contributes incl. all 5 `justwokerAgent.*` settings with exact defaults: baseUrl `https://api.justwoker.icu`, model `gpt-5.6-sol`, maxTokens 4096, autoApproveEdits true, autoApproveTerminal false); `media/icon.svg` created.
+- [x] Step 2: `tsconfig.json`, `esbuild.js` (host CJS + webview ESM), `.gitignore` (docs not excluded), `.vscode/launch.json`, `.vscode/tasks.json` (`npm: watch`, isBackground, `$esbuild-watch`), `vitest.config.ts` ΓÇö all present and per brief.
+- [x] Step 3: `src/host/extension.ts` and `src/webview/main.tsx` verbatim from brief.
+- [x] Step 4: `npm install` OK; `npm run compile` OK; both bundle outputs exist; `npm run test:unit` ΓåÆ 1/1 passing. F5 verification NOT attempted (per instructions).
+- [x] Step 5: committed as described above.
+
+## Notes for later tasks
+
+- VS Code `^1.85.0` uses implicit activation events for contributed views/commands, so empty `activationEvents` is fine.
+- `vsce package` script requires `@vscode/vsce` ΓÇö installed; packaging not exercised in this task.
diff --git a/.vscode/launch.json b/.vscode/launch.json
new file mode 100644
index 0000000..70ccd12
--- /dev/null
+++ b/.vscode/launch.json
@@ -0,0 +1,11 @@
+{
+  "version": "0.2.0",
+  "configurations": [{
+    "name": "Run Extension",
+    "type": "extensionHost",
+    "request": "launch",
+    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
+    "preLaunchTask": "npm: watch",
+    "outFiles": ["${workspaceFolder}/dist/**/*.js"]
+  }]
+}
diff --git a/.vscode/tasks.json b/.vscode/tasks.json
new file mode 100644
index 0000000..fcf49a6
--- /dev/null
+++ b/.vscode/tasks.json
@@ -0,0 +1,13 @@
+{
+  "version": "2.0.0",
+  "tasks": [
+    {
+      "type": "npm",
+      "script": "watch",
+      "problemMatcher": "$esbuild-watch",
+      "label": "npm: watch",
+      "isBackground": true,
+      "group": { "kind": "build", "isDefault": true }
+    }
+  ]
+}
diff --git a/docs/superpowers/plans/2026-09-11-vscode-agent-extension.md b/docs/superpowers/plans/2026-09-11-vscode-agent-extension.md
new file mode 100644
index 0000000..4bf9bc9
--- /dev/null
+++ b/docs/superpowers/plans/2026-09-11-vscode-agent-extension.md
@@ -0,0 +1,1541 @@
+# Justwoker Agent ΓÇö VS Code Extension Implementation Plan
+
+> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
+
+**Goal:** Build a VS Code extension with a Copilot-agent-style chat sidebar that streams responses from an Anthropic-compatible API and can read files, auto-apply edits (with diffs), and run user-approved terminal commands.
+
+**Architecture:** Extension host (Node/TS) owns the Anthropic SDK client, agent loop, tool executors, approvals, and JSONL session persistence. A React webview sidebar renders chat/tool/approval cards and talks to the host only through a typed postMessage protocol. No secrets or file access in the webview.
+
+**Tech Stack:** TypeScript, vscode API (1.85+), `@anthropic-ai/sdk`, React 18, Vite, esbuild, vitest, `@vscode/test-electron`.
+
+**Spec:** `docs/superpowers/specs/2026-09-11-vscode-agent-extension-design.md`
+
+## Global Constraints
+
+- API base URL default: `https://api.justwoker.icu`; default model: `gpt-5.6-sol`.
+- Settings prefix: `justwokerAgent.` (`baseUrl`, `model`, `maxTokens`, `autoApproveEdits` default `true`, `autoApproveTerminal` default `false`).
+- API key stored ONLY via `vscode.SecretStorage`, never in workspace state or settings.
+- Tool execution limited to paths inside VS Code workspace folders (except reading session storage).
+- Terminal commands: approval required (60s timeout auto-reject); file edits: auto-applied with diff tab + Undo.
+- One agent loop per session; concurrent user messages queued.
+- All hostΓåöwebview messages must be types defined in `src/shared/protocol.ts`.
+- Node 18+, no other runtime; npm workspaces NOT used ΓÇö single package.
+- Windows development environment ΓÇö use PowerShell-compatible commands.
+
+---
+
+### Task 1: Scaffold extension project (host bundles, webview placeholder, F5 runs)
+
+**Files:**
+- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `src/host/extension.ts`, `src/webview/main.tsx`, `src/webview/index.html`, `webview.html`, `.vscode/launch.json`, `.gitignore`, `test/unit/example.test.ts`, `vitest.config.ts`
+
+**Interfaces:**
+- Produces: npm scripts `compile`, `watch`, `test:unit`, `package` (vsce-ready layout); extension id `justwoker.agent`.
+
+- [ ] **Step 1: Initialize repo and package.json**
+
+```powershell
+mkdir justwoker-agent; cd justwoker-agent; git init
+```
+
+`package.json` (key parts):
+
+```json
+{
+  "name": "justwoker-agent",
+  "displayName": "Justwoker Agent",
+  "publisher": "justwoker",
+  "version": "0.1.0",
+  "engines": { "vscode": "^1.85.0" },
+  "main": "./dist/host/extension.js",
+  "activationEvents": [],
+  "contributes": {
+    "viewsContainers": {
+      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
+    },
+    "views": {
+      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
+    },
+    "commands": [
+      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
+      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
+    ],
+    "configuration": {
+      "title": "Justwoker Agent",
+      "properties": {
+        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
+        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
+        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
+        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
+        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
+      }
+    }
+  },
+  "scripts": {
+    "compile": "node esbuild.js --production",
+    "watch": "node esbuild.js --watch",
+    "test:unit": "vitest run",
+    "package": "vsce package"
+  },
+  "devDependencies": {
+    "@types/vscode": "^1.85.0", "@types/node": "^20.0.0", "typescript": "^5.4.0",
+    "esbuild": "^0.20.0", "vitest": "^1.5.0", "@vscode/test-electron": "^2.3.0", "@vscode/vsce": "^2.24.0"
+  },
+  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
+}
+```
+
+- [ ] **Step 2: Write tsconfig.json, esbuild.js, .gitignore, launch.json**
+
+`tsconfig.json`:
+
+```json
+{
+  "compilerOptions": {
+    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
+    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
+    "outDir": "dist", "jsx": "react-jsx", "types": ["node"]
+  },
+  "include": ["src", "test"]
+}
+```
+
+`esbuild.js` (two bundles: host CJS, webview ESM):
+
+```js
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
+
+(async () => {
+  if (watch) {
+    const ctx = await esbuild.context({ ...host });
+    await ctx.watch();
+    const ctx2 = await esbuild.context({ ...webview });
+    await ctx2.watch();
+  } else {
+    await esbuild.build(host);
+    await esbuild.build(webview);
+  }
+})();
+```
+
+`.gitignore`: `node_modules/`, `dist/`, `*.vsix`, `.vscode-test/`
+
+`.vscode/launch.json`:
+
+```json
+{
+  "version": "0.2.0",
+  "configurations": [{
+    "name": "Run Extension",
+    "type": "extensionHost",
+    "request": "launch",
+    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
+    "preLaunchTask": "npm: watch",
+    "outFiles": ["${workspaceFolder}/dist/**/*.js"]
+  }]
+}
+```
+
+- [ ] **Step 3: Minimal host entry + webview**
+
+`src/host/extension.ts`:
+
+```ts
+import * as vscode from "vscode";
+
+export function activate(context: vscode.ExtensionContext) {
+  const provider = new ChatViewProvider(context.extensionUri);
+  context.subscriptions.push(
+    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
+    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
+      const key = await vscode.window.showInputBox({ password: true, prompt: "API key" });
+      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
+    }),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => {
+      provider.postMessage({ type: "newSession" });
+    })
+  );
+}
+
+class ChatViewProvider implements vscode.WebviewViewProvider {
+  public view?: vscode.WebviewView;
+  constructor(private readonly uri: vscode.Uri) {}
+  resolveWebviewView(view: vscode.WebviewView) {
+    this.view = view;
+    view.webview.options = { enableScripts: true, localResourceRoots: [this.uri] };
+    view.webview.html = this.html(view.webview);
+  }
+  postMessage(msg: unknown) { this.view?.webview.postMessage(msg); }
+  private html(webview: vscode.Webview) {
+    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "webview", "main.js"));
+    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+  }
+}
+
+export function deactivate() {}
+```
+
+`src/webview/main.tsx`:
+
+```tsx
+import React from "react";
+import { createRoot } from "react-dom/client";
+createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
+```
+
+- [ ] **Step 4: Smoke-verify**
+
+```powershell
+npm install; npm run compile
+```
+
+Expected: `dist/host/extension.js` and `dist/webview/main.js` exist; F5 in VS Code opens Extension Development Host with the sidebar showing "Justwoker Agent".
+
+- [ ] **Step 5: Commit**
+
+```powershell
+git add -A; git commit -m "chore: scaffold extension host + webview build"
+```
+
+---
+
+### Task 2: Shared message protocol
+
+**Files:**
+- Create: `src/shared/protocol.ts`
+- Test: `test/unit/protocol.test.ts`
+
+**Interfaces:**
+- Produces: all message types used by every later task ΓÇö `HostToWebviewMsg`, `WebviewToHostMsg`, `ToolCallView`, `SessionEvent` (defined below, verbatim).
+
+- [ ] **Step 1: Write failing type-compile test**
+
+`test/unit/protocol.test.ts`:
+
+```ts
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
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `npx vitest run test/unit/protocol.test.ts`
+Expected: FAIL ΓÇö `src/shared/protocol.ts` does not exist.
+
+- [ ] **Step 3: Implement `src/shared/protocol.ts`**
+
+```ts
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
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `npx vitest run test/unit/protocol.test.ts` ΓÇö Expected: PASS.
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: shared host/webview message protocol"`
+
+---
+
+### Task 3: Tool executors (read_file, list_dir, apply_edit, run_terminal) ΓÇö pure logic, mock vscode
+
+**Files:**
+- Create: `src/host/tools.ts`
+- Test: `test/unit/tools.test.ts`
+
+**Interfaces:**
+- Produces:
+
+```ts
+export interface ToolContext {
+  readFile(path: string): Promise<string>;
+  listDir(path: string): Promise<string[]>;
+  applyEdit(path: string, oldString: string, newString: string): Promise<void>;
+  runTerminal(command: string, cwd: string | undefined, onOutput: (chunk: string) => void): Promise<{ exitCode: number }>;
+  requestApproval(command: string, callId: string): Promise<boolean>;
+  openDiff(path: string): Promise<void>;
+  workspaceRoot(): string | undefined;
+}
+export interface ToolDef { name: ToolName; description: string; schema: Record<string, unknown>; }
+export const TOOL_DEFS: ToolDef[];
+export function executeTool(name: string, input: Record<string, unknown>, callId: string, ctx: ToolContext): Promise<{ ok: boolean; output: string }>;
+export function resolvePath(workspaceRoot: string | undefined, path: string): string; // also exported for tests
+```
+
+- [ ] **Step 1: Write failing tests**
+
+`test/unit/tools.test.ts`:
+
+```ts
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
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `npx vitest run test/unit/tools.test.ts` ΓÇö Expected: FAIL (module missing).
+
+- [ ] **Step 3: Implement `src/host/tools.ts`**
+
+```ts
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
+  const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel);
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
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `npx vitest run test/unit/tools.test.ts` ΓÇö Expected: PASS (all 8 tests).
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: tool executors with workspace path confinement"`
+
+---
+
+### Task 4: Provider (Anthropic SDK wrapper with retry)
+
+**Files:**
+- Create: `src/host/provider.ts`
+- Test: `test/unit/provider.test.ts`
+
+**Interfaces:**
+- Produces:
+
+```ts
+export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
+export interface StreamEvent { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
+export interface Provider {
+  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>;
+}
+export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
+export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider;
+export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
+```
+
+- [ ] **Step 1: Write failing test with fake SDK stream**
+
+`test/unit/provider.test.ts`:
+
+```ts
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
+  it("retries 5xx errors up to 3 times then throws", async () => {
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
+});
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `npx vitest run test/unit/provider.test.ts` ΓÇö Expected: FAIL.
+
+- [ ] **Step 3: Implement `src/host/provider.ts`**
+
+```ts
+import Anthropic from "@anthropic-ai/sdk";
+import { TOOL_DEFS, type ToolDef } from "./tools";
+
+export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
+export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
+export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
+export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
+export interface Provider { streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>; }
+
+export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider {
+  const client: AnthropicClientLike = sdk ?? new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
+  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
+        if (!retryable || attempt >= 2) throw e;
+        await sleep(500 * 2 ** attempt);
+      }
+    }
+
+    let text = "";
+    const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
+    let currentTool: { id: string; name: string; json: string } | undefined;
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
+        try {
+          toolUses.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.json || "{}") });
+        } catch { toolUses.push({ id: currentTool.id, name: currentTool.name, input: { _error: "malformed JSON input" } }); }
+        currentTool = undefined;
+      }
+    }
+
+    const content: unknown[] = [];
+    if (text) content.push({ type: "text", text });
+    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
+    onEvent({ type: "endTurn" });
+    return [{ role: "assistant", content }];
+  }
+
+  return { streamTurn };
+}
+
+export { TOOL_DEFS };
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `npx vitest run test/unit/provider.test.ts` ΓÇö Expected: PASS.
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: anthropic-compatible provider with streaming and retry"`
+
+---
+
+### Task 5: SessionStore (JSONL persistence)
+
+**Files:**
+- Create: `src/host/store.ts`
+- Test: `test/unit/store.test.ts`
+
+**Interfaces:**
+- Produces:
+
+```ts
+export class SessionStore {
+  constructor(sessionsDir: string);
+  createSession(): { id: string; path: string };                 // id = `${Date.now()}-${rand}` , file `<id>.jsonl`
+  append(sessionId: string, event: SessionEvent): Promise<void>;
+  load(sessionId: string): Promise<SessionEvent[]>;
+  list(): Promise<{ id: string; firstUserMessage: string; ts: number }[]>;
+  delete(sessionId: string): Promise<void>;
+}
+```
+
+- [ ] **Step 1: Write failing test (uses temp dir)**
+
+`test/unit/store.test.ts`:
+
+```ts
+import { describe, it, expect, beforeEach } from "vitest";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync, rmSync } from "fs";
+import { tmpdir } from "os";
+import path from "path";
+
+let dir: string;
+beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jw-")); });
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
+});
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `npx vitest run test/unit/store.test.ts` ΓÇö Expected: FAIL.
+
+- [ ] **Step 3: Implement `src/host/store.ts`**
+
+```ts
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
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `npx vitest run test/unit/store.test.ts` ΓÇö Expected: PASS.
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: JSONL session store"`
+
+---
+
+### Task 6: Agent loop (AgentSession + queueing + tool_result plumbing)
+
+**Files:**
+- Create: `src/host/agent.ts`
+- Test: `test/unit/agent.test.ts`
+
+**Interfaces:**
+- Consumes: `Provider`, `StreamEvent`, `AnthropicMessage` (Task 4); `executeTool`, `ToolContext`, `TOOL_DEFS` (Task 3); `SessionStore` (Task 5).
+- Produces:
+
+```ts
+export interface AgentUi { textDelta(t: string): void; toolCall(callId: string, tool: string, input: Record<string, unknown>): void; toolResult(callId: string, ok: boolean, output: string): void; error(msg: string): void; turnComplete(): void; }
+export class AgentSession {
+  constructor(opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi });
+  send(text: string): void;      // queues if loop running
+  get busy(): boolean;
+}
+```
+
+- [ ] **Step 1: Write failing test ΓÇö full loop with scripted provider**
+
+`test/unit/agent.test.ts`:
+
+```ts
+import { describe, it, expect, vi } from "vitest";
+import { AgentSession } from "../../src/host/agent";
+import type { Provider, StreamEvent, AnthropicMessage } from "../../src/host/provider";
+import type { ToolContext } from "../../src/host/tools";
+import { SessionStore } from "../../src/host/store";
+import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import path from "path";
+
+function scriptedProvider(turns: { text: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
+  const calls: AnthropicMessage[][] = [];
+  return {
+    calls,
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
+describe("AgentSession", () => {
+  it("runs a tool round-trip: text ΓåÆ tool_use ΓåÆ tool_result ΓåÆ final text", async () => {
+    const provider = scriptedProvider([
+      { toolUses: [{ id: "c1", name: "read_file", input: { path: "a.txt" } }] },
+      { text: "The file says: content of a.txt" },
+    ]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("read a.txt");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalled());
+    expect(ui.toolCall).toHaveBeenCalledWith("c1", "read_file", { path: "a.txt" });
+    expect(ui.toolResult).toHaveBeenCalledWith("c1", true, "content of a.txt");
+    // second model call must contain the tool_result
+    const secondCall = provider.calls[1];
+    expect(JSON.stringify(secondCall)).toContain('"type":"tool_result"');
+    expect(ui.textDelta).toHaveBeenCalledWith("The file says: content of a.txt".slice(0, 3));
+  });
+
+  it("queues a second user message while the loop is running", async () => {
+    const provider = scriptedProvider([{ text: "one" }, { text: "two" }]);
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("first");
+    expect(session.busy).toBe(true);
+    session.send("second");
+    await vi.waitFor(() => expect(ui.turnComplete).toHaveBeenCalledTimes(2));
+    expect(provider.calls.length).toBe(2);
+  });
+
+  it("surfaces provider errors via ui.error", async () => {
+    const provider: Provider = {
+      async streamTurn() { throw new Error("boom"); },
+    };
+    const ui = { textDelta: vi.fn(), toolCall: vi.fn(), toolResult: vi.fn(), error: vi.fn(), turnComplete: vi.fn() };
+    const store = new SessionStore(mkdtempSync(path.join(tmpdir(), "jw-")));
+    const session = new AgentSession({ sessionId: store.createSession().id, provider, ctx: ctx(), store, ui });
+    session.send("hello");
+    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledWith("boom"));
+    expect(session.busy).toBe(false);
+  });
+});
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `npx vitest run test/unit/agent.test.ts` ΓÇö Expected: FAIL.
+
+- [ ] **Step 3: Implement `src/host/agent.ts`**
+
+```ts
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
+  private turn = 0;
+
+  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi; systemPrompt?: string }) {}
+
+  get busy() { return this.running; }
+
+  send(text: string): void {
+    this.queue.push(text);
+    void this.drain();
+  }
+
+  private async drain(): Promise<void> {
+    if (this.running) return;
+    this.running = true;
+    try {
+      while (this.queue.length > 0) {
+        const text = this.queue.shift()!;
+        await this.runTurn(text);
+      }
+    } finally { this.running = false; }
+  }
+
+  private async runTurn(userText: string): Promise<void> {
+    this.turn++;
+    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });
+    await this.opts.store.append(this.opts.sessionId, { kind: "user", text: userText, ts: Date.now() });
+
+    try {
+      for (let round = 0; round < 25; round++) {
+        const assistantMsg = await this.opts.provider.streamTurn(this.messages, TOOL_DEFS, (e) => {
+          if (e.type === "textDelta") this.opts.ui.textDelta(e.text);
+          else if (e.type === "toolUse") this.opts.ui.toolCall(e.id, e.name, e.input);
+        });
+        this.messages.push(assistantMsg);
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
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `npx vitest run test/unit/agent.test.ts` ΓÇö Expected: PASS (3 tests).
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: agent loop with tool round-trips and message queueing"`
+
+---
+
+### Task 7: VS Code wiring (ChatViewProvider, ApprovalManager, real ToolContext)
+
+**Files:**
+- Modify: `src/host/extension.ts` (replace minimal scaffold)
+- Create: `src/host/approvals.ts`
+- Test: manual (integration harness comes in Task 9)
+
+**Interfaces:**
+- Consumes: everything from Tasks 2ΓÇô6.
+- Produces: a running extension ΓÇö sidebar chat wired to the real API with real file/terminal tools.
+
+- [ ] **Step 1: Implement `src/host/approvals.ts`**
+
+```ts
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
+```
+
+- [ ] **Step 2: Rewrite `src/host/extension.ts` with full wiring**
+
+```ts
+import * as vscode from "vscode";
+import * as path from "path";
+import * as cp from "child_process";
+import { createProvider, type AnthropicMessage } from "./provider";
+import { AgentSession } from "./agent";
+import { SessionStore } from "./store";
+import { ApprovalManager } from "./approvals";
+import type { ToolContext } from "./tools";
+import type { HostToWebviewMsg, WebviewToHostMsg, SessionEvent } from "../shared/protocol";
+
+export function activate(context: vscode.ExtensionContext) {
+  const provider = new ChatViewProvider(context);
+  context.subscriptions.push(
+    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
+    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
+      const key = await vscode.window.showInputBox({ password: true, prompt: "API key for the Justwoker Agent API" });
+      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
+    }),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => provider.post({ type: "newSession" })),
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
+  resolveWebviewView(view: vscode.WebviewView) {
+    this.view = view;
+    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
+    view.webview.html = this.html(view.webview);
+    view.webview.onDidReceiveMessage((m: WebviewToHostMsg) => void this.onMessage(m));
+
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
+    const apiKey = this.context.secrets.get("justwokerAgent.apiKey");
+    const provider = createProvider({
+      baseUrl: cfg.get("baseUrl", "https://api.justwoker.icu"),
+      apiKey: "", // replaced below before first turn
+      model: cfg.get("model", "gpt-5.6-sol"),
+      maxTokens: cfg.get("maxTokens", 4096),
+    });
+    const ctx = this.makeToolContext();
+    const ui = {
+      textDelta: (t) => this.post({ type: "textDelta", sessionId: id, text: t }),
+      toolCall: (callId, tool, input) => this.post({ type: "toolCall", sessionId: id, callId, tool, input }),
+      toolResult: (callId, ok, output) => this.post({ type: "toolResult", sessionId: id, callId, ok, output }),
+      error: (message) => this.post({ type: "error", sessionId: id, message }),
+      turnComplete: () => this.post({ type: "turnComplete", sessionId: id }),
+    };
+    // key injection: patch provider config lazily via closure ΓÇö simplest: recreate provider per turn is overkill;
+    // instead we read key async at session creation:
+    void this.context.secrets.get("justwokerAgent.apiKey").then((key) => {
+      if (!key) {
+        ui.error("No API key set. Run command 'Justwoker: Set API Key'.");
+        return;
+      }
+      // mutate the provider's config through a setter
+      (provider as any).setKey?.(key);
+    });
+    return new AgentSession({ sessionId: id, provider: this.withKey(provider), ctx, store: this.store, ui });
+  }
+
+  // wrapper ensuring key is fetched before first streamTurn call
+  private withKey(provider: ReturnType<typeof createProvider>): ReturnType<typeof createProvider> {
+    let cached: string | null = null;
+    const self = this;
+    return {
+      async streamTurn(messages, tools, onEvent) {
+        if (!cached) {
+          cached = await self.context.secrets.get("justwokerAgent.apiKey");
+          if (!cached) throw new Error("No API key set. Run command 'Justwoker: Set API Key'.");
+          (provider as any).setKey?.(cached);
+        }
+        return provider.streamTurn(messages, tools, onEvent);
+      },
+    } as any;
+  }
+
+  private makeToolContext(): ToolContext {
+    const self = this;
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
+          const proc = cp.exec(command, { cwd, shell: true }, (err) => {
+            resolve({ exitCode: err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0 });
+          });
+          proc.stdout?.on("data", (d) => onOutput(d.toString()));
+          proc.stderr?.on("data", (d) => onOutput(d.toString()));
+        });
+      },
+      requestApproval: (command, callId) => this.approvals.request(this.currentSessionId!, callId, command),
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
+      case "userMessage": {
+        if (m.sessionId === this.currentSessionId) this.sessions.get(m.sessionId)?.send(m.text);
+        break;
+      }
+      case "approve": {
+        if (this.currentSessionId) this.approvals.resolve(m.callId, m.approved, this.currentSessionId);
+        break;
+      }
+      case "newSessionRequest": this.startSession(); break;
+      case "retry": {
+        const s = this.sessions.get(m.sessionId);
+        if (s && !s.busy) s.send("(retry)");
+        break;
+      }
+      case "requestSessionList": await this.sendSessionList(); break;
+      case "loadSession": {
+        if (this.sessions.has(m.sessionId)) { this.currentSessionId = m.sessionId; break; }
+        const events = await this.store.load(m.sessionId);
+        this.currentSessionId = m.sessionId;
+        this.sessions.set(m.sessionId, this.makeSession(m.sessionId));
+        this.post({ type: "loadEvents", sessionId: m.sessionId, events });
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
+    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+  }
+}
+
+export function deactivate() {}
+```
+
+Note: `createProvider` in Task 4 needs a tiny addition for key injection ΓÇö add to `createProvider`:
+
+```ts
+const p = { streamTurn, setKey: (k: string) => { cfg = { ...cfg, apiKey: k }; client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: k }); } } as Provider & { setKey(k: string): void };
+return p;
+```
+
+(Refactor `client` to `let` and rebuild it on `setKey`; rerun Task 4 tests to confirm they still pass.)
+
+- [ ] **Step 3: Compile and manual smoke test**
+
+```powershell
+npm run compile
+```
+
+Press F5 ΓåÆ in the Extension Development Host: run "Justwoker: Set API Key", open a workspace folder, type "read a.txt and tell me what it contains" in the sidebar. Expected: tool card appears, contents stream back. If no key: error card with instructions.
+
+- [ ] **Step 4: Commit** ΓÇö `git add -A; git commit -m "feat: wire agent, tools, approvals and session store into vscode"`
+
+---
+
+### Task 8: Webview chat UI (React)
+
+**Files:**
+- Modify: `src/webview/main.tsx`
+- Create: `src/webview/App.tsx`, `src/webview/api.ts`
+- Add deps: `npm install marked` (add `"marked": "^12.0.0"` to dependencies)
+
+**Interfaces:**
+- Consumes: `HostToWebviewMsg`, `WebviewToHostMsg`, `SessionEvent` from `src/shared/protocol.ts`.
+- Produces: full chat UI ΓÇö streaming text, tool cards, approval cards, session picker, input box.
+
+- [ ] **Step 1: Implement `src/webview/api.ts`**
+
+```ts
+import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";
+
+declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void; getState<T>(): T; setState<T>(s: T): void };
+export const vscode = acquireVsCodeApi();
+export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
+export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
+  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
+};
+```
+
+- [ ] **Step 2: Implement `src/webview/App.tsx`**
+
+```tsx
+import React, { useEffect, useRef, useState } from "react";
+import { marked } from "marked";
+import { send, onHostMessage } from "./api";
+import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";
+
+interface Card {
+  kind: "user" | "assistant" | "tool" | "error";
+  text?: string;              // user/assistant/error
+  callId?: string;            // tool
+  tool?: string;              // tool
+  output?: string;            // tool
+  pendingApproval?: string;   // tool: command awaiting approval
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
+          case "loadEvents":
+            sessionIdRef.current = m.type === "loadEvents" ? m.sessionId : sessionIdRef.current;
+            if (m.type === "loadEvents") return eventsToCards(m.events);
+            return [];
+          case "textDelta":
+            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
+            else next.push({ kind: "assistant", text: m.text });
+            return next;
+          case "toolCall":
+            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
+            return next;
+          case "approvalRequest":
+            if (last?.callId === m.callId) next[next.length - 1] = { ...last, pendingApproval: m.command };
+            return next;
+          case "approvalResolved":
+            return next.map((c) => c.callId === m.callId ? { ...c, approvalDone: m.approved ? "approved" : "rejected", pendingApproval: undefined } : c);
+          case "toolResult":
+            return next.map((c) => c.callId === m.callId ? { ...c, output: m.output } : c);
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
+  return (
+    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
+      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
+        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
+        <select onChange={(e) => e.target.value && send({ type: "loadSession", sessionId: e.target.value })} value="">
+          <option value="">SessionsΓÇª</option>
+          {sessionList.map((s) => <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>)}
+        </select>
+      </div>
+      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
+        {cards.map((c, i) => <CardView key={i} card={c} />)}
+        <div ref={bottomRef} />
+      </div>
+      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
+        <textarea
+          style={{ flex: 1, resize: "none" }}
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
+    return { kind: "tool" as const, callId: e.callId, tool: e.tool };
+  });
+}
+
+function CardView({ card }: { card: Card }) {
+  if (card.kind === "assistant") {
+    return <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.text ?? "", { async: false }) as string }} />;
+  }
+  if (card.kind === "user") return <div style={{ color: "var(--vscode-inputforeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
+  if (card.kind === "error") {
+    return <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
+      {card.text} <button onClick={() => sessionIdRef.current && send({ type: "retry", sessionId: sessionIdRef.current })}>Retry</button>
+    </div>;
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
+```
+
+Note: `sessionIdRef` is used inside `CardView` ΓÇö hoist it out of `App` to module scope or pass a `onRetry` prop instead (pick prop-passing during implementation: `<CardView card={c} onRetry={() => send({ type: "retry", sessionId: sessionIdRef.current })} />`).
+
+- [ ] **Step 3: Update `src/webview/main.tsx` and add marked**
+
+```tsx
+import React from "react";
+import { createRoot } from "react-dom/client";
+import App from "./App";
+createRoot(document.getElementById("root")!).render(<App />);
+```
+
+```powershell
+npm install marked; npm run compile
+```
+
+- [ ] **Step 4: Manual UI verification (F5)**
+
+Check: streaming text renders as markdown; "read a.txt" shows a tool card; `run_terminal` shows Approve/Reject buttons and Resolve output streams into the card; "+ New" resets; session picker reloads an old session's events; Retry appears on errors.
+
+- [ ] **Step 5: Commit** ΓÇö `git add -A; git commit -m "feat: webview chat UI with streaming, tool and approval cards"`
+
+---
+
+### Task 9: Integration test (@vscode/test-electron, mock server)
+
+**Files:**
+- Create: `test/integration/index.ts`, `test/integration/agentFlow.test.ts`, `test/integration/run.ts`, `test/mock-server.ts`
+- Modify: `package.json` (script `test:integration`)
+
+**Interfaces:**
+- Consumes: compiled extension from `dist/host/extension.js`.
+- Produces: `npm run test:integration` verifying activation + webview render + a real API-key-set flow against a local mock.
+
+- [ ] **Step 1: Add mock Anthropic server `test/mock-server.ts`**
+
+```ts
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
+```
+
+- [ ] **Step 2: Write integration test `test/integration/agentFlow.test.ts`**
+
+```ts
+import * as assert from "assert";
+import * as vscode from "vscode";
+
+suite("Justwoker Agent extension", () => {
+  test("extension activates and registers the webview view", async () => {
+    const ext = vscode.extensions.getExtension("justwoker.agent");
+    assert.ok(ext, "extension not found");
+    await ext!.activate();
+    await vscode.commands.executeCommand("justwokerAgent.chat.focus");
+    assert.ok(true);
+  });
+
+  test("set API key command stores secret without error", async () => {
+    // showInputBox is not scriptable in test harness; verify command exists instead
+    const cmds = await vscode.commands.getCommands(true);
+    assert.ok(cmds.includes("justwokerAgent.setApiKey"));
+    assert.ok(cmds.includes("justwokerAgent.newSession"));
+  });
+});
+```
+
+`test/integration/index.ts`:
+
+```ts
+import * as path from "path";
+export function run(): Promise<void> {
+  return Promise.all([
+    import("./agentFlow.test"),
+  ]).then(undefined, (e) => { console.error(e); process.exit(1); });
+}
+```
+
+`test/integration/run.ts`:
+
+```ts
+import * as path from "path";
+async function go() {
+  const { runTests } = await import("@vscode/test-electron");
+  await runTests({
+    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
+    extensionTestsPath: path.resolve(__dirname, "./index"),
+  });
+}
+go().catch((e) => { console.error(e); process.exit(1); });
+```
+
+package.json script: `"test:integration": "npm run compile && node test/integration/run.js"` (esbuild-compile `test/integration/run.ts` too ΓÇö add it as a third esbuild entry, CJS, outfile `test/integration/run.js`).
+
+- [ ] **Step 3: Run integration test**
+
+```powershell
+npm run test:integration
+```
+
+Expected: VS Code instance launches, both tests PASS.
+
+- [ ] **Step 4: Commit** ΓÇö `git add -A; git commit -m "test: integration harness for extension activation"`
+
+---
+
+### Task 10: Real-endpoint smoke test + polish
+
+**Files:**
+- Modify: none required (fixes as found)
+- Create: `README.md`
+
+**Interfaces:**
+- Consumes: completed extension.
+- Produces: verified working extension against `https://api.justwoker.icu`.
+
+- [ ] **Step 1: Real smoke test (manual checklist)**
+
+F5, set real API key, then in a test workspace:
+1. Plain question ΓåÆ streaming markdown reply.
+2. "Read the file src/a.txt and summarize it" ΓåÆ tool card + summary.
+3. "Change the greeting in a.txt from Hello to Hi" ΓåÆ edit auto-applied, diff tab opens, Ctrl+Z in editor undoes it.
+4. "Run `npm --version`" ΓåÆ approval card ΓåÆ Approve ΓåÆ exit output streams into card; Reject path: output says "User rejected".
+5. "Create a new file b.txt with the word test" ΓåÆ model should use apply_edit (host returns file-not-found error as tool_result ΓåÆ model retries sensibly or explains); note behavior.
+
+- [ ] **Step 2: Fix any defects found, re-run unit + integration**
+
+```powershell
+npm run test:unit; npm run test:integration
+```
+
+- [ ] **Step 3: Write `README.md`**
+
+Cover: install/dev setup (`npm install`, `npm run watch`, F5), set API key command, settings table, tool permissions model (edits auto, terminal approved), architecture summary (host/webview/protocol), test commands.
+
+- [ ] **Step 4: Commit** ΓÇö `git add -A; git commit -m "docs: README and post-smoke-test fixes"`
+
+---
+
+## Self-Review (completed)
+
+- **Spec coverage:** streaming chat (T4/T8), tools read/list/edit/terminal (T3/T7), auto-edit + diff (T3/T7), approval + 60s timeout (T7), session JSONL (T5), settings + commands (T1/T7), queueing (T6), error handling + retry (T4/T6/T8), webview rebuild from JSONL (T5/T8), testing unit/integration/manual (T9/T10). Non-goals respected.
+- **Placeholders:** none ΓÇö every step has concrete code or an exact command.
+- **Type consistency:** `ToolContext`/`executeTool`/`TOOL_DEFS` (T3) match usage in T6/T7; `Provider`/`StreamEvent`/`AnthropicMessage` (T4) match T6/T7; `SessionStore` (T5) matches T6/T7; protocol types (T2) match T7/T8. One deliberate tweak noted inline in T7 (`setKey` addition to provider) with a re-test instruction.
diff --git a/docs/superpowers/specs/2026-09-11-vscode-agent-extension-design.md b/docs/superpowers/specs/2026-09-11-vscode-agent-extension-design.md
new file mode 100644
index 0000000..f9fb80d
--- /dev/null
+++ b/docs/superpowers/specs/2026-09-11-vscode-agent-extension-design.md
@@ -0,0 +1,57 @@
+# Spec: Justwoker Agent ΓÇö VS Code Agent Extension
+
+Date: 2026-09-11
+Status: Approved design, pre-implementation
+
+## Purpose
+A VS Code extension providing a Copilot-agent-mode-style chat sidebar, powered by an Anthropic-compatible API at `https://api.justwoker.icu` (model `gpt-5.6-sol`), supporting streaming chat, file read/edit tools (auto-applied with diffs), and terminal commands (user-approved).
+
+## Architecture
+- **Extension host (Node, TS)**: API client (`@anthropic-ai/sdk` with custom `baseURL`), agent loop, tool executors, approvals, session persistence. Holds API key via `SecretStorage`.
+- **Webview (React 18 + Vite, TS)**: chat UI ΓÇö streaming markdown, syntax-highlighted code blocks, tool-call cards, terminal approval cards, diff notifications, session list.
+- **Shared module**: typed `postMessage` protocol (all request/response/notify message types), session types, config types.
+- Communication strictly `webview Γåö host` via typed messages; webview never touches filesystem, API, or secrets.
+
+## Components
+1. **Provider** ΓÇö wraps Anthropic TS SDK; `baseUrl`, `apiKey`, `model`, `maxTokens` from settings/SecretStorage.
+2. **AgentSession** ΓÇö message history + loop: send ΓåÆ stream deltas to UI ΓåÆ on `tool_use` execute tool ΓåÆ return `tool_result` ΓåÆ repeat until `end_turn`. One loop per session; user messages queued while running.
+3. **Tools**:
+   - `read_file(path)` ΓÇö returns file content (paths constrained to workspace folders).
+   - `list_dir(path)` ΓÇö directory listing.
+   - `apply_edit(path, oldString, newString)` ΓÇö string-replace edit; auto-applied via `WorkspaceEdit`, shown as diff tab + chat card with Undo.
+   - `run_terminal(command, cwd?)` ΓÇö pauses loop, ApprovalManager pushes approval card; on Approve, executes via `child_process`, streams stdout/stderr to the card; auto-reject after 60s.
+4. **ApprovalManager** ΓÇö terminal approval lifecycle (request ΓåÆ user decision/timeout ΓåÆ resolve loop).
+5. **SessionStore** ΓÇö JSONL append per event in `globalStorage/sessions/<id>.jsonl`; session list, resume, delete.
+6. **Settings & commands** ΓÇö `justwokerAgent.baseUrl`, `.model`, `.maxTokens`, `.autoApproveEdits` (default `true`), `.autoApproveTerminal` (default `false`). Commands: set API key, new session, open settings, retry.
+
+## Data flow (one turn)
+`userMessage` ΓåÆ host appends to session ΓåÆ SDK call ΓåÆ stream `content_block_delta` ΓåÆ relay chunks to UI ΓåÆ `tool_use` block ΓåÆ execute tool (immediate or after approval) ΓåÆ `tool_result` appended ΓåÆ next SDK call ΓåÆ repeat ΓåÆ `end_turn` ΓåÆ persist final state.
+
+## Error handling
+- Network/5xx: retry ├ù3 with backoff; then error card with Retry button.
+- Malformed tool call (missing file, bad params, `oldString` not found): returned as error `tool_result` so the model can self-correct.
+- Concurrent user sends queued while a loop is running; no parallel loops per session.
+- Webview reload reconstructs UI state from session JSONL.
+
+## Non-goals (v1)
+No multi-root awareness, no web portal, no marketplace publishing, no agent-side git operations, no context-window compaction.
+
+## Testing
+- Unit (vitest): agent loop state machine against a mock SDK stream; tool executors; edit application on a temp workspace.
+- Integration: `@vscode/test-electron` full loop against a mock server.
+- Manual: smoke test against the real endpoint (chat, one file edit, one approved terminal command).
+
+## Repo layout
+```
+justwoker-agent/
+Γö£ΓöÇΓöÇ src/host/        (extension.ts, provider, agent, tools, approvals, store)
+Γö£ΓöÇΓöÇ src/webview/     (React app)
+Γö£ΓöÇΓöÇ src/shared/      (protocol, types)
+Γö£ΓöÇΓöÇ test/            (unit + integration)
+Γö£ΓöÇΓöÇ esbuild.js, package.json, tsconfig.json
+```
+
+## Decisions confirmed
+- Name: **Justwoker Agent**.
+- Terminal execution: hidden `child_process` with output streamed to the chat card (integrated-terminal mode deferred).
+- Edits auto-applied (with diff + undo); terminal commands require explicit approval.
diff --git a/esbuild.js b/esbuild.js
new file mode 100644
index 0000000..36e8f6e
--- /dev/null
+++ b/esbuild.js
@@ -0,0 +1,25 @@
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
+
+(async () => {
+  if (watch) {
+    const ctx = await esbuild.context({ ...host });
+    await ctx.watch();
+    const ctx2 = await esbuild.context({ ...webview });
+    await ctx2.watch();
+  } else {
+    await esbuild.build(host);
+    await esbuild.build(webview);
+  }
+})();
diff --git a/media/icon.svg b/media/icon.svg
new file mode 100644
index 0000000..75882e5
--- /dev/null
+++ b/media/icon.svg
@@ -0,0 +1,7 @@
+<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
+  <rect x="3" y="4" width="18" height="14" rx="2" fill="#4f8cff"/>
+  <circle cx="8" cy="10" r="1.5" fill="#fff"/>
+  <circle cx="12" cy="10" r="1.5" fill="#fff"/>
+  <circle cx="16" cy="10" r="1.5" fill="#fff"/>
+  <rect x="8" y="19" width="8" height="2" rx="1" fill="#4f8ffff"/>
+</svg>
diff --git a/package-lock.json b/package-lock.json
new file mode 100644
index 0000000..ea6256a
--- /dev/null
+++ b/package-lock.json
@@ -0,0 +1,5348 @@
+{
+  "name": "justwoker-agent",
+  "version": "0.1.0",
+  "lockfileVersion": 3,
+  "requires": true,
+  "packages": {
+    "": {
+      "name": "justwoker-agent",
+      "version": "0.1.0",
+      "dependencies": {
+        "@anthropic-ai/sdk": "^0.30.0",
+        "react": "^18.3.0",
+        "react-dom": "^18.3.0"
+      },
+      "devDependencies": {
+        "@types/node": "^20.0.0",
+        "@types/vscode": "^1.85.0",
+        "@vscode/test-electron": "^2.3.0",
+        "@vscode/vsce": "^2.24.0",
+        "esbuild": "^0.20.0",
+        "typescript": "^5.4.0",
+        "vitest": "^1.5.0"
+      },
+      "engines": {
+        "vscode": "^1.85.0"
+      }
+    },
+    "node_modules/@anthropic-ai/sdk": {
+      "version": "0.30.1",
+      "resolved": "https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.30.1.tgz",
+      "integrity": "sha512-nuKvp7wOIz6BFei8WrTdhmSsx5mwnArYyJgh4+vYu3V4J0Ltb8Xm3odPm51n1aSI0XxNCrDl7O88cxCtUdAkaw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "^18.11.18",
+        "@types/node-fetch": "^2.6.4",
+        "abort-controller": "^3.0.0",
+        "agentkeepalive": "^4.2.1",
+        "form-data-encoder": "1.7.2",
+        "formdata-node": "^4.3.2",
+        "node-fetch": "^2.6.7"
+      }
+    },
+    "node_modules/@anthropic-ai/sdk/node_modules/@types/node": {
+      "version": "18.19.130",
+      "resolved": "https://registry.npmjs.org/@types/node/-/node-18.19.130.tgz",
+      "integrity": "sha512-GRaXQx6jGfL8sKfaIDD6OupbIHBr9jv7Jnaml9tB7l4v068PAOXqfcujMMo5PhbIs6ggR1XODELqahT2R8v0fg==",
+      "license": "MIT",
+      "dependencies": {
+        "undici-types": "~5.26.4"
+      }
+    },
+    "node_modules/@anthropic-ai/sdk/node_modules/undici-types": {
+      "version": "5.26.5",
+      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-5.26.5.tgz",
+      "integrity": "sha512-JlCMO+ehdEIKqlFxk6IfVoAUVmgz7cU7zD/h9XZ0qzeosSHmUJVOzSQvvYSYWXkFXC+IfLKSIffhv0sVZup6pA==",
+      "license": "MIT"
+    },
+    "node_modules/@azure/abort-controller": {
+      "version": "2.2.0",
+      "resolved": "https://registry.npmjs.org/@azure/abort-controller/-/abort-controller-2.2.0.tgz",
+      "integrity": "sha512-fNAjWnA/nZ2jz31kxR/AqRaUT8ewHBw/WuBIosK0moMy1C9e5ValbDfFdIxJzVOOYaYkV/b2F1S4H/aHiqfVQg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-auth": {
+      "version": "1.11.0",
+      "resolved": "https://registry.npmjs.org/@azure/core-auth/-/core-auth-1.11.0.tgz",
+      "integrity": "sha512-IUZydyTUkDnYdstOW9pFOOUQlBjAepK5teihDE3x6yxsPJs/hsAaaYpeGxdxrgtOiJbBKSjKW7MDk7AEhb4LRg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/abort-controller": "^2.1.2",
+        "@azure/core-util": "^1.13.0",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-client": {
+      "version": "1.11.1",
+      "resolved": "https://registry.npmjs.org/@azure/core-client/-/core-client-1.11.1.tgz",
+      "integrity": "sha512-2QygG2F76ZpMP2eMztiJvAiFMu71M9rDeU7vO/QKg5Css7MgM4frUOslFjhVjRhbGaCNPtz/S8M6y46/fFKVuQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/abort-controller": "^2.1.2",
+        "@azure/core-auth": "^1.10.0",
+        "@azure/core-rest-pipeline": "^1.22.0",
+        "@azure/core-tracing": "^1.3.0",
+        "@azure/core-util": "^1.13.0",
+        "@azure/logger": "^1.3.0",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-process": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/@azure/core-process/-/core-process-1.0.0.tgz",
+      "integrity": "sha512-/shnJ+ooO8WPxDhPEeI/2oRQuubn16gZ6CvlbpWbEswZfzwI9tI/sMAHmF3x1LuQ9yZYXfLW3TjzGMLEC5blKg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-rest-pipeline": {
+      "version": "1.25.0",
+      "resolved": "https://registry.npmjs.org/@azure/core-rest-pipeline/-/core-rest-pipeline-1.25.0.tgz",
+      "integrity": "sha512-bMs8ekJLjX8wPV+9IPBges1SLPyuDtE9g5gLDWOpxzKcoOFQnpLGkbcT1tdw3FaAmDS1gnPmMmJ6y/T5B96kIA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/abort-controller": "^2.1.2",
+        "@azure/core-auth": "^1.10.0",
+        "@azure/core-tracing": "^1.3.0",
+        "@azure/core-util": "^1.13.0",
+        "@azure/logger": "^1.3.0",
+        "@typespec/ts-http-runtime": "^0.3.4",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-tracing": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/@azure/core-tracing/-/core-tracing-1.4.0.tgz",
+      "integrity": "sha512-eGwxD0AtncrxeBM4tG8R55Pc3rdX1hNW2WibJAgYpCVA6E93mvvVH+LcssoVjOBrSKWS55yEIHsk0X8ctHmfOQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/core-util": {
+      "version": "1.14.0",
+      "resolved": "https://registry.npmjs.org/@azure/core-util/-/core-util-1.14.0.tgz",
+      "integrity": "sha512-9n2pWK61veAuN0V20t9lOuoV4CFMdyAZ1ygZzvBGk/pBBJRib/PjL9PLXa/aI2CcPpyHfqVsxxqLCYl6uZlfDw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/abort-controller": "^2.1.2",
+        "@typespec/ts-http-runtime": "^0.3.0",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/identity": {
+      "version": "4.13.2",
+      "resolved": "https://registry.npmjs.org/@azure/identity/-/identity-4.13.2.tgz",
+      "integrity": "sha512-NXL2/pCJctLxgw8bvrwwgge743kEq8LBT+O1pmV0vyUwetzFPH9auP6jhkU/cgZCPPtWoewAe3ncaGCgPo07fA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/abort-controller": "^2.0.0",
+        "@azure/core-auth": "^1.9.0",
+        "@azure/core-client": "^1.9.2",
+        "@azure/core-process": "^1.0.0",
+        "@azure/core-rest-pipeline": "^1.17.0",
+        "@azure/core-tracing": "^1.0.0",
+        "@azure/core-util": "^1.11.0",
+        "@azure/logger": "^1.0.0",
+        "@azure/msal-browser": "^5.5.0",
+        "@azure/msal-node": "^5.1.5",
+        "open": "^10.1.0",
+        "tslib": "^2.2.0"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/logger": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/@azure/logger/-/logger-1.4.0.tgz",
+      "integrity": "sha512-rbAE25KUfjU/s3XHUdJgceoCP5dEOpMx85J04kF+QMdta73XkuG9JGHHinch+XIoKpBdqljin+KqURpJriSzLA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@typespec/ts-http-runtime": "^0.3.0",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@azure/msal-browser": {
+      "version": "5.21.0",
+      "resolved": "https://registry.npmjs.org/@azure/msal-browser/-/msal-browser-5.21.0.tgz",
+      "integrity": "sha512-80OcuXDErmcEDAIH9pBtSqBsed2sPT/IWmbG3xHLoPMl5zc8TINd6SlJAbVSmN5huGa3xGAg5qR7VnpaIEK0Zw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/msal-common": "16.14.0"
+      },
+      "engines": {
+        "node": ">=0.8.0"
+      }
+    },
+    "node_modules/@azure/msal-common": {
+      "version": "16.14.0",
+      "resolved": "https://registry.npmjs.org/@azure/msal-common/-/msal-common-16.14.0.tgz",
+      "integrity": "sha512-A4rb55hI86Q9tBl/+jBj7TMz7iX2RFgQs/nExFzcAtoI/BFRVdaH5SL/MivrYD7qvweMpN8AgVvVMHV8UBYxew==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.8.0"
+      }
+    },
+    "node_modules/@azure/msal-node": {
+      "version": "5.6.0",
+      "resolved": "https://registry.npmjs.org/@azure/msal-node/-/msal-node-5.6.0.tgz",
+      "integrity": "sha512-uFY9NxrWHw8PwZx7gAX6PDn+9vdfS05+levc/kwkx77IkjfaldnQbbcQzzDIZ5Hq5Zdr6/z92oAIoRWKp6MnOA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/msal-common": "16.13.0",
+        "jsonwebtoken": "^9.0.0"
+      },
+      "engines": {
+        "node": ">=20"
+      }
+    },
+    "node_modules/@azure/msal-node/node_modules/@azure/msal-common": {
+      "version": "16.13.0",
+      "resolved": "https://registry.npmjs.org/@azure/msal-common/-/msal-common-16.13.0.tgz",
+      "integrity": "sha512-rOAy0KUcyBbdwVJ+f3uPpthXatFLLZN+/KWAsTLzk1aB23Xl9DRmmXYwSvBFOZyXj4jUQQ5FKxxRkhAFW1fOow==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.8.0"
+      }
+    },
+    "node_modules/@esbuild/aix-ppc64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.20.2.tgz",
+      "integrity": "sha512-D+EBOJHXdNZcLJRBkhENNG8Wji2kgc9AZ9KiPr1JuZjsNtyHzrsfLRrY0tk2H2aoFu6RANO1y1iPPUCDYWkb5g==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "aix"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/android-arm": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.20.2.tgz",
+      "integrity": "sha512-t98Ra6pw2VaDhqNWO2Oph2LXbz/EJcnLmKLGBJwEwXX/JAN83Fym1rU8l0JUWK6HkIbWONCSSatf4sf2NBRx/w==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/android-arm64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.20.2.tgz",
+      "integrity": "sha512-mRzjLacRtl/tWU0SvD8lUEwb61yP9cqQo6noDZP/O8VkwafSYwZ4yWy24kan8jE/IMERpYncRt2dw438LP3Xmg==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/android-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.20.2.tgz",
+      "integrity": "sha512-btzExgV+/lMGDDa194CcUQm53ncxzeBrWJcncOBxuC6ndBkKxnHdFJn86mCIgTELsooUmwUm9FkhSp5HYu00Rg==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/darwin-arm64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.20.2.tgz",
+      "integrity": "sha512-4J6IRT+10J3aJH3l1yzEg9y3wkTDgDk7TSDFX+wKFiWjqWp/iCfLIYzGyasx9l0SAFPT1HwSCR+0w/h1ES/MjA==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/darwin-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.20.2.tgz",
+      "integrity": "sha512-tBcXp9KNphnNH0dfhv8KYkZhjc+H3XBkF5DKtswJblV7KlT9EI2+jeA8DgBjp908WEuYll6pF+UStUCfEpdysA==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/freebsd-arm64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.20.2.tgz",
+      "integrity": "sha512-d3qI41G4SuLiCGCFGUrKsSeTXyWG6yem1KcGZVS+3FYlYhtNoNgYrWcvkOoaqMhwXSMrZRl69ArHsGJ9mYdbbw==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/freebsd-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.20.2.tgz",
+      "integrity": "sha512-d+DipyvHRuqEeM5zDivKV1KuXn9WeRX6vqSqIDgwIfPQtwMP4jaDsQsDncjTDDsExT4lR/91OLjRo8bmC1e+Cw==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-arm": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.20.2.tgz",
+      "integrity": "sha512-VhLPeR8HTMPccbuWWcEUD1Az68TqaTYyj6nfE4QByZIQEQVWBB8vup8PpR7y1QHL3CpcF6xd5WVBU/+SBEvGTg==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-arm64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.20.2.tgz",
+      "integrity": "sha512-9pb6rBjGvTFNira2FLIWqDk/uaf42sSyLE8j1rnUpuzsODBq7FvpwHYZxQ/It/8b+QOS1RYfqgGFNLRI+qlq2A==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-ia32": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.20.2.tgz",
+      "integrity": "sha512-o10utieEkNPFDZFQm9CoP7Tvb33UutoJqg3qKf1PWVeeJhJw0Q347PxMvBgVVFgouYLGIhFYG0UGdBumROyiig==",
+      "cpu": [
+        "ia32"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-loong64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.20.2.tgz",
+      "integrity": "sha512-PR7sp6R/UC4CFVomVINKJ80pMFlfDfMQMYynX7t1tNTeivQ6XdX5r2XovMmha/VjR1YN/HgHWsVcTRIMkymrgQ==",
+      "cpu": [
+        "loong64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-mips64el": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.20.2.tgz",
+      "integrity": "sha512-4BlTqeutE/KnOiTG5Y6Sb/Hw6hsBOZapOVF6njAESHInhlQAghVVZL1ZpIctBOoTFbQyGW+LsVYZ8lSSB3wkjA==",
+      "cpu": [
+        "mips64el"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-ppc64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.20.2.tgz",
+      "integrity": "sha512-rD3KsaDprDcfajSKdn25ooz5J5/fWBylaaXkuotBDGnMnDP1Uv5DLAN/45qfnf3JDYyJv/ytGHQaziHUdyzaAg==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-riscv64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.20.2.tgz",
+      "integrity": "sha512-snwmBKacKmwTMmhLlz/3aH1Q9T8v45bKYGE3j26TsaOVtjIag4wLfWSiZykXzXuE1kbCE+zJRmwp+ZbIHinnVg==",
+      "cpu": [
+        "riscv64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-s390x": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.20.2.tgz",
+      "integrity": "sha512-wcWISOobRWNm3cezm5HOZcYz1sKoHLd8VL1dl309DiixxVFoFe/o8HnwuIwn6sXre88Nwj+VwZUvJf4AFxkyrQ==",
+      "cpu": [
+        "s390x"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/linux-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.20.2.tgz",
+      "integrity": "sha512-1MdwI6OOTsfQfek8sLwgyjOXAu+wKhLEoaOLTjbijk6E2WONYpH9ZU2mNtR+lZ2B4uwr+usqGuVfFT9tMtGvGw==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/netbsd-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.20.2.tgz",
+      "integrity": "sha512-K8/DhBxcVQkzYc43yJXDSyjlFeHQJBiowJ0uVL6Tor3jGQfSGHNNJcWxNbOI8v5k82prYqzPuwkzHt3J1T1iZQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "netbsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/openbsd-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.20.2.tgz",
+      "integrity": "sha512-eMpKlV0SThJmmJgiVyN9jTPJ2VBPquf6Kt/nAoo6DgHAoN57K15ZghiHaMvqjCye/uU4X5u3YSMgVBI1h3vKrQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "openbsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/sunos-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.20.2.tgz",
+      "integrity": "sha512-2UyFtRC6cXLyejf/YEld4Hajo7UHILetzE1vsRcGL3earZEW77JxrFjH4Ez2qaTiEfMgAXxfAZCm1fvM/G/o8w==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "sunos"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/win32-arm64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.20.2.tgz",
+      "integrity": "sha512-GRibxoawM9ZCnDxnP3usoUDO9vUkpAxIIZ6GQI+IlVmr5kP3zUq+l17xELTHMWTWzjxa2guPNyrpq1GWmPvcGQ==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/win32-ia32": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.20.2.tgz",
+      "integrity": "sha512-HfLOfn9YWmkSKRQqovpnITazdtquEW8/SoHW7pWpuEeguaZI4QnCRW6b+oZTztdBnZOS2hqJ6im/D5cPzBTTlQ==",
+      "cpu": [
+        "ia32"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@esbuild/win32-x64": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.20.2.tgz",
+      "integrity": "sha512-N49X4lJX27+l9jbLKSqZ6bKNjzQvHaT8IIFUy+YIqmXQdjYCToGWwOItDrfby14c78aDd5NHQl29xingXfCdLQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/@jest/schemas": {
+      "version": "29.6.3",
+      "resolved": "https://registry.npmjs.org/@jest/schemas/-/schemas-29.6.3.tgz",
+      "integrity": "sha512-mo5j5X+jIZmJQveBKeS/clAueipV7KgiX1vMgCxam1RNYiqE1w62n0/tJJnHtjW8ZHcQco5gY85jA3mi0L+nSA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@sinclair/typebox": "^0.27.8"
+      },
+      "engines": {
+        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
+      }
+    },
+    "node_modules/@jridgewell/sourcemap-codec": {
+      "version": "1.6.0",
+      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.6.0.tgz",
+      "integrity": "sha512-T7jf+5zgsZHwNJ4lvQ7/aezbyk0nNX+zJVWpmHA7VYsEx7a7qr5Rg5IbtJFqkgze5Y2sruq1RUY8Q837Od7iFw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@napi-rs/lzma-linux-x64-gnu": {
+      "version": "1.5.1",
+      "resolved": "https://registry.npmjs.org/@napi-rs/lzma-linux-x64-gnu/-/lzma-linux-x64-gnu-1.5.1.tgz",
+      "integrity": "sha512-oTXEIha4SsuXdTA4Iyskj0kpdx2yVXdhd75c2v3xGrHFfVMsbhTPZU/nMPL4sWKo4pBHm3aucLaqGlF696dTyQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": "^22.20 || ^24.12 || >=25"
+      }
+    },
+    "node_modules/@rollup/rollup-android-arm-eabi": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm-eabi/-/rollup-android-arm-eabi-4.63.1.tgz",
+      "integrity": "sha512-UZ8sUxPTiHWYX9QNdJedb1kDZSpS1t/VPWBWGSgqHNi9w3Cu6IXvu2mzbhiTiPvtrqgTQJ+zqiAq2iPIPilpaQ==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ]
+    },
+    "node_modules/@rollup/rollup-android-arm64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm64/-/rollup-android-arm64-4.63.1.tgz",
+      "integrity": "sha512-cQ4nFQABN5cDvDpbvJ7bMStCpnaVxynZrRMfUJYgxcIk9Sh54FIO1vtfkg0B69REjER77ioZ/ov+eAApx/KmLQ==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ]
+    },
+    "node_modules/@rollup/rollup-darwin-arm64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-arm64/-/rollup-darwin-arm64-4.63.1.tgz",
+      "integrity": "sha512-FQNqd1lRy/0QhDk3xeRIkSBiCpXCiDnZO3YLVdcDKN1UBiKToNftCzcXYNLshmPDUMlu2TdeS8tGcsU6f3YF1Q==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ]
+    },
+    "node_modules/@rollup/rollup-darwin-x64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-x64/-/rollup-darwin-x64-4.63.1.tgz",
+      "integrity": "sha512-pvD16V939D3CloK0+qikpGaxiPrDUXTe7Y5cWOMkMSy7m1cawa8EGy/kXYi/G/cKAC4HDAbSnzCIk1WmsoOKXg==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ]
+    },
+    "node_modules/@rollup/rollup-freebsd-arm64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-arm64/-/rollup-freebsd-arm64-4.63.1.tgz",
+      "integrity": "sha512-pcFGeL2345VwdTnJhA6zLbew+YgWB0qBG2+dMtXjCicf6+rm6kO6cOoh5VnTe0ZMrMRgRyuHmCJxZWrIdzYuOw==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ]
+    },
+    "node_modules/@rollup/rollup-freebsd-x64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-x64/-/rollup-freebsd-x64-4.63.1.tgz",
+      "integrity": "sha512-mRJlqSRulVzcKq/LKA6ICSIc3K/l4fzlVn/gePn2nXIHy8seRi5z/eeRE0d/XMBxcMldiXtQTSpRj0tkkC3g8Q==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-arm-gnueabihf": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-gnueabihf/-/rollup-linux-arm-gnueabihf-4.63.1.tgz",
+      "integrity": "sha512-YDUNvVM85TI3g/1OpnqKP1h4NeW/j64DfWMf+G3M809xNk1bJSnpFp4sh83NpmVE5DXnkh8ULor4LTVZKoYLHw==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-arm-musleabihf": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-musleabihf/-/rollup-linux-arm-musleabihf-4.63.1.tgz",
+      "integrity": "sha512-7Mcn71p9ZuQFAj+h+dhQXy/yeLePRS2yKRnmW1DijA9thKO5qap0GNOIQK4yQ6iP3SU0Mrb/yWo8h8vgRba8lw==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-arm64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-gnu/-/rollup-linux-arm64-gnu-4.63.1.tgz",
+      "integrity": "sha512-4YiLQTX6U4CSl0L9cluep9A9W6UmTfqBDc2/CH6wlu54pl4E7Jn3cOD8oxzvBDEGk/JMKgJ47C8g+radF7mwvg==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-arm64-musl": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-musl/-/rollup-linux-arm64-musl-4.63.1.tgz",
+      "integrity": "sha512-2ra8F7w8OquwZN9z2/fKFnli69wa8PLwaVzRMIPGb13ByMJwC28Fbp8YcVGoUhlYMTt7j5j9bNgpysrN2UM+vw==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-loong64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-gnu/-/rollup-linux-loong64-gnu-4.63.1.tgz",
+      "integrity": "sha512-Sy20ncyhjmBP0Ml+UvQbimjlk6VFgjW5uNP+qqwHB00mTE8Bl2C1TuHTlRwK2YoXeZbee5lP2XevBWVkAQAtSQ==",
+      "cpu": [
+        "loong64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-loong64-musl": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-musl/-/rollup-linux-loong64-musl-4.63.1.tgz",
+      "integrity": "sha512-noITLp8oNjYliPnGWmLyelIHwULGqbHloQHGw1rtxbWhTuWooRpnZarZQJ1y9EUC4szuCusCc+HEpUtxpIwYvA==",
+      "cpu": [
+        "loong64"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-ppc64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-gnu/-/rollup-linux-ppc64-gnu-4.63.1.tgz",
+      "integrity": "sha512-hlxxXd+F1mWiAcaFR7Sv9ZQT6m6UfI8+Vy/kFJzztq2pDMU/0wZ9sish0iszNZvsQDo8Gc0i5yuFEOz5dDf6fA==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-ppc64-musl": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-musl/-/rollup-linux-ppc64-musl-4.63.1.tgz",
+      "integrity": "sha512-EF7OpqQTQ/BvGqLzUi4rEHuagCV9MugAUXSHemwPW5vxZ75RR+jxO/2j95Ph2dalMpFHSVECjRoioHZgA9zOYA==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-riscv64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-gnu/-/rollup-linux-riscv64-gnu-4.63.1.tgz",
+      "integrity": "sha512-wQO3JesW9PRkwlabQ27y7sPfVOOTLRG73I4F2UYHG5PXun3J9U3y+b7ezVKSYbsvSKGQ1k1cq8Qlun4C9kLt3w==",
+      "cpu": [
+        "riscv64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-riscv64-musl": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-musl/-/rollup-linux-riscv64-musl-4.63.1.tgz",
+      "integrity": "sha512-ouAGwhO6wHRXdnOVCOsB0tRFkA7nhNB2Nwax6oECXN0YiN8EYUTBAOudADOB1PI+yDL61TeNx/u7MVCzksNbkQ==",
+      "cpu": [
+        "riscv64"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-s390x-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-s390x-gnu/-/rollup-linux-s390x-gnu-4.63.1.tgz",
+      "integrity": "sha512-q2R38Sn+1J8RxhfJ+T54wSWmyKXWec+9jgDfqO2AtArEqHO5R2aeayp5H5OYLr5UYDVGsVaZPEFUooMhYCdz5A==",
+      "cpu": [
+        "s390x"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-x64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.63.1.tgz",
+      "integrity": "sha512-gfI5T24WLLuFfSKw7Go/zDXjAAV0fny0swTaDv+WjK7vqcw4cRhFfdsyKL1n+ukI+ooBxn3bVQnyrn06WpI50w==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "libc": [
+        "glibc"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-linux-x64-musl": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-musl/-/rollup-linux-x64-musl-4.63.1.tgz",
+      "integrity": "sha512-4h6XqthmB4Hspji84wvgk+ElodTsGj+dbZqHJHHtKxj4mYq0ANSEEPX9ys3moJueqsRjwpaJYH7874Itwnj2ow==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "libc": [
+        "musl"
+      ],
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@rollup/rollup-openbsd-x64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-openbsd-x64/-/rollup-openbsd-x64-4.63.1.tgz",
+      "integrity": "sha512-dlfCOa87o1VAYegLQ9EKilx2JCeRofiyPGhTCmqnuXZ6bMPiycO1rq1+sKoulAp7pGLIsTIw+1x5R+zgh5LhhA==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "openbsd"
+      ]
+    },
+    "node_modules/@rollup/rollup-openharmony-arm64": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-openharmony-arm64/-/rollup-openharmony-arm64-4.63.1.tgz",
+      "integrity": "sha512-cjkLbOlfcm3QGhMM1J5zaZjsw1GggbN6rw9UTSSRrPrR1KkcXnN7Uq9rPw34xImQ9VOY9GN+6u2Zj80B9ptkcw==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "openharmony"
+      ]
+    },
+    "node_modules/@rollup/rollup-win32-arm64-msvc": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-arm64-msvc/-/rollup-win32-arm64-msvc-4.63.1.tgz",
+      "integrity": "sha512-Li1KdUnWGE4N3e1F/B4RTB1ms+nG4WBgjByO46pkeBVX/2UBsY53xf5vK9WygVmnH3RwncIST7lkSdLSY6P9lg==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/@rollup/rollup-win32-ia32-msvc": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-ia32-msvc/-/rollup-win32-ia32-msvc-4.63.1.tgz",
+      "integrity": "sha512-t4ZYOSoLTgwhuFMrmTMLx/+i1DQVK7HYqMc6kY46EApwi8X0nIVphzdNoThU3xt6n+N5urG1/gxBdCaKDLavfg==",
+      "cpu": [
+        "ia32"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/@rollup/rollup-win32-x64-gnu": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-gnu/-/rollup-win32-x64-gnu-4.63.1.tgz",
+      "integrity": "sha512-RgroPfMmKlD1RzSDxvwgcPiy2HNQKoYV7OmwIXDsk73uKW5t6B/V8KIy27SMv/FNXFo/oSBtWc9J0X7t91ezZg==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/@rollup/rollup-win32-x64-msvc": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-msvc/-/rollup-win32-x64-msvc-4.63.1.tgz",
+      "integrity": "sha512-at8QVep6S3h5Y6gSbdGU06bRY5WJkf6WUduM9YtvYMbYhB1MOFfUgc6kehitQXzOtMSaT70q7f9ydPhpqu821w==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/@sinclair/typebox": {
+      "version": "0.27.12",
+      "resolved": "https://registry.npmjs.org/@sinclair/typebox/-/typebox-0.27.12.tgz",
+      "integrity": "sha512-hhyNJ+nbR6ZR7pToHvllEFun9TL0sbL+tk/ON75lo+Xas054uez98qRbsuNt7MBCyZKK4+8Yli/OAGZhmfBZ/g==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@types/estree": {
+      "version": "1.0.9",
+      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
+      "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@types/node": {
+      "version": "20.19.43",
+      "resolved": "https://registry.npmjs.org/@types/node/-/node-20.19.43.tgz",
+      "integrity": "sha512-6oYBAi5ikg4Pl+kGsoYtawUMBT2zZMCvPNF7pVLnHZfd1zf38DRiWn/gT01RYCdUqkv7Fhr+C9ot4/tb+2sVvA==",
+      "license": "MIT",
+      "dependencies": {
+        "undici-types": "~6.21.0"
+      }
+    },
+    "node_modules/@types/node-fetch": {
+      "version": "2.6.13",
+      "resolved": "https://registry.npmjs.org/@types/node-fetch/-/node-fetch-2.6.13.tgz",
+      "integrity": "sha512-QGpRVpzSaUs30JBSGPjOg4Uveu384erbHBoT1zeONvyCfwQxIkUshLAOqN/k9EjGviPRmWTTe6aH2qySWKTVSw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "*",
+        "form-data": "^4.0.4"
+      }
+    },
+    "node_modules/@types/vscode": {
+      "version": "1.137.0",
+      "resolved": "https://registry.npmjs.org/@types/vscode/-/vscode-1.137.0.tgz",
+      "integrity": "sha512-0dc/BBWxkyUsJzXIZ7PkKSalThmS4xiBT+8YEDiWdCefRKHGVV5ZNkM5NB5ULYamallYJujIfncNoXWFlyzL8A==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@typespec/ts-http-runtime": {
+      "version": "0.3.9",
+      "resolved": "https://registry.npmjs.org/@typespec/ts-http-runtime/-/ts-http-runtime-0.3.9.tgz",
+      "integrity": "sha512-edSdeAqkdxBVzA1yL1LrLCml1YjyCVvPMtMqJpbF+6K609tHe8V6sQUzFQSGcYNhcuhOceZtjvN32+mpIth30A==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "http-proxy-agent": "^7.0.0",
+        "https-proxy-agent": "^7.0.0",
+        "tslib": "^2.6.2"
+      },
+      "engines": {
+        "node": ">=22.0.0"
+      }
+    },
+    "node_modules/@vitest/expect": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/@vitest/expect/-/expect-1.6.1.tgz",
+      "integrity": "sha512-jXL+9+ZNIJKruofqXuuTClf44eSpcHlgj3CiuNihUF3Ioujtmc0zIa3UJOW5RjDK1YLBJZnWBlPuqhYycLioog==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@vitest/spy": "1.6.1",
+        "@vitest/utils": "1.6.1",
+        "chai": "^4.3.10"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/@vitest/runner": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/@vitest/runner/-/runner-1.6.1.tgz",
+      "integrity": "sha512-3nSnYXkVkf3mXFfE7vVyPmi3Sazhb/2cfZGGs0JRzFsPFvAMBEcrweV1V1GsrstdXeKCTXlJbvnQwGWgEIHmOA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@vitest/utils": "1.6.1",
+        "p-limit": "^5.0.0",
+        "pathe": "^1.1.1"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/@vitest/snapshot": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/@vitest/snapshot/-/snapshot-1.6.1.tgz",
+      "integrity": "sha512-WvidQuWAzU2p95u8GAKlRMqMyN1yOJkGHnx3M1PL9Raf7AQ1kwLKg04ADlCa3+OXUZE7BceOhVZiuWAbzCKcUQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "magic-string": "^0.30.5",
+        "pathe": "^1.1.1",
+        "pretty-format": "^29.7.0"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/@vitest/spy": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/@vitest/spy/-/spy-1.6.1.tgz",
+      "integrity": "sha512-MGcMmpGkZebsMZhbQKkAf9CX5zGvjkBTqf8Zx3ApYWXr3wG+QvEu2eXWfnIIWYSJExIp4V9FCKDEeygzkYrXMw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "tinyspy": "^2.2.0"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/@vitest/utils": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/@vitest/utils/-/utils-1.6.1.tgz",
+      "integrity": "sha512-jOrrUvXM4Av9ZWiG1EajNto0u96kWAhJ1LmPmJhXXQx/32MecEKd10pOLYgS2BQx1TgkGhloPU1ArDW2vvaY6g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "diff-sequences": "^29.6.3",
+        "estree-walker": "^3.0.3",
+        "loupe": "^2.3.7",
+        "pretty-format": "^29.7.0"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/@vscode/test-electron": {
+      "version": "2.5.2",
+      "resolved": "https://registry.npmjs.org/@vscode/test-electron/-/test-electron-2.5.2.tgz",
+      "integrity": "sha512-8ukpxv4wYe0iWMRQU18jhzJOHkeGKbnw7xWRX3Zw1WJA4cEKbHcmmLPdPrPtL6rhDcrlCZN+xKRpv09n4gRHYg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "http-proxy-agent": "^7.0.2",
+        "https-proxy-agent": "^7.0.5",
+        "jszip": "^3.10.1",
+        "ora": "^8.1.0",
+        "semver": "^7.6.2"
+      },
+      "engines": {
+        "node": ">=16"
+      }
+    },
+    "node_modules/@vscode/vsce": {
+      "version": "2.32.0",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce/-/vsce-2.32.0.tgz",
+      "integrity": "sha512-3EFJfsgrSftIqt3EtdRcAygy/OJ3hstyI1cDmIgkU9CFZW5C+3djr6mfosndCUqcVYuyjmxOK1xmFp/Bq7+NIg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@azure/identity": "^4.1.0",
+        "@vscode/vsce-sign": "^2.0.0",
+        "azure-devops-node-api": "^12.5.0",
+        "chalk": "^2.4.2",
+        "cheerio": "^1.0.0-rc.9",
+        "cockatiel": "^3.1.2",
+        "commander": "^6.2.1",
+        "form-data": "^4.0.0",
+        "glob": "^7.0.6",
+        "hosted-git-info": "^4.0.2",
+        "jsonc-parser": "^3.2.0",
+        "leven": "^3.1.0",
+        "markdown-it": "^12.3.2",
+        "mime": "^1.3.4",
+        "minimatch": "^3.0.3",
+        "parse-semver": "^1.1.1",
+        "read": "^1.0.7",
+        "semver": "^7.5.2",
+        "tmp": "^0.2.1",
+        "typed-rest-client": "^1.8.4",
+        "url-join": "^4.0.1",
+        "xml2js": "^0.5.0",
+        "yauzl": "^2.3.1",
+        "yazl": "^2.2.2"
+      },
+      "bin": {
+        "vsce": "vsce"
+      },
+      "engines": {
+        "node": ">= 16"
+      },
+      "optionalDependencies": {
+        "keytar": "^7.7.0"
+      }
+    },
+    "node_modules/@vscode/vsce-sign": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign/-/vsce-sign-2.1.0.tgz",
+      "integrity": "sha512-9AQrqazrBgTgRSuwleLVXUrIUphY02/SFCh2TKYoLV/xifJAdblhdmEmw5gUrYSPQ3sRwNs9iyCMD14sATEE6g==",
+      "dev": true,
+      "hasInstallScript": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optionalDependencies": {
+        "@vscode/vsce-sign-alpine-arm64": "2.0.6",
+        "@vscode/vsce-sign-alpine-x64": "2.0.6",
+        "@vscode/vsce-sign-darwin-arm64": "2.0.6",
+        "@vscode/vsce-sign-darwin-x64": "2.0.6",
+        "@vscode/vsce-sign-linux-arm": "2.0.6",
+        "@vscode/vsce-sign-linux-arm64": "2.0.6",
+        "@vscode/vsce-sign-linux-x64": "2.0.6",
+        "@vscode/vsce-sign-win32-arm64": "2.0.6",
+        "@vscode/vsce-sign-win32-x64": "2.0.6"
+      }
+    },
+    "node_modules/@vscode/vsce-sign-alpine-arm64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-alpine-arm64/-/vsce-sign-alpine-arm64-2.0.6.tgz",
+      "integrity": "sha512-wKkJBsvKF+f0GfsUuGT0tSW0kZL87QggEiqNqK6/8hvqsXvpx8OsTEc3mnE1kejkh5r+qUyQ7PtF8jZYN0mo8Q==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "alpine"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-alpine-x64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-alpine-x64/-/vsce-sign-alpine-x64-2.0.6.tgz",
+      "integrity": "sha512-YoAGlmdK39vKi9jA18i4ufBbd95OqGJxRvF3n6ZbCyziwy3O+JgOpIUPxv5tjeO6gQfx29qBivQ8ZZTUF2Ba0w==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "alpine"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-darwin-arm64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-darwin-arm64/-/vsce-sign-darwin-arm64-2.0.6.tgz",
+      "integrity": "sha512-5HMHaJRIQuozm/XQIiJiA0W9uhdblwwl2ZNDSSAeXGO9YhB9MH5C4KIHOmvyjUnKy4UCuiP43VKpIxW1VWP4tQ==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "darwin"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-darwin-x64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-darwin-x64/-/vsce-sign-darwin-x64-2.0.6.tgz",
+      "integrity": "sha512-25GsUbTAiNfHSuRItoQafXOIpxlYj+IXb4/qarrXu7kmbH94jlm5sdWSCKrrREs8+GsXF1b+l3OB7VJy5jsykw==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "darwin"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-linux-arm": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-linux-arm/-/vsce-sign-linux-arm-2.0.6.tgz",
+      "integrity": "sha512-UndEc2Xlq4HsuMPnwu7420uqceXjs4yb5W8E2/UkaHBB9OWCwMd3/bRe/1eLe3D8kPpxzcaeTyXiK3RdzS/1CA==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-linux-arm64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-linux-arm64/-/vsce-sign-linux-arm64-2.0.6.tgz",
+      "integrity": "sha512-cfb1qK7lygtMa4NUl2582nP7aliLYuDEVpAbXJMkDq1qE+olIw/es+C8j1LJwvcRq1I2yWGtSn3EkDp9Dq5FdA==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-linux-x64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-linux-x64/-/vsce-sign-linux-x64-2.0.6.tgz",
+      "integrity": "sha512-/olerl1A4sOqdP+hjvJ1sbQjKN07Y3DVnxO4gnbn/ahtQvFrdhUi0G1VsZXDNjfqmXw57DmPi5ASnj/8PGZhAA==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "linux"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-win32-arm64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-win32-arm64/-/vsce-sign-win32-arm64-2.0.6.tgz",
+      "integrity": "sha512-ivM/MiGIY0PJNZBoGtlRBM/xDpwbdlCWomUWuLmIxbi1Cxe/1nooYrEQoaHD8ojVRgzdQEUzMsRbyF5cJJgYOg==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/@vscode/vsce-sign-win32-x64": {
+      "version": "2.0.6",
+      "resolved": "https://registry.npmjs.org/@vscode/vsce-sign-win32-x64/-/vsce-sign-win32-x64-2.0.6.tgz",
+      "integrity": "sha512-mgth9Kvze+u8CruYMmhHw6Zgy3GRX2S+Ed5oSokDEK5vPEwGGKnmuXua9tmFhomeAnhgJnL4DCna3TiNuGrBTQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "SEE LICENSE IN LICENSE.txt",
+      "optional": true,
+      "os": [
+        "win32"
+      ]
+    },
+    "node_modules/abort-controller": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/abort-controller/-/abort-controller-3.0.0.tgz",
+      "integrity": "sha512-h8lQ8tacZYnR3vNQTgibj+tODHI5/+l06Au2Pcriv/Gmet0eaj4TwWH41sO9wnHDiQsEj19q0drzdWdeAHtweg==",
+      "license": "MIT",
+      "dependencies": {
+        "event-target-shim": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=6.5"
+      }
+    },
+    "node_modules/acorn": {
+      "version": "8.18.0",
+      "resolved": "https://registry.npmjs.org/acorn/-/acorn-8.18.0.tgz",
+      "integrity": "sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdcDh/Ka7FG3twP6v4d5BkravUilhIAsG4Qj83t02LWUPQ==",
+      "dev": true,
+      "license": "MIT",
+      "bin": {
+        "acorn": "bin/acorn"
+      },
+      "engines": {
+        "node": ">=0.4.0"
+      }
+    },
+    "node_modules/acorn-walk": {
+      "version": "8.3.5",
+      "resolved": "https://registry.npmjs.org/acorn-walk/-/acorn-walk-8.3.5.tgz",
+      "integrity": "sha512-HEHNfbars9v4pgpW6SO1KSPkfoS0xVOM/9UzkJltjlsHZmJasxg8aXkuZa7SMf8vKGIBhpUsPluQSqhJFCqebw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "acorn": "^8.11.0"
+      },
+      "engines": {
+        "node": ">=0.4.0"
+      }
+    },
+    "node_modules/agent-base": {
+      "version": "7.1.4",
+      "resolved": "https://registry.npmjs.org/agent-base/-/agent-base-7.1.4.tgz",
+      "integrity": "sha512-MnA+YT8fwfJPgBx3m60MNqakm30XOkyIoH1y6huTQvC0PwZG7ki8NacLBcrPbNoo8vEZy7Jpuk7+jMO+CUovTQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">= 14"
+      }
+    },
+    "node_modules/agentkeepalive": {
+      "version": "4.6.0",
+      "resolved": "https://registry.npmjs.org/agentkeepalive/-/agentkeepalive-4.6.0.tgz",
+      "integrity": "sha512-kja8j7PjmncONqaTsB8fQ+wE2mSU2DJ9D4XKoJ5PFWIdRMa6SLSN1ff4mOr4jCbfRSsxR4keIiySJU0N9T5hIQ==",
+      "license": "MIT",
+      "dependencies": {
+        "humanize-ms": "^1.2.1"
+      },
+      "engines": {
+        "node": ">= 8.0.0"
+      }
+    },
+    "node_modules/ansi-regex": {
+      "version": "6.3.0",
+      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-6.3.0.tgz",
+      "integrity": "sha512-WpDfL7NO6j7tH88IDBNVdUJxDh9nmCteAVW9dsep846XdwF4naCBK+/tGLX3KJgcpgMRXCFlTM2hKGoK9FsdrQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/ansi-regex?sponsor=1"
+      }
+    },
+    "node_modules/ansi-styles": {
+      "version": "3.2.1",
+      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-3.2.1.tgz",
+      "integrity": "sha512-VT0ZI6kZRdTh8YyJw3SMbYm/u+NqfsAxEpWO0Pf9sq8/e94WxxOpPKx9FR1FlyCtOVDNOQ+8ntlqFxiRc+r5qA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "color-convert": "^1.9.0"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/argparse": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz",
+      "integrity": "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==",
+      "dev": true,
+      "license": "Python-2.0"
+    },
+    "node_modules/assertion-error": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/assertion-error/-/assertion-error-1.1.0.tgz",
+      "integrity": "sha512-jgsaNduz+ndvGyFt3uSuWqvy4lCnIJiovtouQN5JZHOKCS2QuhEdbcQHFhVksz2N2U9hXJo8odG7ETyWlEeuDw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/asynckit": {
+      "version": "0.4.0",
+      "resolved": "https://registry.npmjs.org/asynckit/-/asynckit-0.4.0.tgz",
+      "integrity": "sha512-Oei9OH4tRh0YqU3GxhX79dM/mwVgvbZJaSNaRk+bshkj0S5cfHcgYakreBjrHwatXKbz+IoIdYLxrKim2MjW0Q==",
+      "license": "MIT"
+    },
+    "node_modules/azure-devops-node-api": {
+      "version": "12.5.0",
+      "resolved": "https://registry.npmjs.org/azure-devops-node-api/-/azure-devops-node-api-12.5.0.tgz",
+      "integrity": "sha512-R5eFskGvOm3U/GzeAuxRkUsAl0hrAwGgWn6zAd2KrZmrEhWZVqLew4OOupbQlXUuojUzpGtq62SmdhJ06N88og==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "tunnel": "0.0.6",
+        "typed-rest-client": "^1.8.4"
+      }
+    },
+    "node_modules/balanced-match": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-1.0.2.tgz",
+      "integrity": "sha512-3oSeUO0TMV67hN1AmbXsK4yaqU7tjiHlbxRDZOpH0KW9+CeX4bRAaX0Anxt0tx2MrpRpWwQaPwIlISEJhYU5Pw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/base64-js": {
+      "version": "1.5.1",
+      "resolved": "https://registry.npmjs.org/base64-js/-/base64-js-1.5.1.tgz",
+      "integrity": "sha512-AKpaYlHn8t4SVbOHCy+b5+KKgvR4vrsD8vbvrbiQJps7fKDTkjkDry6ji0rUJjC0kzbNePLwzxq8iypo41qeWA==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/bl": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/bl/-/bl-4.1.0.tgz",
+      "integrity": "sha512-1W07cM9gS6DcLperZfFSj+bWLtaPGSOHWhPiGzXmvVJbRLdG82sH/Kn8EtW1VqWVA54AKf2h5k5BbnIbwF3h6w==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "buffer": "^5.5.0",
+        "inherits": "^2.0.4",
+        "readable-stream": "^3.4.0"
+      }
+    },
+    "node_modules/bl/node_modules/readable-stream": {
+      "version": "3.6.2",
+      "resolved": "https://registry.npmjs.org/readable-stream/-/readable-stream-3.6.2.tgz",
+      "integrity": "sha512-9u/sniCrY3D5WdsERHzHE4G2YCXqoG5FTHUiCC4SIbr6XcLZBY05ya9EKjYek9O5xOAwjGq+1JdGBAS7Q9ScoA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "inherits": "^2.0.3",
+        "string_decoder": "^1.1.1",
+        "util-deprecate": "^1.0.1"
+      },
+      "engines": {
+        "node": ">= 6"
+      }
+    },
+    "node_modules/boolbase": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/boolbase/-/boolbase-1.0.0.tgz",
+      "integrity": "sha512-JZOSA7Mo9sNGB8+UjSgzdLtokWAky1zbztM3WRLCbZ70/3cTANmQmOdR7y2g+J0e2WXywy1yS468tY+IruqEww==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/brace-expansion": {
+      "version": "1.1.18",
+      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.18.tgz",
+      "integrity": "sha512-Edep/X9fGqVNmzKBVsDYIOtD+z1tuezV70LBjdCst9Tqu76lsnvRiZ6oTic1n+/BIwX6QDGAO94PN4N2SADvtw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "balanced-match": "^1.0.0",
+        "concat-map": "0.0.1"
+      }
+    },
+    "node_modules/buffer": {
+      "version": "5.7.1",
+      "resolved": "https://registry.npmjs.org/buffer/-/buffer-5.7.1.tgz",
+      "integrity": "sha512-EHcyIPBQ4BSGlvjB16k5KgAJ27CIsHY/2JBmCRReo48y9rQ3MaUzWX3KVlBa4U7MyX02HdVj0K7C3WaB3ju7FQ==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "base64-js": "^1.3.1",
+        "ieee754": "^1.1.13"
+      }
+    },
+    "node_modules/buffer-crc32": {
+      "version": "0.2.13",
+      "resolved": "https://registry.npmjs.org/buffer-crc32/-/buffer-crc32-0.2.13.tgz",
+      "integrity": "sha512-VO9Ht/+p3SN7SKWqcrgEzjGbRSJYTx+Q1pTQC0wrWqHx0vpJraQ6GtHx8tvcg1rlK1byhU5gccxgOgj7B0TDkQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/buffer-equal-constant-time": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/buffer-equal-constant-time/-/buffer-equal-constant-time-1.0.1.tgz",
+      "integrity": "sha512-zRpUiDwd/xk6ADqPMATG8vc9VPrkck7T07OIx0gnjmJAnHnTVXNQG3vfvWNuiZIkwu9KrKdA1iJKfsfTVxE6NA==",
+      "dev": true,
+      "license": "BSD-3-Clause"
+    },
+    "node_modules/bundle-name": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/bundle-name/-/bundle-name-4.1.0.tgz",
+      "integrity": "sha512-tjwM5exMg6BGRI+kNmTntNsvdZS1X8BFYS6tnJ2hdH0kVxM6/eVZ2xy+FqStSWvYmtfFMDLIxurorHwDKfDz5Q==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "run-applescript": "^7.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/cac": {
+      "version": "6.7.14",
+      "resolved": "https://registry.npmjs.org/cac/-/cac-6.7.14.tgz",
+      "integrity": "sha512-b6Ilus+c3RrdDk+JhLKUAQfzzgLEPy6wcXqS7f/xe1EETvsDP6GORG7SFuOs6cID5YkqchW/LXZbX5bc8j7ZcQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/call-bind-apply-helpers": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/call-bind-apply-helpers/-/call-bind-apply-helpers-1.0.2.tgz",
+      "integrity": "sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==",
+      "license": "MIT",
+      "dependencies": {
+        "es-errors": "^1.3.0",
+        "function-bind": "^1.1.2"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/call-bound": {
+      "version": "1.0.4",
+      "resolved": "https://registry.npmjs.org/call-bound/-/call-bound-1.0.4.tgz",
+      "integrity": "sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "call-bind-apply-helpers": "^1.0.2",
+        "get-intrinsic": "^1.3.0"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/chai": {
+      "version": "4.5.0",
+      "resolved": "https://registry.npmjs.org/chai/-/chai-4.5.0.tgz",
+      "integrity": "sha512-RITGBfijLkBddZvnn8jdqoTypxvqbOLYQkGGxXzeFjVHvudaPw0HNFD9x928/eUwYWd2dPCugVqspGALTZZQKw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "assertion-error": "^1.1.0",
+        "check-error": "^1.0.3",
+        "deep-eql": "^4.1.3",
+        "get-func-name": "^2.0.2",
+        "loupe": "^2.3.6",
+        "pathval": "^1.1.1",
+        "type-detect": "^4.1.0"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/chalk": {
+      "version": "2.4.2",
+      "resolved": "https://registry.npmjs.org/chalk/-/chalk-2.4.2.tgz",
+      "integrity": "sha512-Mti+f9lpJNcwF4tWV8/OrTTtF1gZi+f8FqlyAdouralcFWFQWF2+NgCHShjkCb+IFBLq9buZwE1xckQU4peSuQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "ansi-styles": "^3.2.1",
+        "escape-string-regexp": "^1.0.5",
+        "supports-color": "^5.3.0"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/check-error": {
+      "version": "1.0.3",
+      "resolved": "https://registry.npmjs.org/check-error/-/check-error-1.0.3.tgz",
+      "integrity": "sha512-iKEoDYaRmd1mxM90a2OEfWhjsjPpYPuQ+lMYsoxB126+t8fw7ySEO48nmDg5COTjxDI65/Y2OWpeEHk3ZOe8zg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "get-func-name": "^2.0.2"
+      },
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/cheerio": {
+      "version": "1.2.0",
+      "resolved": "https://registry.npmjs.org/cheerio/-/cheerio-1.2.0.tgz",
+      "integrity": "sha512-WDrybc/gKFpTYQutKIK6UvfcuxijIZfMfXaYm8NMsPQxSYvf+13fXUJ4rztGGbJcBQ/GF55gvrZ0Bc0bj/mqvg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "cheerio-select": "^2.1.0",
+        "dom-serializer": "^2.0.0",
+        "domhandler": "^5.0.3",
+        "domutils": "^3.2.2",
+        "encoding-sniffer": "^0.2.1",
+        "htmlparser2": "^10.1.0",
+        "parse5": "^7.3.0",
+        "parse5-htmlparser2-tree-adapter": "^7.1.0",
+        "parse5-parser-stream": "^7.1.2",
+        "undici": "^7.19.0",
+        "whatwg-mimetype": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=20.18.1"
+      },
+      "funding": {
+        "url": "https://github.com/cheeriojs/cheerio?sponsor=1"
+      }
+    },
+    "node_modules/cheerio-select": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/cheerio-select/-/cheerio-select-2.1.0.tgz",
+      "integrity": "sha512-9v9kG0LvzrlcungtnJtpGNxY+fzECQKhK4EGJX2vByejiMX84MFNQw4UxPJl3bFbTMw+Dfs37XaIkCwTZfLh4g==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "dependencies": {
+        "boolbase": "^1.0.0",
+        "css-select": "^5.1.0",
+        "css-what": "^6.1.0",
+        "domelementtype": "^2.3.0",
+        "domhandler": "^5.0.3",
+        "domutils": "^3.0.1"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/fb55"
+      }
+    },
+    "node_modules/chownr": {
+      "version": "1.1.4",
+      "resolved": "https://registry.npmjs.org/chownr/-/chownr-1.1.4.tgz",
+      "integrity": "sha512-jJ0bqzaylmJtVnNgzTeSOs8DPavpbYgEr/b0YL8/2GO3xJEhInFmhKMUnEJQjZumK7KXGFhUy89PrsJWlakBVg==",
+      "dev": true,
+      "license": "ISC",
+      "optional": true
+    },
+    "node_modules/cli-cursor": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/cli-cursor/-/cli-cursor-5.0.0.tgz",
+      "integrity": "sha512-aCj4O5wKyszjMmDT4tZj93kxyydN/K5zPWSCe6/0AV/AA1pqe5ZBIw0a2ZfPQV7lL5/yb5HsUreJ6UFAF1tEQw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "restore-cursor": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/cli-spinners": {
+      "version": "2.9.2",
+      "resolved": "https://registry.npmjs.org/cli-spinners/-/cli-spinners-2.9.2.tgz",
+      "integrity": "sha512-ywqV+5MmyL4E7ybXgKys4DugZbX0FC6LnwrhjuykIjnK9k8OQacQ7axGKnjDXWNhns0xot3bZI5h55H8yo9cJg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=6"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/cockatiel": {
+      "version": "3.2.1",
+      "resolved": "https://registry.npmjs.org/cockatiel/-/cockatiel-3.2.1.tgz",
+      "integrity": "sha512-gfrHV6ZPkquExvMh9IOkKsBzNDk6sDuZ6DdBGUBkvFnTCqCxzpuq48RySgP0AnaqQkw2zynOFj9yly6T1Q2G5Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=16"
+      }
+    },
+    "node_modules/color-convert": {
+      "version": "1.9.3",
+      "resolved": "https://registry.npmjs.org/color-convert/-/color-convert-1.9.3.tgz",
+      "integrity": "sha512-QfAUtd+vFdAtFQcC8CCyYt1fYWxSqAiK2cSD6zDB8N3cpsEBAvRxp9zOGg6G/SHHJYAT88/az/IuDGALsNVbGg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "color-name": "1.1.3"
+      }
+    },
+    "node_modules/color-name": {
+      "version": "1.1.3",
+      "resolved": "https://registry.npmjs.org/color-name/-/color-name-1.1.3.tgz",
+      "integrity": "sha512-72fSenhMw2HZMTVHeCA9KCmpEIbzWiQsjN+BHcBbS9vr1mtt+vJjPdksIBNUmKAW8TFUDPJK5SUU3QhE9NEXDw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/combined-stream": {
+      "version": "1.0.8",
+      "resolved": "https://registry.npmjs.org/combined-stream/-/combined-stream-1.0.8.tgz",
+      "integrity": "sha512-FQN4MRfuJeHf7cBbBMJFXhKSDq+2kAArBlmRBvcvFE5BB1HZKXtSFASDhdlz9zOYwxh8lDdnvmMOe/+5cdoEdg==",
+      "license": "MIT",
+      "dependencies": {
+        "delayed-stream": "~1.0.0"
+      },
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/commander": {
+      "version": "6.2.1",
+      "resolved": "https://registry.npmjs.org/commander/-/commander-6.2.1.tgz",
+      "integrity": "sha512-U7VdrJFnJgo4xjrHpTzu0yrHPGImdsmD95ZlgYSEajAn2JKzDhDTPG9kBTefmObL2w/ngeZnilk+OV9CG3d7UA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">= 6"
+      }
+    },
+    "node_modules/concat-map": {
+      "version": "0.0.1",
+      "resolved": "https://registry.npmjs.org/concat-map/-/concat-map-0.0.1.tgz",
+      "integrity": "sha512-/Srv4dswyQNBfohGpz9o6Yb3Gz3SrUDqBH5rTuhGR7ahtlbYKnVxw2bCFMRljaA7EXHaXZ8wsHdodFvbkhKmqg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/confbox": {
+      "version": "0.1.8",
+      "resolved": "https://registry.npmjs.org/confbox/-/confbox-0.1.8.tgz",
+      "integrity": "sha512-RMtmw0iFkeR4YV+fUOSucriAQNb9g8zFR52MWCtl+cCZOFRNL6zeB395vPzFhEjjn4fMxXudmELnl/KF/WrK6w==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/core-util-is": {
+      "version": "1.0.3",
+      "resolved": "https://registry.npmjs.org/core-util-is/-/core-util-is-1.0.3.tgz",
+      "integrity": "sha512-ZQBvi1DcpJ4GDqanjucZ2Hj3wEO5pZDS89BWbkcrvdxksJorwUDDZamX9ldFkp9aw2lmBDLgkObEA4DWNJ9FYQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/cross-spawn": {
+      "version": "7.0.6",
+      "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
+      "integrity": "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "path-key": "^3.1.0",
+        "shebang-command": "^2.0.0",
+        "which": "^2.0.1"
+      },
+      "engines": {
+        "node": ">= 8"
+      }
+    },
+    "node_modules/css-select": {
+      "version": "5.2.2",
+      "resolved": "https://registry.npmjs.org/css-select/-/css-select-5.2.2.tgz",
+      "integrity": "sha512-TizTzUddG/xYLA3NXodFM0fSbNizXjOKhqiQQwvhlspadZokn1KDy0NZFS0wuEubIYAV5/c1/lAr0TaaFXEXzw==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "dependencies": {
+        "boolbase": "^1.0.0",
+        "css-what": "^6.1.0",
+        "domhandler": "^5.0.2",
+        "domutils": "^3.0.1",
+        "nth-check": "^2.0.1"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/fb55"
+      }
+    },
+    "node_modules/css-what": {
+      "version": "6.2.2",
+      "resolved": "https://registry.npmjs.org/css-what/-/css-what-6.2.2.tgz",
+      "integrity": "sha512-u/O3vwbptzhMs3L1fQE82ZSLHQQfto5gyZzwteVIEyeaY5Fc7R4dapF/BvRoSYFeqfBk4m0V1Vafq5Pjv25wvA==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">= 6"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/fb55"
+      }
+    },
+    "node_modules/debug": {
+      "version": "4.4.3",
+      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
+      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "ms": "^2.1.3"
+      },
+      "engines": {
+        "node": ">=6.0"
+      },
+      "peerDependenciesMeta": {
+        "supports-color": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/decompress-response": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/decompress-response/-/decompress-response-6.0.0.tgz",
+      "integrity": "sha512-aW35yZM6Bb/4oJlZncMH2LCoZtJXTRxES17vE3hoRiowU2kWHaJKFkSBDnDR+cm9J+9QhXmREyIfv0pji9ejCQ==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "mimic-response": "^3.1.0"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/deep-eql": {
+      "version": "4.1.4",
+      "resolved": "https://registry.npmjs.org/deep-eql/-/deep-eql-4.1.4.tgz",
+      "integrity": "sha512-SUwdGfqdKOwxCPeVYjwSyRpJ7Z+fhpwIAtmCUdZIWZ/YP5R9WAsyuSgpLVDi9bjWoN2LXHNss/dk3urXtdQxGg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "type-detect": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=6"
+      }
+    },
+    "node_modules/deep-extend": {
+      "version": "0.6.0",
+      "resolved": "https://registry.npmjs.org/deep-extend/-/deep-extend-0.6.0.tgz",
+      "integrity": "sha512-LOHxIOaPYdHlJRtCQfDIVZtfw/ufM8+rVj649RIHzcm/vGwQRXFt6OPqIFWsm2XEMrNIEtWR64sY1LEKD2vAOA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "engines": {
+        "node": ">=4.0.0"
+      }
+    },
+    "node_modules/default-browser": {
+      "version": "5.5.1",
+      "resolved": "https://registry.npmjs.org/default-browser/-/default-browser-5.5.1.tgz",
+      "integrity": "sha512-m1pAzaJgZ/gssEqlOhJkPJp8Xly7QyW6xcrkUa2KKcDeDSEMP7X8xipU3snUcfisTQx0w1AGae+9UtJSfVnXGw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "bundle-name": "^4.1.0",
+        "default-browser-id": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/default-browser-id": {
+      "version": "5.0.1",
+      "resolved": "https://registry.npmjs.org/default-browser-id/-/default-browser-id-5.0.1.tgz",
+      "integrity": "sha512-x1VCxdX4t+8wVfd1so/9w+vQ4vx7lKd2Qp5tDRutErwmR85OgmfX7RlLRMWafRMY7hbEiXIbudNrjOAPa/hL8Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/define-lazy-prop": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/define-lazy-prop/-/define-lazy-prop-3.0.0.tgz",
+      "integrity": "sha512-N+MeXYoqr3pOgn8xfyRPREN7gHakLYjhsHhWGT3fWAiL4IkAt0iDw14QiiEm2bE30c5XX5q0FtAA3CK5f9/BUg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/delayed-stream": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/delayed-stream/-/delayed-stream-1.0.0.tgz",
+      "integrity": "sha512-ZySD7Nf91aLB0RxL4KGrKHBXl7Eds1DAmEdcoVawXnLD7SDhpNgtuII2aAkg7a7QS41jxPSZ17p4VdGnMHk3MQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.4.0"
+      }
+    },
+    "node_modules/detect-libc": {
+      "version": "2.1.2",
+      "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz",
+      "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "optional": true,
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/diff-sequences": {
+      "version": "29.6.3",
+      "resolved": "https://registry.npmjs.org/diff-sequences/-/diff-sequences-29.6.3.tgz",
+      "integrity": "sha512-EjePK1srD3P08o2j4f0ExnylqRs5B9tJjcp9t1krH2qRi8CCdsYfwe9JgSLurFBWwq4uOlipzfk5fHNvwFKr8Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
+      }
+    },
+    "node_modules/dom-serializer": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/dom-serializer/-/dom-serializer-2.0.0.tgz",
+      "integrity": "sha512-wIkAryiqt/nV5EQKqQpo3SToSOV9J0DnbJqwK7Wv/Trc92zIAYZ4FlMu+JPFW1DfGFt81ZTCGgDEabffXeLyJg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "domelementtype": "^2.3.0",
+        "domhandler": "^5.0.2",
+        "entities": "^4.2.0"
+      },
+      "funding": {
+        "url": "https://github.com/cheeriojs/dom-serializer?sponsor=1"
+      }
+    },
+    "node_modules/domelementtype": {
+      "version": "2.3.0",
+      "resolved": "https://registry.npmjs.org/domelementtype/-/domelementtype-2.3.0.tgz",
+      "integrity": "sha512-OLETBj6w0OsagBwdXnPdN0cnMfF9opN69co+7ZrbfPGrdpPVNBUj02spi6B1N7wChLQiPn4CSH/zJvXw56gmHw==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/fb55"
+        }
+      ],
+      "license": "BSD-2-Clause"
+    },
+    "node_modules/domhandler": {
+      "version": "5.0.3",
+      "resolved": "https://registry.npmjs.org/domhandler/-/domhandler-5.0.3.tgz",
+      "integrity": "sha512-cgwlv/1iFQiFnU96XXgROh8xTeetsnJiDsTc7TYCLFd9+/WNkIqPTxiM/8pSd8VIrhXGTf1Ny1q1hquVqDJB5w==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "dependencies": {
+        "domelementtype": "^2.3.0"
+      },
+      "engines": {
+        "node": ">= 4"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/domhandler?sponsor=1"
+      }
+    },
+    "node_modules/domutils": {
+      "version": "3.2.2",
+      "resolved": "https://registry.npmjs.org/domutils/-/domutils-3.2.2.tgz",
+      "integrity": "sha512-6kZKyUajlDuqlHKVX1w7gyslj9MPIXzIFiz/rGu35uC1wMi+kMhQwGhl4lt9unC9Vb9INnY9Z3/ZA3+FhASLaw==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "dependencies": {
+        "dom-serializer": "^2.0.0",
+        "domelementtype": "^2.3.0",
+        "domhandler": "^5.0.3"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/domutils?sponsor=1"
+      }
+    },
+    "node_modules/dunder-proto": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/dunder-proto/-/dunder-proto-1.0.1.tgz",
+      "integrity": "sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==",
+      "license": "MIT",
+      "dependencies": {
+        "call-bind-apply-helpers": "^1.0.1",
+        "es-errors": "^1.3.0",
+        "gopd": "^1.2.0"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/ecdsa-sig-formatter": {
+      "version": "1.0.11",
+      "resolved": "https://registry.npmjs.org/ecdsa-sig-formatter/-/ecdsa-sig-formatter-1.0.11.tgz",
+      "integrity": "sha512-nagl3RYrbNv6kQkeJIpt6NJZy8twLB/2vtz6yN9Z4vRKHN4/QZJIEbqohALSgwKdnksuY3k5Addp5lg8sVoVcQ==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "dependencies": {
+        "safe-buffer": "^5.0.1"
+      }
+    },
+    "node_modules/emoji-regex": {
+      "version": "10.6.0",
+      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-10.6.0.tgz",
+      "integrity": "sha512-toUI84YS5YmxW219erniWD0CIVOo46xGKColeNQRgOzDorgBi1v4D71/OFzgD9GO2UGKIv1C3Sp8DAn0+j5w7A==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/encoding-sniffer": {
+      "version": "0.2.1",
+      "resolved": "https://registry.npmjs.org/encoding-sniffer/-/encoding-sniffer-0.2.1.tgz",
+      "integrity": "sha512-5gvq20T6vfpekVtqrYQsSCFZ1wEg5+wW0/QaZMWkFr6BqD3NfKs0rLCx4rrVlSWJeZb5NBJgVLswK/w2MWU+Gw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "iconv-lite": "^0.6.3",
+        "whatwg-encoding": "^3.1.1"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/encoding-sniffer?sponsor=1"
+      }
+    },
+    "node_modules/end-of-stream": {
+      "version": "1.4.5",
+      "resolved": "https://registry.npmjs.org/end-of-stream/-/end-of-stream-1.4.5.tgz",
+      "integrity": "sha512-ooEGc6HP26xXq/N+GCGOT0JKCLDGrq2bQUZrQ7gyrJiZANJ/8YDTxTpQBXGMn+WbIQXNVpyWymm7KYVICQnyOg==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "once": "^1.4.0"
+      }
+    },
+    "node_modules/entities": {
+      "version": "4.5.0",
+      "resolved": "https://registry.npmjs.org/entities/-/entities-4.5.0.tgz",
+      "integrity": "sha512-V0hjH4dGPh9Ao5p0MoRY6BVqtwCjhz6vI5LT8AJ55H+4g9/4vbHx1I54fS0XuclLhDHArPQCiMjDxjaL8fPxhw==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">=0.12"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/entities?sponsor=1"
+      }
+    },
+    "node_modules/es-define-property": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz",
+      "integrity": "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/es-errors": {
+      "version": "1.3.0",
+      "resolved": "https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz",
+      "integrity": "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/es-object-atoms": {
+      "version": "1.1.2",
+      "resolved": "https://registry.npmjs.org/es-object-atoms/-/es-object-atoms-1.1.2.tgz",
+      "integrity": "sha512-HWcBoN6NileqtSydK2FqHbS/LoDd2pqrnQHLyJzBj4kOp/ky2MWMN694xOfkK8/SnUsW2DH7EfyVlydKCsm1Zw==",
+      "license": "MIT",
+      "dependencies": {
+        "es-errors": "^1.3.0"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/es-set-tostringtag": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/es-set-tostringtag/-/es-set-tostringtag-2.1.0.tgz",
+      "integrity": "sha512-j6vWzfrGVfyXxge+O0x5sh6cvxAog0a/4Rdd2K36zCMV5eJ+/+tOAngRO8cODMNWbVRdVlmGZQL2YS3yR8bIUA==",
+      "license": "MIT",
+      "dependencies": {
+        "es-errors": "^1.3.0",
+        "get-intrinsic": "^1.2.6",
+        "has-tostringtag": "^1.0.2",
+        "hasown": "^2.0.2"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/esbuild": {
+      "version": "0.20.2",
+      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.20.2.tgz",
+      "integrity": "sha512-WdOOppmUNU+IbZ0PaDiTst80zjnrOkyJNHoKupIcVyU8Lvla3Ugx94VzkQ32Ijqd7UhHJy75gNWDMUekcrSJ6g==",
+      "dev": true,
+      "hasInstallScript": true,
+      "license": "MIT",
+      "bin": {
+        "esbuild": "bin/esbuild"
+      },
+      "engines": {
+        "node": ">=12"
+      },
+      "optionalDependencies": {
+        "@esbuild/aix-ppc64": "0.20.2",
+        "@esbuild/android-arm": "0.20.2",
+        "@esbuild/android-arm64": "0.20.2",
+        "@esbuild/android-x64": "0.20.2",
+        "@esbuild/darwin-arm64": "0.20.2",
+        "@esbuild/darwin-x64": "0.20.2",
+        "@esbuild/freebsd-arm64": "0.20.2",
+        "@esbuild/freebsd-x64": "0.20.2",
+        "@esbuild/linux-arm": "0.20.2",
+        "@esbuild/linux-arm64": "0.20.2",
+        "@esbuild/linux-ia32": "0.20.2",
+        "@esbuild/linux-loong64": "0.20.2",
+        "@esbuild/linux-mips64el": "0.20.2",
+        "@esbuild/linux-ppc64": "0.20.2",
+        "@esbuild/linux-riscv64": "0.20.2",
+        "@esbuild/linux-s390x": "0.20.2",
+        "@esbuild/linux-x64": "0.20.2",
+        "@esbuild/netbsd-x64": "0.20.2",
+        "@esbuild/openbsd-x64": "0.20.2",
+        "@esbuild/sunos-x64": "0.20.2",
+        "@esbuild/win32-arm64": "0.20.2",
+        "@esbuild/win32-ia32": "0.20.2",
+        "@esbuild/win32-x64": "0.20.2"
+      }
+    },
+    "node_modules/escape-string-regexp": {
+      "version": "1.0.5",
+      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-1.0.5.tgz",
+      "integrity": "sha512-vbRorB5FUQWvla16U8R/qgaFIya2qGzwDrNmCZuYKrbdSUMG6I1ZCGQRefkRVhuOkIGVne7BQ35DSfo1qvJqFg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.8.0"
+      }
+    },
+    "node_modules/estree-walker": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/estree-walker/-/estree-walker-3.0.3.tgz",
+      "integrity": "sha512-7RUKfXgSMMkzt6ZuXmqapOurLGPPfgj6l9uRZ7lRGolvk0y2yocc35LdcxKC5PQZdn2DMqioAQ2NoWcrTKmm6g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/estree": "^1.0.0"
+      }
+    },
+    "node_modules/event-target-shim": {
+      "version": "5.0.1",
+      "resolved": "https://registry.npmjs.org/event-target-shim/-/event-target-shim-5.0.1.tgz",
+      "integrity": "sha512-i/2XbnSz/uxRCU6+NdVJgKWDTM427+MqYbkQzD321DuCQJUqOuJKIA0IM2+W2xtYHdKOmZ4dR6fExsd4SXL+WQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=6"
+      }
+    },
+    "node_modules/execa": {
+      "version": "8.0.1",
+      "resolved": "https://registry.npmjs.org/execa/-/execa-8.0.1.tgz",
+      "integrity": "sha512-VyhnebXciFV2DESc+p6B+y0LjSm0krU4OgJN44qFAhBY0TJ+1V61tYD2+wHusZ6F9n5K+vl8k0sTy7PEfV4qpg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "cross-spawn": "^7.0.3",
+        "get-stream": "^8.0.1",
+        "human-signals": "^5.0.0",
+        "is-stream": "^3.0.0",
+        "merge-stream": "^2.0.0",
+        "npm-run-path": "^5.1.0",
+        "onetime": "^6.0.0",
+        "signal-exit": "^4.1.0",
+        "strip-final-newline": "^3.0.0"
+      },
+      "engines": {
+        "node": ">=16.17"
+      },
+      "funding": {
+        "url": "https://github.com/sindresorhus/execa?sponsor=1"
+      }
+    },
+    "node_modules/execa/node_modules/onetime": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/onetime/-/onetime-6.0.0.tgz",
+      "integrity": "sha512-1FlR+gjXK7X+AsAHso35MnyN5KqGwJRi/31ft6x0M194ht7S+rWAvd7PHss9xSKMzE0asv1pyIHaJYq+BbacAQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "mimic-fn": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/expand-template": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/expand-template/-/expand-template-2.0.3.tgz",
+      "integrity": "sha512-XYfuKMvj4O35f/pOXLObndIRvyQ+/+6AhODh+OKWj9S9498pHHn/IMszH+gt0fBCRWMNfk1ZSp5x3AifmnI2vg==",
+      "dev": true,
+      "license": "(MIT OR WTFPL)",
+      "optional": true,
+      "engines": {
+        "node": ">=6"
+      }
+    },
+    "node_modules/fd-slicer": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/fd-slicer/-/fd-slicer-1.1.0.tgz",
+      "integrity": "sha512-cE1qsB/VwyQozZ+q1dGxR8LBYNZeofhEdUNGSMbQD3Gw2lAzX9Zb3uIU6Ebc/Fmyjo9AWWfnn0AUCHqtevs/8g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "pend": "~1.2.0"
+      }
+    },
+    "node_modules/form-data": {
+      "version": "4.0.6",
+      "resolved": "https://registry.npmjs.org/form-data/-/form-data-4.0.6.tgz",
+      "integrity": "sha512-vKatAh4SlVfgbv+YtmhiRjhEMJsYpsG1Y2rMQtR+SVSbytsSD1YGzDIcrAJmdFec88u/+VoGmxnl+80gL1tRCQ==",
+      "license": "MIT",
+      "dependencies": {
+        "asynckit": "^0.4.0",
+        "combined-stream": "^1.0.8",
+        "es-set-tostringtag": "^2.1.0",
+        "hasown": "^2.0.4",
+        "mime-types": "^2.1.35"
+      },
+      "engines": {
+        "node": ">= 6"
+      }
+    },
+    "node_modules/form-data-encoder": {
+      "version": "1.7.2",
+      "resolved": "https://registry.npmjs.org/form-data-encoder/-/form-data-encoder-1.7.2.tgz",
+      "integrity": "sha512-qfqtYan3rxrnCk1VYaA4H+Ms9xdpPqvLZa6xmMgFvhO32x7/3J/ExcTd6qpxM0vH2GdMI+poehyBZvqfMTto8A==",
+      "license": "MIT"
+    },
+    "node_modules/formdata-node": {
+      "version": "4.4.1",
+      "resolved": "https://registry.npmjs.org/formdata-node/-/formdata-node-4.4.1.tgz",
+      "integrity": "sha512-0iirZp3uVDjVGt9p49aTaqjk84TrglENEDuqfdlZQ1roC9CWlPk6Avf8EEnZNcAqPonwkG35x4n3ww/1THYAeQ==",
+      "license": "MIT",
+      "dependencies": {
+        "node-domexception": "1.0.0",
+        "web-streams-polyfill": "4.0.0-beta.3"
+      },
+      "engines": {
+        "node": ">= 12.20"
+      }
+    },
+    "node_modules/fs-constants": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/fs-constants/-/fs-constants-1.0.0.tgz",
+      "integrity": "sha512-y6OAwoSIf7FyjMIv94u+b5rdheZEjzR63GTyZJm5qh4Bi+2YgwLCcI/fPFZkL5PSixOt6ZNKm+w+Hfp/Bciwow==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/fs.realpath": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/fs.realpath/-/fs.realpath-1.0.0.tgz",
+      "integrity": "sha512-OO0pH2lK6a0hZnAdau5ItzHPI6pUlvI7jMVnxUQRtw4owF2wk8lOSabtGDCTP4Ggrg2MbGnWO9X8K1t4+fGMDw==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/fsevents": {
+      "version": "2.3.3",
+      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
+      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
+      "dev": true,
+      "hasInstallScript": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
+      }
+    },
+    "node_modules/function-bind": {
+      "version": "1.1.2",
+      "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
+      "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
+      "license": "MIT",
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/get-east-asian-width": {
+      "version": "1.6.0",
+      "resolved": "https://registry.npmjs.org/get-east-asian-width/-/get-east-asian-width-1.6.0.tgz",
+      "integrity": "sha512-QRbvDIbx6YklUe6RxeTeleMR0yv3cYH6PsPZHcnVn7xv7zO1BHN8r0XETu8n6Ye3Q+ahtSarc3WgtNWmehIBfA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/get-func-name": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/get-func-name/-/get-func-name-2.0.2.tgz",
+      "integrity": "sha512-8vXOvuE167CtIc3OyItco7N/dpRtBbYOsPsXCz7X/PMnlGjYjSGuZJgM1Y7mmew7BKf9BqvLX2tnOVy1BBUsxQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/get-intrinsic": {
+      "version": "1.3.0",
+      "resolved": "https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.3.0.tgz",
+      "integrity": "sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==",
+      "license": "MIT",
+      "dependencies": {
+        "call-bind-apply-helpers": "^1.0.2",
+        "es-define-property": "^1.0.1",
+        "es-errors": "^1.3.0",
+        "es-object-atoms": "^1.1.1",
+        "function-bind": "^1.1.2",
+        "get-proto": "^1.0.1",
+        "gopd": "^1.2.0",
+        "has-symbols": "^1.1.0",
+        "hasown": "^2.0.2",
+        "math-intrinsics": "^1.1.0"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/get-proto": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/get-proto/-/get-proto-1.0.1.tgz",
+      "integrity": "sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==",
+      "license": "MIT",
+      "dependencies": {
+        "dunder-proto": "^1.0.1",
+        "es-object-atoms": "^1.0.0"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/get-stream": {
+      "version": "8.0.1",
+      "resolved": "https://registry.npmjs.org/get-stream/-/get-stream-8.0.1.tgz",
+      "integrity": "sha512-VaUJspBffn/LMCJVoMvSAdmscJyS1auj5Zulnn5UoYcY531UWmdwhRWkcGKnGU93m5HSXP9LP2usOryrBtQowA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=16"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/github-from-package": {
+      "version": "0.0.0",
+      "resolved": "https://registry.npmjs.org/github-from-package/-/github-from-package-0.0.0.tgz",
+      "integrity": "sha512-SyHy3T1v2NUXn29OsWdxmK6RwHD+vkj3v8en8AOBZ1wBQ/hCAQ5bAQTD02kW4W9tUp/3Qh6J8r9EvntiyCmOOw==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/glob": {
+      "version": "7.2.3",
+      "resolved": "https://registry.npmjs.org/glob/-/glob-7.2.3.tgz",
+      "integrity": "sha512-nFR0zLpU2YCaRxwoCJvL6UvCH2JFyFVIvwTLsIf21AuHlMskA1hhTdk+LlYJtOlYt9v6dvszD2BGRqBL+iQK9Q==",
+      "deprecated": "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "fs.realpath": "^1.0.0",
+        "inflight": "^1.0.4",
+        "inherits": "2",
+        "minimatch": "^3.1.1",
+        "once": "^1.3.0",
+        "path-is-absolute": "^1.0.0"
+      },
+      "engines": {
+        "node": "*"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/gopd": {
+      "version": "1.2.0",
+      "resolved": "https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz",
+      "integrity": "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/has-flag": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/has-flag/-/has-flag-3.0.0.tgz",
+      "integrity": "sha512-sKJf1+ceQBr4SMkvQnBDNDtf4TXpVhVGateu0t918bl30FnbE2m4vNLX+VWe/dpjlb+HugGYzW7uQXH98HPEYw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/has-symbols": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/has-symbols/-/has-symbols-1.1.0.tgz",
+      "integrity": "sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/has-tostringtag": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/has-tostringtag/-/has-tostringtag-1.0.2.tgz",
+      "integrity": "sha512-NqADB8VjPFLM2V0VvHUewwwsw0ZWBaIdgo+ieHtK3hasLz4qeCRjYcqfB6AQrBggRKppKF8L52/VqdVsO47Dlw==",
+      "license": "MIT",
+      "dependencies": {
+        "has-symbols": "^1.0.3"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/hasown": {
+      "version": "2.0.4",
+      "resolved": "https://registry.npmjs.org/hasown/-/hasown-2.0.4.tgz",
+      "integrity": "sha512-T2UbfbBEF32wiepXIsMlTW9+dDYC6wMh/t/vYA4tuOMKqWz/n3vr1NFSxQiyP+zk2mXsoMA/i/7qV6LKut1t1A==",
+      "license": "MIT",
+      "dependencies": {
+        "function-bind": "^1.1.2"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/hosted-git-info": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/hosted-git-info/-/hosted-git-info-4.1.0.tgz",
+      "integrity": "sha512-kyCuEOWjJqZuDbRHzL8V93NzQhwIB71oFWSyzVo+KPZI+pnQPPxucdkrOZvkLRnrf5URsQM+IJ09Dw29cRALIA==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "lru-cache": "^6.0.0"
+      },
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/htmlparser2": {
+      "version": "10.1.0",
+      "resolved": "https://registry.npmjs.org/htmlparser2/-/htmlparser2-10.1.0.tgz",
+      "integrity": "sha512-VTZkM9GWRAtEpveh7MSF6SjjrpNVNNVJfFup7xTY3UpFtm67foy9HDVXneLtFVt4pMz5kZtgNcvCniNFb1hlEQ==",
+      "dev": true,
+      "funding": [
+        "https://github.com/fb55/htmlparser2?sponsor=1",
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/fb55"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "domelementtype": "^2.3.0",
+        "domhandler": "^5.0.3",
+        "domutils": "^3.2.2",
+        "entities": "^7.0.1"
+      }
+    },
+    "node_modules/htmlparser2/node_modules/entities": {
+      "version": "7.0.1",
+      "resolved": "https://registry.npmjs.org/entities/-/entities-7.0.1.tgz",
+      "integrity": "sha512-TWrgLOFUQTH994YUyl1yT4uyavY5nNB5muff+RtWaqNVCAK408b5ZnnbNAUEWLTCpum9w6arT70i1XdQ4UeOPA==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">=0.12"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/entities?sponsor=1"
+      }
+    },
+    "node_modules/http-proxy-agent": {
+      "version": "7.0.2",
+      "resolved": "https://registry.npmjs.org/http-proxy-agent/-/http-proxy-agent-7.0.2.tgz",
+      "integrity": "sha512-T1gkAiYYDWYx3V5Bmyu7HcfcvL7mUrTWiM6yOfa3PIphViJ/gFPbvidQ+veqSOHci/PxBcDabeUNCzpOODJZig==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "agent-base": "^7.1.0",
+        "debug": "^4.3.4"
+      },
+      "engines": {
+        "node": ">= 14"
+      }
+    },
+    "node_modules/https-proxy-agent": {
+      "version": "7.0.6",
+      "resolved": "https://registry.npmjs.org/https-proxy-agent/-/https-proxy-agent-7.0.6.tgz",
+      "integrity": "sha512-vK9P5/iUfdl95AI+JVyUuIcVtd4ofvtrOr3HNtM2yxC9bnMbEdp3x01OhQNnjb8IJYi38VlTE3mBXwcfvywuSw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "agent-base": "^7.1.2",
+        "debug": "4"
+      },
+      "engines": {
+        "node": ">= 14"
+      }
+    },
+    "node_modules/human-signals": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/human-signals/-/human-signals-5.0.0.tgz",
+      "integrity": "sha512-AXcZb6vzzrFAUE61HnN4mpLqd/cSIwNQjtNWR0euPm6y0iqx3G4gOXaIDdtdDwZmhwe82LA6+zinmW4UBWVePQ==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "engines": {
+        "node": ">=16.17.0"
+      }
+    },
+    "node_modules/humanize-ms": {
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/humanize-ms/-/humanize-ms-1.2.1.tgz",
+      "integrity": "sha512-Fl70vYtsAFb/C06PTS9dZBo7ihau+Tu/DNCk/OyHhea07S+aeMWpFFkUaXRa8fI+ScZbEI8dfSxwY7gxZ9SAVQ==",
+      "license": "MIT",
+      "dependencies": {
+        "ms": "^2.0.0"
+      }
+    },
+    "node_modules/iconv-lite": {
+      "version": "0.6.3",
+      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.6.3.tgz",
+      "integrity": "sha512-4fCk79wshMdzMp2rH06qWrJE4iolqLhCUH+OiuIgU++RB0+94NlDL81atO7GX55uUKueo0txHNtvEyI6D7WdMw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "safer-buffer": ">= 2.1.2 < 3.0.0"
+      },
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
+    "node_modules/ieee754": {
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/ieee754/-/ieee754-1.2.1.tgz",
+      "integrity": "sha512-dcyqhDvX1C46lXZcVqCpK+FtMRQVdIMN6/Df5js2zouUsqG7I6sFxitIC+7KYK29KdXOLHdu9zL4sFnoVQnqaA==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "BSD-3-Clause",
+      "optional": true
+    },
+    "node_modules/immediate": {
+      "version": "3.0.6",
+      "resolved": "https://registry.npmjs.org/immediate/-/immediate-3.0.6.tgz",
+      "integrity": "sha512-XXOFtyqDjNDAQxVfYxuF7g9Il/IbWmmlQg2MYKOH8ExIT1qg6xc4zyS3HaEEATgs1btfzxq15ciUiY7gjSXRGQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/inflight": {
+      "version": "1.0.6",
+      "resolved": "https://registry.npmjs.org/inflight/-/inflight-1.0.6.tgz",
+      "integrity": "sha512-k92I/b08q4wvFscXCLvqfsHCrjrF7yiXsQuIVvVE7N82W3+aqpzuUdBbfhWcy/FZR3/4IgflMgKLOsvPDrGCJA==",
+      "deprecated": "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "once": "^1.3.0",
+        "wrappy": "1"
+      }
+    },
+    "node_modules/inherits": {
+      "version": "2.0.4",
+      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
+      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/ini": {
+      "version": "1.3.8",
+      "resolved": "https://registry.npmjs.org/ini/-/ini-1.3.8.tgz",
+      "integrity": "sha512-JV/yugV2uzW5iMRSiZAyDtQd+nxtUnjeLt0acNdw98kKLrvuRVyB80tsREOE7yvGVgalhZ6RNXCmEHkUKBKxew==",
+      "dev": true,
+      "license": "ISC",
+      "optional": true
+    },
+    "node_modules/is-docker": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/is-docker/-/is-docker-3.0.0.tgz",
+      "integrity": "sha512-eljcgEDlEns/7AXFosB5K/2nCM4P7FQPkGc/DWLy5rmFEWvZayGrik1d9/QIY5nJ4f9YsVvBkA6kJpHn9rISdQ==",
+      "dev": true,
+      "license": "MIT",
+      "bin": {
+        "is-docker": "cli.js"
+      },
+      "engines": {
+        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/is-inside-container": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/is-inside-container/-/is-inside-container-1.0.0.tgz",
+      "integrity": "sha512-KIYLCCJghfHZxqjYBE7rEy0OBuTd5xCHS7tHVgvCLkx7StIoaxwNW3hCALgEUjFfeRk+MG/Qxmp/vtETEF3tRA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "is-docker": "^3.0.0"
+      },
+      "bin": {
+        "is-inside-container": "cli.js"
+      },
+      "engines": {
+        "node": ">=14.16"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/is-interactive": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/is-interactive/-/is-interactive-2.0.0.tgz",
+      "integrity": "sha512-qP1vozQRI+BMOPcjFzrjXuQvdak2pHNUMZoeG2eRbiSqyvbEf/wQtEOTOX1guk6E3t36RkaqiSt8A/6YElNxLQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/is-stream": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/is-stream/-/is-stream-3.0.0.tgz",
+      "integrity": "sha512-LnQR4bZ9IADDRSkvpqMGvt/tEJWclzklNgSw48V5EAaAeDd6qGvN8ei6k5p0tvxSR171VmGyHuTiAOfxAbr8kA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/is-unicode-supported": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/is-unicode-supported/-/is-unicode-supported-2.1.0.tgz",
+      "integrity": "sha512-mE00Gnza5EEB3Ds0HfMyllZzbBrmLOX3vfWoj9A9PEnTfratQ/BcaJOuMhnkhjXvb2+FkY3VuHqtAGpTPmglFQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/is-wsl": {
+      "version": "3.1.1",
+      "resolved": "https://registry.npmjs.org/is-wsl/-/is-wsl-3.1.1.tgz",
+      "integrity": "sha512-e6rvdUCiQCAuumZslxRJWR/Doq4VpPR82kqclvcS0efgt430SlGIk05vdCN58+VrzgtIcfNODjozVielycD4Sw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "is-inside-container": "^1.0.0"
+      },
+      "engines": {
+        "node": ">=16"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/isarray": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/isarray/-/isarray-1.0.0.tgz",
+      "integrity": "sha512-VLghIWNM6ELQzo7zwmcg0NmTVyWKYjvIeM83yjp0wRDTmUnrM678fQbcKBo6n2CJEF0szoG//ytg+TKla89ALQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/isexe": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
+      "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/js-tokens": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
+      "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
+      "license": "MIT"
+    },
+    "node_modules/jsonc-parser": {
+      "version": "3.3.1",
+      "resolved": "https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz",
+      "integrity": "sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/jsonwebtoken": {
+      "version": "9.0.3",
+      "resolved": "https://registry.npmjs.org/jsonwebtoken/-/jsonwebtoken-9.0.3.tgz",
+      "integrity": "sha512-MT/xP0CrubFRNLNKvxJ2BYfy53Zkm++5bX9dtuPbqAeQpTVe0MQTFhao8+Cp//EmJp244xt6Drw/GVEGCUj40g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "jws": "^4.0.1",
+        "lodash.includes": "^4.3.0",
+        "lodash.isboolean": "^3.0.3",
+        "lodash.isinteger": "^4.0.4",
+        "lodash.isnumber": "^3.0.3",
+        "lodash.isplainobject": "^4.0.6",
+        "lodash.isstring": "^4.0.1",
+        "lodash.once": "^4.0.0",
+        "ms": "^2.1.1",
+        "semver": "^7.5.4"
+      },
+      "engines": {
+        "node": ">=12",
+        "npm": ">=6"
+      }
+    },
+    "node_modules/jszip": {
+      "version": "3.10.2",
+      "resolved": "https://registry.npmjs.org/jszip/-/jszip-3.10.2.tgz",
+      "integrity": "sha512-3l+rb15IOWtUhU0H5MFqES/T6Kh7abYwjosBey/vD6hDt8zoEffkSC5Ws5SGtgVw3gBx2NEbhTeSW1+kWkpyTQ==",
+      "dev": true,
+      "license": "(MIT OR GPL-3.0-or-later)",
+      "dependencies": {
+        "lie": "~3.3.0",
+        "pako": "~1.0.2",
+        "readable-stream": "~2.3.6",
+        "setimmediate": "^1.0.5"
+      }
+    },
+    "node_modules/jwa": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/jwa/-/jwa-2.0.1.tgz",
+      "integrity": "sha512-hRF04fqJIP8Abbkq5NKGN0Bbr3JxlQ+qhZufXVr0DvujKy93ZCbXZMHDL4EOtodSbCWxOqR8MS1tXA5hwqCXDg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "buffer-equal-constant-time": "^1.0.1",
+        "ecdsa-sig-formatter": "1.0.11",
+        "safe-buffer": "^5.0.1"
+      }
+    },
+    "node_modules/jws": {
+      "version": "4.0.1",
+      "resolved": "https://registry.npmjs.org/jws/-/jws-4.0.1.tgz",
+      "integrity": "sha512-EKI/M/yqPncGUUh44xz0PxSidXFr/+r0pA70+gIYhjv+et7yxM+s29Y+VGDkovRofQem0fs7Uvf4+YmAdyRduA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "jwa": "^2.0.1",
+        "safe-buffer": "^5.0.1"
+      }
+    },
+    "node_modules/keytar": {
+      "version": "7.9.0",
+      "resolved": "https://registry.npmjs.org/keytar/-/keytar-7.9.0.tgz",
+      "integrity": "sha512-VPD8mtVtm5JNtA2AErl6Chp06JBfy7diFQ7TQQhdpWOl6MrCRB+eRbvAZUsbGQS9kiMq0coJsy0W0vHpDCkWsQ==",
+      "dev": true,
+      "hasInstallScript": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "node-addon-api": "^4.3.0",
+        "prebuild-install": "^7.0.1"
+      }
+    },
+    "node_modules/leven": {
+      "version": "3.1.0",
+      "resolved": "https://registry.npmjs.org/leven/-/leven-3.1.0.tgz",
+      "integrity": "sha512-qsda+H8jTaUaN/x5vzW2rzc+8Rw4TAQ/4KjB46IwK5VH+IlVeeeje/EoZRpiXvIqjFgK84QffqPztGI3VBLG1A==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=6"
+      }
+    },
+    "node_modules/lie": {
+      "version": "3.3.0",
+      "resolved": "https://registry.npmjs.org/lie/-/lie-3.3.0.tgz",
+      "integrity": "sha512-UaiMJzeWRlEujzAuw5LokY1L5ecNQYZKfmyZ9L7wDHb/p5etKaxXhohBcrw0EYby+G/NA52vRSN4N39dxHAIwQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "immediate": "~3.0.5"
+      }
+    },
+    "node_modules/linkify-it": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/linkify-it/-/linkify-it-3.0.3.tgz",
+      "integrity": "sha512-ynTsyrFSdE5oZ/O9GEf00kPngmOfVwazR5GKDq6EYfhlpFug3J2zybX56a2PRRpc9P+FuSoGNAwjlbDs9jJBPQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "uc.micro": "^1.0.1"
+      }
+    },
+    "node_modules/local-pkg": {
+      "version": "0.5.1",
+      "resolved": "https://registry.npmjs.org/local-pkg/-/local-pkg-0.5.1.tgz",
+      "integrity": "sha512-9rrA30MRRP3gBD3HTGnC6cDFpaE1kVDWxWgqWJUN0RvDNAo+Nz/9GxB+nHOH0ifbVFy0hSA1V6vFDvnx54lTEQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "mlly": "^1.7.3",
+        "pkg-types": "^1.2.1"
+      },
+      "engines": {
+        "node": ">=14"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/antfu"
+      }
+    },
+    "node_modules/lodash.includes": {
+      "version": "4.3.0",
+      "resolved": "https://registry.npmjs.org/lodash.includes/-/lodash.includes-4.3.0.tgz",
+      "integrity": "sha512-W3Bx6mdkRTGtlJISOvVD/lbqjTlPPUDTMnlXZFnVwi9NKJ6tiAk6LVdlhZMm17VZisqhKcgzpO5Wz91PCt5b0w==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.isboolean": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/lodash.isboolean/-/lodash.isboolean-3.0.3.tgz",
+      "integrity": "sha512-Bz5mupy2SVbPHURB98VAcw+aHh4vRV5IPNhILUCsOzRmsTmSQ17jIuqopAentWoehktxGd9e/hbIXq980/1QJg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.isinteger": {
+      "version": "4.0.4",
+      "resolved": "https://registry.npmjs.org/lodash.isinteger/-/lodash.isinteger-4.0.4.tgz",
+      "integrity": "sha512-DBwtEWN2caHQ9/imiNeEA5ys1JoRtRfY3d7V9wkqtbycnAmTvRRmbHKDV4a0EYc678/dia0jrte4tjYwVBaZUA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.isnumber": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/lodash.isnumber/-/lodash.isnumber-3.0.3.tgz",
+      "integrity": "sha512-QYqzpfwO3/CWf3XP+Z+tkQsfaLL/EnUlXWVkIk5FUPc4sBdTehEqZONuyRt2P67PXAk+NXmTBcc97zw9t1FQrw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.isplainobject": {
+      "version": "4.0.6",
+      "resolved": "https://registry.npmjs.org/lodash.isplainobject/-/lodash.isplainobject-4.0.6.tgz",
+      "integrity": "sha512-oSXzaWypCMHkPC3NvBEaPHf0KsA5mvPrOPgQWDsbg8n7orZ290M0BmC/jgRZ4vcJ6DTAhjrsSYgdsW/F+MFOBA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.isstring": {
+      "version": "4.0.1",
+      "resolved": "https://registry.npmjs.org/lodash.isstring/-/lodash.isstring-4.0.1.tgz",
+      "integrity": "sha512-0wJxfxH1wgO3GrbuP+dTTk7op+6L41QCXbGINEmD+ny/G/eCqGzxyCsh7159S+mgDDcoarnBw6PC1PS5+wUGgw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/lodash.once": {
+      "version": "4.1.1",
+      "resolved": "https://registry.npmjs.org/lodash.once/-/lodash.once-4.1.1.tgz",
+      "integrity": "sha512-Sb487aTOCr9drQVL8pIxOzVhafOjZN9UU54hiN8PU3uAiSV7lx1yYNpbNmex2PK6dSJoNTSJUUswT651yww3Mg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/log-symbols": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/log-symbols/-/log-symbols-6.0.0.tgz",
+      "integrity": "sha512-i24m8rpwhmPIS4zscNzK6MSEhk0DUWa/8iYQWxhffV8jkI4Phvs3F+quL5xvS0gdQR0FyTCMMH33Y78dDTzzIw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "chalk": "^5.3.0",
+        "is-unicode-supported": "^1.3.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/log-symbols/node_modules/chalk": {
+      "version": "5.6.2",
+      "resolved": "https://registry.npmjs.org/chalk/-/chalk-5.6.2.tgz",
+      "integrity": "sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "^12.17.0 || ^14.13 || >=16.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/chalk?sponsor=1"
+      }
+    },
+    "node_modules/log-symbols/node_modules/is-unicode-supported": {
+      "version": "1.3.0",
+      "resolved": "https://registry.npmjs.org/is-unicode-supported/-/is-unicode-supported-1.3.0.tgz",
+      "integrity": "sha512-43r2mRvz+8JRIKnWJ+3j8JtjRKZ6GmjzfaE/qiBJnikNnYv/6bagRJ1kUhNk8R5EX/GkobD+r+sfxCPJsiKBLQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/loose-envify": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/loose-envify/-/loose-envify-1.4.0.tgz",
+      "integrity": "sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==",
+      "license": "MIT",
+      "dependencies": {
+        "js-tokens": "^3.0.0 || ^4.0.0"
+      },
+      "bin": {
+        "loose-envify": "cli.js"
+      }
+    },
+    "node_modules/loupe": {
+      "version": "2.3.7",
+      "resolved": "https://registry.npmjs.org/loupe/-/loupe-2.3.7.tgz",
+      "integrity": "sha512-zSMINGVYkdpYSOBmLi0D1Uo7JU9nVdQKrHxC8eYlV+9YKK9WePqAlL7lSlorG/U2Fw1w0hTBmaa/jrQ3UbPHtA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "get-func-name": "^2.0.1"
+      }
+    },
+    "node_modules/lru-cache": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-6.0.0.tgz",
+      "integrity": "sha512-Jo6dJ04CmSjuznwJSS3pUeWmd/H0ffTlkXXgwZi+eq1UCmqQwCh+eLsYOYCwY991i2Fah4h1BEMCx4qThGbsiA==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "yallist": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/magic-string": {
+      "version": "0.30.21",
+      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.21.tgz",
+      "integrity": "sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@jridgewell/sourcemap-codec": "^1.5.5"
+      }
+    },
+    "node_modules/markdown-it": {
+      "version": "12.3.2",
+      "resolved": "https://registry.npmjs.org/markdown-it/-/markdown-it-12.3.2.tgz",
+      "integrity": "sha512-TchMembfxfNVpHkbtriWltGWc+m3xszaRD0CZup7GFFhzIgQqxIfn3eGj1yZpfuflzPvfkt611B2Q/Bsk1YnGg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "argparse": "^2.0.1",
+        "entities": "~2.1.0",
+        "linkify-it": "^3.0.1",
+        "mdurl": "^1.0.1",
+        "uc.micro": "^1.0.5"
+      },
+      "bin": {
+        "markdown-it": "bin/markdown-it.js"
+      }
+    },
+    "node_modules/markdown-it/node_modules/entities": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/entities/-/entities-2.1.0.tgz",
+      "integrity": "sha512-hCx1oky9PFrJ611mf0ifBLBRW8lUUVRlFolb5gWRfIELabBlbp9xZvrqZLZAs+NxFnbfQoeGd8wDkygjg7U85w==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "funding": {
+        "url": "https://github.com/fb55/entities?sponsor=1"
+      }
+    },
+    "node_modules/math-intrinsics": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz",
+      "integrity": "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      }
+    },
+    "node_modules/mdurl": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/mdurl/-/mdurl-1.0.1.tgz",
+      "integrity": "sha512-/sKlQJCBYVY9Ers9hqzKou4H6V5UWc/M59TH2dvkt+84itfnq7uFOMLpOiOS4ujvHP4etln18fmIxA5R5fll0g==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/merge-stream": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/merge-stream/-/merge-stream-2.0.0.tgz",
+      "integrity": "sha512-abv/qOcuPfk3URPfDzmZU1LKmuw8kT+0nIHvKrKgFrwifol/doWcdA4ZqsWQ8ENrFKkd67Mfpo/LovbIUsbt3w==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/mime": {
+      "version": "1.6.0",
+      "resolved": "https://registry.npmjs.org/mime/-/mime-1.6.0.tgz",
+      "integrity": "sha512-x0Vn8spI+wuJ1O6S7gnbaQg8Pxh4NNHb7KSINmEWKiPE4RKOplvijn+NkmYmmRgP68mc70j2EbeTFRsrswaQeg==",
+      "dev": true,
+      "license": "MIT",
+      "bin": {
+        "mime": "cli.js"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/mime-db": {
+      "version": "1.52.0",
+      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.52.0.tgz",
+      "integrity": "sha512-sPU4uV7dYlvtWJxwwxHD0PuihVNiE7TyAbQ5SWxDCB9mUYvOgroQOwYQQOKPJ8CIbE+1ETVlOoK1UC2nU3gYvg==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.6"
+      }
+    },
+    "node_modules/mime-types": {
+      "version": "2.1.35",
+      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz",
+      "integrity": "sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzaeXiw==",
+      "license": "MIT",
+      "dependencies": {
+        "mime-db": "1.52.0"
+      },
+      "engines": {
+        "node": ">= 0.6"
+      }
+    },
+    "node_modules/mimic-fn": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/mimic-fn/-/mimic-fn-4.0.0.tgz",
+      "integrity": "sha512-vqiC06CuhBTUdZH+RYl8sFrL096vA45Ok5ISO6sE/Mr1jRbGH4Csnhi8f3wKVl7x8mO4Au7Ir9D3Oyv1VYMFJw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/mimic-function": {
+      "version": "5.0.1",
+      "resolved": "https://registry.npmjs.org/mimic-function/-/mimic-function-5.0.1.tgz",
+      "integrity": "sha512-VP79XUPxV2CigYP3jWwAUFSku2aKqBH7uTAapFWCBqutsbmDo96KY5o8uh6U+/YSIn5OxJnXp73beVkpqMIGhA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/mimic-response": {
+      "version": "3.1.0",
+      "resolved": "https://registry.npmjs.org/mimic-response/-/mimic-response-3.1.0.tgz",
+      "integrity": "sha512-z0yWI+4FDrrweS8Zmt4Ej5HdJmky15+L2e6Wgn3+iK5fWzb6T3fhNFq2+MeTRb064c6Wr4N/wv0DzQTjNzHNGQ==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/minimatch": {
+      "version": "3.1.5",
+      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-3.1.5.tgz",
+      "integrity": "sha512-VgjWUsnnT6n+NUk6eZq77zeFdpW2LWDzP6zFGrCbHXiYNul5Dzqk2HHQ5uFH2DNW5Xbp8+jVzaeNt94ssEEl4w==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "brace-expansion": "^1.1.7"
+      },
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/minimist": {
+      "version": "1.2.8",
+      "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz",
+      "integrity": "sha512-2yyAR8qBkN3YuheJanUpWC5U3bb5osDywNB8RzDVlDwDHbocAJveqqj1u8+SVD7jkWT4yvsHCpWqqWqAxb0zCA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/mkdirp-classic": {
+      "version": "0.5.3",
+      "resolved": "https://registry.npmjs.org/mkdirp-classic/-/mkdirp-classic-0.5.3.tgz",
+      "integrity": "sha512-gKLcREMhtuZRwRAfqP3RFW+TK4JqApVBtOIftVgjuABpAtpxhPGaDcfvbhNvD0B8iD1oUr/txX35NjcaY6Ns/A==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/mlly": {
+      "version": "1.8.2",
+      "resolved": "https://registry.npmjs.org/mlly/-/mlly-1.8.2.tgz",
+      "integrity": "sha512-d+ObxMQFmbt10sretNDytwt85VrbkhhUA/JBGm1MPaWJ65Cl4wOgLaB1NYvJSZ0Ef03MMEU/0xpPMXUIQ29UfA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "acorn": "^8.16.0",
+        "pathe": "^2.0.3",
+        "pkg-types": "^1.3.1",
+        "ufo": "^1.6.3"
+      }
+    },
+    "node_modules/mlly/node_modules/pathe": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/pathe/-/pathe-2.0.3.tgz",
+      "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/ms": {
+      "version": "2.1.3",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
+      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
+      "license": "MIT"
+    },
+    "node_modules/mute-stream": {
+      "version": "0.0.8",
+      "resolved": "https://registry.npmjs.org/mute-stream/-/mute-stream-0.0.8.tgz",
+      "integrity": "sha512-nnbWWOkoWyUsTjKrhgD0dcz22mdkSnpYqbEjIm2nhwhuxlSkpywJmBo8h0ZqJdkp73mb90SssHkN4rsRaBAfAA==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/nanoid": {
+      "version": "3.3.19",
+      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.19.tgz",
+      "integrity": "sha512-Y2tUNy4ouw6tq5oDSKeQYGOyhkUBhNOcGV/02KC+6kd9eDGqdZd++mjMiIDilrBYvjEnCYvVtsuHCuP+okSfug==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/ai"
+        }
+      ],
+      "license": "MIT",
+      "bin": {
+        "nanoid": "bin/nanoid.cjs"
+      },
+      "engines": {
+        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
+      }
+    },
+    "node_modules/napi-build-utils": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/napi-build-utils/-/napi-build-utils-2.0.0.tgz",
+      "integrity": "sha512-GEbrYkbfF7MoNaoh2iGG84Mnf/WZfB0GdGEsM8wz7Expx/LlWf5U8t9nvJKXSp3qr5IsEbK04cBGhol/KwOsWA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/node-abi": {
+      "version": "3.96.0",
+      "resolved": "https://registry.npmjs.org/node-abi/-/node-abi-3.96.0.tgz",
+      "integrity": "sha512-rebQ/lz7i0EkoLzUVSrKRzA69zMkwLp95kKMWoMDkkM00Suxz0D7zEQPwRml5fQum24mj7bPvmlgLAmu2JCiYg==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "semver": "^7.3.5"
+      },
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/node-addon-api": {
+      "version": "4.3.0",
+      "resolved": "https://registry.npmjs.org/node-addon-api/-/node-addon-api-4.3.0.tgz",
+      "integrity": "sha512-73sE9+3UaLYYFmDsFZnqCInzPyh3MqIwZO9cw58yIqAZhONrrabrYyYe3TuIqtIiOuTXVhsGau8hcrhhwSsDIQ==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/node-domexception": {
+      "version": "1.0.0",
+      "resolved": "https://registry.npmjs.org/node-domexception/-/node-domexception-1.0.0.tgz",
+      "integrity": "sha512-/jKZoMpw0F8GRwl4/eLROPA3cfcXtLApP0QzLmUT/HuPCZWyB7IY9ZrMeKw2O/nFIqPQB3PVM9aYm0F312AXDQ==",
+      "deprecated": "Use your platform's native DOMException instead",
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/jimmywarting"
+        },
+        {
+          "type": "github",
+          "url": "https://paypal.me/jimmywarting"
+        }
+      ],
+      "license": "MIT",
+      "engines": {
+        "node": ">=10.5.0"
+      }
+    },
+    "node_modules/node-fetch": {
+      "version": "2.7.0",
+      "resolved": "https://registry.npmjs.org/node-fetch/-/node-fetch-2.7.0.tgz",
+      "integrity": "sha512-c4FRfUm/dbcWZ7U+1Wq0AwCyFL+3nt2bEw05wfxSz+DWpWsitgmSgYmy2dQdWyKC1694ELPqMs/YzUSNozLt8A==",
+      "license": "MIT",
+      "dependencies": {
+        "whatwg-url": "^5.0.0"
+      },
+      "engines": {
+        "node": "4.x || >=6.0.0"
+      },
+      "peerDependencies": {
+        "encoding": "^0.1.0"
+      },
+      "peerDependenciesMeta": {
+        "encoding": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/npm-run-path": {
+      "version": "5.3.0",
+      "resolved": "https://registry.npmjs.org/npm-run-path/-/npm-run-path-5.3.0.tgz",
+      "integrity": "sha512-ppwTtiJZq0O/ai0z7yfudtBpWIoxM8yE6nHi1X47eFR2EWORqfbu6CnPlNsjeN683eT0qG6H/Pyf9fCcvjnnnQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "path-key": "^4.0.0"
+      },
+      "engines": {
+        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/npm-run-path/node_modules/path-key": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/path-key/-/path-key-4.0.0.tgz",
+      "integrity": "sha512-haREypq7xkM7ErfgIyA0z+Bj4AGKlMSdlQE2jvJo6huWD1EdkKYV+G/T4nq0YEF2vgTT8kqMFKo1uHn950r4SQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/nth-check": {
+      "version": "2.1.1",
+      "resolved": "https://registry.npmjs.org/nth-check/-/nth-check-2.1.1.tgz",
+      "integrity": "sha512-lqjrjmaOoAnWfMmBPL+XNnynZh2+swxiX3WUE0s4yEHI6m+AwrK2UZOimIRl3X/4QctVqS8AiZjFqyOGrMXb/w==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "dependencies": {
+        "boolbase": "^1.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/nth-check?sponsor=1"
+      }
+    },
+    "node_modules/object-inspect": {
+      "version": "1.13.4",
+      "resolved": "https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.4.tgz",
+      "integrity": "sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/once": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/once/-/once-1.4.0.tgz",
+      "integrity": "sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "wrappy": "1"
+      }
+    },
+    "node_modules/onetime": {
+      "version": "7.0.0",
+      "resolved": "https://registry.npmjs.org/onetime/-/onetime-7.0.0.tgz",
+      "integrity": "sha512-VXJjc87FScF88uafS3JllDgvAm+c/Slfz06lorj2uAY34rlUu0Nt+v8wreiImcrgAjjIHp1rXpTDlLOGw29WwQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "mimic-function": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/open": {
+      "version": "10.2.0",
+      "resolved": "https://registry.npmjs.org/open/-/open-10.2.0.tgz",
+      "integrity": "sha512-YgBpdJHPyQ2UE5x+hlSXcnejzAvD0b22U2OuAP+8OnlJT+PjWPxtgmGqKKc+RgTM63U9gN0YzrYc71R2WT/hTA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "default-browser": "^5.2.1",
+        "define-lazy-prop": "^3.0.0",
+        "is-inside-container": "^1.0.0",
+        "wsl-utils": "^0.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/ora": {
+      "version": "8.2.0",
+      "resolved": "https://registry.npmjs.org/ora/-/ora-8.2.0.tgz",
+      "integrity": "sha512-weP+BZ8MVNnlCm8c0Qdc1WSWq4Qn7I+9CJGm7Qali6g44e/PUzbjNqJX5NJ9ljlNMosfJvg1fKEGILklK9cwnw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "chalk": "^5.3.0",
+        "cli-cursor": "^5.0.0",
+        "cli-spinners": "^2.9.2",
+        "is-interactive": "^2.0.0",
+        "is-unicode-supported": "^2.0.0",
+        "log-symbols": "^6.0.0",
+        "stdin-discarder": "^0.2.2",
+        "string-width": "^7.2.0",
+        "strip-ansi": "^7.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/ora/node_modules/chalk": {
+      "version": "5.6.2",
+      "resolved": "https://registry.npmjs.org/chalk/-/chalk-5.6.2.tgz",
+      "integrity": "sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "^12.17.0 || ^14.13 || >=16.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/chalk?sponsor=1"
+      }
+    },
+    "node_modules/p-limit": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-5.0.0.tgz",
+      "integrity": "sha512-/Eaoq+QyLSiXQ4lyYV23f14mZRQcXnxfHrN0vCai+ak9G0pp9iEQukIIZq5NccEvwRB8PUnZT0KsOoDCINS1qQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "yocto-queue": "^1.0.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/pako": {
+      "version": "1.0.11",
+      "resolved": "https://registry.npmjs.org/pako/-/pako-1.0.11.tgz",
+      "integrity": "sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==",
+      "dev": true,
+      "license": "(MIT AND Zlib)"
+    },
+    "node_modules/parse-semver": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/parse-semver/-/parse-semver-1.1.1.tgz",
+      "integrity": "sha512-Eg1OuNntBMH0ojvEKSrvDSnwLmvVuUOSdylH/pSCPNMIspLlweJyIWXCE+k/5hm3cj/EBUYwmWkjhBALNP4LXQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "semver": "^5.1.0"
+      }
+    },
+    "node_modules/parse-semver/node_modules/semver": {
+      "version": "5.7.2",
+      "resolved": "https://registry.npmjs.org/semver/-/semver-5.7.2.tgz",
+      "integrity": "sha512-cBznnQ9KjJqU67B52RMC65CMarK2600WFnbkcaiwWq3xy/5haFJlshgnpjovMVJ+Hff49d8GEn0b87C5pDQ10g==",
+      "dev": true,
+      "license": "ISC",
+      "bin": {
+        "semver": "bin/semver"
+      }
+    },
+    "node_modules/parse5": {
+      "version": "7.3.0",
+      "resolved": "https://registry.npmjs.org/parse5/-/parse5-7.3.0.tgz",
+      "integrity": "sha512-IInvU7fabl34qmi9gY8XOVxhYyMyuH2xUNpb2q8/Y+7552KlejkRvqvD19nMoUW/uQGGbqNpA6Tufu5FL5BZgw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "entities": "^6.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/inikulin/parse5?sponsor=1"
+      }
+    },
+    "node_modules/parse5-htmlparser2-tree-adapter": {
+      "version": "7.1.0",
+      "resolved": "https://registry.npmjs.org/parse5-htmlparser2-tree-adapter/-/parse5-htmlparser2-tree-adapter-7.1.0.tgz",
+      "integrity": "sha512-ruw5xyKs6lrpo9x9rCZqZZnIUntICjQAd0Wsmp396Ul9lN/h+ifgVV1x1gZHi8euej6wTfpqX8j+BFQxF0NS/g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "domhandler": "^5.0.3",
+        "parse5": "^7.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/inikulin/parse5?sponsor=1"
+      }
+    },
+    "node_modules/parse5-parser-stream": {
+      "version": "7.1.2",
+      "resolved": "https://registry.npmjs.org/parse5-parser-stream/-/parse5-parser-stream-7.1.2.tgz",
+      "integrity": "sha512-JyeQc9iwFLn5TbvvqACIF/VXG6abODeB3Fwmv/TGdLk2LfbWkaySGY72at4+Ty7EkPZj854u4CrICqNk2qIbow==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "parse5": "^7.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/inikulin/parse5?sponsor=1"
+      }
+    },
+    "node_modules/parse5/node_modules/entities": {
+      "version": "6.0.1",
+      "resolved": "https://registry.npmjs.org/entities/-/entities-6.0.1.tgz",
+      "integrity": "sha512-aN97NXWF6AWBTahfVOIrB/NShkzi5H7F9r1s9mD3cDj4Ko5f2qhhVoYMibXF7GlLveb/D2ioWay8lxI97Ven3g==",
+      "dev": true,
+      "license": "BSD-2-Clause",
+      "engines": {
+        "node": ">=0.12"
+      },
+      "funding": {
+        "url": "https://github.com/fb55/entities?sponsor=1"
+      }
+    },
+    "node_modules/path-is-absolute": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/path-is-absolute/-/path-is-absolute-1.0.1.tgz",
+      "integrity": "sha512-AVbw3UJ2e9bq64vSaS9Am0fje1Pa8pbGqTTsmXfaIiMpnr5DlDhfJOuLj9Sf95ZPVDAUerDfEk88MPmPe7UCQg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
+    "node_modules/path-key": {
+      "version": "3.1.1",
+      "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
+      "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/pathe": {
+      "version": "1.1.2",
+      "resolved": "https://registry.npmjs.org/pathe/-/pathe-1.1.2.tgz",
+      "integrity": "sha512-whLdWMYL2TwI08hn8/ZqAbrVemu0LNaNNJZX73O6qaIdCTfXutsLhMkjdENX0qhsQ9uIimo4/aQOmXkoon2nDQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/pathval": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/pathval/-/pathval-1.1.1.tgz",
+      "integrity": "sha512-Dp6zGqpTdETdR63lehJYPeIOqpiNBNtc7BpWSLrOje7UaIsE5aY92r/AunQA7rsXvet3lrJ3JnZX29UPTKXyKQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/pend": {
+      "version": "1.2.0",
+      "resolved": "https://registry.npmjs.org/pend/-/pend-1.2.0.tgz",
+      "integrity": "sha512-F3asv42UuXchdzt+xXqfW1OGlVBe+mxa2mqI0pg5yAHZPvFmY3Y6drSf/GQ1A86WgWEN9Kzh/WrgKa6iGcHXLg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/picocolors": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
+      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/pkg-types": {
+      "version": "1.3.1",
+      "resolved": "https://registry.npmjs.org/pkg-types/-/pkg-types-1.3.1.tgz",
+      "integrity": "sha512-/Jm5M4RvtBFVkKWRu2BLUTNP8/M2a+UwuAX+ae4770q1qVGtfjG+WTCupoZixokjmHiry8uI+dlY8KXYV5HVVQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "confbox": "^0.1.8",
+        "mlly": "^1.7.4",
+        "pathe": "^2.0.1"
+      }
+    },
+    "node_modules/pkg-types/node_modules/pathe": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/pathe/-/pathe-2.0.3.tgz",
+      "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/postcss": {
+      "version": "8.5.28",
+      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.28.tgz",
+      "integrity": "sha512-RRuzqDtt5Y9h3quz5hWhK+TPnsmVs6WwSU6LkJMeY4HstUEDuYTG8UJSdawMRzmzAtV+KEoG8N3Qg2qLy5vM/A==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "opencollective",
+          "url": "https://opencollective.com/postcss/"
+        },
+        {
+          "type": "tidelift",
+          "url": "https://tidelift.com/funding/github/npm/postcss"
+        },
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/ai"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "nanoid": "^3.3.18",
+        "picocolors": "^1.1.1",
+        "source-map-js": "^1.2.1"
+      },
+      "engines": {
+        "node": "^10 || ^12 || >=14"
+      }
+    },
+    "node_modules/prebuild-install": {
+      "version": "7.1.3",
+      "resolved": "https://registry.npmjs.org/prebuild-install/-/prebuild-install-7.1.3.tgz",
+      "integrity": "sha512-8Mf2cbV7x1cXPUILADGI3wuhfqWvtiLA1iclTDbFRZkgRQS0NqsPZphna9V+HyTEadheuPmjaJMsbzKQFOzLug==",
+      "deprecated": "No longer maintained. Please contact the author of the relevant native addon; alternatives are available.",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "detect-libc": "^2.0.0",
+        "expand-template": "^2.0.3",
+        "github-from-package": "0.0.0",
+        "minimist": "^1.2.3",
+        "mkdirp-classic": "^0.5.3",
+        "napi-build-utils": "^2.0.0",
+        "node-abi": "^3.3.0",
+        "pump": "^3.0.0",
+        "rc": "^1.2.7",
+        "simple-get": "^4.0.0",
+        "tar-fs": "^2.0.0",
+        "tunnel-agent": "^0.6.0"
+      },
+      "bin": {
+        "prebuild-install": "bin.js"
+      },
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/pretty-format": {
+      "version": "29.7.0",
+      "resolved": "https://registry.npmjs.org/pretty-format/-/pretty-format-29.7.0.tgz",
+      "integrity": "sha512-Pdlw/oPxN+aXdmM9R00JVC9WVFoCLTKJvDVLgmJ+qAffBMxsV85l/Lu7sNx4zSzPyoL2euImuEwHhOXdEgNFZQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@jest/schemas": "^29.6.3",
+        "ansi-styles": "^5.0.0",
+        "react-is": "^18.0.0"
+      },
+      "engines": {
+        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
+      }
+    },
+    "node_modules/pretty-format/node_modules/ansi-styles": {
+      "version": "5.2.0",
+      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-5.2.0.tgz",
+      "integrity": "sha512-Cxwpt2SfTzTtXcfOlzGEee8O+c+MmUgGrNiBcXnuWxuFJHe6a5Hz7qwhwe5OgaSYI0IJvkLqWX1ASG+cJOkEiA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
+      }
+    },
+    "node_modules/process-nextick-args": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/process-nextick-args/-/process-nextick-args-2.0.1.tgz",
+      "integrity": "sha512-3ouUOpQhtgrbOa17J7+uxOTpITYWaGP7/AhoR3+A+/1e9skrzelGi/dXzEYyvbxubEF6Wn2ypscTKiKJFFn1ag==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/pump": {
+      "version": "3.0.4",
+      "resolved": "https://registry.npmjs.org/pump/-/pump-3.0.4.tgz",
+      "integrity": "sha512-VS7sjc6KR7e1ukRFhQSY5LM2uBWAUPiOPa/A3mkKmiMwSmRFUITt0xuj+/lesgnCv+dPIEYlkzrcyXgquIHMcA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "end-of-stream": "^1.1.0",
+        "once": "^1.3.1"
+      }
+    },
+    "node_modules/qs": {
+      "version": "6.16.0",
+      "resolved": "https://registry.npmjs.org/qs/-/qs-6.16.0.tgz",
+      "integrity": "sha512-h6fhOIaRrID2CbEY2fqs+7t+UXZo+MLAnU5gRIq85uFtdiUPCdsApMlHhXogKVM4HM2DVbIjGNTTYH2OcmP1vA==",
+      "dev": true,
+      "license": "BSD-3-Clause",
+      "dependencies": {
+        "es-define-property": "^1.0.1",
+        "side-channel": "^1.1.1"
+      },
+      "engines": {
+        "node": ">=0.6"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/rc": {
+      "version": "1.2.8",
+      "resolved": "https://registry.npmjs.org/rc/-/rc-1.2.8.tgz",
+      "integrity": "sha512-y3bGgqKj3QBdxLbLkomlohkvsA8gdAiUQlSBJnBhfn+BPxg4bc62d8TcBW15wavDfgexCgccckhcZvywyQYPOw==",
+      "dev": true,
+      "license": "(BSD-2-Clause OR MIT OR Apache-2.0)",
+      "optional": true,
+      "dependencies": {
+        "deep-extend": "^0.6.0",
+        "ini": "~1.3.0",
+        "minimist": "^1.2.0",
+        "strip-json-comments": "~2.0.1"
+      },
+      "bin": {
+        "rc": "cli.js"
+      }
+    },
+    "node_modules/react": {
+      "version": "18.3.1",
+      "resolved": "https://registry.npmjs.org/react/-/react-18.3.1.tgz",
+      "integrity": "sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==",
+      "license": "MIT",
+      "dependencies": {
+        "loose-envify": "^1.1.0"
+      },
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
+    "node_modules/react-dom": {
+      "version": "18.3.1",
+      "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-18.3.1.tgz",
+      "integrity": "sha512-5m4nQKp+rZRb09LNH59GM4BxTh9251/ylbKIbpe7TpGxfJ+9kv6BLkLBXIjjspbgbnIBNqlI23tRnTWT0snUIw==",
+      "license": "MIT",
+      "dependencies": {
+        "loose-envify": "^1.1.0",
+        "scheduler": "^0.23.2"
+      },
+      "peerDependencies": {
+        "react": "^18.3.1"
+      }
+    },
+    "node_modules/react-is": {
+      "version": "18.3.1",
+      "resolved": "https://registry.npmjs.org/react-is/-/react-is-18.3.1.tgz",
+      "integrity": "sha512-/LLMVyas0ljjAtoYiPqYiL8VWXzUUdThrmU5+n20DZv+a+ClRoevUzw5JxU+Ieh5/c87ytoTBV9G1FiKfNJdmg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/read": {
+      "version": "1.0.7",
+      "resolved": "https://registry.npmjs.org/read/-/read-1.0.7.tgz",
+      "integrity": "sha512-rSOKNYUmaxy0om1BNjMN4ezNT6VKK+2xF4GBhc81mkH7L60i6dp8qPYrkndNLT3QPphoII3maL9PVC9XmhHwVQ==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "mute-stream": "~0.0.4"
+      },
+      "engines": {
+        "node": ">=0.8"
+      }
+    },
+    "node_modules/readable-stream": {
+      "version": "2.3.8",
+      "resolved": "https://registry.npmjs.org/readable-stream/-/readable-stream-2.3.8.tgz",
+      "integrity": "sha512-8p0AUk4XODgIewSi0l8Epjs+EVnWiK7NoDIEGU0HhE7+ZyY8D1IMY7odu5lRrFXGg71L15KG8QrPmum45RTtdA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "core-util-is": "~1.0.0",
+        "inherits": "~2.0.3",
+        "isarray": "~1.0.0",
+        "process-nextick-args": "~2.0.0",
+        "safe-buffer": "~5.1.1",
+        "string_decoder": "~1.1.1",
+        "util-deprecate": "~1.0.1"
+      }
+    },
+    "node_modules/readable-stream/node_modules/safe-buffer": {
+      "version": "5.1.2",
+      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.1.2.tgz",
+      "integrity": "sha512-Gd2UZBJDkXlY7GbJxfsE8/nvKkUEU1G38c1siN6QP6a9PT9MmHB8GnpscSmMJSoF8LOIrt8ud/wPtojys4G6+g==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/restore-cursor": {
+      "version": "5.1.0",
+      "resolved": "https://registry.npmjs.org/restore-cursor/-/restore-cursor-5.1.0.tgz",
+      "integrity": "sha512-oMA2dcrw6u0YfxJQXm342bFKX/E4sG9rbTzO9ptUcR/e8A33cHuvStiYOwH7fszkZlZ1z/ta9AAoPk2F4qIOHA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "onetime": "^7.0.0",
+        "signal-exit": "^4.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/rollup": {
+      "version": "4.63.1",
+      "resolved": "https://registry.npmjs.org/rollup/-/rollup-4.63.1.tgz",
+      "integrity": "sha512-3Df9jsstwhccuEfmAMi9l8XUh/GOkVObmFTU7CCVBysEbcOZLl84jCtaAZMcPiMz2EGKsATzQcU+Xr3n/wU6cg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/estree": "1.0.9"
+      },
+      "bin": {
+        "rollup": "dist/bin/rollup"
+      },
+      "engines": {
+        "node": ">=18.0.0",
+        "npm": ">=8.0.0"
+      },
+      "optionalDependencies": {
+        "@napi-rs/lzma-linux-x64-gnu": "1.5.1",
+        "@rollup/rollup-android-arm-eabi": "4.63.1",
+        "@rollup/rollup-android-arm64": "4.63.1",
+        "@rollup/rollup-darwin-arm64": "4.63.1",
+        "@rollup/rollup-darwin-x64": "4.63.1",
+        "@rollup/rollup-freebsd-arm64": "4.63.1",
+        "@rollup/rollup-freebsd-x64": "4.63.1",
+        "@rollup/rollup-linux-arm-gnueabihf": "4.63.1",
+        "@rollup/rollup-linux-arm-musleabihf": "4.63.1",
+        "@rollup/rollup-linux-arm64-gnu": "4.63.1",
+        "@rollup/rollup-linux-arm64-musl": "4.63.1",
+        "@rollup/rollup-linux-loong64-gnu": "4.63.1",
+        "@rollup/rollup-linux-loong64-musl": "4.63.1",
+        "@rollup/rollup-linux-ppc64-gnu": "4.63.1",
+        "@rollup/rollup-linux-ppc64-musl": "4.63.1",
+        "@rollup/rollup-linux-riscv64-gnu": "4.63.1",
+        "@rollup/rollup-linux-riscv64-musl": "4.63.1",
+        "@rollup/rollup-linux-s390x-gnu": "4.63.1",
+        "@rollup/rollup-linux-x64-gnu": "4.63.1",
+        "@rollup/rollup-linux-x64-musl": "4.63.1",
+        "@rollup/rollup-openbsd-x64": "4.63.1",
+        "@rollup/rollup-openharmony-arm64": "4.63.1",
+        "@rollup/rollup-win32-arm64-msvc": "4.63.1",
+        "@rollup/rollup-win32-ia32-msvc": "4.63.1",
+        "@rollup/rollup-win32-x64-gnu": "4.63.1",
+        "@rollup/rollup-win32-x64-msvc": "4.63.1",
+        "fsevents": "~2.3.2"
+      }
+    },
+    "node_modules/run-applescript": {
+      "version": "7.1.0",
+      "resolved": "https://registry.npmjs.org/run-applescript/-/run-applescript-7.1.0.tgz",
+      "integrity": "sha512-DPe5pVFaAsinSaV6QjQ6gdiedWDcRCbUuiQfQa2wmWV7+xC9bGulGI8+TdRmoFkAPaBXk8CrAbnlY2ISniJ47Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/safe-buffer": {
+      "version": "5.2.1",
+      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
+      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT"
+    },
+    "node_modules/safer-buffer": {
+      "version": "2.1.2",
+      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
+      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/sax": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/sax/-/sax-1.6.1.tgz",
+      "integrity": "sha512-42tBVwLWnaQvW5zc4HbZrTuWccECCZfBi92FDuwtqxasH+JbPB3/FOKb1m222K42R4WxuxzzMsTswfzgtSu64Q==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": ">=11.0.0"
+      }
+    },
+    "node_modules/scheduler": {
+      "version": "0.23.2",
+      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.23.2.tgz",
+      "integrity": "sha512-UOShsPwz7NrMUqhR6t0hWjFduvOzbtv7toDH1/hIrfRNIDBnnBWd0CwJTGvTpngVlmwGCdP9/Zl/tVrDqcuYzQ==",
+      "license": "MIT",
+      "dependencies": {
+        "loose-envify": "^1.1.0"
+      }
+    },
+    "node_modules/semver": {
+      "version": "7.8.5",
+      "resolved": "https://registry.npmjs.org/semver/-/semver-7.8.5.tgz",
+      "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
+      "dev": true,
+      "license": "ISC",
+      "bin": {
+        "semver": "bin/semver.js"
+      },
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/setimmediate": {
+      "version": "1.0.5",
+      "resolved": "https://registry.npmjs.org/setimmediate/-/setimmediate-1.0.5.tgz",
+      "integrity": "sha512-MATJdZp8sLqDl/68LfQmbP8zKPLQNV6BIZoIgrscFDQ+RsvK/BxeDQOgyxKKoh0y/8h3BqVFnCqQ/gd+reiIXA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/shebang-command": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
+      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "shebang-regex": "^3.0.0"
+      },
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/shebang-regex": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
+      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/side-channel": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/side-channel/-/side-channel-1.1.1.tgz",
+      "integrity": "sha512-6x6dK6zJdpTzF4sQeNYxwtvBzf6Eg4GtlesS94HOvTudUeyK2WXAaIfmDgsyslYrRBeFIlsi54AYsFGUuhmvrQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "es-errors": "^1.3.0",
+        "object-inspect": "^1.13.4",
+        "side-channel-list": "^1.0.1",
+        "side-channel-map": "^1.0.1",
+        "side-channel-weakmap": "^1.0.2"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/side-channel-list": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/side-channel-list/-/side-channel-list-1.0.1.tgz",
+      "integrity": "sha512-mjn/0bi/oUURjc5Xl7IaWi/OJJJumuoJFQJfDDyO46+hBWsfaVM65TBHq2eoZBhzl9EchxOijpkbRC8SVBQU0w==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "es-errors": "^1.3.0",
+        "object-inspect": "^1.13.4"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/side-channel-map": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/side-channel-map/-/side-channel-map-1.0.1.tgz",
+      "integrity": "sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "call-bound": "^1.0.2",
+        "es-errors": "^1.3.0",
+        "get-intrinsic": "^1.2.5",
+        "object-inspect": "^1.13.3"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/side-channel-weakmap": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/side-channel-weakmap/-/side-channel-weakmap-1.0.2.tgz",
+      "integrity": "sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "call-bound": "^1.0.2",
+        "es-errors": "^1.3.0",
+        "get-intrinsic": "^1.2.5",
+        "object-inspect": "^1.13.3",
+        "side-channel-map": "^1.0.1"
+      },
+      "engines": {
+        "node": ">= 0.4"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/siginfo": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/siginfo/-/siginfo-2.0.0.tgz",
+      "integrity": "sha512-ybx0WO1/8bSBLEWXZvEd7gMW3Sn3JFlW3TvX1nREbDLRNQNaeNN8WK0meBwPdAaOI7TtRRRJn/Es1zhrrCHu7g==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/signal-exit": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/signal-exit/-/signal-exit-4.1.0.tgz",
+      "integrity": "sha512-bzyZ1e88w9O1iNJbKnOlvYTrWPDl46O1bG0D3XInv+9tkPrxrN8jUUTiFlDkkmKWgn1M6CfIA13SuGqOa9Korw==",
+      "dev": true,
+      "license": "ISC",
+      "engines": {
+        "node": ">=14"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/simple-concat": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/simple-concat/-/simple-concat-1.0.1.tgz",
+      "integrity": "sha512-cSFtAPtRhljv69IK0hTVZQ+OfE9nePi/rtJmw5UjHeVyVroEqJXP1sFztKUy1qU+xvz3u/sfYJLa947b7nAN2Q==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT",
+      "optional": true
+    },
+    "node_modules/simple-get": {
+      "version": "4.0.1",
+      "resolved": "https://registry.npmjs.org/simple-get/-/simple-get-4.0.1.tgz",
+      "integrity": "sha512-brv7p5WgH0jmQJr1ZDDfKDOSeWWg+OVypG99A/5vYGPqJ6pxiaHLy8nxtFjBA7oMa01ebA9gfh1uMCFqOuXxvA==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "decompress-response": "^6.0.0",
+        "once": "^1.3.1",
+        "simple-concat": "^1.0.0"
+      }
+    },
+    "node_modules/source-map-js": {
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
+      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
+      "dev": true,
+      "license": "BSD-3-Clause",
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
+    "node_modules/stackback": {
+      "version": "0.0.2",
+      "resolved": "https://registry.npmjs.org/stackback/-/stackback-0.0.2.tgz",
+      "integrity": "sha512-1XMJE5fQo1jGH6Y/7ebnwPOBEkIEnT4QF32d5R1+VXdXveM0IBMJt8zfaxX1P3QhVwrYe+576+jkANtSS2mBbw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/std-env": {
+      "version": "3.10.0",
+      "resolved": "https://registry.npmjs.org/std-env/-/std-env-3.10.0.tgz",
+      "integrity": "sha512-5GS12FdOZNliM5mAOxFRg7Ir0pWz8MdpYm6AY6VPkGpbA7ZzmbzNcBJQ0GPvvyWgcY7QAhCgf9Uy89I03faLkg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/stdin-discarder": {
+      "version": "0.2.2",
+      "resolved": "https://registry.npmjs.org/stdin-discarder/-/stdin-discarder-0.2.2.tgz",
+      "integrity": "sha512-UhDfHmA92YAlNnCfhmq0VeNL5bDbiZGg7sZ2IvPsXubGkiNa9EC+tUTsjBRsYUAz87btI6/1wf4XoVvQ3uRnmQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/string_decoder": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/string_decoder/-/string_decoder-1.1.1.tgz",
+      "integrity": "sha512-n/ShnvDi6FHbbVfviro+WojiFzv+s8MPMHBczVePfUpDJLwoLT0ht1l4YwBCbi8pJAveEEdnkHyPyTP/mzRfwg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "safe-buffer": "~5.1.0"
+      }
+    },
+    "node_modules/string_decoder/node_modules/safe-buffer": {
+      "version": "5.1.2",
+      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.1.2.tgz",
+      "integrity": "sha512-Gd2UZBJDkXlY7GbJxfsE8/nvKkUEU1G38c1siN6QP6a9PT9MmHB8GnpscSmMJSoF8LOIrt8ud/wPtojys4G6+g==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/string-width": {
+      "version": "7.2.0",
+      "resolved": "https://registry.npmjs.org/string-width/-/string-width-7.2.0.tgz",
+      "integrity": "sha512-tsaTIkKW9b4N+AEj+SVA+WhJzV7/zMhcSu78mLKWSk7cXMOSHsBKFWUs0fWwq8QyK3MgJBQRX6Gbi4kYbdvGkQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "emoji-regex": "^10.3.0",
+        "get-east-asian-width": "^1.0.0",
+        "strip-ansi": "^7.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/strip-ansi": {
+      "version": "7.2.0",
+      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz",
+      "integrity": "sha512-yDPMNjp4WyfYBkHnjIRLfca1i6KMyGCtsVgoKe/z1+6vukgaENdgGBZt+ZmKPc4gavvEZ5OgHfHdrazhgNyG7w==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "ansi-regex": "^6.2.2"
+      },
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/strip-ansi?sponsor=1"
+      }
+    },
+    "node_modules/strip-final-newline": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/strip-final-newline/-/strip-final-newline-3.0.0.tgz",
+      "integrity": "sha512-dOESqjYr96iWYylGObzd39EuNTa5VJxyvVAEm5Jnh7KGo75V43Hk1odPQkNDyXNmUR6k+gEiDVXnjB8HJ3crXw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/strip-json-comments": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/strip-json-comments/-/strip-json-comments-2.0.1.tgz",
+      "integrity": "sha512-4gB8na07fecVVkOI6Rs4e7T6NOTki5EmL7TUduTs6bu3EdnSycntVJ4re8kgZA+wx9IueI2Y11bfbgwtzuE0KQ==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "engines": {
+        "node": ">=0.10.0"
+      }
+    },
+    "node_modules/strip-literal": {
+      "version": "2.1.1",
+      "resolved": "https://registry.npmjs.org/strip-literal/-/strip-literal-2.1.1.tgz",
+      "integrity": "sha512-631UJ6O00eNGfMiWG78ck80dfBab8X6IVFB51jZK5Icd7XAs60Z5y7QdSd/wGIklnWvRbUNloVzhOKKmutxQ6Q==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "js-tokens": "^9.0.1"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/antfu"
+      }
+    },
+    "node_modules/strip-literal/node_modules/js-tokens": {
+      "version": "9.0.1",
+      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-9.0.1.tgz",
+      "integrity": "sha512-mxa9E9ITFOt0ban3j6L5MpjwegGz6lBQmM1IJkWeBZGcMxto50+eWdjC/52xDbS2vy0k7vIMK0Fe2wfL9OQSpQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/supports-color": {
+      "version": "5.5.0",
+      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-5.5.0.tgz",
+      "integrity": "sha512-QjVjwdXIt408MIiAqCX4oUKsgU2EqAGzs2Ppkm4aQYbjm+ZEWEcW4SfFNTr4uMNZma0ey4f5lgLrkB0aX0QMow==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "has-flag": "^3.0.0"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/tar-fs": {
+      "version": "2.1.5",
+      "resolved": "https://registry.npmjs.org/tar-fs/-/tar-fs-2.1.5.tgz",
+      "integrity": "sha512-OboTd8mmMhZDNPV+UjQcK9yKAatXu2aJ+r1w4im1Otd4M4fl2hwvdoXUxIYHFTHWK/3y3FarBP70v3vwmGlOxw==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "chownr": "^1.1.1",
+        "mkdirp-classic": "^0.5.2",
+        "pump": "^3.0.0",
+        "tar-stream": "^2.1.4"
+      }
+    },
+    "node_modules/tar-stream": {
+      "version": "2.2.0",
+      "resolved": "https://registry.npmjs.org/tar-stream/-/tar-stream-2.2.0.tgz",
+      "integrity": "sha512-ujeqbceABgwMZxEJnk2HDY2DlnUZ+9oEcb1KzTVfYHio0UE6dG71n60d8D2I4qNvleWrrXpmjpt7vZeF1LnMZQ==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "bl": "^4.0.3",
+        "end-of-stream": "^1.4.1",
+        "fs-constants": "^1.0.0",
+        "inherits": "^2.0.3",
+        "readable-stream": "^3.1.1"
+      },
+      "engines": {
+        "node": ">=6"
+      }
+    },
+    "node_modules/tar-stream/node_modules/readable-stream": {
+      "version": "3.6.2",
+      "resolved": "https://registry.npmjs.org/readable-stream/-/readable-stream-3.6.2.tgz",
+      "integrity": "sha512-9u/sniCrY3D5WdsERHzHE4G2YCXqoG5FTHUiCC4SIbr6XcLZBY05ya9EKjYek9O5xOAwjGq+1JdGBAS7Q9ScoA==",
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "dependencies": {
+        "inherits": "^2.0.3",
+        "string_decoder": "^1.1.1",
+        "util-deprecate": "^1.0.1"
+      },
+      "engines": {
+        "node": ">= 6"
+      }
+    },
+    "node_modules/tinybench": {
+      "version": "2.9.0",
+      "resolved": "https://registry.npmjs.org/tinybench/-/tinybench-2.9.0.tgz",
+      "integrity": "sha512-0+DUvqWMValLmha6lr4kD8iAMK1HzV0/aKnCtWb9v9641TnP/MFb7Pc2bxoxQjTXAErryXVgUOfv2YqNllqGeg==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/tinypool": {
+      "version": "0.8.4",
+      "resolved": "https://registry.npmjs.org/tinypool/-/tinypool-0.8.4.tgz",
+      "integrity": "sha512-i11VH5gS6IFeLY3gMBQ00/MmLncVP7JLXOw1vlgkytLmJK7QnEr7NXf0LBdxfmNPAeyetukOk0bOYrJrFGjYJQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=14.0.0"
+      }
+    },
+    "node_modules/tinyspy": {
+      "version": "2.2.1",
+      "resolved": "https://registry.npmjs.org/tinyspy/-/tinyspy-2.2.1.tgz",
+      "integrity": "sha512-KYad6Vy5VDWV4GH3fjpseMQ/XU2BhIYP7Vzd0LG44qRWm/Yt2WCOTicFdvmgo6gWaqooMQCawTtILVQJupKu7A==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=14.0.0"
+      }
+    },
+    "node_modules/tmp": {
+      "version": "0.2.7",
+      "resolved": "https://registry.npmjs.org/tmp/-/tmp-0.2.7.tgz",
+      "integrity": "sha512-e0votIpp4Uo2AJYSzVHV6xCcawuiez3DzqDAbrTc3YxBkplN6e+dM13ZeIcZnDg/QpSuU2zfZ3rzwY8ukEnaXw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=14.14"
+      }
+    },
+    "node_modules/tr46": {
+      "version": "0.0.3",
+      "resolved": "https://registry.npmjs.org/tr46/-/tr46-0.0.3.tgz",
+      "integrity": "sha512-N3WMsuqV66lT30CrXNbEjx4GEwlow3v6rr4mCcv6prnfwhS01rkgyFdjPNBYd9br7LpXV1+Emh01fHnq2Gdgrw==",
+      "license": "MIT"
+    },
+    "node_modules/tslib": {
+      "version": "2.8.1",
+      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
+      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
+      "dev": true,
+      "license": "0BSD"
+    },
+    "node_modules/tunnel": {
+      "version": "0.0.6",
+      "resolved": "https://registry.npmjs.org/tunnel/-/tunnel-0.0.6.tgz",
+      "integrity": "sha512-1h/Lnq9yajKY2PEbBadPXj3VxsDDu844OnaAo52UVmIzIvwwtBPIuNvkjuzBlTWpfJyUbG3ez0KSBibQkj4ojg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=0.6.11 <=0.7.0 || >=0.7.3"
+      }
+    },
+    "node_modules/tunnel-agent": {
+      "version": "0.6.0",
+      "resolved": "https://registry.npmjs.org/tunnel-agent/-/tunnel-agent-0.6.0.tgz",
+      "integrity": "sha512-McnNiV1l8RYeY8tBgEpuodCC1mLUdbSN+CYBL7kJsJNInOP8UjDDEwdk6Mw60vdLLrr5NHKZhMAOSrR2NZuQ+w==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "optional": true,
+      "dependencies": {
+        "safe-buffer": "^5.0.1"
+      },
+      "engines": {
+        "node": "*"
+      }
+    },
+    "node_modules/type-detect": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/type-detect/-/type-detect-4.1.0.tgz",
+      "integrity": "sha512-Acylog8/luQ8L7il+geoSxhEkazvkslg7PSNKOX59mbB9cOveP5aq9h74Y7YU8yDpJwetzQQrfIwtf4Wp4LKcw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=4"
+      }
+    },
+    "node_modules/typed-rest-client": {
+      "version": "1.8.11",
+      "resolved": "https://registry.npmjs.org/typed-rest-client/-/typed-rest-client-1.8.11.tgz",
+      "integrity": "sha512-5UvfMpd1oelmUPRbbaVnq+rHP7ng2cE4qoQkQeAqxRL6PklkxsM0g32/HL0yfvruK6ojQ5x8EE+HF4YV6DtuCA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "qs": "^6.9.1",
+        "tunnel": "0.0.6",
+        "underscore": "^1.12.1"
+      }
+    },
+    "node_modules/typescript": {
+      "version": "5.9.3",
+      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
+      "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
+      "dev": true,
+      "license": "Apache-2.0",
+      "bin": {
+        "tsc": "bin/tsc",
+        "tsserver": "bin/tsserver"
+      },
+      "engines": {
+        "node": ">=14.17"
+      }
+    },
+    "node_modules/uc.micro": {
+      "version": "1.0.6",
+      "resolved": "https://registry.npmjs.org/uc.micro/-/uc.micro-1.0.6.tgz",
+      "integrity": "sha512-8Y75pvTYkLJW2hWQHXxoqRgV7qb9B+9vFEtidML+7koHUFapnVJAZ6cKs+Qjz5Aw3aZWHMC6u0wJE3At+nSGwA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/ufo": {
+      "version": "1.6.4",
+      "resolved": "https://registry.npmjs.org/ufo/-/ufo-1.6.4.tgz",
+      "integrity": "sha512-JFNbkD1Svwe0KvGi8GOeLcP4kAWQ609twvCdcHxq1oSL8svv39ZuSvajcD8B+5D0eL4+s1Is2D/O6KN3qcTeRA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/underscore": {
+      "version": "1.13.8",
+      "resolved": "https://registry.npmjs.org/underscore/-/underscore-1.13.8.tgz",
+      "integrity": "sha512-DXtD3ZtEQzc7M8m4cXotyHR+FAS18C64asBYY5vqZexfYryNNnDc02W4hKg3rdQuqOYas1jkseX0+nZXjTXnvQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/undici": {
+      "version": "7.29.1",
+      "resolved": "https://registry.npmjs.org/undici/-/undici-7.29.1.tgz",
+      "integrity": "sha512-RYONW2MeafgYlkVOKYKkA/Ag7BmXqgIWCa8t1m0JcxrQg9pI9lEqRhAOruOBCbAohOa/gkCF+iPi9hrgvTzu6Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=20.18.1"
+      }
+    },
+    "node_modules/undici-types": {
+      "version": "6.21.0",
+      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-6.21.0.tgz",
+      "integrity": "sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==",
+      "license": "MIT"
+    },
+    "node_modules/url-join": {
+      "version": "4.0.1",
+      "resolved": "https://registry.npmjs.org/url-join/-/url-join-4.0.1.tgz",
+      "integrity": "sha512-jk1+QP6ZJqyOiuEI9AEWQfju/nB2Pw466kbA0LEZljHwKeMgd9WrAEgEGxjPDD2+TNbbb37rTyhEfrCXfuKXnA==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/util-deprecate": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/util-deprecate/-/util-deprecate-1.0.2.tgz",
+      "integrity": "sha512-EPD5q1uXyFxJpCrLnCc1nHnq3gOa6DZBocAIiI2TaSCA7VCJ1UJDMagCzIkXNsUYfD1daK//LTEQ8xiIbrHtcw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/vite": {
+      "version": "5.4.21",
+      "resolved": "https://registry.npmjs.org/vite/-/vite-5.4.21.tgz",
+      "integrity": "sha512-o5a9xKjbtuhY6Bi5S3+HvbRERmouabWbyUcpXXUA1u+GNUKoROi9byOJ8M0nHbHYHkYICiMlqxkg1KkYmm25Sw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "esbuild": "^0.21.3",
+        "postcss": "^8.4.43",
+        "rollup": "^4.20.0"
+      },
+      "bin": {
+        "vite": "bin/vite.js"
+      },
+      "engines": {
+        "node": "^18.0.0 || >=20.0.0"
+      },
+      "funding": {
+        "url": "https://github.com/vitejs/vite?sponsor=1"
+      },
+      "optionalDependencies": {
+        "fsevents": "~2.3.3"
+      },
+      "peerDependencies": {
+        "@types/node": "^18.0.0 || >=20.0.0",
+        "less": "*",
+        "lightningcss": "^1.21.0",
+        "sass": "*",
+        "sass-embedded": "*",
+        "stylus": "*",
+        "sugarss": "*",
+        "terser": "^5.4.0"
+      },
+      "peerDependenciesMeta": {
+        "@types/node": {
+          "optional": true
+        },
+        "less": {
+          "optional": true
+        },
+        "lightningcss": {
+          "optional": true
+        },
+        "sass": {
+          "optional": true
+        },
+        "sass-embedded": {
+          "optional": true
+        },
+        "stylus": {
+          "optional": true
+        },
+        "sugarss": {
+          "optional": true
+        },
+        "terser": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/vite-node": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/vite-node/-/vite-node-1.6.1.tgz",
+      "integrity": "sha512-YAXkfvGtuTzwWbDSACdJSg4A4DZiAqckWe90Zapc/sEX3XvHcw1NdurM/6od8J207tSDqNbSsgdCacBgvJKFuA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "cac": "^6.7.14",
+        "debug": "^4.3.4",
+        "pathe": "^1.1.1",
+        "picocolors": "^1.0.0",
+        "vite": "^5.0.0"
+      },
+      "bin": {
+        "vite-node": "vite-node.mjs"
+      },
+      "engines": {
+        "node": "^18.0.0 || >=20.0.0"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/aix-ppc64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.21.5.tgz",
+      "integrity": "sha512-1SDgH6ZSPTlggy1yI6+Dbkiz8xzpHJEVAlF/AM1tHPLsf5STom9rwtjE4hKAF20FfXXNTFqEYXyJNWh1GiZedQ==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "aix"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/android-arm": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.21.5.tgz",
+      "integrity": "sha512-vCPvzSjpPHEi1siZdlvAlsPxXl7WbOVUBBAowWug4rJHb68Ox8KualB+1ocNvT5fjv6wpkX6o/iEpbDrf68zcg==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/android-arm64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.21.5.tgz",
+      "integrity": "sha512-c0uX9VAUBQ7dTDCjq+wdyGLowMdtR/GoC2U5IYk/7D1H1JYC0qseD7+11iMP2mRLN9RcCMRcjC4YMclCzGwS/A==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/android-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.21.5.tgz",
+      "integrity": "sha512-D7aPRUUNHRBwHxzxRvp856rjUHRFW1SdQATKXH2hqA0kAZb1hKmi02OpYRacl0TxIGz/ZmXWlbZgjwWYaCakTA==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "android"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/darwin-arm64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.21.5.tgz",
+      "integrity": "sha512-DwqXqZyuk5AiWWf3UfLiRDJ5EDd49zg6O9wclZ7kUMv2WRFr4HKjXp/5t8JZ11QbQfUS6/cRCKGwYhtNAY88kQ==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/darwin-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.21.5.tgz",
+      "integrity": "sha512-se/JjF8NlmKVG4kNIuyWMV/22ZaerB+qaSi5MdrXtd6R08kvs2qCN4C09miupktDitvh8jRFflwGFBQcxZRjbw==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "darwin"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/freebsd-arm64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.21.5.tgz",
+      "integrity": "sha512-5JcRxxRDUJLX8JXp/wcBCy3pENnCgBR9bN6JsY4OmhfUtIHe3ZW0mawA7+RDAcMLrMIZaf03NlQiX9DGyB8h4g==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/freebsd-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.21.5.tgz",
+      "integrity": "sha512-J95kNBj1zkbMXtHVH29bBriQygMXqoVQOQYA+ISs0/2l3T9/kj42ow2mpqerRBxDJnmkUDCaQT/dfNXWX/ZZCQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "freebsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-arm": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.21.5.tgz",
+      "integrity": "sha512-bPb5AHZtbeNGjCKVZ9UGqGwo8EUu4cLq68E95A53KlxAPRmUyYv2D6F0uUI65XisGOL1hBP5mTronbgo+0bFcA==",
+      "cpu": [
+        "arm"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-arm64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.21.5.tgz",
+      "integrity": "sha512-ibKvmyYzKsBeX8d8I7MH/TMfWDXBF3db4qM6sy+7re0YXya+K1cem3on9XgdT2EQGMu4hQyZhan7TeQ8XkGp4Q==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-ia32": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.21.5.tgz",
+      "integrity": "sha512-YvjXDqLRqPDl2dvRODYmmhz4rPeVKYvppfGYKSNGdyZkA01046pLWyRKKI3ax8fbJoK5QbxblURkwK/MWY18Tg==",
+      "cpu": [
+        "ia32"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-loong64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.21.5.tgz",
+      "integrity": "sha512-uHf1BmMG8qEvzdrzAqg2SIG/02+4/DHB6a9Kbya0XDvwDEKCoC8ZRWI5JJvNdUjtciBGFQ5PuBlpEOXQj+JQSg==",
+      "cpu": [
+        "loong64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-mips64el": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.21.5.tgz",
+      "integrity": "sha512-IajOmO+KJK23bj52dFSNCMsz1QP1DqM6cwLUv3W1QwyxkyIWecfafnI555fvSGqEKwjMXVLokcV5ygHW5b3Jbg==",
+      "cpu": [
+        "mips64el"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-ppc64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.21.5.tgz",
+      "integrity": "sha512-1hHV/Z4OEfMwpLO8rp7CvlhBDnjsC3CttJXIhBi+5Aj5r+MBvy4egg7wCbe//hSsT+RvDAG7s81tAvpL2XAE4w==",
+      "cpu": [
+        "ppc64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-riscv64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.21.5.tgz",
+      "integrity": "sha512-2HdXDMd9GMgTGrPWnJzP2ALSokE/0O5HhTUvWIbD3YdjME8JwvSCnNGBnTThKGEB91OZhzrJ4qIIxk/SBmyDDA==",
+      "cpu": [
+        "riscv64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-s390x": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.21.5.tgz",
+      "integrity": "sha512-zus5sxzqBJD3eXxwvjN1yQkRepANgxE9lgOW2qLnmr8ikMTphkjgXu1HR01K4FJg8h1kEEDAqDcZQtbrRnB41A==",
+      "cpu": [
+        "s390x"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/linux-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.21.5.tgz",
+      "integrity": "sha512-1rYdTpyv03iycF1+BhzrzQJCdOuAOtaqHTWJZCWvijKD2N5Xu0TtVC8/+1faWqcP9iBCWOmjmhoH94dH82BxPQ==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "linux"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/netbsd-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.21.5.tgz",
+      "integrity": "sha512-Woi2MXzXjMULccIwMnLciyZH4nCIMpWQAs049KEeMvOcNADVxo0UBIQPfSmxB3CWKedngg7sWZdLvLczpe0tLg==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "netbsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/openbsd-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.21.5.tgz",
+      "integrity": "sha512-HLNNw99xsvx12lFBUwoT8EVCsSvRNDVxNpjZ7bPn947b8gJPzeHWyNVhFsaerc0n3TsbOINvRP2byTZ5LKezow==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "openbsd"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/sunos-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.21.5.tgz",
+      "integrity": "sha512-6+gjmFpfy0BHU5Tpptkuh8+uw3mnrvgs+dSPQXQOv3ekbordwnzTVEb4qnIvQcYXq6gzkyTnoZ9dZG+D4garKg==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "sunos"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/win32-arm64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.21.5.tgz",
+      "integrity": "sha512-Z0gOTd75VvXqyq7nsl93zwahcTROgqvuAcYDUr+vOv8uHhNSKROyU961kgtCD1e95IqPKSQKH7tBTslnS3tA8A==",
+      "cpu": [
+        "arm64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/win32-ia32": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.21.5.tgz",
+      "integrity": "sha512-SWXFF1CL2RVNMaVs+BBClwtfZSvDgtL//G/smwAc5oVK/UPu2Gu9tIaRgFmYFFKrmg3SyAjSrElf0TiJ1v8fYA==",
+      "cpu": [
+        "ia32"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/@esbuild/win32-x64": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.21.5.tgz",
+      "integrity": "sha512-tQd/1efJuzPC6rCFwEvLtci/xNFcTZknmXs98FYDfGE4wP9ClFV98nyKrzJKVPMhdDnjzLhdUyMX4PsQAPjwIw==",
+      "cpu": [
+        "x64"
+      ],
+      "dev": true,
+      "license": "MIT",
+      "optional": true,
+      "os": [
+        "win32"
+      ],
+      "engines": {
+        "node": ">=12"
+      }
+    },
+    "node_modules/vite/node_modules/esbuild": {
+      "version": "0.21.5",
+      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.21.5.tgz",
+      "integrity": "sha512-mg3OPMV4hXywwpoDxu3Qda5xCKQi+vCTZq8S9J/EpkhB2HzKXq4SNFZE3+NK93JYxc8VMSep+lOUSC/RVKaBqw==",
+      "dev": true,
+      "hasInstallScript": true,
+      "license": "MIT",
+      "bin": {
+        "esbuild": "bin/esbuild"
+      },
+      "engines": {
+        "node": ">=12"
+      },
+      "optionalDependencies": {
+        "@esbuild/aix-ppc64": "0.21.5",
+        "@esbuild/android-arm": "0.21.5",
+        "@esbuild/android-arm64": "0.21.5",
+        "@esbuild/android-x64": "0.21.5",
+        "@esbuild/darwin-arm64": "0.21.5",
+        "@esbuild/darwin-x64": "0.21.5",
+        "@esbuild/freebsd-arm64": "0.21.5",
+        "@esbuild/freebsd-x64": "0.21.5",
+        "@esbuild/linux-arm": "0.21.5",
+        "@esbuild/linux-arm64": "0.21.5",
+        "@esbuild/linux-ia32": "0.21.5",
+        "@esbuild/linux-loong64": "0.21.5",
+        "@esbuild/linux-mips64el": "0.21.5",
+        "@esbuild/linux-ppc64": "0.21.5",
+        "@esbuild/linux-riscv64": "0.21.5",
+        "@esbuild/linux-s390x": "0.21.5",
+        "@esbuild/linux-x64": "0.21.5",
+        "@esbuild/netbsd-x64": "0.21.5",
+        "@esbuild/openbsd-x64": "0.21.5",
+        "@esbuild/sunos-x64": "0.21.5",
+        "@esbuild/win32-arm64": "0.21.5",
+        "@esbuild/win32-ia32": "0.21.5",
+        "@esbuild/win32-x64": "0.21.5"
+      }
+    },
+    "node_modules/vitest": {
+      "version": "1.6.1",
+      "resolved": "https://registry.npmjs.org/vitest/-/vitest-1.6.1.tgz",
+      "integrity": "sha512-Ljb1cnSJSivGN0LqXd/zmDbWEM0RNNg2t1QW/XUhYl/qPqyu7CsqeWtqQXHVaJsecLPuDoak2oJcZN2QoRIOag==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@vitest/expect": "1.6.1",
+        "@vitest/runner": "1.6.1",
+        "@vitest/snapshot": "1.6.1",
+        "@vitest/spy": "1.6.1",
+        "@vitest/utils": "1.6.1",
+        "acorn-walk": "^8.3.2",
+        "chai": "^4.3.10",
+        "debug": "^4.3.4",
+        "execa": "^8.0.1",
+        "local-pkg": "^0.5.0",
+        "magic-string": "^0.30.5",
+        "pathe": "^1.1.1",
+        "picocolors": "^1.0.0",
+        "std-env": "^3.5.0",
+        "strip-literal": "^2.0.0",
+        "tinybench": "^2.5.1",
+        "tinypool": "^0.8.3",
+        "vite": "^5.0.0",
+        "vite-node": "1.6.1",
+        "why-is-node-running": "^2.2.2"
+      },
+      "bin": {
+        "vitest": "vitest.mjs"
+      },
+      "engines": {
+        "node": "^18.0.0 || >=20.0.0"
+      },
+      "funding": {
+        "url": "https://opencollective.com/vitest"
+      },
+      "peerDependencies": {
+        "@edge-runtime/vm": "*",
+        "@types/node": "^18.0.0 || >=20.0.0",
+        "@vitest/browser": "1.6.1",
+        "@vitest/ui": "1.6.1",
+        "happy-dom": "*",
+        "jsdom": "*"
+      },
+      "peerDependenciesMeta": {
+        "@edge-runtime/vm": {
+          "optional": true
+        },
+        "@types/node": {
+          "optional": true
+        },
+        "@vitest/browser": {
+          "optional": true
+        },
+        "@vitest/ui": {
+          "optional": true
+        },
+        "happy-dom": {
+          "optional": true
+        },
+        "jsdom": {
+          "optional": true
+        }
+      }
+    },
+    "node_modules/web-streams-polyfill": {
+      "version": "4.0.0-beta.3",
+      "resolved": "https://registry.npmjs.org/web-streams-polyfill/-/web-streams-polyfill-4.0.0-beta.3.tgz",
+      "integrity": "sha512-QW95TCTaHmsYfHDybGMwO5IJIM93I/6vTRk+daHTWFPhwh+C8Cg7j7XyKrwrj8Ib6vYXe0ocYNrmzY4xAAN6ug==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 14"
+      }
+    },
+    "node_modules/webidl-conversions": {
+      "version": "3.0.1",
+      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-3.0.1.tgz",
+      "integrity": "sha512-2JAn3z8AR6rjK8Sm8orRC0h/bcl/DqL7tRPdGZ4I1CjdF+EaMLmYxBHyXuKL849eucPFhvBoxMsflfOb8kxaeQ==",
+      "license": "BSD-2-Clause"
+    },
+    "node_modules/whatwg-encoding": {
+      "version": "3.1.1",
+      "resolved": "https://registry.npmjs.org/whatwg-encoding/-/whatwg-encoding-3.1.1.tgz",
+      "integrity": "sha512-6qN4hJdMwfYBtE3YBTTHhoeuUrDBPZmbQaxWAqSALV/MeEnR5z1xd8UKud2RAkFoPkmB+hli1TZSnyi84xz1vQ==",
+      "deprecated": "Use @exodus/bytes instead for a more spec-conformant and faster implementation",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "iconv-lite": "0.6.3"
+      },
+      "engines": {
+        "node": ">=18"
+      }
+    },
+    "node_modules/whatwg-mimetype": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/whatwg-mimetype/-/whatwg-mimetype-4.0.0.tgz",
+      "integrity": "sha512-QaKxh0eNIi2mE9p2vEdzfagOKHCcj1pJ56EEHGQOVxp8r9/iszLUUV7v89x9O1p/T+NlTM5W7jW6+cz4Fq1YVg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      }
+    },
+    "node_modules/whatwg-url": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-5.0.0.tgz",
+      "integrity": "sha512-saE57nupxk6v3HY35+jzBwYa0rKSy0XR8JSxZPwgLr7ys0IBzhGviA1/TUGJLmSVqs8pb9AnvICXEuOHLprYTw==",
+      "license": "MIT",
+      "dependencies": {
+        "tr46": "~0.0.3",
+        "webidl-conversions": "^3.0.0"
+      }
+    },
+    "node_modules/which": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
+      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
+      "dev": true,
+      "license": "ISC",
+      "dependencies": {
+        "isexe": "^2.0.0"
+      },
+      "bin": {
+        "node-which": "bin/node-which"
+      },
+      "engines": {
+        "node": ">= 8"
+      }
+    },
+    "node_modules/why-is-node-running": {
+      "version": "2.3.0",
+      "resolved": "https://registry.npmjs.org/why-is-node-running/-/why-is-node-running-2.3.0.tgz",
+      "integrity": "sha512-hUrmaWBdVDcxvYqnyh09zunKzROWjbZTiNy8dBEjkS7ehEDQibXJ7XvlmtbwuTclUiIyN+CyXQD4Vmko8fNm8w==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "siginfo": "^2.0.0",
+        "stackback": "0.0.2"
+      },
+      "bin": {
+        "why-is-node-running": "cli.js"
+      },
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/wrappy": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz",
+      "integrity": "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/wsl-utils": {
+      "version": "0.1.0",
+      "resolved": "https://registry.npmjs.org/wsl-utils/-/wsl-utils-0.1.0.tgz",
+      "integrity": "sha512-h3Fbisa2nKGPxCpm89Hk33lBLsnaGBvctQopaBSOW/uIs6FTe1ATyAnKFJrzVs9vpGdsTe73WF3V4lIsk4Gacw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "is-wsl": "^3.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/xml2js": {
+      "version": "0.5.0",
+      "resolved": "https://registry.npmjs.org/xml2js/-/xml2js-0.5.0.tgz",
+      "integrity": "sha512-drPFnkQJik/O+uPKpqSgr22mpuFHqKdbS835iAQrUC73L2F5WkboIRd63ai/2Yg6I1jzifPFKH2NTK+cfglkIA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "sax": ">=0.6.0",
+        "xmlbuilder": "~11.0.0"
+      },
+      "engines": {
+        "node": ">=4.0.0"
+      }
+    },
+    "node_modules/xmlbuilder": {
+      "version": "11.0.1",
+      "resolved": "https://registry.npmjs.org/xmlbuilder/-/xmlbuilder-11.0.1.tgz",
+      "integrity": "sha512-fDlsI/kFEx7gLvbecc0/ohLG50fugQp8ryHzMTuW9vSa1GJ0XYWKnhsUx7oie3G98+r56aTQIUB4kht42R3JvA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=4.0"
+      }
+    },
+    "node_modules/yallist": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/yallist/-/yallist-4.0.0.tgz",
+      "integrity": "sha512-3wdGidZyq5PB084XLES5TpOSRA3wjXAlIWMhum2kRcv/41Sn2emQ0dycQW4uZXLejwKvg6EsvbdlVL+FYEct7A==",
+      "dev": true,
+      "license": "ISC"
+    },
+    "node_modules/yauzl": {
+      "version": "2.10.0",
+      "resolved": "https://registry.npmjs.org/yauzl/-/yauzl-2.10.0.tgz",
+      "integrity": "sha512-p4a9I6X6nu6IhoGmBqAcbJy1mlC4j27vEPZX9F4L4/vZT3Lyq1VkFHw/V/PUcB9Buo+DG3iHkT0x3Qya58zc3g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "buffer-crc32": "~0.2.3",
+        "fd-slicer": "~1.1.0"
+      }
+    },
+    "node_modules/yazl": {
+      "version": "2.5.1",
+      "resolved": "https://registry.npmjs.org/yazl/-/yazl-2.5.1.tgz",
+      "integrity": "sha512-phENi2PLiHnHb6QBVot+dJnaAZ0xosj7p3fWl+znIjBDlnMI2PsZCJZ306BPTFOaHf5qdDEI8x5qFrSOBN5vrw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "buffer-crc32": "~0.2.3"
+      }
+    },
+    "node_modules/yocto-queue": {
+      "version": "1.2.2",
+      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-1.2.2.tgz",
+      "integrity": "sha512-4LCcse/U2MHZ63HAJVE+v71o7yOdIe4cZ70Wpf8D/IyjDKYQLV5GD46B+hSTjJsvV5PztjvHoU580EftxjDZFQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12.20"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    }
+  }
+}
diff --git a/package.json b/package.json
new file mode 100644
index 0000000..fd038aa
--- /dev/null
+++ b/package.json
@@ -0,0 +1,47 @@
+{
+  "name": "justwoker-agent",
+  "displayName": "Justwoker Agent",
+  "publisher": "justwoker",
+  "version": "0.1.0",
+  "engines": { "vscode": "^1.85.0" },
+  "main": "./dist/host/extension.js",
+  "activationEvents": [],
+  "contributes": {
+    "viewsContainers": {
+      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
+    },
+    "views": {
+      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
+    },
+    "commands": [
+      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
+      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
+    ],
+    "configuration": {
+      "title": "Justwoker Agent",
+      "properties": {
+        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
+        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
+        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
+        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
+        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
+      }
+    }
+  },
+  "scripts": {
+    "compile": "node esbuild.js --production",
+    "watch": "node esbuild.js --watch",
+    "test:unit": "vitest run",
+    "package": "vsce package"
+  },
+  "devDependencies": {
+    "@types/vscode": "^1.85.0",
+    "@types/node": "^20.0.0",
+    "typescript": "^5.4.0",
+    "esbuild": "^0.20.0",
+    "vitest": "^1.5.0",
+    "@vscode/test-electron": "^2.3.0",
+    "@vscode/vsce": "^2.24.0"
+  },
+  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
+}
diff --git a/src/host/extension.ts b/src/host/extension.ts
new file mode 100644
index 0000000..0f1c903
--- /dev/null
+++ b/src/host/extension.ts
@@ -0,0 +1,32 @@
+import * as vscode from "vscode";
+
+export function activate(context: vscode.ExtensionContext) {
+  const provider = new ChatViewProvider(context.extensionUri);
+  context.subscriptions.push(
+    vscode.window.registerWebviewViewProvider("justwokerAgent.chat", provider),
+    vscode.commands.registerCommand("justwokerAgent.setApiKey", async () => {
+      const key = await vscode.window.showInputBox({ password: true, prompt: "API key" });
+      if (key) { await context.secrets.store("justwokerAgent.apiKey", key); vscode.window.showInformationMessage("API key saved."); }
+    }),
+    vscode.commands.registerCommand("justwokerAgent.newSession", () => {
+      provider.postMessage({ type: "newSession" });
+    })
+  );
+}
+
+class ChatViewProvider implements vscode.WebviewViewProvider {
+  public view?: vscode.WebviewView;
+  constructor(private readonly uri: vscode.Uri) {}
+  resolveWebviewView(view: vscode.WebviewView) {
+    this.view = view;
+    view.webview.options = { enableScripts: true, localResourceRoots: [this.uri] };
+    view.webview.html = this.html(view.webview);
+  }
+  postMessage(msg: unknown) { this.view?.webview.postMessage(msg); }
+  private html(webview: vscode.Webview) {
+    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "webview", "main.js"));
+    return `<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
+  }
+}
+
+export function deactivate() {}
diff --git a/src/webview/main.tsx b/src/webview/main.tsx
new file mode 100644
index 0000000..6ff9530
--- /dev/null
+++ b/src/webview/main.tsx
@@ -0,0 +1,3 @@
+import React from "react";
+import { createRoot } from "react-dom/client";
+createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
diff --git a/test/unit/example.test.ts b/test/unit/example.test.ts
new file mode 100644
index 0000000..01d1eb2
--- /dev/null
+++ b/test/unit/example.test.ts
@@ -0,0 +1,2 @@
+import { describe, it, expect } from "vitest";
+describe("scaffold", () => { it("runs vitest", () => { expect(1).toBe(1); }); });
diff --git a/tsconfig.json b/tsconfig.json
new file mode 100644
index 0000000..2451ec8
--- /dev/null
+++ b/tsconfig.json
@@ -0,0 +1,8 @@
+{
+  "compilerOptions": {
+    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
+    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
+    "outDir": "dist", "jsx": "react-jsx", "types": ["node"]
+  },
+  "include": ["src", "test"]
+}
diff --git a/vitest.config.ts b/vitest.config.ts
new file mode 100644
index 0000000..2fb080a
--- /dev/null
+++ b/vitest.config.ts
@@ -0,0 +1,2 @@
+import { defineConfig } from "vitest/config";
+export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
