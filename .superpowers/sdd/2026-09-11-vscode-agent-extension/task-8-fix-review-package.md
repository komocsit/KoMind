## fix diff vs b0dd760^
diff --git a/package-lock.json b/package-lock.json
index 1646a57..8baec49 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -2,25 +2,27 @@
   "name": "justwoker-agent",
   "version": "0.1.0",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "justwoker-agent",
       "version": "0.1.0",
       "dependencies": {
         "@anthropic-ai/sdk": "^0.30.0",
+        "dompurify": "^3.4.15",
         "marked": "^18.0.12",
         "react": "^18.3.0",
         "react-dom": "^18.3.0"
       },
       "devDependencies": {
+        "@types/dompurify": "^3.0.5",
         "@types/node": "^20.0.0",
         "@types/react": "^18.3.31",
         "@types/react-dom": "^18.3.7",
         "@types/vscode": "^1.85.0",
         "@vscode/test-electron": "^2.3.0",
         "@vscode/vsce": "^2.24.0",
         "esbuild": "^0.20.0",
         "typescript": "^5.4.0",
         "vitest": "^1.5.0"
       },
@@ -1067,20 +1069,30 @@
         "win32"
       ]
     },
     "node_modules/@sinclair/typebox": {
       "version": "0.27.12",
       "resolved": "https://registry.npmjs.org/@sinclair/typebox/-/typebox-0.27.12.tgz",
       "integrity": "sha512-hhyNJ+nbR6ZR7pToHvllEFun9TL0sbL+tk/ON75lo+Xas054uez98qRbsuNt7MBCyZKK4+8Yli/OAGZhmfBZ/g==",
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/@types/dompurify": {
+      "version": "3.0.5",
+      "resolved": "https://registry.npmjs.org/@types/dompurify/-/dompurify-3.0.5.tgz",
+      "integrity": "sha512-1Wg0g3BtQF7sSb27fJQAKck1HECM6zV1EB66j8JH9i3LCjYabJa0FSdiSgsD5K/RbrsR0SiraKacLB+T8ZVYAg==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/trusted-types": "*"
+      }
+    },
     "node_modules/@types/estree": {
       "version": "1.0.9",
       "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
       "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/@types/node": {
       "version": "20.19.43",
       "resolved": "https://registry.npmjs.org/@types/node/-/node-20.19.43.tgz",
@@ -1121,20 +1133,27 @@
     "node_modules/@types/react-dom": {
       "version": "18.3.7",
       "resolved": "https://registry.npmjs.org/@types/react-dom/-/react-dom-18.3.7.tgz",
       "integrity": "sha512-MEe3UeoENYVFXzoXEWsvcpg6ZvlrFNlOQ7EOsvhI3CfAXwzPfO8Qwuxd40nepsYKqyyVQnTdEfv68q91yLcKrQ==",
       "dev": true,
       "license": "MIT",
       "peerDependencies": {
         "@types/react": "^18.0.0"
       }
     },
+    "node_modules/@types/trusted-types": {
+      "version": "2.0.7",
+      "resolved": "https://registry.npmjs.org/@types/trusted-types/-/trusted-types-2.0.7.tgz",
+      "integrity": "sha512-ScaPdn1dQczgbl0QFTeTOmVHFULt394XJgOQNoyVhZ6r2vLnMLJfBPd53SB52T/3G36VI1/g2MZaX0cwDuXsfw==",
+      "devOptional": true,
+      "license": "MIT"
+    },
     "node_modules/@types/vscode": {
       "version": "1.137.0",
       "resolved": "https://registry.npmjs.org/@types/vscode/-/vscode-1.137.0.tgz",
       "integrity": "sha512-0dc/BBWxkyUsJzXIZ7PkKSalThmS4xiBT+8YEDiWdCefRKHGVV5ZNkM5NB5ULYamallYJujIfncNoXWFlyzL8A==",
       "dev": true,
       "license": "MIT"
     },
     "node_modules/@typespec/ts-http-runtime": {
       "version": "0.3.9",
       "resolved": "https://registry.npmjs.org/@typespec/ts-http-runtime/-/ts-http-runtime-0.3.9.tgz",
@@ -2142,20 +2161,29 @@
       "dependencies": {
         "domelementtype": "^2.3.0"
       },
       "engines": {
         "node": ">= 4"
       },
       "funding": {
         "url": "https://github.com/fb55/domhandler?sponsor=1"
       }
     },
+    "node_modules/dompurify": {
+      "version": "3.4.15",
+      "resolved": "https://registry.npmjs.org/dompurify/-/dompurify-3.4.15.tgz",
+      "integrity": "sha512-EUBjM+B+lkDE41iE82DDSCfkoPGfXx8IxFxPMjNzm/Uk4xDet77rTN9wqlxlVg71kK7XGuUMv6wUxJUwwv+Xyw==",
+      "license": "(MPL-2.0 OR Apache-2.0)",
+      "optionalDependencies": {
+        "@types/trusted-types": "^2.0.7"
+      }
+    },
     "node_modules/domutils": {
       "version": "3.2.2",
       "resolved": "https://registry.npmjs.org/domutils/-/domutils-3.2.2.tgz",
       "integrity": "sha512-6kZKyUajlDuqlHKVX1w7gyslj9MPIXzIFiz/rGu35uC1wMi+kMhQwGhl4lt9unC9Vb9INnY9Z3/ZA3+FhASLaw==",
       "dev": true,
       "license": "BSD-2-Clause",
       "dependencies": {
         "dom-serializer": "^2.0.0",
         "domelementtype": "^2.3.0",
         "domhandler": "^5.0.3"
diff --git a/package.json b/package.json
index e4724bf..9601de3 100644
--- a/package.json
+++ b/package.json
@@ -63,27 +63,29 @@
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
+    "@types/dompurify": "^3.0.5",
     "@types/node": "^20.0.0",
     "@types/react": "^18.3.31",
     "@types/react-dom": "^18.3.7",
     "@types/vscode": "^1.85.0",
     "@vscode/test-electron": "^2.3.0",
     "@vscode/vsce": "^2.24.0",
     "esbuild": "^0.20.0",
     "typescript": "^5.4.0",
     "vitest": "^1.5.0"
   },
   "dependencies": {
     "@anthropic-ai/sdk": "^0.30.0",
+    "dompurify": "^3.4.15",
     "marked": "^18.0.12",
     "react": "^18.3.0",
     "react-dom": "^18.3.0"
   }
 }
diff --git a/src/webview/App.tsx b/src/webview/App.tsx
index 9648c55..9acefd2 100644
--- a/src/webview/App.tsx
+++ b/src/webview/App.tsx
@@ -1,12 +1,13 @@
 import React, { useEffect, useRef, useState } from "react";
 import { marked } from "marked";
+import DOMPurify from "dompurify";
 import { send, onHostMessage } from "./api";
 import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";
 
 interface Card {
   kind: "user" | "assistant" | "tool" | "error";
   text?: string;
   callId?: string;
   tool?: string;
   output?: string;
   pendingApproval?: string;
@@ -117,21 +118,21 @@ function eventsToCards(events: SessionEvent[]): Card[] {
     if (e.kind === "user") return { kind: "user" as const, text: e.text };
     if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text };
     if (e.kind === "error") return { kind: "error" as const, text: e.message };
     if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool };
     return { kind: "tool" as const, callId: e.callId, output: e.output };
   });
 }
 
 function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
   if (card.kind === "assistant") {
-    return <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.text ?? "", { async: false }) as string }} />;
+    return <div className="md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(card.text ?? "", { async: false }) as string) }} />;
   }
   if (card.kind === "user") {
     return <div style={{ color: "var(--vscode-inputForeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
   }
   if (card.kind === "error") {
     return (
       <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
         {card.text} <button onClick={onRetry}>Retry</button>
       </div>
     );
