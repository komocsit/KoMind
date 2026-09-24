export type ToolName = "read_file" | "list_dir" | "apply_edit" | "create_file" | "run_terminal" | "run_subagents";

/** A single line in a rendered diff for a file edit/creation. */
export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
  /** 1-based line number in the old file (present for context/del lines). */
  oldLine?: number;
  /** 1-based line number in the new file (present for context/add lines). */
  newLine?: number;
}

/**
 * Structured description of what a file edit changed. Attached to the tool
 * result of `apply_edit`/`create_file` so the webview can render a diff and
 * offer to open the file (or a native diff) in the editor.
 */
export interface EditInfo {
  path: string;
  /** True when the edit created a brand-new file. */
  created?: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export type Effort = "low" | "medium" | "high" | "extra" | "max";
export type Mode = "plan" | "build";
export type SubagentStatus = "running" | "done" | "failed";

/** Live status of a single sub-agent spawned by a `run_subagents` call. */
export interface SubagentStatusView {
  name: string;
  status: SubagentStatus;
}

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

export interface ImageAttachment {
  name: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64-encoded image bytes (without a data URL prefix). */
  data: string;
}

export type HostToWebviewMsg =
  | { type: "textDelta"; sessionId: string; text: string }
  | { type: "thinkingDelta"; sessionId: string; text: string }
  | { type: "toolCall"; sessionId: string; callId: string; tool: ToolName; input: Record<string, unknown> }
  | { type: "toolResult"; sessionId: string; callId: string; ok: boolean; output: string; editInfo?: EditInfo }
  | { type: "subagentStatus"; sessionId: string; callId: string; agents: SubagentStatusView[] }
  | { type: "approvalRequest"; sessionId: string; callId: string; command: string; tool: ToolName }
  | { type: "approvalResolved"; sessionId: string; callId: string; approved: boolean }
  | { type: "error"; sessionId: string; message: string }
  | { type: "turnComplete"; sessionId: string }
  | { type: "turnStopped"; sessionId: string }
  | { type: "newSession" }
  | { type: "sessionList"; sessions: { id: string; firstUserMessage: string; ts: number; archived: boolean }[] }
  | { type: "loadEvents"; sessionId: string; events: SessionEvent[] }
  | { type: "config"; model: string; models: string[]; effort: Effort; mode: Mode; alwaysAllow: { terminal: boolean; edits: boolean } }
  | { type: "settings"; baseUrl: string; maxTokens: number; autoApproveEdits: boolean; autoApproveTerminal: boolean; models: string[]; apiKeySet: boolean }
  | { type: "attachments"; files: FileAttachment[]; images: ImageAttachment[]; warning?: string }
  | { type: "attachmentError"; message: string }
  | { type: "importResult"; ok: boolean; message: string; count?: number }
  | { type: "contextEnabled"; enabled: boolean };

export type WebviewToHostMsg =
  | { type: "userMessage"; sessionId: string; text: string; attachments?: FileAttachment[]; images?: ImageAttachment[] }
  | { type: "approve"; callId: string; approved: boolean; always?: boolean }
  | { type: "newSessionRequest" }
  | { type: "requestCurrentSession" }
  | { type: "stop"; sessionId: string }
  | { type: "retry"; sessionId: string }
  | { type: "requestSessionList" }
  | { type: "loadSession"; sessionId: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "setSessionArchived"; sessionId: string; archived: boolean }
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
  | { type: "attachFolder" }
  | { type: "setContextEnabled"; enabled: boolean }
  | { type: "importSession" }
  | { type: "openFile"; path: string; view: "file" | "diff" };

export type SessionEvent =
  | { kind: "user"; text: string; ts: number; images?: ImageAttachment[] }
  | { kind: "assistantText"; text: string; ts: number }
  | { kind: "toolCall"; callId: string; tool: ToolName; input: Record<string, unknown>; ts: number }
  | { kind: "toolResult"; callId: string; ok: boolean; output: string; ts: number; editInfo?: EditInfo }
  | { kind: "error"; message: string; ts: number };
