export type ToolName = "read_file" | "list_dir" | "apply_edit" | "run_terminal";

export type Effort = "low" | "medium" | "high";

export interface ToolCallView {
  callId: string;
  tool: ToolName;
  input: Record<string, unknown>;
}

export type HostToWebviewMsg =
  | { type: "textDelta"; sessionId: string; text: string }
  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string }
  | { type: "approvalRequest"; sessionId: string; callId: string; command: string }
  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
  | { type: "error"; sessionId: string; message: string }
  | { type: "turnComplete"; sessionId: string }
  | { type: "newSession" }
  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number }[] }
  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] }
  | { type: "config"; model: string; models: string[]; effort: Effort };

export type WebviewToHostMsg =
  | { type: "userMessage"; sessionId: string; text: string }
  | { type: "approve"; callId: string; approved: boolean }
  | { type: "newSessionRequest" }
  | { type: "retry"; sessionId: string }
  | { type: "requestSessionList" }
  | { type: "loadSession"; sessionId: string }
  | { type: "requestConfig" }
  | { type: "setModel"; model: string }
  | { type: "setEffort"; effort: Effort };

export type SessionEvent =
  | { kind: "user"; text: string; ts: number }
  | { kind: "assistantText"; text: string; ts: number }
  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number }
  | { kind: "error"; message: string; ts: number };
