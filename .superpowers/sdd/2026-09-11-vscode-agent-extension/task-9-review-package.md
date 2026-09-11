## git log
f9b9690 test: integration harness for extension activation
b0dd760 fix: sanitize assistant markdown with DOMPurify to prevent webview XSS

## diff stat

 .gitignore                         |   1 +
 esbuild.js                         |  22 +++
 package-lock.json                  | 363 +++++++++++++++++++++++++++++++++++++
 package.json                       |   2 +
 test/integration/agentFlow.test.ts |  21 +++
 test/integration/index.ts          |  16 ++
 test/integration/run.ts            |   9 +
 test/mock-server.ts                |  15 ++
 8 files changed, 449 insertions(+)

## diff

diff --git a/.gitignore b/.gitignore
index 10a0e02..cccd1f7 100644
--- a/.gitignore
+++ b/.gitignore
@@ -1,4 +1,5 @@
 node_modules/
 dist/
 *.vsix
 .vscode-test/
+test/integration/*.js
diff --git a/esbuild.js b/esbuild.js
index 36e8f6e..12e12b2 100644
--- a/esbuild.js
+++ b/esbuild.js
@@ -4,22 +4,44 @@ const watch = process.argv.includes("--watch");
 
 const host = {
   entryPoints: ["src/host/extension.ts"], bundle: true, platform: "node",
   format: "cjs", outfile: "dist/host/extension.js", external: ["vscode"],
   sourcemap: !prod, minify: prod,
 };
 const webview = {
   entryPoints: ["src/webview/main.tsx"], bundle: true, platform: "browser",
   format: "esm", outfile: "dist/webview/main.js", sourcemap: !prod, minify: prod,
 };
+const testRunner = {
+  entryPoints: ["test/integration/run.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/run.js", sourcemap: false,
+};
+const testIndex = {
+  entryPoints: ["test/integration/index.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/index.js", sourcemap: false,
+};
+const testSuite = {
+  entryPoints: ["test/integration/agentFlow.test.ts"], bundle: true, platform: "node",
+  format: "cjs", outfile: "test/integration/agentFlow.test.js", external: ["vscode"],
+  sourcemap: false,
+};
 
 (async () => {
   if (watch) {
     const ctx = await esbuild.context({ ...host });
     await ctx.watch();
     const ctx2 = await esbuild.context({ ...webview });
     await ctx2.watch();
+    const ctx3 = await esbuild.context({ ...testRunner });
+    await ctx3.watch();
+    const ctx4 = await esbuild.context({ ...testIndex });
+    await ctx4.watch();
+    const ctx5 = await esbuild.context({ ...testSuite });
+    await ctx5.watch();
   } else {
     await esbuild.build(host);
     await esbuild.build(webview);
+    await esbuild.build(testRunner);
+    await esbuild.build(testIndex);
+    await esbuild.build(testSuite);
   }
 })();
diff --git a/package-lock.json b/package-lock.json
index 8baec49..abedf7f 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -16,20 +16,21 @@
       },
       "devDependencies": {
         "@types/dompurify": "^3.0.5",
         "@types/node": "^20.0.0",
         "@types/react": "^18.3.31",
         "@types/react-dom": "^18.3.7",
         "@types/vscode": "^1.85.0",
         "@vscode/test-electron": "^2.3.0",
         "@vscode/vsce": "^2.24.0",
         "esbuild": "^0.20.0",
+        "mocha": "^12.0.0",
         "typescript": "^5.4.0",
         "vitest": "^1.5.0"
       },
       "engines": {
         "vscode": "^1.85.0"
       }
     },
     "node_modules/@anthropic-ai/sdk": {
       "version": "0.30.1",
       "resolved": "https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.30.1.tgz",
@@ -1636,20 +1637,27 @@
       "version": "1.1.18",
       "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.18.tgz",
       "integrity": "sha512-Edep/X9fGqVNmzKBVsDYIOtD+z1tuezV70LBjdCst9Tqu76lsnvRiZ6oTic1n+/BIwX6QDGAO94PN4N2SADvtw==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
         "balanced-match": "^1.0.0",
         "concat-map": "0.0.1"
       }
     },
+    "node_modules/browser-stdout": {
+      "version": "1.3.1",
+      "resolved": "https://registry.npmjs.org/browser-stdout/-/browser-stdout-1.3.1.tgz",
+      "integrity": "sha512-qhAVI1+Av2X7qelOfAIYwXONood6XlZE/fXaBSmW/T5SzLAmCgzi+eiWE7fUvbHaeNBQH13UftjpXxsfLkMpgw==",
+      "dev": true,
+      "license": "ISC"
+    },
     "node_modules/buffer": {
       "version": "5.7.1",
       "resolved": "https://registry.npmjs.org/buffer/-/buffer-5.7.1.tgz",
       "integrity": "sha512-EHcyIPBQ4BSGlvjB16k5KgAJ27CIsHY/2JBmCRReo48y9rQ3MaUzWX3KVlBa4U7MyX02HdVj0K7C3WaB3ju7FQ==",
       "dev": true,
       "funding": [
         {
           "type": "github",
           "url": "https://github.com/sponsors/feross"
         },
@@ -1826,20 +1834,36 @@
         "css-select": "^5.1.0",
         "css-what": "^6.1.0",
         "domelementtype": "^2.3.0",
         "domhandler": "^5.0.3",
         "domutils": "^3.0.1"
       },
       "funding": {
         "url": "https://github.com/sponsors/fb55"
       }
     },
+    "node_modules/chokidar": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/chokidar/-/chokidar-5.0.0.tgz",
+      "integrity": "sha512-TQMmc3w+5AxjpL8iIiwebF73dRDF4fBIieAqGn9RGCWaEVwQ6Fb2cGe31Yns0RRIzii5goJ1Y7xbMwo1TxMplw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "readdirp": "^5.0.0"
+      },
+      "engines": {
+        "node": ">= 20.19.0"
+      },
+      "funding": {
+        "url": "https://paulmillr.com/funding/"
+      }
+    },
     "node_modules/chownr": {
       "version": "1.1.4",
       "resolved": "https://registry.npmjs.org/chownr/-/chownr-1.1.4.tgz",
       "integrity": "sha512-jJ0bqzaylmJtVnNgzTeSOs8DPavpbYgEr/b0YL8/2GO3xJEhInFmhKMUnEJQjZumK7KXGFhUy89PrsJWlakBVg==",
       "dev": true,
       "license": "ISC",
       "optional": true
     },
     "node_modules/cli-cursor": {
       "version": "5.0.0",
@@ -2107,20 +2131,30 @@
       "version": "2.1.2",
       "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz",
       "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
       "dev": true,
       "license": "Apache-2.0",
       "optional": true,
       "engines": {
         "node": ">=8"
       }
     },
+    "node_modules/diff": {
+      "version": "9.0.0",
+      "resolved": "https://registry.npmjs.org/diff/-/diff-9.0.0.tgz",
+      "integrity": "sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==",
+      "dev": true,
+      "license": "BSD-3-Clause",
+      "engines": {
+        "node": ">=0.3.1"
+      }
+    },
     "node_modules/diff-sequences": {
       "version": "29.6.3",
       "resolved": "https://registry.npmjs.org/diff-sequences/-/diff-sequences-29.6.3.tgz",
       "integrity": "sha512-EjePK1srD3P08o2j4f0ExnylqRs5B9tJjcp9t1krH2qRi8CCdsYfwe9JgSLurFBWwq4uOlipzfk5fHNvwFKr8Q==",
       "dev": true,
       "license": "MIT",
       "engines": {
         "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
       }
     },
@@ -2428,20 +2462,37 @@
     "node_modules/fd-slicer": {
       "version": "1.1.0",
       "resolved": "https://registry.npmjs.org/fd-slicer/-/fd-slicer-1.1.0.tgz",
       "integrity": "sha512-cE1qsB/VwyQozZ+q1dGxR8LBYNZeofhEdUNGSMbQD3Gw2lAzX9Zb3uIU6Ebc/Fmyjo9AWWfnn0AUCHqtevs/8g==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
         "pend": "~1.2.0"
       }
     },
+    "node_modules/find-up": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/find-up/-/find-up-5.0.0.tgz",
+      "integrity": "sha512-78/PXT1wlLLDgTzDs7sjq9hzz0vXD+zn+7wypEe4fXQxCmdmqfGsEPQxmiCSQI3ajFV91bVSsvNtrJRiW6nGng==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "locate-path": "^6.0.0",
+        "path-exists": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
     "node_modules/form-data": {
       "version": "4.0.6",
       "resolved": "https://registry.npmjs.org/form-data/-/form-data-4.0.6.tgz",
       "integrity": "sha512-vKatAh4SlVfgbv+YtmhiRjhEMJsYpsG1Y2rMQtR+SVSbytsSD1YGzDIcrAJmdFec88u/+VoGmxnl+80gL1tRCQ==",
       "license": "MIT",
       "dependencies": {
         "asynckit": "^0.4.0",
         "combined-stream": "^1.0.8",
         "es-set-tostringtag": "^2.1.0",
         "hasown": "^2.0.4",
@@ -2876,20 +2927,30 @@
       "integrity": "sha512-qP1vozQRI+BMOPcjFzrjXuQvdak2pHNUMZoeG2eRbiSqyvbEf/wQtEOTOX1guk6E3t36RkaqiSt8A/6YElNxLQ==",
       "dev": true,
       "license": "MIT",
       "engines": {
         "node": ">=12"
       },
       "funding": {
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/is-path-inside": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/is-path-inside/-/is-path-inside-3.0.3.tgz",
+      "integrity": "sha512-Fd4gABb+ycGAmKou8eMftCupSir5lRxqf4aD/vd0cD2qc4HL07OjCeuHMr8Ro4CoMaeCKDB0/ECBOVWjTwUvPQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
     "node_modules/is-stream": {
       "version": "3.0.0",
       "resolved": "https://registry.npmjs.org/is-stream/-/is-stream-3.0.0.tgz",
       "integrity": "sha512-LnQR4bZ9IADDRSkvpqMGvt/tEJWclzklNgSw48V5EAaAeDd6qGvN8ei6k5p0tvxSR171VmGyHuTiAOfxAbr8kA==",
       "dev": true,
       "license": "MIT",
       "engines": {
         "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
       },
       "funding": {
@@ -2938,20 +2999,43 @@
       "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
       "dev": true,
       "license": "ISC"
     },
     "node_modules/js-tokens": {
       "version": "4.0.0",
       "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
       "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
       "license": "MIT"
     },
+    "node_modules/js-yaml": {
+      "version": "5.4.1",
+      "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-5.4.1.tgz",
+      "integrity": "sha512-28R/k+NAjeuf7+CKlTxWZVExJGwVVLwY06DgEnOMz2gEpfNkDcD7QvyiVPT0xy0XXhU8vHsd4Ot42OOPdJG7dQ==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/puzrin"
+        },
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/nodeca"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "argparse": "^2.0.1"
+      },
+      "bin": {
+        "js-yaml": "bin/js-yaml.mjs"
+      }
+    },
     "node_modules/jsonc-parser": {
       "version": "3.3.1",
       "resolved": "https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz",
       "integrity": "sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/jsonwebtoken": {
       "version": "9.0.3",
       "resolved": "https://registry.npmjs.org/jsonwebtoken/-/jsonwebtoken-9.0.3.tgz",
@@ -3064,20 +3148,36 @@
         "mlly": "^1.7.3",
         "pkg-types": "^1.2.1"
       },
       "engines": {
         "node": ">=14"
       },
       "funding": {
         "url": "https://github.com/sponsors/antfu"
       }
     },
+    "node_modules/locate-path": {
+      "version": "6.0.0",
+      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-6.0.0.tgz",
+      "integrity": "sha512-iPZK6eYjbxRu3uB4/WZ3EsEIMJFMqAoopl3R+zuq0UjcAm/MO6KCweDgPfP3elTztoKP3KtnVHxTn2NHBSDVUw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "p-locate": "^5.0.0"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
     "node_modules/lodash.includes": {
       "version": "4.3.0",
       "resolved": "https://registry.npmjs.org/lodash.includes/-/lodash.includes-4.3.0.tgz",
       "integrity": "sha512-W3Bx6mdkRTGtlJISOvVD/lbqjTlPPUDTMnlXZFnVwi9NKJ6tiAk6LVdlhZMm17VZisqhKcgzpO5Wz91PCt5b0w==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/lodash.isboolean": {
       "version": "3.0.3",
       "resolved": "https://registry.npmjs.org/lodash.isboolean/-/lodash.isboolean-3.0.3.tgz",
@@ -3361,20 +3461,30 @@
       "version": "1.2.8",
       "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz",
       "integrity": "sha512-2yyAR8qBkN3YuheJanUpWC5U3bb5osDywNB8RzDVlDwDHbocAJveqqj1u8+SVD7jkWT4yvsHCpWqqWqAxb0zCA==",
       "dev": true,
       "license": "MIT",
       "optional": true,
       "funding": {
         "url": "https://github.com/sponsors/ljharb"
       }
     },
+    "node_modules/minipass": {
+      "version": "7.1.3",
+      "resolved": "https://registry.npmjs.org/minipass/-/minipass-7.1.3.tgz",
+      "integrity": "sha512-tEBHqDnIoM/1rXME1zgka9g6Q2lcoCkxHLuc7ODJ5BxbP5d4c2Z5cGgtXAku59200Cx7diuHTOYfSBD8n6mm8A==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": ">=16 || 14 >=14.17"
+      }
+    },
     "node_modules/mkdirp-classic": {
       "version": "0.5.3",
       "resolved": "https://registry.npmjs.org/mkdirp-classic/-/mkdirp-classic-0.5.3.tgz",
       "integrity": "sha512-gKLcREMhtuZRwRAfqP3RFW+TK4JqApVBtOIftVgjuABpAtpxhPGaDcfvbhNvD0B8iD1oUr/txX35NjcaY6Ns/A==",
       "dev": true,
       "license": "MIT",
       "optional": true
     },
     "node_modules/mlly": {
       "version": "1.8.2",
@@ -3389,20 +3499,160 @@
         "ufo": "^1.6.3"
       }
     },
     "node_modules/mlly/node_modules/pathe": {
       "version": "2.0.3",
       "resolved": "https://registry.npmjs.org/pathe/-/pathe-2.0.3.tgz",
       "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/mocha": {
+      "version": "12.0.0",
+      "resolved": "https://registry.npmjs.org/mocha/-/mocha-12.0.0.tgz",
+      "integrity": "sha512-NYNh5IFt6WYqm9bi4601m7vix8MZdXC0DwS4gY6WhXO2RgJWhivhISVmq1oklCif18OSI9l+vx5Mdm5oh1XGiQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "browser-stdout": "^1.3.1",
+        "chokidar": "^5.0.0",
+        "debug": "^4.3.5",
+        "diff": "^9.0.0",
+        "find-up": "^5.0.0",
+        "glob": "^13.0.0",
+        "is-path-inside": "^3.0.3",
+        "is-unicode-supported": "^0.1.0",
+        "js-yaml": "^5.0.0",
+        "minimatch": "^10.2.2",
+        "ms": "^2.1.3",
+        "picocolors": "^1.1.1",
+        "serialize-javascript": "^7.0.2",
+        "strip-json-comments": "^5.0.3",
+        "supports-color": "^8.1.1",
+        "workerpool": "^10.0.0"
+      },
+      "bin": {
+        "mocha": "bin/mocha.js"
+      },
+      "engines": {
+        "node": "^20.19.0 || >=22.12.0"
+      }
+    },
+    "node_modules/mocha/node_modules/balanced-match": {
+      "version": "4.0.4",
+      "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-4.0.4.tgz",
+      "integrity": "sha512-BLrgEcRTwX2o6gGxGOCNyMvGSp35YofuYzw9h1IMTRmKqttAZZVU67bdb9Pr2vUHA8+j3i2tJfjO6C6+4myGTA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": "18 || 20 || >=22"
+      }
+    },
+    "node_modules/mocha/node_modules/brace-expansion": {
+      "version": "5.0.9",
+      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
+      "integrity": "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "balanced-match": "^4.0.2"
+      },
+      "engines": {
+        "node": "20 || >=22"
+      }
+    },
+    "node_modules/mocha/node_modules/glob": {
+      "version": "13.0.6",
+      "resolved": "https://registry.npmjs.org/glob/-/glob-13.0.6.tgz",
+      "integrity": "sha512-Wjlyrolmm8uDpm/ogGyXZXb1Z+Ca2B8NbJwqBVg0axK9GbBeoS7yGV6vjXnYdGm6X53iehEuxxbyiKp8QmN4Vw==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "dependencies": {
+        "minimatch": "^10.2.2",
+        "minipass": "^7.1.3",
+        "path-scurry": "^2.0.2"
+      },
+      "engines": {
+        "node": "18 || 20 || >=22"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/mocha/node_modules/has-flag": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/has-flag/-/has-flag-4.0.0.tgz",
+      "integrity": "sha512-EykJT/Q1KjTWctppgIAgfSO0tKVuZUjhgMr17kqTumMl6Afv3EISleU7qZUzoXDFTAHTDC4NOoG/ZxU3EvlMPQ==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
+    "node_modules/mocha/node_modules/is-unicode-supported": {
+      "version": "0.1.0",
+      "resolved": "https://registry.npmjs.org/is-unicode-supported/-/is-unicode-supported-0.1.0.tgz",
+      "integrity": "sha512-knxG2q4UC3u8stRGyAVJCOdxFmv5DZiRcdlIaAQXAbSfJya+OhopNotLQrstBhququ4ZpuKbDc/8S6mgXgPFPw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/mocha/node_modules/minimatch": {
+      "version": "10.2.6",
+      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz",
+      "integrity": "sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "dependencies": {
+        "brace-expansion": "^5.0.8"
+      },
+      "engines": {
+        "node": "18 || 20 || >=22"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/mocha/node_modules/strip-json-comments": {
+      "version": "5.0.3",
+      "resolved": "https://registry.npmjs.org/strip-json-comments/-/strip-json-comments-5.0.3.tgz",
+      "integrity": "sha512-1tB5mhVo7U+ETBKNf92xT4hrQa3pm0MZ0PQvuDnWgAAGHDsfp4lPSpiS6psrSiet87wyGPh9ft6wmhOMQ0hDiw==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=14.16"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/mocha/node_modules/supports-color": {
+      "version": "8.1.1",
+      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-8.1.1.tgz",
+      "integrity": "sha512-MpUEN2OodtUzxvKQl72cUF7RQ5EiHsGvSsVG0ia9c5RbWGL2CI4C7EpPS8UTBIplnlzZiNuV56w+FuNxy3ty2Q==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "has-flag": "^4.0.0"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/chalk/supports-color?sponsor=1"
+      }
+    },
     "node_modules/ms": {
       "version": "2.1.3",
       "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
       "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
       "license": "MIT"
     },
     "node_modules/mute-stream": {
       "version": "0.0.8",
       "resolved": "https://registry.npmjs.org/mute-stream/-/mute-stream-0.0.8.tgz",
       "integrity": "sha512-nnbWWOkoWyUsTjKrhgD0dcz22mdkSnpYqbEjIm2nhwhuxlSkpywJmBo8h0ZqJdkp73mb90SssHkN4rsRaBAfAA==",
@@ -3644,20 +3894,65 @@
       "dependencies": {
         "yocto-queue": "^1.0.0"
       },
       "engines": {
         "node": ">=18"
       },
       "funding": {
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/p-locate": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-5.0.0.tgz",
+      "integrity": "sha512-LaNjtRWUBY++zB5nE/NwcaoMylSPk+S+ZHNB1TzdbMJMny6dynpAGt7X/tl/QYq3TIeE6nxHppbo2LGymrG5Pw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "p-limit": "^3.0.2"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/p-locate/node_modules/p-limit": {
+      "version": "3.1.0",
+      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-3.1.0.tgz",
+      "integrity": "sha512-TYOanM3wGwNGsZN2cVTYPArw454xnXj5qmWF1bEoAc4+cU/ol7GVh7odevjp1FNHduHc3KZMcFduxU5Xc6uJRQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "yocto-queue": "^0.1.0"
+      },
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/p-locate/node_modules/yocto-queue": {
+      "version": "0.1.0",
+      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-0.1.0.tgz",
+      "integrity": "sha512-rVksvsnNCdJ/ohGc6xgPwyN8eheCxsiLM8mxuE/t/mOVqJewPuO1miLpTHQiRgTKCLexL4MeAFVagts7HmNZ2Q==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=10"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
     "node_modules/pako": {
       "version": "1.0.11",
       "resolved": "https://registry.npmjs.org/pako/-/pako-1.0.11.tgz",
       "integrity": "sha512-4hLB8Py4zZce5s4yd9XzopqwVv/yGNhV1Bl8NTmCq1763HeK2+EwVTv+leGeL13Dnh2wfbqowVPXCIO0z4taYw==",
       "dev": true,
       "license": "(MIT AND Zlib)"
     },
     "node_modules/parse-semver": {
       "version": "1.1.1",
       "resolved": "https://registry.npmjs.org/parse-semver/-/parse-semver-1.1.1.tgz",
@@ -3724,40 +4019,77 @@
       "integrity": "sha512-aN97NXWF6AWBTahfVOIrB/NShkzi5H7F9r1s9mD3cDj4Ko5f2qhhVoYMibXF7GlLveb/D2ioWay8lxI97Ven3g==",
       "dev": true,
       "license": "BSD-2-Clause",
       "engines": {
         "node": ">=0.12"
       },
       "funding": {
         "url": "https://github.com/fb55/entities?sponsor=1"
       }
     },
+    "node_modules/path-exists": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
+      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=8"
+      }
+    },
     "node_modules/path-is-absolute": {
       "version": "1.0.1",
       "resolved": "https://registry.npmjs.org/path-is-absolute/-/path-is-absolute-1.0.1.tgz",
       "integrity": "sha512-AVbw3UJ2e9bq64vSaS9Am0fje1Pa8pbGqTTsmXfaIiMpnr5DlDhfJOuLj9Sf95ZPVDAUerDfEk88MPmPe7UCQg==",
       "dev": true,
       "license": "MIT",
       "engines": {
         "node": ">=0.10.0"
       }
     },
     "node_modules/path-key": {
       "version": "3.1.1",
       "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
       "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
       "dev": true,
       "license": "MIT",
       "engines": {
         "node": ">=8"
       }
     },
+    "node_modules/path-scurry": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/path-scurry/-/path-scurry-2.0.2.tgz",
+      "integrity": "sha512-3O/iVVsJAPsOnpwWIeD+d6z/7PmqApyQePUtCndjatj/9I5LylHvt5qluFaBT3I5h3r1ejfR056c+FCv+NnNXg==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "dependencies": {
+        "lru-cache": "^11.0.0",
+        "minipass": "^7.1.2"
+      },
+      "engines": {
+        "node": "18 || 20 || >=22"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/path-scurry/node_modules/lru-cache": {
+      "version": "11.5.2",
+      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-11.5.2.tgz",
+      "integrity": "sha512-4pfM1Ff0x50o0tQwb5ucw/RzNyD0/YJME6IVcStalZuMWxdt3sR3huStTtxz4PUmvZfRguvDejasvQ2kifR11g==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "engines": {
+        "node": "20 || >=22"
+      }
+    },
     "node_modules/pathe": {
       "version": "1.1.2",
       "resolved": "https://registry.npmjs.org/pathe/-/pathe-1.1.2.tgz",
       "integrity": "sha512-whLdWMYL2TwI08hn8/ZqAbrVemu0LNaNNJZX73O6qaIdCTfXutsLhMkjdENX0qhsQ9uIimo4/aQOmXkoon2nDQ==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/pathval": {
       "version": "1.1.1",
       "resolved": "https://registry.npmjs.org/pathval/-/pathval-1.1.1.tgz",
@@ -4001,20 +4333,34 @@
         "util-deprecate": "~1.0.1"
       }
     },
     "node_modules/readable-stream/node_modules/safe-buffer": {
       "version": "5.1.2",
       "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.1.2.tgz",
       "integrity": "sha512-Gd2UZBJDkXlY7GbJxfsE8/nvKkUEU1G38c1siN6QP6a9PT9MmHB8GnpscSmMJSoF8LOIrt8ud/wPtojys4G6+g==",
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/readdirp": {
+      "version": "5.1.1",
+      "resolved": "https://registry.npmjs.org/readdirp/-/readdirp-5.1.1.tgz",
+      "integrity": "sha512-Kko+Y5XQ6fM+Ce3dq3m9YGxnacYZYl9cA1wZjaF3Vbry2L3i1qVg8+CAgNPsXRArPMUMCaOR7oa9Nqntc43JKA==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">= 20.19.0"
+      },
+      "funding": {
+        "type": "individual",
+        "url": "https://paulmillr.com/funding/"
+      }
+    },
     "node_modules/restore-cursor": {
       "version": "5.1.0",
       "resolved": "https://registry.npmjs.org/restore-cursor/-/restore-cursor-5.1.0.tgz",
       "integrity": "sha512-oMA2dcrw6u0YfxJQXm342bFKX/E4sG9rbTzO9ptUcR/e8A33cHuvStiYOwH7fszkZlZ1z/ta9AAoPk2F4qIOHA==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
         "onetime": "^7.0.0",
         "signal-exit": "^4.1.0"
       },
@@ -4137,20 +4483,30 @@
       "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
       "dev": true,
       "license": "ISC",
       "bin": {
         "semver": "bin/semver.js"
       },
       "engines": {
         "node": ">=10"
       }
     },
+    "node_modules/serialize-javascript": {
+      "version": "7.1.1",
+      "resolved": "https://registry.npmjs.org/serialize-javascript/-/serialize-javascript-7.1.1.tgz",
+      "integrity": "sha512-k3CMsaIvvdSwm8oLB4MXSl0wH2/cwlH7xGcnRd2DaeRmBkbzYmyT8j0tsX60DwD1eRwHTpNpH8ljKu9oUT1MeQ==",
+      "dev": true,
+      "license": "BSD-3-Clause",
+      "engines": {
+        "node": ">=20.0.0"
+      }
+    },
     "node_modules/setimmediate": {
       "version": "1.0.5",
       "resolved": "https://registry.npmjs.org/setimmediate/-/setimmediate-1.0.5.tgz",
       "integrity": "sha512-MATJdZp8sLqDl/68LfQmbP8zKPLQNV6BIZoIgrscFDQ+RsvK/BxeDQOgyxKKoh0y/8h3BqVFnCqQ/gd+reiIXA==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/shebang-command": {
       "version": "2.0.0",
       "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
@@ -5327,20 +5683,27 @@
         "siginfo": "^2.0.0",
         "stackback": "0.0.2"
       },
       "bin": {
         "why-is-node-running": "cli.js"
       },
       "engines": {
         "node": ">=8"
       }
     },
+    "node_modules/workerpool": {
+      "version": "10.0.3",
+      "resolved": "https://registry.npmjs.org/workerpool/-/workerpool-10.0.3.tgz",
+      "integrity": "sha512-6z2Iis68Wqth93/G/wJP9u+R3O+d2XTlgWChGCwuT1qLbBsOYueGRZuJ++v3mtDP5KjYdy+WzvWC+VWETSVXJA==",
+      "dev": true,
+      "license": "Apache-2.0"
+    },
     "node_modules/wrappy": {
       "version": "1.0.2",
       "resolved": "https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz",
       "integrity": "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
       "dev": true,
       "license": "ISC"
     },
     "node_modules/wsl-utils": {
       "version": "0.1.0",
       "resolved": "https://registry.npmjs.org/wsl-utils/-/wsl-utils-0.1.0.tgz",
diff --git a/package.json b/package.json
index 9601de3..314dd7a 100644
--- a/package.json
+++ b/package.json
@@ -60,31 +60,33 @@
           "type": "boolean",
           "default": false
         }
       }
     }
   },
   "scripts": {
     "compile": "node esbuild.js --production",
     "watch": "node esbuild.js --watch",
     "test:unit": "vitest run",
+    "test:integration": "npm run compile && node test/integration/run.js",
     "package": "vsce package"
   },
   "devDependencies": {
     "@types/dompurify": "^3.0.5",
     "@types/node": "^20.0.0",
     "@types/react": "^18.3.31",
     "@types/react-dom": "^18.3.7",
     "@types/vscode": "^1.85.0",
     "@vscode/test-electron": "^2.3.0",
     "@vscode/vsce": "^2.24.0",
     "esbuild": "^0.20.0",
+    "mocha": "^12.0.0",
     "typescript": "^5.4.0",
     "vitest": "^1.5.0"
   },
   "dependencies": {
     "@anthropic-ai/sdk": "^0.30.0",
     "dompurify": "^3.4.15",
     "marked": "^18.0.12",
     "react": "^18.3.0",
     "react-dom": "^18.3.0"
   }
diff --git a/test/integration/agentFlow.test.ts b/test/integration/agentFlow.test.ts
new file mode 100644
index 0000000..8cc069d
--- /dev/null
+++ b/test/integration/agentFlow.test.ts
@@ -0,0 +1,21 @@
+import * as assert from "assert";
+import * as vscode from "vscode";
+
+suite("Justwoker Agent extension", () => {
+  test("extension activates and registers the webview view", async () => {
+    const ext =
+      vscode.extensions.getExtension("justwoker.agent") ??
+      vscode.extensions.getExtension("justwoker.justwoker-agent") ??
+      vscode.extensions.all.find((e) => e.packageJSON?.publisher === "justwoker");
+    assert.ok(ext, "extension not found");
+    await ext!.activate();
+    await vscode.commands.executeCommand("justwokerAgent.chat.focus");
+    assert.ok(true);
+  });
+
+  test("commands are registered", async () => {
+    const cmds = await vscode.commands.getCommands(true);
+    assert.ok(cmds.includes("justwokerAgent.setApiKey"));
+    assert.ok(cmds.includes("justwokerAgent.newSession"));
+  });
+});
diff --git a/test/integration/index.ts b/test/integration/index.ts
new file mode 100644
index 0000000..c056666
--- /dev/null
+++ b/test/integration/index.ts
@@ -0,0 +1,16 @@
+import * as path from "path";
+
+export async function run(): Promise<void> {
+  const Mocha = (await import("mocha")).default;
+  const mocha = new Mocha({ ui: "tdd", color: true });
+  mocha.addFile(path.resolve(__dirname, "./agentFlow.test.js"));
+  await new Promise<void>((resolve, reject) => {
+    mocha.run((failures) => {
+      if (failures > 0) {
+        reject(new Error(`${failures} test(s) failed`));
+      } else {
+        resolve();
+      }
+    });
+  });
+}
diff --git a/test/integration/run.ts b/test/integration/run.ts
new file mode 100644
index 0000000..9e90ca8
--- /dev/null
+++ b/test/integration/run.ts
@@ -0,0 +1,9 @@
+import * as path from "path";
+async function go(): Promise<void> {
+  const { runTests } = await import("@vscode/test-electron");
+  await runTests({
+    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
+    extensionTestsPath: path.resolve(__dirname, "./index"),
+  });
+}
+go().catch((e) => { console.error(e); process.exit(1); });
diff --git a/test/mock-server.ts b/test/mock-server.ts
new file mode 100644
index 0000000..5b788ed
--- /dev/null
+++ b/test/mock-server.ts
@@ -0,0 +1,15 @@
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
