const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const devExtension = process.argv.includes("--dev-extension");
const outputRoot = devExtension ? ".dev-extension" : ".";

if (devExtension) {
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  manifest.name = "komind-dev";
  manifest.displayName = "KoMind - Dev";
  manifest.contributes.viewsContainers.activitybar.forEach((container) => {
    container.title = "KoMind - Dev";
  });
  manifest.contributes.configuration.title = "KoMind - Dev";
  manifest.icon = "media/komind-logo.png";
  manifest.contributes.viewsContainers.activitybar.forEach((container) => {
    container.icon = "media/komind-logo.png";
  });
  manifest.contributes.commands.forEach((command) => {
    command.title = command.title.replace(/^KoMind:/, "KoMind - Dev:");
  });

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.cpSync("media", path.join(outputRoot, "media"), { recursive: true });
}

const host = {
  entryPoints: ["src/host/extension.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: path.join(outputRoot, "dist/host/extension.js"), external: ["vscode"],
  sourcemap: !prod, minify: prod,
};
const webview = {
  entryPoints: ["src/webview/main.tsx"], bundle: true, platform: "browser",
  format: "esm", outfile: path.join(outputRoot, "dist/webview/main.js"), sourcemap: !prod, minify: prod,
  define: { __KOMIND_DISPLAY_NAME__: JSON.stringify(devExtension ? "KoMind - Dev" : "KoMind") },
  loader: { ".png": "dataurl" },
};
const testRunner = {
  entryPoints: ["test/integration/run.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "test/integration/run.js", sourcemap: false,
};
const testIndex = {
  entryPoints: ["test/integration/index.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "test/integration/index.js", sourcemap: false,
};
const testSuite = {
  entryPoints: ["test/integration/agentFlow.test.ts"], bundle: true, platform: "node",
  format: "cjs", outfile: "test/integration/agentFlow.test.js", external: ["vscode"],
  sourcemap: false,
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context({ ...host });
    await ctx.watch();
    const ctx2 = await esbuild.context({ ...webview });
    await ctx2.watch();
    const ctx3 = await esbuild.context({ ...testRunner });
    await ctx3.watch();
    const ctx4 = await esbuild.context({ ...testIndex });
    await ctx4.watch();
    const ctx5 = await esbuild.context({ ...testSuite });
    await ctx5.watch();
  } else {
    await esbuild.build(host);
    await esbuild.build(webview);
    await esbuild.build(testRunner);
    await esbuild.build(testIndex);
    await esbuild.build(testSuite);
  }
})();
