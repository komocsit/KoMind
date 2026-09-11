import * as assert from "assert";
import * as vscode from "vscode";

suite("KoMind extension", () => {
  test("extension activates and registers the webview view", async () => {
    const ext =
      vscode.extensions.getExtension("komind.komind") ??
      vscode.extensions.all.find((e) => e.packageJSON?.publisher === "komind");
    assert.ok(ext, "extension not found");
    await ext!.activate();
    await vscode.commands.executeCommand("koMind.chat.focus");
    assert.ok(true);
  });

  test("commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("koMind.newSession"), "newSession command missing");
    assert.ok(cmds.includes("koMind.resetPermissions"), "resetPermissions command missing");
  });
});
