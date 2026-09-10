import * as path from "path";
async function go(): Promise<void> {
  const { runTests } = await import("@vscode/test-electron");
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, "./index"),
  });
}
go().catch((e) => { console.error(e); process.exit(1); });
