import * as assert from "assert";
import * as vscode from "vscode";

suite("Justwoker Agent extension", () => {
  test("extension activates and registers the webview view", async () => {
    const ext =
      vscode.extensions.getExtension("justwoker.agent") ??
      vscode.extensions.getExtension("justwoker.justwoker-agent") ??
      vscode.extensions.all.find((e) => e.packageJSON?.publisher === "justwoker");
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
