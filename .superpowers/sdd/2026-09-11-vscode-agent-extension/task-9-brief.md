# Task 9: Integration test (@vscode/test-electron)

**Files:**
- Create: `test/integration/index.ts`, `test/integration/agentFlow.test.ts`, `test/integration/run.ts`, `test/mock-server.ts`
- Modify: `package.json` (add script `test:integration`), `esbuild.js` (add third entry: compile run.ts to `test/integration/run.js`, CJS, external none needed, platform node)

**Interfaces:**
- Consumes: compiled extension `dist/host/extension.js`.
- Produces: `npm run test:integration` verifying activation + webview view registration + command registration.

Note: the extension id is `justwoker.agent` (publisher justwoker, name justwoker-agent).

- [ ] **Step 1: Mock Anthropic server `test/mock-server.ts`** (verbatim):

```ts
import http from "http";

export function startMockServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.includes("/v1/messages")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Mock reply." } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
      } else { res.writeHead(404).end(); }
    });
    server.listen(port, () => resolve(server));
  });
}
```

- [ ] **Step 2: Integration test `test/integration/agentFlow.test.ts`** (verbatim):

```ts
import * as assert from "assert";
import * as vscode from "vscode";

suite("Justwoker Agent extension", () => {
  test("extension activates and registers the webview view", async () => {
    const ext = vscode.extensions.getExtension("justwoker.agent");
    assert.ok(ext, "extension not found");
    await ext!.activate();
    await vscode.commands.executeCommand("justwokerAgent.chat.focus");
    assert.ok(true);
  });

  test("commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("justwokerAgent.setApiKey"));
    assert.ok(cmds.includes("justwokerAgent.newSession"));
  });
});
```

`test/integration/index.ts` (verbatim):

```ts
export async function run(): Promise<void> {
  await import("./agentFlow.test");
}
```

`test/integration/run.ts` (verbatim):

```ts
import * as path from "path";
async function go(): Promise<void> {
  const { runTests } = await import("@vscode/test-electron");
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, "./index"),
  });
}
go().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Build wiring**

`esbuild.js` — add a third build target:
```js
const testRunner = {
  entryPoints: ["test/integration/run.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "test/integration/run.js", sourcemap: false,
};
```
and build it alongside the others in both watch and production paths.

`package.json` scripts: `"test:integration": "npm run compile && node test/integration/run.js"`.

Also ensure vitest's `include` only picks up `test/unit/**` (already configured) so integration files don't run under vitest.

- [ ] **Step 4: Run**

```powershell
npm run test:integration
```

Expected: VS Code test instance launches, both tests PASS. If the download of VS Code for testing fails on this machine (network), document the failure and mark BLOCKED with the exact error — do not fake results.

- [ ] **Step 5: Commit** — `git add test package.json esbuild.js; git commit -m "test: integration harness for extension activation"`

(If package-lock.json changed, add it too.)
