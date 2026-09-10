import React, { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
          case "newSession":
            sessionIdRef.current = "";
            return [];
          case "loadEvents":
            sessionIdRef.current = m.sessionId;
            return eventsToCards(m.events);
          case "textDelta":
            sessionIdRef.current = m.sessionId;
            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            else next.push({ kind: "assistant", text: m.text });
            return next;
          case "toolCall":
            next.push({ kind: "tool", callId: m.callId, tool: m.tool });
            return next;
          case "approvalRequest":
            return next.map((c) => (c.callId === m.callId ? { ...c, pendingApproval: m.command } : c));
          case "approvalResolved":
            return next.map((c) =>
              c.callId === m.callId
                ? { ...c, approvalDone: m.approved ? ("approved" as const) : ("rejected" as const), pendingApproval: undefined }
                : c
            );
          case "toolResult":
            return next.map((c) => (c.callId === m.callId ? { ...c, output: m.output } : c));
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

  const onRetry = () => {
    if (sessionIdRef.current) send({ type: "retry", sessionId: sessionIdRef.current });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: "4px", borderBottom: "1px solid var(--vscode-panel-border)", display: "flex", gap: "4px" }}>
        <button onClick={() => send({ type: "newSessionRequest" })}>+ New</button>
        <select
          onChange={(e) => { if (e.target.value) send({ type: "loadSession", sessionId: e.target.value }); e.target.value = ""; }}
          value=""
        >
          <option value="">Sessions…</option>
          {sessionList.map((s) => (
            <option key={s.id} value={s.id}>{s.firstUserMessage.slice(0, 40)}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {cards.map((c, i) => <CardView key={i} card={c} onRetry={onRetry} />)}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "8px", display: "flex", gap: "4px" }}>
        <textarea
          style={{ flex: 1, resize: "none", color: "var(--vscode-inputForeground)", background: "var(--vscode-inputBackground)", border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))" }}
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
    return <div className="md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(card.text ?? "", { async: false }) as string) }} />;
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
