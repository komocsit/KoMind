# Task 1: Scaffold extension project (host bundles, webview placeholder, F5 runs)

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `src/host/extension.ts`, `src/webview/main.tsx`, `.vscode/launch.json`, `.gitignore`, `vitest.config.ts`
- Test: `test/unit/example.test.ts` (a trivial placeholder so `npm run test:unit` works)

**Interfaces:**
- Produces: npm scripts `compile`, `watch`, `test:unit`, `package` (vsce-ready layout); extension id `justwoker.agent`.

- [ ] **Step 1: Initialize repo and package.json**

```powershell
mkdir justwoker-agent; cd justwoker-agent; git init
```

(You are already inside the repo dir — just `git init`.)

`package.json` (key parts):

```json
{
  "name": "justwoker-agent",
  "displayName": "Justwoker Agent",
  "publisher": "justwoker",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/host/extension.js",
  "activationEvents": [],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
    },
    "views": {
      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
    },
    "commands": [
      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
    ],
    "configuration": {
      "title": "Justwoker Agent",
      "properties": {
        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
      }
    }
  },
  "scripts": {
    "compile": "node esbuild.js --production",
    "watch": "node esbuild.js --watch",
    "test:unit": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0", "@types/node": "^20.0.0", "typescript": "^5.4.0",
    "esbuild": "^0.20.0", "vitest": "^1.5.0", "@vscode/test-electron": "^2.3.0", "@vscode/vsce": "^2.24.0"
  },
  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
}
```

Also create a minimal `media/icon.svg` (any simple 24x24 SVG shape) so the activity bar icon resolves.

- [ ] **Step 2: Write tsconfig.json, esbuild.js, .gitignore, launch.json**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "jsx": "react-jsx", "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`esbuild.js` (two bundles: host CJS, webview ESM):

```js
const esbuild = require("esbuild");
const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const host = {
  entryPoints: ["src/host/extension.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "dist/host/extension.js", external: ["vscode"],
  sourcemap: !prod, minify: prod,
};
const webview = {
  entryPoints: ["src/webview/main.tsx"], bundle: true, platform: "browser",
  format: "esm", outfile: "dist/webview/main.js", sourcemap: !prod, minify: prod,
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context({ ...host });
    await ctx.watch();
    const ctx2 = await esbuild.context({ ...webview });
    await ctx2.watch();
  } else {
    await esbuild.build(host);
    await esbuild.build(webview);
  }
})();
```

`.gitignore`: `node_modules/`, `dist/`, `*.vsix`, `.vscode-test/`

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Run Extension",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
    "preLaunchTask": "npm: watch",
    "outFiles": ["${workspaceFolder}/dist/**/*.js"]
  }]
}
```

Also add `.vscode/tasks.json` with a `npm: watch` task (type npm, script watch, isBackground true, problemMatcher `$esbuild-watch`) so the launch config's preLaunchTask resolves.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
```

- [ ] **Step 3: Minimal host entry + webview**

`src/host/extension.ts`:

```ts
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
```

`src/webview/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
```

- [ ] **Step 4: Smoke-verify**

```powershell
npm install; npm run compile
```

Expected: `dist/host/extension.js` and `dist/webview/main.js` exist. Also add `test/unit/example.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("scaffold", () => { it("runs vitest", () => { expect(1).toBe(1); }); });
```

and run `npm run test:unit` (expected: 1 passing test). F5 manual verification is deferred to later tasks — do not attempt it.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "chore: scaffold extension host + webview build"
```
