export type ToolName = "read_file" | "list_dir" | "apply_edit" | "run_terminal";

export type Effort = "low" | "medium" | "high";
export type Mode = "plan" | "build";

export interface ToolCallView {
  callId: string;
  tool: ToolName;
  input: Record<string, unknown>;
}

export interface FileAttachment {
  name: string;
  content: string;
  truncated?: boolean;
}

export type HostToWebviewMsg =
  | { type: "textDelta"; sessionId: string; text: string }
  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string }
  | { type: "approvalRequest"; sessionId: string; callId: string; command: string; tool: ToolName }
  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
  | { type: "error"; sessionId: string; message: string }
  | { type: "turnComplete"; sessionId: string }
  | { type: "newSession" }
  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number }[] }
  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] }
  | { type: "config"; model: string; models: string[]; effort: Effort; mode: Mode; alwaysAllow: { terminal: boolean; edits: boolean } }
  | { type: "settings"; baseUrl: string; maxTokens: number; autoApproveEdits: boolean; autoApproveTerminal: boolean; models: string[]; apiKeySet: boolean }
  | { type: "attachments"; files: FileAttachment[] }
  | { type: "contextEnabled"; enabled: boolean };

export type WebviewToHostMsg =
  | { type: "userMessage"; sessionId: string; text: string; attachments?: FileAttachment[] }
  | { type: "approve"; callId: string; approved: boolean; always?: boolean }
  | { type: "newSessionRequest" }
  | { type: "retry"; sessionId: string }
  | { type: "requestSessionList" }
  | { type: "loadSession"; sessionId: string }
  | { type: "requestConfig" }
  | { type: "setModel"; model: string }
  | { type: "addModel"; model: string }
  | { type: "removeModel"; model: string }
  | { type: "requestSettings" }
  | { type: "updateSettings"; baseUrl?: string; maxTokens?: number; autoApproveEdits?: boolean; autoApproveTerminal?: boolean }
  | { type: "setApiKey" }
  | { type: "setEffort"; effort: Effort }
  | { type: "setMode"; mode: Mode }
  | { type: "resetPermissions" }
  | { type: "attachFiles" }
  | { type: "setContextEnabled"; enabled: boolean };

export type SessionEvent =
  | { kind: "user"; text: string; ts: number }
  | { kind: "assistantText"; text: string; ts: number }
  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number }
  | { kind: "error"; message: string; ts: number };
