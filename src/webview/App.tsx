import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { send, onHostMessage } from "./api";
import type { HostToWebviewMsg, SessionEvent, ToolName, Effort, Mode, FileAttachment, ImageAttachment, SubagentStatusView, EditInfo, SlashCommandView, SkillView } from "../shared/protocol";
import logoUrl from "../../media/komind-logo.png";

const DISPLAY_NAME = __KOMIND_DISPLAY_NAME__;

interface Card {
  kind: "user" | "assistant" | "tool" | "error" | "thinking" | "summary";
  text?: string;
  callId?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  ok?: boolean;
  images?: ImageAttachment[];
  pendingApproval?: string;
  approvalDone?: "approved" | "rejected";
  /** thinking cards: elapsed wall-clock seconds spent reasoning */
  thinkingSeconds?: number;
  /** thinking cards: whether the model is still streaming its reasoning */
  thinkingActive?: boolean;
  /** wall-clock time (ms since epoch) at which this step happened */
  ts?: number;
  /** summary cards: total time taken for the turn, in milliseconds */
  durationMs?: number;
  /** tool cards for run_subagents: live status of each spawned sub-agent */
  subagents?: SubagentStatusView[];
  /** structured diff for apply_edit/create_file tool cards */
  editInfo?: EditInfo;
}

const CSS = `
  :root {
    --km-radius: 8px;
    --km-radius-sm: 6px;
    /* Single professional brand accent used for interactive + decorative color. */
    --km-primary: var(--vscode-charts-blue, #3b82f6);
    --km-primary-soft: color-mix(in srgb, var(--km-primary) 14%, transparent);
    /* Semantic colors kept for status only (success / warning / error). */
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
    background: var(--km-primary);
    color: #fff;
    border-color: transparent;
  }
  button.primary:hover { background: color-mix(in srgb, var(--km-primary) 85%, #000); }
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
  .brand .brand-logo { width: 39.6px; height: 39.6px; object-fit: contain; flex: none; }
  .header .spacer { flex: 1; }
  .icon-btn { padding: 4px 7px; min-height: 28px; }
  .attach-menu-wrap { position: relative; flex: none; }
  .attach-trigger { min-width: 34px; min-height: 34px; justify-content: center; }
  .attach-menu {
    position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 70;
    width: 220px; padding: 5px;
    background: var(--vscode-editorWidget-background, var(--vscode-inputBackground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: 10px; box-shadow: 0 -5px 18px rgba(0,0,0,.4);
    animation: km-menu-in 130ms ease;
  }
  .attach-menu button { width: 100%; border: none; background: transparent; justify-content: flex-start; padding: 7px 9px; }
  .attach-menu button:hover { background: var(--vscode-list-hoverBackground); }
  .attach-menu button:disabled { opacity: .45; }
  .attach-menu .shortcut { margin-left: auto; opacity: .55; }

  /* Controls row (bottom, above composer): model/effort menu + repo context toggle */
  .controls {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px 0;
    border-top: 1px solid var(--vscode-panel-border);
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
    position: absolute; bottom: calc(100% + 4px); left: 0; right: 0;
    background: var(--vscode-editorWidget-background, var(--vscode-inputBackground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: var(--km-radius);
    box-shadow: 0 -4px 16px rgba(0,0,0,0.35);
    z-index: 60; padding: 4px;
    animation: km-menu-in 130ms ease;
    max-height: 320px; overflow-y: auto;
  }
  @keyframes km-menu-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
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
  .menu-item .check { visibility: hidden; color: var(--km-primary); flex: none; }
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

  /* Settings popup */
  .settings-overlay {
    position: absolute; inset: 0; z-index: 80;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    animation: km-fade-in 120ms ease;
  }
  @keyframes km-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .settings-panel {
    width: min(94%, 420px); max-height: 88%;
    display: flex; flex-direction: column;
    background: var(--vscode-editorWidget-background, var(--vscode-inputBackground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: km-menu-in 130ms ease;
  }
  .settings-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; font-weight: 600; font-size: 13px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .settings-head button { margin-left: auto; }
  .settings-body { padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field > label { font-size: 11.5px; font-weight: 600; opacity: 0.85; }
  .field input[type="text"], .field input:not([type]), .field input[type="number"] {
    font-family: inherit; font-size: 12.5px;
    color: var(--vscode-inputForeground);
    background: var(--vscode-inputBackground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: var(--km-radius-sm);
    padding: 6px 9px; min-height: 28px;
  }
  .field input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .field .row { display: flex; align-items: center; gap: 8px; }
  .apikey-status { font-size: 12px; opacity: 0.85; flex: 1; }
  .apikey-status.ok { color: var(--km-accent); }
  .apikey-status.none { color: var(--vscode-errorForeground); }
  .check-row { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
  .check-row input { margin-top: 2px; accent-color: var(--km-primary); }
  .check-row small { display: block; opacity: 0.6; font-size: 11px; font-weight: 400; }
  .model-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .muted { opacity: 0.6; font-size: 11.5px; }
  .settings-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border);
  }
  .settings-foot .primary { background: var(--km-primary); color: #fff; border-color: transparent; }
  .settings-foot .primary:hover { background: color-mix(in srgb, var(--km-primary) 85%, #000); }
  .effort-row { display: flex; gap: 4px; padding: 2px 6px 6px; }
  .effort-row button {
    flex: 1; min-height: 26px; justify-content: center; font-size: 11.5px; font-weight: 600;
  }
  .effort-row button.active {
    background: var(--km-primary);
    color: #fff;
    border-color: transparent; opacity: 1;
  }

  /* Effort slider (Faster ↔ Smarter) */
  .effort-slider { padding: 4px 10px 10px; }
  .effort-slider-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .effort-slider-head .es-label { font-size: 12px; opacity: 0.6; }
  .effort-slider-head .es-value {
    font-size: 13px; font-weight: 800;
    color: var(--km-primary);
  }
  .effort-slider-head .es-help {
    margin-left: auto; display: inline-flex; opacity: 0.5;
  }
  .effort-slider-ends {
    display: flex; justify-content: space-between;
    font-size: 11.5px; font-weight: 600; margin-bottom: 6px;
  }
  .effort-slider-ends span:first-child { color: var(--vscode-descriptionForeground, var(--vscode-foreground)); }
  .effort-slider-ends span:last-child { color: var(--km-primary); }
  .effort-track {
    position: relative; height: 26px; display: flex; align-items: center;
  }
  .effort-track input[type="range"] {
    -webkit-appearance: none; appearance: none;
    width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer;
  }
  .effort-track .es-rail {
    position: absolute; left: 0; right: 0; height: 22px; border-radius: 11px;
    background: var(--vscode-input-background, rgba(255,255,255,0.08));
    border: 1px solid var(--vscode-panel-border);
    pointer-events: none;
  }
  .effort-track .es-fill {
    position: absolute; left: 0; height: 22px; border-radius: 11px;
    background: var(--km-primary);
    pointer-events: none; transition: width var(--km-transition);
  }
  .effort-track .es-dots {
    position: absolute; left: 0; right: 0; display: flex;
    justify-content: space-between; padding: 0 13px; pointer-events: none;
  }
  .effort-track .es-dots span { width: 4px; height: 4px; border-radius: 50%; background: #fff; opacity: 0.55; }
  .effort-track input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 22px; height: 22px; border-radius: 50%;
    background: #fff;
    border: 3px solid var(--km-primary);
    box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: pointer;
  }
  .effort-track input[type="range"]::-moz-range-thumb {
    width: 22px; height: 22px; border-radius: 50%;
    background: #fff;
    border: 3px solid var(--km-primary);
    box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: pointer;
  }
  .ctx-btn { flex: none; min-height: 28px; }
  .ctx-btn.active {
    background: color-mix(in srgb, var(--km-primary) 18%, transparent);
    border-color: var(--km-primary);
    color: var(--km-primary);
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
  .image-chip { padding: 3px; border-radius: var(--km-radius-sm); position: relative; }
  .image-chip img { width: 44px; height: 44px; display: block; object-fit: cover; border-radius: 4px; }
  .image-chip button { position: absolute; top: -5px; right: -5px; background: var(--vscode-inputBackground); border: 1px solid var(--vscode-panel-border); }

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
  .history-tabs { display: flex; gap: 4px; padding: 6px 8px 2px; }
  .history-tabs button { flex: 1; justify-content: center; border: none; background: transparent; }
  .history-tabs button.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .history-list { flex: 1; overflow-y: auto; padding: 6px; }
  .history-row { display: flex; align-items: center; gap: 3px; border-radius: var(--km-radius-sm); }
  .history-row:hover { background: var(--vscode-list-hoverBackground); }
  .history-item {
    display: block; flex: 1; min-width: 0; text-align: left; font-weight: 400;
    padding: 8px 10px; min-height: 34px; border: none; border-radius: var(--km-radius-sm);
    background: transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .history-item:hover { background: transparent; }
  .history-action { flex: none; padding: 4px 6px; min-width: 26px; border: none; background: transparent; opacity: 0.65; }
  .history-action:hover { opacity: 1; }
  .history-action.delete:hover { color: var(--vscode-errorForeground); }
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
    background: color-mix(in srgb, var(--km-primary) 16%, var(--vscode-inputBackground));
    border: 1px solid color-mix(in srgb, var(--km-primary) 32%, transparent);
    border-radius: var(--km-radius) var(--km-radius) 3px var(--km-radius);
    padding: 7px 11px;
    white-space: pre-wrap;
    line-height: 1.5;
  }
  .user-images { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
  .user-images img { max-width: 180px; max-height: 180px; object-fit: contain; border-radius: var(--km-radius-sm); }

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

  /* KoMind-branded loading state */
  .komind-loading { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 2px; opacity: 0.85; }
  .komind-loading img { position: absolute; top: 0; left: 0; width: 28px; height: 28px; object-fit: contain; animation: km-sweep-lr 1.8s ease-in-out infinite, km-brand-pulse 1.2s ease-in-out infinite; will-change: left; }
  .komind-loading .km-sweep-track { position: relative; width: 100%; height: 28px; overflow: hidden; }
  @keyframes km-sweep-lr { from { left: 0; transform: translateX(0); } to { left: 100%; transform: translateX(-100%); } }
  .komind-loading span {
    font-size: 11px;
    font-weight: 700;
    opacity: 1;
    color: var(--km-primary);
  }
  .komind-loading .progress-color-0,
  .komind-loading .progress-color-1,
  .komind-loading .progress-color-2,
  .komind-loading .progress-color-3,
  .komind-loading .progress-color-4,
  .komind-loading .progress-color-5,
  .komind-loading .progress-color-6 { color: var(--km-primary); }
  .komind-status-logo { width: 16px; height: 16px; object-fit: contain; animation: km-brand-pulse 1.2s ease-in-out infinite; }
  @keyframes km-brand-pulse {
    0%, 100% { transform: scale(0.9); opacity: 0.5; }
    50% { transform: scale(1); opacity: 1; }
  }

  /* Thinking card — shows the model's live reasoning */
  .thinking-card {
    border: 1px solid var(--vscode-panel-border);
    border-left: 2px solid color-mix(in srgb, var(--km-primary) 60%, var(--vscode-panel-border));
    border-radius: var(--km-radius);
    margin: 8px 0; overflow: hidden;
    background: color-mix(in srgb, var(--vscode-inputBackground) 40%, transparent);
  }
  .thinking-head {
    display: flex; width: 100%; align-items: center; gap: 8px;
    min-height: 32px; padding: 6px 10px;
    color: var(--vscode-foreground); background: transparent;
    border: none; border-radius: 0;
    font-size: 12px; text-align: left;
  }
  .thinking-head:hover { background: var(--vscode-list-hoverBackground); }
  .thinking-title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
  .thinking-title img { width: 15px; height: 15px; object-fit: contain; }
  .thinking-title img.spin-pulse { animation: km-brand-pulse 1.2s ease-in-out infinite; }
  .thinking-meta { margin-left: auto; font-size: 11px; opacity: 0.7; }
  .thinking-chevron { display: inline-flex; flex: none; opacity: 0.65; transition: transform var(--km-transition); }
  .thinking-chevron.expanded { transform: rotate(180deg); }
  .thinking-body {
    padding: 4px 12px 10px;
    font-size: 12px; line-height: 1.55; font-style: italic;
    color: var(--vscode-descriptionForeground, var(--vscode-foreground));
    opacity: 0.9;
    white-space: pre-wrap; word-break: break-word;
    max-height: 320px; overflow-y: auto;
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
    display: flex; width: 100%; align-items: center; gap: 8px;
    min-height: 34px; padding: 6px 10px;
    color: var(--vscode-foreground); background: transparent;
    border: none; border-radius: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px; text-align: left;
  }
  .tool-head:hover { background: var(--vscode-list-hoverBackground); }
  .tool-name { font-weight: 600; }
  .tool-status { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 11px; opacity: 0.9; }
  .tool-status svg { flex: none; }
  .tool-chevron { display: inline-flex; flex: none; opacity: 0.65; transition: transform var(--km-transition); }
  .tool-chevron.expanded { transform: rotate(180deg); }
  .spin { animation: km-spin 1s linear infinite; }
  @keyframes km-spin { to { transform: rotate(360deg); } }
  .tool-body { padding: 0 10px 8px; }
  .tool-summary {
    padding: 0 10px 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground, var(--vscode-foreground));
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Sub-agent roster — one row per parallel agent with its pet icon + status */
  .subagents { padding: 2px 10px 8px; display: flex; flex-direction: column; gap: 4px; }
  .subagent-row {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px; min-height: 30px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius-sm);
    background: color-mix(in srgb, var(--vscode-inputBackground) 45%, transparent);
    font-size: 12px;
  }
  .subagent-row.running { border-color: color-mix(in srgb, var(--vscode-focusBorder) 45%, var(--vscode-panel-border)); }
  .subagent-row.done { border-color: color-mix(in srgb, var(--km-accent) 40%, var(--vscode-panel-border)); }
  .subagent-row.failed { border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, var(--vscode-panel-border)); }
  .subagent-pet {
    display: inline-flex; flex: none;
    width: 26px; height: 26px; align-items: center; justify-content: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--km-primary) 14%, transparent);
    color: var(--km-primary);
  }
  .subagent-row.done .subagent-pet { background: color-mix(in srgb, var(--km-accent) 16%, transparent); color: var(--km-accent); }
  .subagent-row.failed .subagent-pet { background: color-mix(in srgb, var(--vscode-errorForeground) 14%, transparent); color: var(--vscode-errorForeground); }
  .subagent-pet.working svg { animation: km-pet-bounce 1s ease-in-out infinite; }
  @keyframes km-pet-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  .subagent-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subagent-kind { font-size: 10.5px; opacity: 0.55; }
  .subagent-state { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
  .subagent-state svg { flex: none; }
  .subagent-state.running { color: var(--vscode-foreground); opacity: 0.85; }
  .subagent-state.done { color: var(--km-accent); }
  .subagent-state.failed { color: var(--vscode-errorForeground); }
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
  .mode-toggle button.active { background: var(--km-primary); color: #fff; opacity: 1; }
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

  /* File-edit diff — rendered inside apply_edit/create_file tool cards */
  .diff-stat { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; font-size: 11px; }
  .diff-stat .add { color: var(--km-accent); font-weight: 700; }
  .diff-stat .del { color: var(--vscode-errorForeground); font-weight: 700; }
  .diff-actions { display: flex; gap: 6px; padding: 2px 10px 6px; }
  .diff-actions button { font-size: 11px; min-height: 24px; padding: 3px 8px; }
  .diff-block {
    margin: 4px 10px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius-sm);
    overflow: auto;
    max-height: 320px;
    background: var(--vscode-textCodeBlock-background);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11.5px;
    line-height: 1.5;
  }
  .diff-line { display: flex; white-space: pre; }
  .diff-line .ln {
    flex: none; width: 34px; text-align: right; padding: 0 6px 0 4px;
    opacity: 0.4; user-select: none;
    border-right: 1px solid var(--vscode-panel-border);
  }
  .diff-line .mark { flex: none; width: 16px; text-align: center; opacity: 0.7; }
  .diff-line .txt { flex: 1; padding-right: 8px; white-space: pre-wrap; word-break: break-word; }
  .diff-line.add { background: color-mix(in srgb, var(--km-accent) 14%, transparent); }
  .diff-line.add .mark { color: var(--km-accent); }
  .diff-line.del { background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
  .diff-line.del .mark { color: var(--vscode-errorForeground); }
  .diff-line.gap { opacity: 0.45; justify-content: center; }
  .diff-line.gap .txt { text-align: center; padding: 0; }

  /* Error card */
  .error-card {    display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid var(--vscode-errorForeground);
    border-radius: var(--km-radius);
    background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
    color: var(--vscode-errorForeground);
    padding: 8px 10px; margin: 8px 0;
    font-size: 12px;
  }
  .error-card .msg { flex: 1; word-break: break-word; }

  /* Step timestamp — small, subtle label shown on each step */
  .step-ts {
    display: block;
    font-size: 10px;
    opacity: 0.5;
    margin: 0 0 2px;
    font-family: var(--vscode-editor-font-family, monospace);
    letter-spacing: 0.3px;
  }
  .user-row .step-ts { text-align: right; }

  /* Turn summary card — total time taken for the completed turn */
  .summary-card {
    display: flex; align-items: center; gap: 8px;
    margin: 12px 0 6px;
    padding: 6px 10px;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground, var(--vscode-foreground));
    border: 1px dashed var(--vscode-panel-border);
    border-radius: var(--km-radius);
    background: color-mix(in srgb, var(--vscode-inputBackground) 35%, transparent);
  }
  .summary-card svg { flex: none; opacity: 0.8; }
  .summary-card .total { font-weight: 700; color: var(--km-primary); }
  .summary-card .at { margin-left: auto; opacity: 0.7; font-family: var(--vscode-editor-font-family, monospace); }

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
    background: var(--km-primary);
    color: #fff;
    border-color: transparent; border-radius: var(--km-radius);
  }
  .composer .send-btn:hover { background: color-mix(in srgb, var(--km-primary) 85%, #000); }
  .composer .send-btn.stop {
    background: var(--vscode-errorForeground);
    color: var(--vscode-editor-background, #fff);
  }
  .composer .send-btn.stop:hover { opacity: 0.85; }
  .stop-square { width: 10px; height: 10px; border-radius: 1px; background: currentColor; }
  .composer .hint { margin-top: 5px; font-size: 10.5px; opacity: 0.55; text-align: center; }
  /* Slash-command autocomplete popup above the composer */
  .slash-menu { position: absolute; left: 10px; right: 10px; bottom: 100%; margin-bottom: 6px; z-index: 70;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); border: 1px solid var(--vscode-panel-border);
    border-radius: var(--km-radius); box-shadow: 0 6px 20px rgba(0,0,0,0.28); max-height: 220px; overflow-y: auto; padding: 4px; }
  .slash-menu .slash-item { display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; padding: 6px 8px;
    border: none; background: none; color: var(--vscode-foreground); border-radius: var(--km-radius-sm); cursor: pointer; }
  .slash-menu .slash-item:hover, .slash-menu .slash-item.active { background: var(--km-primary-soft); }
  .slash-menu .slash-item .cmd { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .slash-menu .slash-item .desc { font-size: 10.5px; opacity: 0.7; }
  .slash-badge { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 1px 5px; margin-right: 6px; border-radius: 4px; vertical-align: middle; font-family: var(--vscode-font-family); }
  .slash-badge.command { background: var(--km-primary-soft); color: var(--km-primary); }
  .slash-badge.skill { background: color-mix(in srgb, var(--km-accent) 18%, transparent); color: var(--km-accent); }
  .paste-error { margin: 0 0 6px; color: var(--vscode-errorForeground); font-size: 11px; }

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
const IconGear = () => (
  <svg {...iconProps} width={15} height={15}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.08a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.08a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.08a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);
const IconTrash = () => (<svg {...iconProps} width={12} height={12}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>);
const IconArchive = () => (<svg {...iconProps} width={13} height={13}><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>);
const IconUnarchive = () => (<svg {...iconProps} width={13} height={13}><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M12 17v-5M9 15l3-3 3 3" /></svg>);
const IconPaperclip = () => (<svg {...iconProps} width={14} height={14}><path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.2-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>);
const IconMenuFolder = () => (<svg {...iconProps} width={14} height={14}><path d="M3 6a2 2 0 012-2h5l2 3h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>);
const IconImport = () => (<svg {...iconProps} width={14} height={14}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>);
const IconSlashBox = () => (<svg {...iconProps} width={14} height={14}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M14 7l-4 10" /></svg>);
const IconConnector = () => (<svg {...iconProps} width={14} height={14}><rect x="3" y="12" width="7" height="8" rx="1" /><rect x="14" y="4" width="7" height="7" rx="1" /><path d="M6.5 12V8h11v4M10 16h4" /></svg>);
const IconPlug = () => (<svg {...iconProps} width={14} height={14}><path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 01-6 6v5M5 19l14-14" /></svg>);
const IconChevronRight = () => (<svg {...iconProps} width={13} height={13}><path d="M9 18l6-6-6-6" /></svg>);
const IconBranch = () => (<svg {...iconProps} width={14} height={14}><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>);
const IconSparkMini = () => (
  <svg {...iconProps} width={12} height={12} style={{ color: "var(--km-primary)", flex: "none" }}>
    <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9L12 3z" />
  </svg>
);
const IconFileChip = () => (<svg {...iconProps} width={11} height={11}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconSend = () => (<svg {...iconProps} width={15} height={15}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>);
const IconCheck = () => (<svg {...iconProps} width={13} height={13}><path d="M20 6L9 17l-5-5" /></svg>);
const IconX = () => (<svg {...iconProps} width={13} height={13}><path d="M18 6L6 18M6 6l12 12" /></svg>);
const IconClock = () => (<svg {...iconProps} width={13} height={13}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>);
const IconAlert = () => (<svg {...iconProps} width={15} height={15}><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
const IconFile = () => (<svg {...iconProps} width={13} height={13}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconFolder = () => (<svg {...iconProps} width={13} height={13}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>);
const IconPencil = () => (<svg {...iconProps} width={13} height={13}><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>);
const IconFilePlus = () => (<svg {...iconProps} width={13} height={13}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M12 12v6M9 15h6" /></svg>);
const IconOpen = () => (<svg {...iconProps} width={13} height={13}><path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /></svg>);
const IconDiff = () => (<svg {...iconProps} width={13} height={13}><path d="M12 3v6M9 6h6" /><path d="M9 18h6" /><path d="M5 21h14a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2z" /></svg>);
const IconTerminal = () => (<svg {...iconProps} width={13} height={13}><path d="M4 17l6-6-6-6" /><path d="M12 19h8" /></svg>);
const IconRotate = () => (<svg {...iconProps} width={13} height={13}><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 102.1-9.4L1 10" /></svg>);
const IconHelp = () => (<svg {...iconProps} width={14} height={14}><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>);

/* ---------- Pet icons for sub-agents ----------
   Each spawned sub-agent gets its own animal so it is easy to tell them apart
   at a glance. Icons are simple inline SVGs that inherit currentColor. */
const petProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const PetCat = () => (<svg {...petProps}><path d="M4 5l2.5 3.5M20 5l-2.5 3.5" /><path d="M4 5v6a8 8 0 0016 0V5" /><path d="M9 13h.01M15 13h.01" /><path d="M12 15v1.5M10.5 16.5h3" /><path d="M8 18l-2 1M16 18l2 1" /></svg>);
const PetDog = () => (<svg {...petProps}><path d="M5 7c0-2 1-3 2-3s2 1 2 3M15 7c0-2 1-3 2-3s2 1 2 3" /><path d="M6 7c-1 1-2 3-2 6a8 8 0 0016 0c0-3-1-5-2-6" /><path d="M9 13h.01M15 13h.01" /><path d="M12 15c-1 0-1.5.7-1.5 1.2S11 17 12 17s1.5-.3 1.5-.8S13 15 12 15z" /></svg>);
const PetRabbit = () => (<svg {...petProps}><path d="M8 9C7 6 6.5 3 8 3s2 3 2 6M16 9c1-3 1.5-6 0-6s-2 3-2 6" /><circle cx="12" cy="15" r="5" /><path d="M10 15h.01M14 15h.01" /><path d="M11.5 17.5h1" /></svg>);
const PetFox = () => (<svg {...petProps}><path d="M3 5l5 4M21 5l-5 4" /><path d="M8 9l4 3 4-3 1 5-5 5-5-5 1-5z" /><path d="M10.5 13h.01M13.5 13h.01" /><path d="M12 15v1" /></svg>);
const PetBear = () => (<svg {...petProps}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="13" r="6" /><path d="M10 13h.01M14 13h.01" /><circle cx="12" cy="16" r="1.2" /></svg>);
const PetPanda = () => (<svg {...petProps}><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="13" r="6.2" /><path d="M9 12.5c0-1 .7-1.5 1.5-1.5M15 12.5c0-1-.7-1.5-1.5-1.5" /><circle cx="12" cy="16" r="1" /></svg>);
const PetOwl = () => (<svg {...petProps}><path d="M12 3c-4 0-7 3-7 8s3 10 7 10 7-5 7-10-3-8-7-8z" /><circle cx="9" cy="10" r="2" /><circle cx="15" cy="10" r="2" /><path d="M12 12l-1.5 2h3L12 12z" /></svg>);
const PetFrog = () => (<svg {...petProps}><circle cx="7.5" cy="7" r="2.5" /><circle cx="16.5" cy="7" r="2.5" /><path d="M4 12a8 8 0 0016 0" /><path d="M4 12h16" /><path d="M7.5 7h.01M16.5 7h.01" /></svg>);
const PetPenguin = () => (<svg {...petProps}><path d="M12 3c-3 0-5 2.5-5 7v6a5 5 0 0010 0v-6c0-4.5-2-7-5-7z" /><path d="M12 8c-1.5 0-2.5 1.5-2.5 4s1 5 2.5 5 2.5-2.5 2.5-5-1-4-2.5-4z" /><path d="M10.5 6h.01M13.5 6h.01" /><path d="M12 10l-1 1.5h2L12 10z" /></svg>);
const PetTurtle = () => (<svg {...petProps}><circle cx="12" cy="12" r="5" /><path d="M12 7v10M7 12h10M8.5 8.5l7 7M15.5 8.5l-7 7" /><path d="M4 12h-1M20 12h1M6 17l-1 1M18 17l1 1" /></svg>);

const PET_ICONS: (() => JSX.Element)[] = [PetCat, PetDog, PetRabbit, PetFox, PetBear, PetPanda, PetOwl, PetFrog, PetPenguin, PetTurtle];
const PET_LABELS = ["Cat", "Dog", "Rabbit", "Fox", "Bear", "Panda", "Owl", "Frog", "Penguin", "Turtle"];

/* Deterministically map a sub-agent's name to one of the pet icons so the same
   agent always shows the same animal within a session. */
function petIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % PET_ICONS.length;
}
function PetIcon({ name }: { name: string }) {
  const Icon = PET_ICONS[petIndex(name)];
  return <Icon />;
}

/* Reasoning-effort levels, ordered from Faster → Smarter for the slider. */
const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "extra", "max"];
const EFFORT_LABEL: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  extra: "Extra",
  max: "Max",
};

function toolIcon(tool?: string) {
  if (tool && tool.startsWith("mcp__")) return <IconBranch />;
  switch (tool) {
    case "read_file": return <IconFile />;
    case "list_dir": return <IconFolder />;
    case "apply_edit": return <IconPencil />;
    case "create_file": return <IconFilePlus />;
    case "run_terminal": return <IconTerminal />;
    case "run_subagents": return <IconBranch />;
    case "load_skill": return <IconSparkMini />;
    default: return <IconTerminal />;
  }
}

const TOOL_LABEL: Record<string, string> = {
  read_file: "Read file",
  list_dir: "List directory",
  apply_edit: "Edit file",
  create_file: "Create file",
  run_terminal: "Terminal command",
  run_subagents: "Parallel sub-agents",
  load_skill: "Load skill",
};

/**
 * Human-readable label for a tool. Built-ins use TOOL_LABEL; MCP tools
 * (`mcp__<server>__<tool>`) render as "server · tool" so the namespaced id
 * never leaks into the UI.
 */
function toolLabel(tool?: string): string {
  if (!tool) return "";
  if (tool.startsWith("mcp__")) {
    const rest = tool.slice("mcp__".length);
    const sep = rest.indexOf("__");
    if (sep >= 0) return `${rest.slice(0, sep)} · ${rest.slice(sep + 2)}`;
    return rest;
  }
  return TOOL_LABEL[tool] ?? tool;
}

/* ---------- Markdown with memoized sanitized parse ---------- */
const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }) as string),
    [text]
  );
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

const SUPPORTED_IMAGE_TYPES = new Set<ImageAttachment["mediaType"]>(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 5;
const PROGRESS_MESSAGES = [
  "Clue gathering…",
  "Working through it…",
  "Mapping the next step…",
  "Piecing it together…",
  "Checking the details…",
  "Building a response…",
  "Almost there…",
] as const;

/* Format a wall-clock timestamp (ms since epoch) as HH:MM:SS for step labels. */
function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* Format an elapsed duration (ms) as a compact human-readable string. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ${seconds}s`;
}

function base64Bytes(data: string): number {
  return Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

function readImage(file: File, name: string): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${name}.`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) return reject(new Error(`Could not read ${name}.`));
      resolve({ name, mediaType: file.type as ImageAttachment["mediaType"], data: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

function imageSrc(image: ImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

/* ---------- File-edit diff ---------- */
function DiffView({ info }: { info: EditInfo }) {
  return (
    <div className="diff-block" role="group" aria-label={`Diff for ${info.path}`}>
      {info.lines.map((line, i) => {
        if (line.text === "…" && line.type === "context" && line.oldLine === undefined && line.newLine === undefined) {
          return (
            <div key={i} className="diff-line gap">
              <span className="txt">⋯ unchanged lines ⋯</span>
            </div>
          );
        }
        const mark = line.type === "add" ? "+" : line.type === "del" ? "−" : "\u00a0";
        const ln = line.type === "add" ? line.newLine : line.type === "del" ? line.oldLine : line.newLine;
        return (
          <div key={i} className={`diff-line ${line.type}`}>
            <span className="ln">{ln ?? ""}</span>
            <span className="mark">{mark}</span>
            <span className="txt">{line.text || "\u00a0"}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- App ---------- */
export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>(PROGRESS_MESSAGES[0]);
  const [progressColor, setProgressColor] = useState(0);
  const [sessionList, setSessionList] = useState<{ id: string; firstUserMessage: string; archived: boolean }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"active" | "archived">("active");
  const [model, setModel] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [effort, setEffort] = useState<Effort>("high");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [pasteError, setPasteError] = useState("");
  const [contextOn, setContextOn] = useState(false);
  const [mode, setMode] = useState<Mode>("build");
  const [alwaysAllow, setAlwaysAllow] = useState({ terminal: false, edits: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<{ baseUrl: string; maxTokens: number; autoApproveEdits: boolean; autoApproveTerminal: boolean; models: string[]; apiKeySet: boolean } | null>(null);
  const [commands, setCommands] = useState<SlashCommandView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const sessionIdRef = useRef<string>("");
  const imageSequenceRef = useRef(0);
  const turnStartRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // remove the host-rendered loading splash once React has mounted
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), 220);
    }

    onHostMessage((m: HostToWebviewMsg) => {
      if (m.type === "turnComplete" || m.type === "turnStopped" || m.type === "error") {
        setStreaming(false);
        setStopping(false);
        // stop any live thinking timer/animation on the last thinking card
        setCards((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].kind === "thinking" && next[i].thinkingActive) { next[i] = { ...next[i], thinkingActive: false }; break; }
          }
          // append a summary card reporting the total time taken for the turn
          if (turnStartRef.current > 0) {
            const now = Date.now();
            next.push({ kind: "summary", ts: now, durationMs: now - turnStartRef.current });
            turnStartRef.current = 0;
          }
          return next;
        });
      }
      setCards((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        switch (m.type) {
          case "newSession":
            sessionIdRef.current = "";
            setStreaming(false);
            setStopping(false);
            return [];
          case "loadEvents":
            sessionIdRef.current = m.sessionId;
            setStreaming(false);
            setStopping(false);
            return eventsToCards(m.events);
          case "textDelta":
            sessionIdRef.current = m.sessionId;
            // once real answer text starts, freeze any active thinking card
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].kind === "thinking" && next[i].thinkingActive) { next[i] = { ...next[i], thinkingActive: false }; break; }
            }
            if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            else next.push({ kind: "assistant", text: m.text, ts: Date.now() });
            return next;
          case "thinkingDelta": {
            sessionIdRef.current = m.sessionId;
            if (last?.kind === "thinking" && last.thinkingActive) {
              next[next.length - 1] = { ...last, text: (last.text ?? "") + m.text };
            } else {
              next.push({ kind: "thinking", text: m.text, thinkingActive: true, thinkingSeconds: 0, ts: Date.now() });
            }
            return next;
          }
          case "toolCall":
            // a tool call means the model finished reasoning for this step
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].kind === "thinking" && next[i].thinkingActive) { next[i] = { ...next[i], thinkingActive: false }; break; }
            }
            next.push({ kind: "tool", callId: m.callId, tool: m.tool, input: m.input, ts: Date.now() });
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
            return next.map((c) => (c.callId === m.callId ? { ...c, output: m.output, ok: m.ok, editInfo: m.editInfo } : c));
          case "subagentStatus":
            return next.map((c) => (c.callId === m.callId ? { ...c, subagents: m.agents } : c));
          case "error":
            next.push({ kind: "error", text: m.message, ts: Date.now() });
            return next;
          case "turnComplete":
            return next;
          case "turnStopped":
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
            setImages((prev) => {
              const next = [...prev];
              let totalBytes = next.reduce((sum, image) => sum + base64Bytes(image.data), 0);
              for (const image of m.images) {
                const bytes = base64Bytes(image.data);
                if (next.length >= MAX_IMAGES_PER_MESSAGE || totalBytes + bytes > MAX_TOTAL_IMAGE_BYTES) break;
                next.push(image);
                totalBytes += bytes;
              }
              return next;
            });
            setPasteError(m.warning ?? "");
            return next;
          case "attachmentError":
            setPasteError(m.message);
            return next;
          case "importResult":
            setPasteError(m.ok ? "" : m.message);
            return next;
          case "contextEnabled":
            setContextOn(m.enabled);
            return next;
          case "settings":
            setSettings(m);
            return next;
          case "commands":
            setCommands(m.commands);
            return next;
          case "skills":
            setSkills(m.skills);
            return next;
          default:
            return next;
        }
      });
    });
    // The host may create the first session before this webview is ready to
    // receive messages, so explicitly request it after mounting.
    send({ type: "requestCurrentSession" });
    send({ type: "requestSessionList" });
    send({ type: "requestConfig" });
    send({ type: "requestSettings" });
    send({ type: "requestCommands" });
    send({ type: "requestSkills" });
  }, []);

  useEffect(() => {
    // Keep the active process in view as text and tool steps stream in.
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [cards, streaming]);

  useEffect(() => {
    if (!streaming) return;
    let index = Math.floor(Math.random() * PROGRESS_MESSAGES.length);
    setProgressMessage(PROGRESS_MESSAGES[index]);
    setProgressColor(index);
    const timer = window.setInterval(() => {
      index = (index + 1) % PROGRESS_MESSAGES.length;
      setProgressMessage(PROGRESS_MESSAGES[index]);
      setProgressColor(index);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [streaming]);

  // Tick the elapsed-time counter on an active thinking card once a second.
  useEffect(() => {
    const hasActive = cards.some((c) => c.kind === "thinking" && c.thinkingActive);
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      setCards((prev) => prev.map((c) =>
        c.kind === "thinking" && c.thinkingActive
          ? { ...c, thinkingSeconds: (c.thinkingSeconds ?? 0) + 1 }
          : c
      ));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cards]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setAttachMenuOpen(false);
        send({ type: "attachFiles" });
      } else if (e.key === "Escape") {
        setAttachMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Slash-command autocomplete: active only when the input begins with '/'
  // and has no space yet (still typing the command name).
  // Slash suggestions combine plugin commands and skills so the user always
  // sees what is available and what will run. Commands expand to a prompt
  // template; skills are loaded by the agent via load_skill.
  type SlashSuggestion =
    | { kind: "command"; name: string; description: string; plugin?: string }
    | { kind: "skill"; name: string; description: string };
  const slashQuery = /^\/([A-Za-z0-9-]*)$/.exec(input);
  const slashMatches: SlashSuggestion[] = slashQuery
    ? (() => {
        const q = slashQuery[1].toLowerCase();
        const cmd: SlashSuggestion[] = commands
          .filter((c) => c.name.toLowerCase().startsWith(q))
          .map((c) => ({ kind: "command" as const, name: c.name, description: c.description, plugin: c.plugin }));
        const skl: SlashSuggestion[] = skills
          .filter((sk) => sk.name.toLowerCase().startsWith(q))
          .map((sk) => ({ kind: "skill" as const, name: sk.name, description: sk.description }));
        return [...cmd, ...skl].slice(0, 8);
      })()
    : [];
  const slashOpen = slashMatches.length > 0;

  const applySuggestion = (item: SlashSuggestion) => {
    if (item.kind === "command") {
      setInput(`/${item.name} `);
    } else {
      // Skills are not slash commands; prime a request that makes the agent
      // load the named skill before continuing.
      setInput(`Use the "${item.name}" skill: `);
    }
    setSlashIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if ((!value && attachments.length === 0 && images.length === 0) || !sessionIdRef.current || streaming) return;
    send({
      type: "userMessage",
      sessionId: sessionIdRef.current,
      text: value,
      attachments: attachments.length > 0 ? attachments : undefined,
      images: images.length > 0 ? images : undefined,
    });
    setCards((p) => [...p, {
      kind: "user",
      text: attachments.length > 0 ? `${value}${value ? "\n\n" : ""}[${attachments.map((f) => `📎 ${f.name}`).join(" ")}]` : value,
      images,
      ts: Date.now(),
    }]);
    setInput("");
    setAttachments([]);
    setImages([]);
    setPasteError("");
    setStreaming(true);
    turnStartRef.current = Date.now();
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    e.preventDefault();
    setPasteError("");

    const available = MAX_IMAGES_PER_MESSAGE - images.length;
    let availableBytes = MAX_TOTAL_IMAGE_BYTES - images.reduce((sum, image) => sum + base64Bytes(image.data), 0);
    const valid = files.slice(0, Math.max(available, 0)).filter((file) => {
      const accepted = SUPPORTED_IMAGE_TYPES.has(file.type as ImageAttachment["mediaType"])
        && file.size <= MAX_PASTED_IMAGE_BYTES && file.size <= availableBytes;
      if (accepted) availableBytes -= file.size;
      return accepted;
    });
    if (valid.length === 0) {
      setPasteError(available <= 0
        ? `You can attach up to ${MAX_IMAGES_PER_MESSAGE} images.`
        : "Image not added. Use PNG, JPEG, GIF, or WebP and keep each image under 5 MB (8 MB total)."
      );
      return;
    }

    try {
      const next = await Promise.all(valid.map((file) => {
        const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
        const name = file.name && file.name !== "image.png" ? file.name : `pasted-image-${++imageSequenceRef.current}.${ext}`;
        return readImage(file, name);
      }));
      setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES_PER_MESSAGE));
      if (valid.length < files.length) setPasteError("Some images were skipped because of type, size, or count limits.");
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : "Could not read the pasted image.");
    }
  };

  const onRetry = () => {
    if (sessionIdRef.current) {
      turnStartRef.current = Date.now();
      setStreaming(true);
      send({ type: "retry", sessionId: sessionIdRef.current });
    }
  };

  const stop = () => {
    if (sessionIdRef.current && streaming && !stopping) {
      setStopping(true);
      send({ type: "stop", sessionId: sessionIdRef.current });
    }
  };

  const deleteSession = (sessionId: string, title: string) => {
    if (!window.confirm(`Delete “${title.slice(0, 80)}”? This cannot be undone.`)) return;
    send({ type: "deleteSession", sessionId });
  };

  const visibleSessions = sessionList.filter((session) => session.archived === (historyTab === "archived"));

  const suggestions = [
    "Explain the structure of this project",
    "Read a.txt and summarize it",
    "Refactor a function for clarity",
  ];

  return (
    <div className="app" style={{ position: "relative" }}>
      <style>{CSS}</style>

      <div className="header">
        <span className="brand"><img src={logoUrl} alt="" className="brand-logo" /> {DISPLAY_NAME}</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => { send({ type: "requestSessionList" }); setHistoryOpen(true); }} title="Chat history">
          <IconHistory />
        </button>
        <button className="icon-btn" onClick={() => { setHistoryOpen(false); send({ type: "newSessionRequest" }); }} title="New session">
          <IconPlus />
        </button>
        <button className="icon-btn" onClick={() => { setSettingsOpen(true); send({ type: "requestSettings" }); }} title="Settings">
          <IconGear />
        </button>
      </div>

      {historyOpen && (
        <div className="history-panel">
          <div className="history-head">
            <IconHistory /> Chat history
            <button className="icon-btn" onClick={() => setHistoryOpen(false)} title="Back to chat">
              <IconChevronLeft />
            </button>
          </div>
          <div className="history-tabs" role="tablist" aria-label="Chat history sections">
            <button className={historyTab === "active" ? "active" : ""} onClick={() => setHistoryTab("active")} role="tab" aria-selected={historyTab === "active"}>
              Chats
            </button>
            <button className={historyTab === "archived" ? "active" : ""} onClick={() => setHistoryTab("archived")} role="tab" aria-selected={historyTab === "archived"}>
              Archived
            </button>
          </div>
          <div className="history-list">
            {visibleSessions.length === 0 ? (
              <div className="history-empty">{historyTab === "archived" ? "No archived chats." : "No previous sessions yet."}</div>
            ) : (
              visibleSessions.map((s) => (
                <div className="history-row" key={s.id}>
                  <button
                    className="history-item"
                    title={s.firstUserMessage}
                    onClick={() => { send({ type: "loadSession", sessionId: s.id }); setHistoryOpen(false); }}
                  >
                    {s.firstUserMessage.slice(0, 60)}
                  </button>
                  <button
                    className="history-action"
                    title={s.archived ? "Restore chat" : "Archive chat"}
                    aria-label={s.archived ? `Restore ${s.firstUserMessage}` : `Archive ${s.firstUserMessage}`}
                    onClick={() => send({ type: "setSessionArchived", sessionId: s.id, archived: !s.archived })}
                  >
                    {s.archived ? <IconUnarchive /> : <IconArchive />}
                  </button>
                  <button
                    className="history-action delete"
                    title="Delete chat"
                    aria-label={`Delete ${s.firstUserMessage}`}
                    onClick={() => deleteSession(s.id, s.firstUserMessage)}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onAddModel={(name) => { send({ type: "addModel", model: name }); send({ type: "requestSettings" }); }}
        />
      )}

      <div className="chat">
        {cards.length === 0 && !streaming ? (
          <div className="empty">
            <img src={logoUrl} alt="KoMind logo" className="logo-img" />
            <h2>{DISPLAY_NAME}</h2>
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
            {streaming && cards[cards.length - 1]?.kind !== "assistant" && cards[cards.length - 1]?.kind !== "thinking" && (
              <div className="komind-loading" role="status" aria-live="polite" aria-label={`KoMind: ${progressMessage}`}>
                <div className="km-sweep-track"><img src={logoUrl} alt="" /></div>
                <span className={`progress-color-${progressColor}`}>{progressMessage}</span>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
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
                <div className="effort-slider">
                  <div className="effort-slider-head">
                    <span className="es-label">Effort</span>
                    <span className="es-value">{EFFORT_LABEL[effort]}</span>
                    <span className="es-help" title="Faster = quicker, lower-cost replies. Smarter = deeper reasoning at higher effort.">
                      <IconHelp />
                    </span>
                  </div>
                  <div className="effort-slider-ends">
                    <span>Faster</span>
                    <span>Smarter</span>
                  </div>
                  <div className="effort-track">
                    <div className="es-rail" />
                    <div className="es-fill" style={{ width: `${(EFFORT_ORDER.indexOf(effort) / (EFFORT_ORDER.length - 1)) * 100}%` }} />
                    <div className="es-dots" aria-hidden="true">
                      {EFFORT_ORDER.map((lv) => <span key={lv} />)}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={EFFORT_ORDER.length - 1}
                      step={1}
                      value={EFFORT_ORDER.indexOf(effort)}
                      onChange={(e) => {
                        const lv = EFFORT_ORDER[Number(e.target.value)];
                        setEffort(lv);
                        send({ type: "setEffort", effort: lv });
                      }}
                      aria-label="Reasoning effort"
                      aria-valuetext={EFFORT_LABEL[effort]}
                    />
                  </div>
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

      <div className="composer">
        {pasteError && <div className="paste-error" role="alert">{pasteError}</div>}
        {(attachments.length > 0 || images.length > 0) && (
          <div className="attach-row">
            {images.map((image, i) => (
              <span key={`${image.name}-${i}`} className="attach-chip image-chip" title={image.name}>
                <img src={imageSrc(image)} alt={image.name} />
                <button
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  title={`Remove ${image.name}`}
                  aria-label={`Remove image ${image.name}`}
                >
                  <IconX />
                </button>
              </span>
            ))}
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
          {slashOpen && (
            <div className="slash-menu" role="listbox" aria-label="Commands and skills">
              {slashMatches.map((c, i) => (
                <button
                  key={`${c.kind}-${c.name}`}
                  role="option"
                  aria-selected={i === slashIndex}
                  className={`slash-item ${i === slashIndex ? "active" : ""}`}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => applySuggestion(c)}
                >
                  <span className="cmd">
                    <span className={`slash-badge ${c.kind}`}>{c.kind === "skill" ? "skill" : "cmd"}</span>
                    {c.kind === "command" ? `/${c.name}` : c.name}
                    {c.kind === "command" && c.plugin ? ` · ${c.plugin}` : ""}
                  </span>
                  {c.description && <span className="desc">{c.description}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="attach-menu-wrap">
            {attachMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 65 }} onClick={() => setAttachMenuOpen(false)} />
                <div className="attach-menu" role="menu" aria-label="Add context">
                  <button role="menuitem" onClick={() => { setAttachMenuOpen(false); send({ type: "attachFiles" }); }}>
                    <IconPaperclip /> Add files or photos <span className="shortcut">Ctrl U</span>
                  </button>
                  <button role="menuitem" onClick={() => { setAttachMenuOpen(false); send({ type: "attachFolder" }); }}>
                    <IconMenuFolder /> Add folder
                  </button>
                  <button role="menuitem" onClick={() => { setAttachMenuOpen(false); send({ type: "importSession" }); }} title="Import a chat or coding session exported from ChatGPT, Claude, Gemini, or an API — continue it mid-thread with any model">
                    <IconImport /> Import chat from another AI
                  </button>
                  <button role="menuitem" onClick={() => { setInput((value) => value || "/"); setAttachMenuOpen(false); requestAnimationFrame(() => textareaRef.current?.focus()); }}>
                    <IconSlashBox /> Slash commands
                  </button>
                  <button role="menuitem" disabled title="No connectors configured">
                    <IconConnector /> Connectors <span className="shortcut">Not configured</span> <IconChevronRight />
                  </button>
                  <button role="menuitem" disabled title="No plugins configured">
                    <IconPlug /> Plugins <span className="shortcut"><IconChevronRight /></span>
                  </button>
                </div>
              </>
            )}
            <button
              className="icon-btn attach-trigger"
              onClick={() => setAttachMenuOpen((open) => !open)}
              title="Add files, photos, or folder"
              aria-label="Add attachment"
              aria-haspopup="menu"
              aria-expanded={attachMenuOpen}
            >
              <IconPlus />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashMatches.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  applySuggestion(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]);
                  return;
                }
                if (e.key === "Escape") { e.preventDefault(); setInput(""); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!streaming) submit();
              }
            }}
            placeholder="Ask KoMind anything… Paste an image with Ctrl+V"
            aria-label="Message KoMind"
          />
          <button
            className={`send-btn ${streaming ? "stop" : ""}`}
            onClick={streaming ? stop : () => submit()}
            disabled={stopping || (!streaming && ((!input.trim() && attachments.length === 0 && images.length === 0) || !sessionIdRef.current))}
            title={streaming ? (stopping ? "Stopping…" : "Stop processing") : "Send (Enter)"}
            aria-label={streaming ? (stopping ? "Stopping processing" : "Stop processing") : "Send message"}
          >
            {streaming ? <span className="stop-square" aria-hidden="true" /> : <IconSend />}
          </button>
        </div>
        <div className="hint">
          Enter to send · Shift+Enter for a new line · Ctrl/Cmd+V to paste an image
          {mode === "plan" ? " · 🧭 Plan mode (read-only)" : ""}
          {contextOn ? " · Repo context ON" : ""}
          {alwaysAllow.terminal ? " · Terminal auto-approved" : ""}
        </div>
      </div>
    </div>
  );
}

/* ---------- Settings popup ---------- */
interface SettingsShape {
  baseUrl: string;
  maxTokens: number;
  autoApproveEdits: boolean;
  autoApproveTerminal: boolean;
  models: string[];
  apiKeySet: boolean;
}

function SettingsPanel({ settings, onClose, onAddModel }: {
  settings: SettingsShape | null;
  onClose: () => void;
  onAddModel: (name: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");
  const [maxTokens, setMaxTokens] = useState(settings?.maxTokens ?? 4096);
  const [autoApproveEdits, setAutoApproveEdits] = useState(settings?.autoApproveEdits ?? true);
  const [autoApproveTerminal, setAutoApproveTerminal] = useState(settings?.autoApproveTerminal ?? false);
  const [newModel, setNewModel] = useState("");
  const dirty = settings !== null && (
    baseUrl !== settings.baseUrl || maxTokens !== settings.maxTokens ||
    autoApproveEdits !== settings.autoApproveEdits || autoApproveTerminal !== settings.autoApproveTerminal
  );

  const save = () => {
    send({
      type: "updateSettings",
      baseUrl, maxTokens: Number(maxTokens), autoApproveEdits, autoApproveTerminal,
    });
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" role="dialog" aria-label="KoMind settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <IconGear /> Settings
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><IconX /></button>
        </div>
        <div className="settings-body">
          <div className="field">
            <label htmlFor="km-apikey">API key</label>
            <div className="row">
              <span className={`apikey-status ${settings?.apiKeySet ? "ok" : "none"}`}>
                {settings?.apiKeySet ? "•••••••• (set)" : "Not set"}
              </span>
              <button onClick={() => send({ type: "setApiKey" })}>
                {settings?.apiKeySet ? "Replace" : "Set key"}
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="km-baseurl">API base URL (Anthropic-compatible)</label>
            <input id="km-baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.justwoker.icu" />
          </div>
          <div className="field">
            <label htmlFor="km-maxtokens">Max tokens per completion</label>
            <input id="km-maxtokens" type="number" min={256} max={100000} step={256} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
          </div>
          <div className="field">
            <label className="check-row" htmlFor="km-edits">
              <input id="km-edits" type="checkbox" checked={autoApproveEdits} onChange={(e) => setAutoApproveEdits(e.target.checked)} />
              <span>
                <b>Apply edits without approval</b>
                <small>Every accepted edit is saved immediately</small>
              </span>
            </label>
          </div>
          <div className="field">
            <label className="check-row" htmlFor="km-terminal">
              <input id="km-terminal" type="checkbox" checked={autoApproveTerminal} onChange={(e) => setAutoApproveTerminal(e.target.checked)} />
              <span>
                <b>Run terminal commands automatically</b>
                <small>When off, every command needs approval</small>
              </span>
            </label>
          </div>
          <div className="field">
            <label>Extra models</label>
            {settings && settings.models.length > 0 ? (
              <div className="model-list">
                {settings.models.map((m) => (
                  <span key={m} className="attach-chip">
                    <span className="n">{m}</span>
                    <button title={`Remove ${m}`} onClick={() => send({ type: "removeModel", model: m })} aria-label={`Remove model ${m}`}>
                      <IconX />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <small className="muted">No extra models added yet.</small>
            )}
            <div className="add-model-row">
              <input
                value={newModel}
                placeholder="model name, e.g. claude-sonnet-4-5"
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newModel.trim()) { onAddModel(newModel.trim()); setNewModel(""); } }}
                aria-label="Add model"
              />
              <button
                title="Add model"
                disabled={!newModel.trim()}
                onClick={() => { if (!newModel.trim()) return; onAddModel(newModel.trim()); setNewModel(""); }}
              >
                <IconPlus />
              </button>
            </div>
          </div>
        </div>
        <div className="settings-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!dirty}>Save</button>
        </div>
      </div>
    </div>
  );
}

function eventsToCards(events: SessionEvent[]): Card[] {
  return events.map((e) => {
    if (e.kind === "user") return { kind: "user" as const, text: e.text, images: e.images, ts: e.ts };
    if (e.kind === "assistantText") return { kind: "assistant" as const, text: e.text, ts: e.ts };
    if (e.kind === "error") return { kind: "error" as const, text: e.message, ts: e.ts };
    if (e.kind === "toolCall") return { kind: "tool" as const, callId: e.callId, tool: e.tool as ToolName, input: e.input, ts: e.ts };
    return { kind: "tool" as const, callId: e.callId, output: e.output, ok: e.ok, editInfo: e.editInfo, ts: e.ts };
  });
}

/* ---------- Thinking card ---------- */
function ThinkingCard({ card }: { card: Card }) {
  const active = Boolean(card.thinkingActive);
  // Auto-expand while thinking; collapse once done, but let the user override.
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userToggled) setOpen(active);
  }, [active, userToggled]);

  // Keep the reasoning scrolled to the newest line while it streams.
  useEffect(() => {
    if (active && open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [card.text, active, open]);

  const seconds = card.thinkingSeconds ?? 0;
  const label = active
    ? `Thinking${seconds > 0 ? ` for ${seconds}s` : "…"}`
    : `Thought${seconds > 0 ? ` for ${seconds}s` : ""}`;

  return (
    <div className="thinking-card">
      <button
        type="button"
        className="thinking-head"
        onClick={() => { setUserToggled(true); setOpen((o) => !o); }}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} reasoning`}
      >
        <span className="thinking-title">
          <img src={logoUrl} alt="" className={active ? "spin-pulse" : ""} />
          {label}
        </span>
        {active && <span className="thinking-meta">reasoning…</span>}
        {!active && formatTimestamp(card.ts) && <span className="thinking-meta">{formatTimestamp(card.ts)}</span>}
        <span className={`thinking-chevron ${open ? "expanded" : ""}`}><IconChevronDown /></span>
      </button>
      {open && card.text && (
        <div className="thinking-body" ref={bodyRef}>{card.text}</div>
      )}
    </div>
  );
}

function CardView({ card, onRetry }: { card: Card; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const timestamp = formatTimestamp(card.ts);

  if (card.kind === "summary") {
    return (
      <div className="summary-card" role="status">
        <IconClock />
        <span>Total time taken: <span className="total">{formatDuration(card.durationMs ?? 0)}</span></span>
        {timestamp && <span className="at">{timestamp}</span>}
      </div>
    );
  }

  if (card.kind === "thinking") {
    return <ThinkingCard card={card} />;
  }

  if (card.kind === "assistant") {
    return (
      <div className="assistant">
        {timestamp && <span className="step-ts">{timestamp}</span>}
        <Markdown text={card.text ?? ""} />
      </div>
    );
  }
  if (card.kind === "user") {
    return (
      <div className="user-row">
        <div className="user-bubble">
          {timestamp && <span className="step-ts">{timestamp}</span>}
          {card.images && card.images.length > 0 && (
            <div className="user-images">
              {card.images.map((image, i) => <img key={`${image.name}-${i}`} src={imageSrc(image)} alt={image.name} />)}
            </div>
          )}
          {card.text}
        </div>
      </div>
    );
  }
  if (card.kind === "error") {
    return (
      <div className="error-card" role="alert">
        <IconAlert />
        <span className="msg">
          {timestamp && <span className="step-ts">{timestamp}</span>}
          {card.text}
        </span>
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
  const statusIcon = awaiting ? <IconClock /> : running ? <img src={logoUrl} alt="" className="komind-status-logo" /> : rejected ? <IconX /> : doneErr ? <IconX /> : <IconCheck />;
  const statusText = awaiting ? "Awaiting approval" : running ? "In progress" : rejected ? "Rejected" : doneErr ? "Failed" : "Done";
  const statusColor = awaiting ? "var(--km-warn)" : doneErr || rejected ? "var(--vscode-errorForeground)" : doneOk ? "var(--km-accent)" : "var(--vscode-foreground)";

  const args = card.input?.path ? String(card.input.path) : "";
  const editInfo = card.editInfo;
  const isFileEdit = card.tool === "apply_edit" || card.tool === "create_file";
  const summary = card.tool === "run_terminal"
    ? String(card.input?.command ?? "")
    : card.tool === "run_subagents"
      ? (Array.isArray(card.input?.tasks) ? (card.input!.tasks as { name?: unknown }[]).map((t) => String(t?.name ?? "agent")).join(", ") : "")
      : args;

  return (
    <div className={`tool-card ${statusClass}`}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${toolLabel(card.tool)} details`}
      >
        {toolIcon(card.tool)}
        <span className="tool-name">{toolLabel(card.tool)}</span>
        <span className="tool-status" style={{ color: statusColor }}>
          {statusIcon} {statusText}
        </span>
        {timestamp && <span className="thinking-meta" style={{ marginLeft: 8 }}>{timestamp}</span>}
        <span className={`tool-chevron ${expanded ? "expanded" : ""}`}><IconChevronDown /></span>
      </button>
      {summary && (
        <div className="tool-summary" title={summary}>
          {summary}
          {isFileEdit && editInfo && (
            <span className="diff-stat">
              {editInfo.additions > 0 && <span className="add">+{editInfo.additions}</span>}
              {editInfo.deletions > 0 && <span className="del">{"\u2212"}{editInfo.deletions}</span>}
            </span>
          )}
        </div>
      )}
      {isFileEdit && args && (card.output !== undefined) && (
        <div className="diff-actions">
          <button onClick={() => send({ type: "openFile", path: args, view: "file" })} title="Open this file in the editor">
            <IconOpen /> Open file
          </button>
          <button onClick={() => send({ type: "openFile", path: args, view: "diff" })} title="Open a diff against the last committed version">
            <IconDiff /> Open diff
          </button>
        </div>
      )}
      {isFileEdit && editInfo && editInfo.lines.length > 0 && (
        <DiffView info={editInfo} />
      )}
      {card.tool === "run_subagents" && card.subagents && card.subagents.length > 0 && (
        <div className="subagents">
          {card.subagents.map((agent, i) => {
            const working = agent.status === "running";
            const stateIcon = working
              ? <img src={logoUrl} alt="" className="komind-status-logo" />
              : agent.status === "done" ? <IconCheck /> : <IconX />;
            const stateText = working ? "Working…" : agent.status === "done" ? "Done" : "Failed";
            return (
              <div key={`${agent.name}-${i}`} className={`subagent-row ${agent.status}`}>
                <span className={`subagent-pet ${working ? "working" : ""}`} title={PET_LABELS[petIndex(agent.name)]}>
                  <PetIcon name={agent.name} />
                </span>
                <span className="subagent-name" title={agent.name}>
                  {agent.name}
                  <span className="subagent-kind"> · {PET_LABELS[petIndex(agent.name)]}</span>
                </span>
                <span className={`subagent-state ${agent.status}`}>
                  {stateIcon} {stateText}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {expanded && card.pendingApproval && (
        <div className="tool-body">
          <div className="cmd-block">{card.pendingApproval}</div>
        </div>
      )}
      {card.pendingApproval && (
        <div className="tool-body">
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
      {expanded && card.output !== undefined && !(isFileEdit && editInfo) && (
        <div className="tool-body">
          <pre className="tool-output">{card.output}</pre>
        </div>
      )}
    </div>
  );
}
