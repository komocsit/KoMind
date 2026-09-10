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
