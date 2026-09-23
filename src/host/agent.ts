import type { Provider, AnthropicMessage } from "./provider";
import { executeTool, TOOL_DEFS, type ToolContext, type ToolDef } from "./tools";
import type { SessionStore } from "./store";
import type { SessionEvent, ToolName, ImageAttachment } from "../shared/protocol";

export interface AgentUi {
  textDelta(t: string): void;
  thinkingDelta?(t: string): void;
  toolCall(callId: string, tool: string, input: Record<string, unknown>): void;
  toolResult(callId: string, ok: boolean, output: string): void;
  subagentStatus?(callId: string, agents: { name: string; status: "running" | "done" | "failed" }[]): void;
  error(msg: string): void;
  turnComplete(): void;
  turnStopped?(): void;
}

export class AgentSession {
  private messages: AnthropicMessage[] = [];
  private queue: { text: string; displayText: string; images: ImageAttachment[] }[] = [];
  private running = false;
  private abortController?: AbortController;
  private stopped = false;
  /** Tool names the agent may use; null = all tools (build mode). */
  allowedTools: ToolName[] | null = null;

  constructor(private readonly opts: { sessionId: string; provider: Provider; ctx: ToolContext; store: SessionStore; ui: AgentUi; initialMessages?: AnthropicMessage[] }) {
    if (opts.initialMessages) this.messages.push(...opts.initialMessages);
  }

  private get tools(): ToolDef[] {
    return this.allowedTools === null ? TOOL_DEFS : TOOL_DEFS.filter((t) => this.allowedTools!.includes(t.name));
  }

  seedFromEvents(events: SessionEvent[]): void {
    this.messages.push(...messagesFromEvents(events));
  }

  get busy() { return this.running; }

  send(text: string, displayText?: string, images: ImageAttachment[] = []): void {
    this.queue.push({ text, displayText: displayText ?? text, images });
    if (this.running) return;
    this.running = true;          // set synchronously so busy is observable immediately
    void this.drain();
  }

  stop(): boolean {
    if (!this.running) return false;
    this.stopped = true;
    this.queue = [];
    this.abortController?.abort();
    return true;
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const { text, displayText, images } = this.queue.shift()!;
        this.abortController = new AbortController();
        await this.runTurn(text, displayText, images, this.abortController.signal);
      }
    } finally {
      this.abortController = undefined;
      this.stopped = false;
      this.running = false;
    }
  }

  private async runTurn(userText: string, displayText: string, images: ImageAttachment[], signal: AbortSignal): Promise<void> {
    const content: unknown[] = images.map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    }));
    if (userText) content.push({ type: "text", text: userText });
    this.messages.push({ role: "user", content });
    await this.opts.store.append(this.opts.sessionId, { kind: "user", text: displayText, ts: Date.now(), images: images.length > 0 ? images : undefined });

    let partialText = "";
    let activeTool: { id: string; name: string } | undefined;
    try {
      for (let round = 0; round < 25; round++) {
        partialText = "";
        const assistantMsgs = await this.opts.provider.streamTurn(this.messages, this.tools, (e) => {
          if (signal.aborted) return;
          if (e.type === "textDelta") {
            partialText += e.text;
            this.opts.ui.textDelta(e.text);
          }
          else if (e.type === "thinkingDelta") {
            this.opts.ui.thinkingDelta?.(e.text);
          }
          else if (e.type === "toolUse") {
            this.opts.ui.toolCall(e.id, e.name, e.input);
          }
        }, signal);
        if (signal.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
        this.messages.push(...assistantMsgs);
        const assistantMsg = assistantMsgs[assistantMsgs.length - 1];

        for (const block of assistantMsg.content as any[]) {
          if (block.type === "text") {
            await this.opts.store.append(this.opts.sessionId, { kind: "assistantText", text: block.text, ts: Date.now() });
          }
        }

        const toolUses = (assistantMsg.content as any[]).filter((b) => b.type === "tool_use");
        if (toolUses.length === 0) { this.opts.ui.turnComplete(); return; }

        const results: unknown[] = [];
        for (const tu of toolUses) {
          activeTool = { id: tu.id, name: tu.name };
          if (signal.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
          await this.opts.store.append(this.opts.sessionId, { kind: "toolCall", callId: tu.id, tool: tu.name, input: tu.input, ts: Date.now() });
          const r = await executeTool(tu.name, tu.input, tu.id, this.opts.ctx, signal, (agents) => this.opts.ui.subagentStatus?.(tu.id, agents));
          activeTool = undefined;
          this.opts.ui.toolResult(tu.id, r.ok, r.output);
          await this.opts.store.append(this.opts.sessionId, { kind: "toolResult", callId: tu.id, ok: r.ok, output: r.output, ts: Date.now() });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.output, is_error: !r.ok });
        }
        this.messages.push({ role: "user", content: results });
      }
      this.opts.ui.error("Max tool rounds (25) reached.");
      this.opts.ui.turnComplete();
    } catch (e) {
      if (signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        if (partialText) {
          this.messages.push({ role: "assistant", content: [{ type: "text", text: partialText }] });
          await this.opts.store.append(this.opts.sessionId, { kind: "assistantText", text: partialText, ts: Date.now() });
        }
        if (activeTool) this.opts.ui.toolResult(activeTool.id, false, "Stopped by user.");
        this.opts.ui.turnStopped?.();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.opts.ui.error(msg);
      await this.opts.store.append(this.opts.sessionId, { kind: "error", message: msg, ts: Date.now() });
    }
  }
}

export function messagesFromEvents(events: SessionEvent[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  let textBuf: { type: "text"; text: string }[] = [];
  let toolBuf: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }[] = [];
  let resultBuf: { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }[] = [];
  const flushText = () => { if (textBuf.length) { messages.push({ role: "assistant", content: textBuf }); textBuf = []; } };
  const flushTools = () => { if (toolBuf.length) { messages.push({ role: "assistant", content: toolBuf }); toolBuf = []; } };
  const flushResults = () => { if (resultBuf.length) { messages.push({ role: "user", content: resultBuf }); resultBuf = []; } };
  for (const e of events) {
    if (e.kind === "user") {
      flushResults(); flushText(); flushTools();
      const content: unknown[] = (e.images ?? []).map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data },
      }));
      if (e.text) content.push({ type: "text", text: e.text });
      messages.push({ role: "user", content });
    } else if (e.kind === "assistantText") {
      flushResults(); flushTools();
      textBuf.push({ type: "text", text: e.text });
    } else if (e.kind === "toolCall") {
      flushResults(); flushText();
      toolBuf.push({ type: "tool_use", id: e.callId, name: e.tool, input: e.input });
    } else if (e.kind === "toolResult") {
      flushText(); flushTools();
      resultBuf.push({ type: "tool_result", tool_use_id: e.callId, content: e.output, is_error: !e.ok });
    }
    // "error" events are not part of the model conversation
  }
  flushResults(); flushText(); flushTools();
  return messages;
}
