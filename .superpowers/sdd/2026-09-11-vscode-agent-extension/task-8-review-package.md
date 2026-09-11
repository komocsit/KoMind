## git log
c685932 feat: webview chat UI with streaming, tool and approval cards
cd3e0a3 feat: wire agent, tools, approvals and session store into vscode

## diff stat

 package-lock.json       |  50 ++++++++++++++++
 package.json            |  74 ++++++++++++++++++-----
 src/webview/App.tsx     | 152 ++++++++++++++++++++++++++++++++++++++++++++++++
 src/webview/api.ts      |   8 +++
 src/webview/main.tsx    |   3 +-
 test/unit/agent.test.ts |   1 +
 6 files changed, 271 insertions(+), 17 deletions(-)

## diff

diff --git a/package-lock.json b/package-lock.json
index ea6256a..1646a57 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -2,25 +2,28 @@
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
+        "marked": "^18.0.12",
         "react": "^18.3.0",
         "react-dom": "^18.3.0"
       },
       "devDependencies": {
         "@types/node": "^20.0.0",
+        "@types/react": "^18.3.31",
+        "@types/react-dom": "^18.3.7",
         "@types/vscode": "^1.85.0",
         "@vscode/test-electron": "^2.3.0",
         "@vscode/vsce": "^2.24.0",
         "esbuild": "^0.20.0",
         "typescript": "^5.4.0",
         "vitest": "^1.5.0"
       },
       "engines": {
         "vscode": "^1.85.0"
       }
@@ -1090,20 +1093,48 @@
     "node_modules/@types/node-fetch": {
       "version": "2.6.13",
       "resolved": "https://registry.npmjs.org/@types/node-fetch/-/node-fetch-2.6.13.tgz",
       "integrity": "sha512-QGpRVpzSaUs30JBSGPjOg4Uveu384erbHBoT1zeONvyCfwQxIkUshLAOqN/k9EjGviPRmWTTe6aH2qySWKTVSw==",
       "license": "MIT",
       "dependencies": {
         "@types/node": "*",
         "form-data": "^4.0.4"
       }
     },
+    "node_modules/@types/prop-types": {
+      "version": "15.7.15",
+      "resolved": "https://registry.npmjs.org/@types/prop-types/-/prop-types-15.7.15.tgz",
+      "integrity": "sha512-F6bEyamV9jKGAFBEmlQnesRPGOQqS2+Uwi0Em15xenOxHaf2hv6L8YCVn3rPdPJOiJfPiCnLIRyvwVaqMY3MIw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@types/react": {
+      "version": "18.3.31",
+      "resolved": "https://registry.npmjs.org/@types/react/-/react-18.3.31.tgz",
+      "integrity": "sha512-vfEqpXTvwT91yhmwdfouStN2hSKwTvyRs8qpLfADyrq/kxDw0hZM7Wk9Ug1FELj8hIby+S/+kQCSRFF32nv2Qw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/prop-types": "*",
+        "csstype": "^3.2.2"
+      }
+    },
+    "node_modules/@types/react-dom": {
+      "version": "18.3.7",
+      "resolved": "https://registry.npmjs.org/@types/react-dom/-/react-dom-18.3.7.tgz",
+      "integrity": "sha512-MEe3UeoENYVFXzoXEWsvcpg6ZvlrFNlOQ7EOsvhI3CfAXwzPfO8Qwuxd40nepsYKqyyVQnTdEfv68q91yLcKrQ==",
+      "dev": true,
+      "license": "MIT",
+      "peerDependencies": {
+        "@types/react": "^18.0.0"
+      }
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
@@ -1928,20 +1959,27 @@
       "integrity": "sha512-u/O3vwbptzhMs3L1fQE82ZSLHQQfto5gyZzwteVIEyeaY5Fc7R4dapF/BvRoSYFeqfBk4m0V1Vafq5Pjv25wvA==",
       "dev": true,
       "license": "BSD-2-Clause",
       "engines": {
         "node": ">= 6"
       },
       "funding": {
         "url": "https://github.com/sponsors/fb55"
       }
     },
+    "node_modules/csstype": {
+      "version": "3.2.3",
+      "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.2.3.tgz",
+      "integrity": "sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/debug": {
       "version": "4.4.3",
       "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
       "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
         "ms": "^2.1.3"
       },
       "engines": {
@@ -3162,20 +3200,32 @@
     "node_modules/markdown-it/node_modules/entities": {
       "version": "2.1.0",
       "resolved": "https://registry.npmjs.org/entities/-/entities-2.1.0.tgz",
       "integrity": "sha512-hCx1oky9PFrJ611mf0ifBLBRW8lUUVRlFolb5gWRfIELabBlbp9xZvrqZLZAs+NxFnbfQoeGd8wDkygjg7U85w==",
       "dev": true,
       "license": "BSD-2-Clause",
       "funding": {
         "url": "https://github.com/fb55/entities?sponsor=1"
       }
     },
+    "node_modules/marked": {
+      "version": "18.0.12",
+      "resolved": "https://registry.npmjs.org/marked/-/marked-18.0.12.tgz",
+      "integrity": "sha512-LEm4ga2YeI2T3GVHj9b0BaDPPk93LLTHMFeMyQbNIzPxc8vCI0y/scy0ZA6z6lXKyT9j9Nhl/OC6ZYKYGuFScA==",
+      "license": "MIT",
+      "bin": {
+        "marked": "bin/marked.js"
+      },
+      "engines": {
+        "node": ">= 20"
+      }
+    },
     "node_modules/math-intrinsics": {
       "version": "1.1.0",
       "resolved": "https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz",
       "integrity": "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
       "license": "MIT",
       "engines": {
         "node": ">= 0.4"
       }
     },
     "node_modules/mdurl": {
diff --git a/package.json b/package.json
index fd038aa..e4724bf 100644
--- a/package.json
+++ b/package.json
@@ -1,47 +1,89 @@
 {
   "name": "justwoker-agent",
   "displayName": "Justwoker Agent",
   "publisher": "justwoker",
   "version": "0.1.0",
-  "engines": { "vscode": "^1.85.0" },
+  "engines": {
+    "vscode": "^1.85.0"
+  },
   "main": "./dist/host/extension.js",
   "activationEvents": [],
   "contributes": {
     "viewsContainers": {
-      "activitybar": [{ "id": "justwokerAgent", "title": "Justwoker Agent", "icon": "media/icon.svg" }]
+      "activitybar": [
+        {
+          "id": "justwokerAgent",
+          "title": "Justwoker Agent",
+          "icon": "media/icon.svg"
+        }
+      ]
     },
     "views": {
-      "justwokerAgent": [{ "type": "webview", "id": "justwokerAgent.chat", "name": "Agent Chat" }]
+      "justwokerAgent": [
+        {
+          "type": "webview",
+          "id": "justwokerAgent.chat",
+          "name": "Agent Chat"
+        }
+      ]
     },
     "commands": [
-      { "command": "justwokerAgent.setApiKey", "title": "Justwoker: Set API Key" },
-      { "command": "justwokerAgent.newSession", "title": "Justwoker: New Session" }
+      {
+        "command": "justwokerAgent.setApiKey",
+        "title": "Justwoker: Set API Key"
+      },
+      {
+        "command": "justwokerAgent.newSession",
+        "title": "Justwoker: New Session"
+      }
     ],
     "configuration": {
       "title": "Justwoker Agent",
       "properties": {
-        "justwokerAgent.baseUrl": { "type": "string", "default": "https://api.justwoker.icu" },
-        "justwokerAgent.model": { "type": "string", "default": "gpt-5.6-sol" },
-        "justwokerAgent.maxTokens": { "type": "number", "default": 4096 },
-        "justwokerAgent.autoApproveEdits": { "type": "boolean", "default": true },
-        "justwokerAgent.autoApproveTerminal": { "type": "boolean", "default": false }
+        "justwokerAgent.baseUrl": {
+          "type": "string",
+          "default": "https://api.justwoker.icu"
+        },
+        "justwokerAgent.model": {
+          "type": "string",
+          "default": "gpt-5.6-sol"
+        },
+        "justwokerAgent.maxTokens": {
+          "type": "number",
+          "default": 4096
+        },
+        "justwokerAgent.autoApproveEdits": {
+          "type": "boolean",
+          "default": true
+        },
+        "justwokerAgent.autoApproveTerminal": {
+          "type": "boolean",
+          "default": false
+        }
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
-    "@types/vscode": "^1.85.0",
     "@types/node": "^20.0.0",
-    "typescript": "^5.4.0",
-    "esbuild": "^0.20.0",
-    "vitest": "^1.5.0",
+    "@types/react": "^18.3.31",
+    "@types/react-dom": "^18.3.7",
+    "@types/vscode": "^1.85.0",
     "@vscode/test-electron": "^2.3.0",
-    "@vscode/vsce": "^2.24.0"
+    "@vscode/vsce": "^2.24.0",
+    "esbuild": "^0.20.0",
+    "typescript": "^5.4.0",
+    "vitest": "^1.5.0"
   },
-  "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "react": "^18.3.0", "react-dom": "^18.3.0" }
+  "dependencies": {
+    "@anthropic-ai/sdk": "^0.30.0",
+    "marked": "^18.0.12",
+    "react": "^18.3.0",
+    "react-dom": "^18.3.0"
+  }
 }
diff --git a/src/webview/App.tsx b/src/webview/App.tsx
new file mode 100644
index 0000000..9648c55
--- /dev/null
+++ b/src/webview/App.tsx
@@ -0,0 +1,152 @@
+import React, { useEffect, useRef, useState } from "react";
+import { marked } from "marked";
+import { send, onHostMessage } from "./api";
+import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";
+
+interface Card {
+  kind: "user" | "assistant" | "tool" | "error";
+  text?: string;
+  callId?: string;
+  tool?: string;
+  output?: string;
+  pendingApproval?: string;
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
+            sessionIdRef.current = "";
+            return [];
+          case "loadEvents":
+            sessionIdRef.current = m.sessionId;
+            return eventsToCards(m.events);
+          case "textDelta":
+            sessionIdRef.current = m.sessionId;
+            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
+            else next.push({ kind: "assistant", text: m.text });
+            return next;
+          case "toolCall":
+            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
+            return next;
+          case "approvalRequest":
+            return next.map((c) => (c.callId === m.callId ? { ...c, pendingApproval: m.command } : c));
+          case "approvalResolved":
+            return next.map((c) =>
+              c.callId === m.callId
+                ? { ...c, approvalDone: m.approved ? ("approved" as const) : ("rejected" as const), pendingApproval: undefined }
+                : c
+            );
+          case "toolResult":
+            return next.map((c) => (c.callId === m.callId ? { ...c, output: m.output } : c));
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
+  const onRetry = () => {
+    if (sessionIdRef.current) send({ type: "retry", sessionId: sessionIdRef.current });
+  };
+
+  return (
+    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
+      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
+        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
+        <select
+          onChange={(e) => { if (e.target.value) send({ type: "loadSession", sessionId: e.target.value }); e.target.value = ""; }}
+          value=""
+        >
+          <option value="">SessionsΓÇª</option>
+          {sessionList.map((s) => (
+            <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>
+          ))}
+        </select>
+      </div>
+      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
+        {cards.map((c, i) => <CardView key={i} card={c} onRetry={onRetry} />)}
+        <div ref={bottomRef} />
+      </div>
+      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
+        <textarea
+          style={{ flex: 1, resize: "none", color: "var(--vscode-inputForeground)", background: "var(--vscode-inputBackground)", border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))" }}
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
+    if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool };
+    return { kind: "tool" as const, callId: e.callId, output: e.output };
+  });
+}
+
+function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
+  if (card.kind === "assistant") {
+    return <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.text ?? "", { async: false }) as string }} />;
+  }
+  if (card.kind === "user") {
+    return <div style={{ color: "var(--vscode-inputForeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
+  }
+  if (card.kind === "error") {
+    return (
+      <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
+        {card.text} <button onClick={onRetry}>Retry</button>
+      </div>
+    );
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
diff --git a/src/webview/api.ts b/src/webview/api.ts
new file mode 100644
index 0000000..1c748fa
--- /dev/null
+++ b/src/webview/api.ts
@@ -0,0 +1,8 @@
+import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";
+
+declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void };
+export const vscode = acquireVsCodeApi();
+export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
+export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
+  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
+};
diff --git a/src/webview/main.tsx b/src/webview/main.tsx
index 6ff9530..9a8cdbf 100644
--- a/src/webview/main.tsx
+++ b/src/webview/main.tsx
@@ -1,3 +1,4 @@
 import React from "react";
 import { createRoot } from "react-dom/client";
-createRoot(document.getElementById("root")!).render(<h1>Justwoker Agent</h1>);
+import App from "./App";
+createRoot(document.getElementById("root")!).render(<App />);
diff --git a/test/unit/agent.test.ts b/test/unit/agent.test.ts
index e288985..316a8a8 100644
--- a/test/unit/agent.test.ts
+++ b/test/unit/agent.test.ts
@@ -2,20 +2,21 @@ import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
 import { AgentSession } from "../../src/host/agent";
 import type { Provider, AnthropicMessage } from "../../src/host/provider";
 import type { ToolContext } from "../../src/host/tools";
 import { SessionStore } from "../../src/host/store";
 import { mkdtempSync, rmSync } from "fs"; import { tmpdir } from "os"; import path from "path";
 
 function scriptedProvider(turns: { text?: string; toolUses?: { id: string; name: string; input: any }[] }[]): Provider & { calls: AnthropicMessage[][] } {
   const calls: AnthropicMessage[][] = [];
   return {
     calls,
+    setKey() {},
     async streamTurn(messages, _tools, onEvent) {
       calls.push(messages.map((m) => ({ ...m, content: [...m.content as any[]] })));
       const turn = turns.shift()!;
       for (const t of (turn.text ?? "").match(/.{1,3}/g) ?? []) onEvent({ type: "textDelta", text: t });
       for (const tu of turn.toolUses ?? []) onEvent({ type: "toolUse", id: tu.id, name: tu.name, input: tu.input });
       onEvent({ type: "endTurn" });
       const content: any[] = [];
       if (turn.text) content.push({ type: "text", text: turn.text });
       for (const tu of turn.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
       return [{ role: "assistant", content }];
