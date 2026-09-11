import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { send, onHostMessage } from "./api";
import type { HostToWebviewMsg, SessionEvent, ToolName, Effort, Mode, FileAttachment } from "../shared/protocol";
import logoUrl from "../../media/komind-logo.png";

interface Card {
  kind: "user" | "assistant" | "tool" | "error";
  text?: string;
  callId?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  ok?: boolean;
  pendingApproval?: string;
  approvalDone?: "approved" | "rejected";
}

const CSS = `
  :root {
    --km-radius: 8px;
    --km-radius-sm: 6px;
    --km-accent: var(--vscode-charts-green, #22c55e);
    --km-warn: var(--vscode-charts-yellow, #eab308);
    --km-transition: 150ms ease;
  }
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  button {
    font-family: inherit; font-size: 12px;
    color: var(--vscode-foreground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-inputBackground));
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius-sm);
    padding: 4px 10px; min-height: 26px;
    cursor: pointer;
    transition: background var(--km-transition), border-color var(--km-transition), opacity var(--km-transition);
    display: inline-flex; align-items: center; gap: 5px;
  }
  button:hover { background: var(--vscode-list-hoverBackground); }
  button:focus-visible, textarea:focus-visible, select:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.approve { color: var(--km-accent); border-color: var(--km-accent); }
  button.approve:hover { background: color-mix(in srgb, var(--km-accent) 15%, transparent); }
  button.reject { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  button.reject:hover { background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }

  .app { display: flex; flex-direction: column; height: 100vh; }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px 6px;
    flex: none;
  }
  .brand { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; letter-spacing: 0.2px; }
  .brand .brand-logo { width: 22px; height: 22px; object-fit: contain; flex: none; }
  .header .spacer { flex: 1; }
  .icon-btn { padding: 4px 7px; min-height: 28px; }

  /* Controls row: model/effort menu + repo context toggle */
  .controls {
    display: flex; align-items: center; gap: 6px;
    padding: 0 10px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex: none; position: relative;
  }
  .picker-wrap { position: relative; flex: 1; min-width: 0; }
  .picker-btn {
    width: 100%; justify-content: space-between; min-height: 28px;
    font-weight: 600;
  }
  .picker-btn .label { display: flex; align-items: center; gap: 6px; overflow: hidden; }
  .picker-btn .label .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-btn .chev { transition: transform var(--km-transition); flex: none; }
  .picker-btn .chev.open { transform: rotate(180deg); }
  .picker-menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--vscode-editorWidget-background, var(--vscode-inputBackground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: var(--km-radius);
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    z-index: 60; padding: 4px;
    animation: km-menu-in 130ms ease;
    max-height: 320px; overflow-y: auto;
  }
  @keyframes km-menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .menu-section {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
    opacity: 0.55; padding: 6px 8px 3px;
  }
  .menu-item {
    display: flex; width: 100%; align-items: center; gap: 8px;
    text-align: left; font-weight: 400; font-size: 12.5px;
    padding: 6px 8px; min-height: 30px; border: none; border-radius: var(--km-radius-sm);
    background: transparent; justify-content: flex-start;
  }
  .menu-item:hover { background: var(--vscode-list-hoverBackground); }
  .menu-item .check { visibility: hidden; color: var(--km-accent); flex: none; }
  .menu-item.selected .check { visibility: visible; }
  .menu-item .check:empty { display: none; }
  .menu-sep { border-top: 1px solid var(--vscode-panel-border); margin: 4px 2px; }
  .add-model-row { display: flex; gap: 4px; padding: 2px 4px 4px; }
  .add-model-row input {
    flex: 1; min-width: 0; font-family: inherit; font-size: 12px;
    color: var(--vscode-inputForeground);
    background: var(--vscode-inputBackground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: var(--km-radius-sm); padding: 4px 8px;
  }
  .add-model-row input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .effort-row { display: flex; gap: 4px; padding: 2px 6px 6px; }
  .effort-row button {
    flex: 1; min-height: 26px; justify-content: center; font-size: 11.5px; font-weight: 600;
  }
  .effort-row button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent; opacity: 1;
  }
  .ctx-btn { flex: none; min-height: 28px; }
  .ctx-btn.active {
    background: color-mix(in srgb, var(--km-accent) 18%, transparent);
    border-color: var(--km-accent);
    color: var(--km-accent);
  }

  /* Attachment chips */
  .attach-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 0 6px; }
  .attach-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; padding: 2px 4px 2px 8px; min-height: 22px;
    background: var(--vscode-inputBackground);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px; max-width: 100%;
  }
  .attach-chip .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attach-chip button { border: none; background: none; padding: 2px; min-height: 18px; min-width: 18px; border-radius: 50%; }
  .attach-chip button:hover { background: var(--vscode-list-hoverBackground); }

  /* History panel */
  .history-panel {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: var(--vscode-sideBar-background);
    z-index: 50; display: flex; flex-direction: column;
    animation: km-slide-in 180ms ease;
  }
  @keyframes km-slide-in { from { transform: translateX(16px); opacity: 0; } to { transform: none; opacity: 1; } }
  .history-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 10px 8px; border-bottom: 1px solid var(--vscode-panel-border);
    font-weight: 600; font-size: 12px;
  }
  .history-head button { margin-left: auto; }
  .history-list { flex: 1; overflow-y: auto; padding: 6px; }
  .history-item {
    display: block; width: 100%; text-align: left; font-weight: 400;
    padding: 8px 10px; min-height: 34px; border: none; border-radius: var(--km-radius-sm);
    background: transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-empty { padding: 20px 12px; text-align: center; opacity: 0.6; font-size: 12px; }

  /* Chat scroll area */
  .chat { flex: 1; overflow-y: auto; padding: 12px 10px; scroll-behavior: smooth; }

  /* Empty state */
  .empty {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 6px;
    text-align: center; padding: 24px; opacity: 0.9;
  }
  .empty .logo-img { width: 84px; height: 84px; object-fit: contain; margin-bottom: 10px; animation: km-logo-float 3s ease-in-out infinite; }
  @keyframes km-logo-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  .empty h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .empty p { margin: 0 0 14px; opacity: 0.7; font-size: 12px; }
  .suggestions { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 280px; }
  .suggestions button { justify-content: flex-start; text-align: left; font-weight: 400; }

  /* User bubble */
  .user-row { display: flex; justify-content: flex-end; margin: 10px 0; }
  .user-bubble {
    max-width: 85%;
    background: color-mix(in srgb, var(--vscode-focusBorder) 22%, var(--vscode-inputBackground));
    border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
    border-radius: var(--km-radius) var(--km-radius) 3px var(--km-radius);
    padding: 7px 11px;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  /* Assistant markdown */
  .assistant { margin: 10px 0; line-height: 1.55; }
  .md p { margin: 6px 0; }
  .md h1, .md h2, .md h3, .md h4 { margin: 12px 0 6px; line-height: 1.3; }
  .md h1 { font-size: 16px; } .md h2 { font-size: 15px; } .md h3 { font-size: 14px; } .md h4 { font-size: 13px; }
  .md ul, .md ol { margin: 6px 0; padding-left: 22px; }
  .md li { margin: 2px 0; }
  .md code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px; padding: 1px 4px;
  }
  .md pre {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius-sm);
    padding: 10px 12px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.5; }
  .md blockquote {
    margin: 8px 0; padding: 2px 12px;
    border-left: 3px solid var(--vscode-panel-border);
    opacity: 0.85;
  }
  .md a { color: var(--vscode-textLink-foreground); }
  .md table { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  .md th, .md td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }
  .md th { background: var(--vscode-list-hoverBackground); }
  .md hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 12px 0; }

  /* Streaming dots */
  .dots { display: inline-flex; gap: 4px; padding: 8px 2px; }
  .dots span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--vscode-foreground); opacity: 0.4;
    animation: km-bounce 1.2s infinite ease-in-out;
  }
  .dots span:nth-child(2) { animation-delay: 0.15s; }
  .dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes km-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-4px); opacity: 0.9; }
  }

  /* Tool card */
  .tool-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius);
    margin: 8px 0; overflow: hidden;
    background: color-mix(in srgb, var(--vscode-inputBackground) 55%, transparent);
    transition: border-color var(--km-transition);
  }
  .tool-card.running { border-color: color-mix(in srgb, var(--vscode-focusBorder) 50%, var(--vscode-panel-border)); }
  .tool-card.awaiting { border-color: color-mix(in srgb, var(--km-warn) 55%, var(--vscode-panel-border)); }
  .tool-card.done-ok { border-color: color-mix(in srgb, var(--km-accent) 40%, var(--vscode-panel-border)); }
  .tool-card.done-err { border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, var(--vscode-panel-border)); }
  .tool-head {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  .tool-name { font-weight: 600; }
  .tool-status { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 11px; opacity: 0.9; }
  .tool-status svg { flex: none; }
  .spin { animation: km-spin 1s linear infinite; }
  @keyframes km-spin { to { transform: rotate(360deg); } }
  .tool-body { padding: 0 10px 8px; }
  .tool-args { font-size: 11px; opacity: 0.65; margin-top: -2px; margin-bottom: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cmd-block {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius-sm);
    padding: 6px 10px; margin: 6px 0;
    white-space: pre-wrap; word-break: break-all;
  }
  .approval-row { display: flex; gap: 8px; margin-top: 8px; }
  .approval-row button { flex: 1; justify-content: center; font-weight: 600; }
  .kbd {
    font-size: 9.5px; font-weight: 700; opacity: 0.7;
    border: 1px solid currentColor; border-radius: 3px;
    padding: 0 3px; margin-left: 2px; line-height: 14px;
  }

  /* Plan/Build mode toggle */
  .mode-toggle { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: var(--km-radius-sm); overflow: hidden; flex: none; }
  .mode-toggle button {
    border: none; border-radius: 0; min-height: 26px; padding: 2px 10px;
    font-size: 11px; font-weight: 600; background: transparent; opacity: 0.65;
  }
  .mode-toggle button + button { border-left: 1px solid var(--vscode-panel-border); }
  .mode-toggle button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
  .mode-toggle button.active.plan { background: var(--km-warn); color: var(--vscode-sideBar-background, #1e1e1e); }
  .tool-output {
    margin: 6px 0 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 220px; overflow-y: auto;
    background: var(--vscode-textCodeBlock-background);
    border-radius: var(--km-radius-sm);
    padding: 8px 10px;
  }

  /* Error card */
  .error-card {
    display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid var(--vscode-errorForeground);
    border-radius: var(--km-radius);
    background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
    color: var(--vscode-errorForeground);
    padding: 8px 10px; margin: 8px 0;
    font-size: 12px;
  }
  .error-card .msg { flex: 1; word-break: break-word; }

  /* Composer */
  .composer { flex: none; padding: 8px 10px 10px; border-top: 1px solid var(--vscode-panel-border); }
  .composer-row { display: flex; gap: 6px; align-items: flex-end; }
  .composer textarea {
    flex: 1; resize: none;
    font-family: inherit; font-size: 13px; line-height: 1.5;
    color: var(--vscode-inputForeground);
    background: var(--vscode-inputBackground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: var(--km-radius);
    padding: 8px 10px;
    transition: border-color var(--km-transition);
  }
  .composer textarea:focus { border-color: var(--vscode-focusBorder); }
  .composer textarea::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.8; }
  .composer .send-btn {
    min-height: 34px; min-width: 38px; justify-content: center;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent; border-radius: var(--km-radius);
  }
  .composer .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  .composer .hint { margin-top: 5px; font-size: 10.5px; opacity: 0.55; text-align: center; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    .chat { scroll-behavior: auto; }
  }
`;

/* ---------- Icons (inline SVG, no emoji) ---------- */
const iconProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const IconPlus = () => (<svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>);
const IconHistory = () => (<svg {...iconProps} width={15} height={15}><path d="M3 3v6h6" /><path d="M3.5 13a9 9 0 102.6-8.4L3 7" /><path d="M12 8v4l3 2" /></svg>);
const IconChevronLeft = () => (<svg {...iconProps} width={14} height={14}><path d="M15 18l-6-6 6-6" /></svg>);
const IconChevronDown = () => (<svg {...iconProps} width={13} height={13}><path d="M6 9l6 6 6-6" /></svg>);
const IconPaperclip = () => (<svg {...iconProps} width={14} height={14}><path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.2-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>);
const IconBranch = () => (<svg {...iconProps} width={14} height={14}><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>);
const IconSparkMini = () => (
  <svg {...iconProps} width={12} height={12} style={{ color: "var(--km-accent)", flex: "none" }}>
    <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9L12 3z" />
  </svg>
);
const IconFileChip = () => (<svg {...iconProps} width={11} height={11}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconSend = () => (<svg {...iconProps} width={15} height={15}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>);
const IconCheck = () => (<svg {...iconProps} width={13} height={13}><path d="M20 6L9 17l-5-5" /></svg>);
const IconX = () => (<svg {...iconProps} width={13} height={13}><path d="M18 6L6 18M6 6l12 12" /></svg>);
const IconClock = () => (<svg {...iconProps} width={13} height={13}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>);
const IconAlert = () => (<svg {...iconProps} width={15} height={15}><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
const IconSpinner = () => (<svg {...iconProps} width={13} height={13} className="spin"><path d="M21 12a9 9 0 11-6.2-8.56" /></svg>);
const IconFile = () => (<svg {...iconProps} width={13} height={13}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconFolder = () => (<svg {...iconProps} width={13} height={13}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>);
const IconPencil = () => (<svg {...iconProps} width={13} height={13}><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>);
const IconTerminal = () => (<svg {...iconProps} width={13} height={13}><path d="M4 17l6-6-6-6" /><path d="M12 19h8" /></svg>);
const IconRotate = () => (<svg {...iconProps} width={13} height={13}><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 102.1-9.4L1 10" /></svg>);

function toolIcon(tool?: string) {
  switch (tool) {
    case "read_file": return <IconFile />;
    case "list_dir": return <IconFolder />;
    case "apply_edit": return <IconPencil />;
    case "run_terminal": return <IconTerminal />;
    default: return <IconTerminal />;
  }
}

const TOOL_LABEL: Record<string, string> = {
  read_file: "Read file",
  list_dir: "List directory",
  apply_edit: "Edit file",
  run_terminal: "Terminal command",
};

/* ---------- Markdown with memoized sanitized parse ---------- */
const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }) as string),
    [text]
  );
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

/* ---------- App ---------- */
export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionList, setSessionList] = useState<{ id: string; firstUserMessage: string }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [model, setModel] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [effort, setEffort] = useState<Effort>("medium");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [contextOn, setContextOn] = useState(false);
  const [mode, setMode] = useState<Mode>("build");
  const [alwaysAllow, setAlwaysAllow] = useState({ terminal: false, edits: false });
  const sessionIdRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    // remove the host-rendered loading splash once React has mounted
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), 220);
    }

    onHostMessage((m: HostToWebviewMsg) => {
      if (m.type === "turnComplete" || m.type === "error") setStreaming(false);
      setCards((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        switch (m.type) {
          case "newSession":
            sessionIdRef.current = "";
            setStreaming(false);
            return [];
          case "loadEvents":
            sessionIdRef.current = m.sessionId;
            setStreaming(false);
            return eventsToCards(m.events);
          case "textDelta":
            sessionIdRef.current = m.sessionId;
            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            else next.push({ kind: "assistant", text: m.text });
            return next;
          case "toolCall":
            next.push({ kind: "tool", callId: m.callId, tool: m.tool, input: m.input });
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
            return next.map((c) => (c.callId === m.callId ? { ...c, output: m.output, ok: m.ok } : c));
          case "error":
            next.push({ kind: "error", text: m.message });
            return next;
          case "turnComplete":
            return next;
          case "sessionList":
            setSessionList(m.sessions);
            return next;
          case "config":
            setModel(m.model);
            setModelOptions(m.models.length > 0 ? m.models : [m.model]);
            setEffort(m.effort);
            setMode(m.mode);
            setAlwaysAllow(m.alwaysAllow);
            return next;
          case "attachments":
            setAttachments((prev) => [...prev, ...m.files]);
            return next;
          case "contextEnabled":
            setContextOn(m.enabled);
            return next;
          default:
            return next;
        }
      });
    });
    send({ type: "requestSessionList" });
    send({ type: "requestConfig" });
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [cards, streaming]);

  // keyboard shortcuts for the pending approval: A approve · Shift+A always allow · R reject
  const pendingApprovalCard = cards.find((c) => c.kind === "tool" && c.pendingApproval);
  useEffect(() => {
    if (!pendingApprovalCard) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "a" && pendingApprovalCard.callId) {
        e.preventDefault();
        send({ type: "approve", callId: pendingApprovalCard.callId, approved: true, always: e.shiftKey });
      } else if (key === "r" && pendingApprovalCard.callId) {
        e.preventDefault();
        send({ type: "approve", callId: pendingApprovalCard.callId, approved: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingApprovalCard]);

  const onChatScroll = () => {
    const el = chatRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || !sessionIdRef.current) return;
    send({ type: "userMessage", sessionId: sessionIdRef.current, text: value, attachments: attachments.length > 0 ? attachments : undefined });
    setCards((p) => [...p, { kind: "user", text: attachments.length > 0 ? `${value}\n\n[${attachments.map((f) => `📎 ${f.name}`).join(" ")}]` : value }]);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    nearBottomRef.current = true;
  };

  const onRetry = () => {
    if (sessionIdRef.current) send({ type: "retry", sessionId: sessionIdRef.current });
  };

  const suggestions = [
    "Explain the structure of this project",
    "Read a.txt and summarize it",
    "Refactor a function for clarity",
  ];

  return (
    <div className="app" style={{ position: "relative" }}>
      <style>{CSS}</style>

      <div className="header">
        <span className="brand"><img src={logoUrl} alt="" className="brand-logo" /> KoMind</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setHistoryOpen(true)} title="Chat history">
          <IconHistory />
        </button>
        <button className="icon-btn" onClick={() => { setHistoryOpen(false); send({ type: "newSessionRequest" }); }} title="New session">
          <IconPlus />
        </button>
      </div>

      <div className="controls">
        <div className="picker-wrap">
          <button
            className="picker-btn"
            onClick={() => setMenuOpen((o) => !o)}
            title="Model and reasoning effort"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
          >
            <span className="label">
              <IconSparkMini />
              <span className="name">{model || "Select model"}</span>
            </span>
            <span className={`chev ${menuOpen ? "open" : ""}`}><IconChevronDown /></span>
          </button>
          {menuOpen && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setMenuOpen(false)} />
              <div className="picker-menu" role="listbox">
                <div className="menu-section">Model</div>
                {modelOptions.map((mo) => (
                  <button
                    key={mo}
                    role="option"
                    aria-selected={mo === model}
                    className={`menu-item ${mo === model ? "selected" : ""}`}
                    onClick={() => { setModel(mo); send({ type: "setModel", model: mo }); }}
                  >
                    <span className="check">{mo === model ? <IconCheck /> : null}</span>
                    {mo}
                  </button>
                ))}
                <div className="menu-section">Reasoning effort</div>
                <div className="effort-row" role="radiogroup" aria-label="Reasoning effort">
                  {(["low", "medium", "high"] as Effort[]).map((lv) => (
                    <button
                      key={lv}
                      className={effort === lv ? "active" : ""}
                      onClick={() => { setEffort(lv); send({ type: "setEffort", effort: lv }); }}
                      role="radio"
                      aria-checked={effort === lv}
                    >
                      {lv === "low" ? "Low" : lv === "medium" ? "Med" : "High"}
                    </button>
                  ))}
                </div>
                <div className="menu-sep" />
                {addingModel ? (
                  <div className="add-model-row">
                    <input
                      autoFocus
                      value={newModel}
                      placeholder="model name, e.g. claude-sonnet-4-5"
                      onChange={(e) => setNewModel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newModel.trim()) {
                          send({ type: "addModel", model: newModel.trim() });
                          setAddingModel(false); setNewModel(""); setMenuOpen(false);
                        } else if (e.key === "Escape") {
                          setAddingModel(false); setNewModel("");
                        }
                      }}
                      aria-label="New model name"
                    />
                    <button
                      title="Add model"
                      disabled={!newModel.trim()}
                      onClick={() => {
                        if (!newModel.trim()) return;
                        send({ type: "addModel", model: newModel.trim() });
                        setAddingModel(false); setNewModel(""); setMenuOpen(false);
                      }}
                    >
                      <IconPlus />
                    </button>
                  </div>
                ) : (
                  <button className="menu-item" onClick={() => setAddingModel(true)}>
                    <span className="check" />
                    <IconPlus /> Add model…
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <button
          className={`ctx-btn ${contextOn ? "active" : ""}`}
          onClick={() => { const next = !contextOn; setContextOn(next); send({ type: "setContextEnabled", enabled: next }); }}
          title={contextOn ? "Repo context: ON — git status + file tree sent with the first message of each session" : "Repo context: OFF — click to attach git + file tree context"}
          aria-pressed={contextOn}
        >
          <IconBranch />
        </button>
        <div className="mode-toggle" role="radiogroup" aria-label="Agent mode" title="Plan mode: read-only, no edits or commands. Build mode: full tool access.">
          <button
            className={mode === "plan" ? "active plan" : ""}
            onClick={() => { setMode("plan"); send({ type: "setMode", mode: "plan" }); }}
            role="radio"
            aria-checked={mode === "plan"}
          >
            Plan
          </button>
          <button
            className={mode === "build" ? "active" : ""}
            onClick={() => { setMode("build"); send({ type: "setMode", mode: "build" }); }}
            role="radio"
            aria-checked={mode === "build"}
          >
            Build
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="history-panel">
          <div className="history-head">
            <IconHistory /> Chat history
            <button className="icon-btn" onClick={() => setHistoryOpen(false)} title="Back to chat">
              <IconChevronLeft />
            </button>
          </div>
          <div className="history-list">
            {sessionList.length === 0 ? (
              <div className="history-empty">No previous sessions yet.</div>
            ) : (
              sessionList.map((s) => (
                <button
                  key={s.id}
                  className="history-item"
                  title={s.firstUserMessage}
                  onClick={() => { send({ type: "loadSession", sessionId: s.id }); setHistoryOpen(false); }}
                >
                  {s.firstUserMessage.slice(0, 60)}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="chat" ref={chatRef} onScroll={onChatScroll}>
        {cards.length === 0 && !streaming ? (
          <div className="empty">
            <img src={logoUrl} alt="KoMind logo" className="logo-img" />
            <h2>KoMind</h2>
            <p>Your coding agent — reads files, applies edits, runs approved commands.</p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} onClick={() => submit(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {cards.map((c, i) => <CardView key={i} card={c} onRetry={onRetry} />)}
            {streaming && cards[cards.length - 1]?.kind !== "assistant" && (
              <div className="dots" aria-label="Thinking"><span /><span /><span /></div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((f, i) => (
              <span key={`${f.name}-${i}`} className="attach-chip" title={f.truncated ? `${f.name} (truncated)` : f.name}>
                <IconFileChip />
                <span className="n">{f.name}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  title={`Remove ${f.name}`}
                  aria-label={`Remove attachment ${f.name}`}
                >
                  <IconX />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            className="icon-btn"
            onClick={() => send({ type: "attachFiles" })}
            title="Attach files to the next message"
            aria-label="Attach files"
          >
            <IconPaperclip />
          </button>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Ask KoMind anything…"
            aria-label="Message KoMind"
          />
          <button
            className="send-btn"
            onClick={() => submit()}
            disabled={!input.trim() || !sessionIdRef.current}
            title="Send (Enter)"
          >
            <IconSend />
          </button>
        </div>
        <div className="hint">
          Enter to send · Shift+Enter for a new line
          {mode === "plan" ? " · 🧭 Plan mode (read-only)" : ""}
          {contextOn ? " · Repo context ON" : ""}
          {alwaysAllow.terminal ? " · Terminal auto-approved" : ""}
        </div>
      </div>
    </div>
  );
}

function eventsToCards(events: SessionEvent[]): Card[] {
  return events.map((e) => {
    if (e.kind === "user") return { kind: "user" as const, text: e.text };
    if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text };
    if (e.kind === "error") return { kind: "error" as const, text: e.message };
    if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool as ToolName, input: e.input };
    return { kind: "tool" as const, callId: e.callId, output: e.output, ok: e.ok };
  });
}

function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
  if (card.kind === "assistant") {
    return (
      <div className="assistant">
        <Markdown text={card.text ?? ""} />
      </div>
    );
  }
  if (card.kind === "user") {
    return (
      <div className="user-row">
        <div className="user-bubble">{card.text}</div>
      </div>
    );
  }
  if (card.kind === "error") {
    return (
      <div className="error-card" role="alert">
        <IconAlert />
        <span className="msg">{card.text}</span>
        <button onClick={onRetry} title="Retry the last request"><IconRotate /> Retry</button>
      </div>
    );
  }

  /* Tool card */
  const rejected = card.approvalDone === "rejected";
  const awaiting = Boolean(card.pendingApproval);
  const running = card.output === undefined && !awaiting && !rejected;
  const doneOk = card.output !== undefined && card.ok === true;
  const doneErr = (card.output !== undefined && card.ok === false) || rejected;
  const statusClass = awaiting ? "awaiting" : running ? "running" : doneErr ? "done-err" : doneOk ? "done-ok" : "";
  const statusIcon = awaiting ? <IconClock /> : running ? <IconSpinner /> : rejected ? <IconX /> : doneErr ? <IconX /> : <IconCheck />;
  const statusText = awaiting ? "Awaiting approval" : running ? "Running" : rejected ? "Rejected" : doneErr ? "Failed" : "Done";
  const statusColor = awaiting ? "var(--km-warn)" : doneErr || rejected ? "var(--vscode-errorForeground)" : doneOk ? "var(--km-accent)" : "var(--vscode-foreground)";

  const args = card.input?.path ? String(card.input.path) : "";

  return (
    <div className={`tool-card ${statusClass}`}>
      <div className="tool-head">
        {toolIcon(card.tool)}
        <span className="tool-name">{TOOL_LABEL[card.tool ?? ""] ?? card.tool}</span>
        <span className="tool-status" style={{ color: statusColor }}>
          {statusIcon} {statusText}
        </span>
      </div>
      {args && <div className="tool-body"><div className="tool-args" title={args}>{args}</div></div>}
      {card.pendingApproval && (
        <div className="tool-body">
          <div className="cmd-block">{card.pendingApproval}</div>
          <div className="approval-row">
            <button className="approve" onClick={() => send({ type: "approve", callId: card.callId!, approved: true })} title="Approve (A)">
              <IconCheck /> Approve <span className="kbd">A</span>
            </button>
            <button className="approve" onClick={() => send({ type: "approve", callId: card.callId!, approved: true, always: true })} title="Always allow this tool — no more approval prompts (Shift+A)">
              <IconCheck /> Always allow <span className="kbd">⇧A</span>
            </button>
            <button className="reject" onClick={() => send({ type: "approve", callId: card.callId!, approved: false })} title="Reject (R)">
              <IconX /> Reject <span className="kbd">R</span>
            </button>
          </div>
        </div>
      )}
      {card.output !== undefined && (
        <div className="tool-body">
          <pre className="tool-output">{card.output}</pre>
        </div>
      )}
    </div>
  );
}
