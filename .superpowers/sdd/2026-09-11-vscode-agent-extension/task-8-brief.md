# Task 8: Webview chat UI (React)

**Files:**
- Modify: `src/webview/main.tsx`
- Create: `src/webview/App.tsx`, `src/webview/api.ts`
- Modify: `package.json` (add `"marked": "^12.0.0"` to dependencies, add `@types/react` + `@types/react-dom` to devDependencies)
- Fix: `test/unit/agent.test.ts` provider mock missing `setKey` (pre-existing tsc error from Task 6 — add `setKey() {},` to the error-path mock)

**Interfaces:**
- Consumes: `HostToWebviewMsg`, `WebviewToHostMsg`, `SessionEvent`, `ToolName` from `../shared/protocol`.
- Produces: full chat UI — streaming markdown text, tool cards, approval cards with Approve/Reject, session picker, input box, Retry on errors.

- [ ] **Step 1: Install deps**

```powershell
npm install marked; npm install -D "@types/react@^18" "@types/react-dom@^18"
```

- [ ] **Step 2: Implement `src/webview/api.ts`**

```ts
import type { WebviewToHostMsg, HostToWebviewMsg } from "../shared/protocol";

declare const acquireVsCodeApi: () => { postMessage(msg: WebviewToHostMsg): void };
export const vscode = acquireVsCodeApi();
export const send = (msg: WebviewToHostMsg) => vscode.postMessage(msg);
export const onHostMessage = (h: (m: HostToWebviewMsg) => void) => {
  window.addEventListener("message", (e: MessageEvent<HostToWebviewMsg>) => h(e.data));
};
```

- [ ] **Step 3: Implement `src/webview/App.tsx`**

Binding behaviors:
1. Maintain a card list state: user / assistant (accumulating text) / tool (with optional pendingApproval command, approvalDone state, output) / error.
2. `textDelta` appends to the last assistant card (or creates one).
3. `toolCall` pushes a tool card; `approvalRequest` attaches the pending command to the card with matching callId; `approvalResolved` sets approvalDone and clears pending; `toolResult` attaches output.
4. `newSession` clears cards; `loadEvents` replaces cards from SessionEvent[] (via an eventsToCards mapper).
5. `sessionList` populates a `<select>`; `loadSession` fires on select.
6. Error card includes a Retry button (sends `{type:"retry", sessionId}` — pass an onRetry callback prop to CardView, do NOT reference refs from module scope).
7. Input textarea: Enter sends (Shift+Enter newline). Auto-scroll to bottom on new cards.
8. Assistant text rendered as markdown via `marked.parse(text, { async: false })` into dangerouslySetInnerHTML.
9. Use VS Code CSS variables for theming: `var(--vscode-panel-border)`, `var(--vscode-errorForeground)`, `var(--vscode-inputforeground)`, etc.

Reference implementation (adapt; fix the known ref-scope issue by using onRetry prop):

```tsx
import React, { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { send, onHostMessage } from "./api";
import type { HostToWebviewMsg, SessionEvent } from "../shared/protocol";

interface Card {
  kind: "user" | "assistant" | "tool" | "error";
  text?: string;
  callId?: string;
  tool?: string;
  output?: string;
  pendingApproval?: string;
  approvalDone?: "approved" | "rejected";
}

export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [sessionList, setSessionList] = useState<{ id: string; firstUserMessage: string }[]>([]);
  const sessionIdRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onHostMessage((m: HostToWebviewMsg) => {
      setCards((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        switch (m.type) {
          case "newSession": return [];
          case "loadEvents":
            sessionIdRef.current = m.sessionId;
            return eventsToCards(m.events);
          case "textDelta":
            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            else next.push({ kind: "assistant", text: m.text });
            return next;
          case "toolCall":
            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
            return next;
          case "approvalRequest":
            return next.map((c) => c.callId === m.callId ? { ...c, pendingApproval: m.command } : c);
          case "approvalResolved":
            return next.map((c) => c.callId === m.callId ? { ...c, approvalDone: m.approved ? "approved" as const : "rejected" as const, pendingApproval: undefined } : c);
          case "toolResult":
            return next.map((c) => c.callId === m.callId ? { ...c, output: m.output } : c);
          case "error":
            next.push({ kind: "error", text: m.message });
            return next;
          case "turnComplete":
            return next;
          case "sessionList":
            setSessionList(m.sessions);
            return next;
          default:
            return next;
        }
      });
    });
    send({ type: "requestSessionList" });
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cards]);

  const submit = () => {
    if (!input.trim() || !sessionIdRef.current) return;
    send({ type: "userMessage", sessionId: sessionIdRef.current, text: input });
    setCards((p) => [...p, { kind: "user", text: input }]);
    setInput("");
  };

  const onRetry = () => { if (sessionIdRef.current) send({ type: "retry", sessionId: sessionIdRef.current }); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
        <select onChange={(e) => { if (e.target.value) send({ type: "loadSession", sessionId: e.target.value }); e.target.value = ""; }} value="">
          <option value="">Sessions…</option>
          {sessionList.map((s) => <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>)}
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {cards.map((c, i) => <CardView key={i} card={c} onRetry={onRetry} />)}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
        <textarea
          style={{ flex: 1, resize: "none" }}
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
        />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}

function eventsToCards(events: SessionEvent[]): Card[] {
  return events.map((e) => {
    if (e.kind === "user") return { kind: "user" as const, text: e.text };
    if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text };
    if (e.kind === "error") return { kind: "error" as const, text: e.message };
    if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool };
    return { kind: "tool" as const, callId: e.callId, output: e.output };
  });
}

function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
  if (card.kind === "assistant") {
    return <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(card.text ?? "", { async: false }) as string }} />;
  }
  if (card.kind === "user") return <div style={{ color: "var(--vscode-inputforeground)", opacity: 0.8 }}><b>You:</b> {card.text}</div>;
  if (card.kind === "error") {
    return <div style={{ color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-errorForeground)", padding: "4px", margin: "4px 0" }}>
      {card.text} <button onClick={onRetry}>Retry</button>
    </div>;
  }
  return (
    <div style={{ border: "1px solid var(--vscode-panel-border)", padding: "6px", margin: "4px 0", fontFamily: "monospace", fontSize: "12px" }}>
      <div>🔧 {card.tool} {card.pendingApproval ? "— awaiting approval" : ""} {card.approvalDone ? `— ${card.approvalDone}` : ""}</div>
      {card.pendingApproval && (
        <div style={{ marginTop: "4px" }}>
          <code>{card.pendingApproval}</code>
          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: true })}>Approve</button>{" "}
          <button onClick={() => send({ type: "approve", callId: card.callId!, approved: false })}>Reject</button>
        </div>
      )}
      {card.output && <pre style={{ whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>{card.output}</pre>}
    </div>
  );
}
```

- [ ] **Step 4: Update `src/webview/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 5: Fix `test/unit/agent.test.ts` mock** — the error-path provider mock needs `setKey() {},` added (tsc clean requirement). Also fix any other tsc errors in the test files.

- [ ] **Step 6: Verify**

```powershell
npm run compile; npm run test:unit; npx tsc --noEmit
```

Expected: compile clean (both bundles), all unit tests pass, `tsc --noEmit` FULLY clean (zero errors — including webview and tests).

- [ ] **Step 7: Commit** — `git add src/webview package.json package-lock.json test/unit/agent.test.ts; git commit -m "feat: webview chat UI with streaming, tool and approval cards"`

(If tsconfig or vitest config needed changes, add those files explicitly too.)
