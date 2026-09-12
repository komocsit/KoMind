import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./tools";
import type { Effort } from "../shared/protocol";

export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; effort?: Effort; }
export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
export interface AnthropicClientLike {
  messages: { stream(params: unknown, options?: { signal?: AbortSignal }): AsyncIterable<unknown> };
  models?: { list(params?: unknown): Promise<{ data?: { id?: string }[] } | AsyncIterable<{ id?: string }>> };
}
export interface Provider {
  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<AnthropicMessage[]>;
  setKey(key: string): void;
  setModel(model: string): void;
  setEffort(effort: Effort): void;
  setBaseUrl(url: string): void;
  setMaxTokens(maxTokens: number): void;
  listModels(): Promise<string[]>;
}

export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider {
  let client: AnthropicClientLike = sdk ?? new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  const abortError = () => Object.assign(new Error("Stopped"), { name: "AbortError" });
  const sleepWithSignal = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });

  function setKey(key: string): void {
    cfg = { ...cfg, apiKey: key };
    if (!sdk) client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: key });
    // when an injected sdk is used (tests), the sdk object stays as-is — key swap is a no-op there
  }

  async function streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<AnthropicMessage[]> {
    const params: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      stream: true,
    };
    if (cfg.effort) params.reasoning_effort = cfg.effort;
    let stream: AsyncIterable<unknown>;
    for (let attempt = 0; ; attempt++) {
      try {
        if (signal?.aborted) throw abortError();
        stream = client.messages.stream(params, { signal });
        break;
      }
      catch (e: any) {
        if (signal?.aborted || e?.name === "AbortError") throw abortError();
        const retryable = e?.status >= 500 || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET";
        if (!retryable || attempt >= 3) throw e;
        await sleepWithSignal(500 * 2 ** attempt, signal);
      }
    }

    let text = "";
    const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let currentTool: { id: string; name: string; json: string } | undefined;

    const flushTool = () => {
      if (!currentTool) return;
      try {
        toolUses.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.json || "{}") });
      } catch { toolUses.push({ id: currentTool.id, name: currentTool.name, input: { _error: "malformed JSON input" } }); }
      currentTool = undefined;
    };

    try {
      for await (const raw of stream) {
        if (signal?.aborted) throw abortError();
        const ev = raw as any;
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          currentTool = { id: ev.content_block.id, name: ev.content_block.name, json: "" };
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          text += ev.delta.text;
          onEvent({ type: "textDelta", text: ev.delta.text });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && currentTool) {
          currentTool.json += ev.delta.partial_json;
        } else if (ev.type === "content_block_stop" && currentTool) {
          flushTool();
        } else if (ev.type === "message_stop") {
          flushTool(); // some streams omit content_block_stop for tool_use blocks
        }
      }
    } catch (e: any) {
      if (signal?.aborted || e?.name === "AbortError") throw abortError();
      throw e;
    }
    flushTool();

    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
    onEvent({ type: "endTurn" });
    return [{ role: "assistant", content }];
  }

  function setModel(model: string): void { cfg = { ...cfg, model }; }
  function setEffort(effort: Effort): void { cfg = { ...cfg, effort }; }
  function setBaseUrl(url: string): void {
    cfg = { ...cfg, baseUrl: url };
    if (!sdk) client = new Anthropic({ baseURL: url, apiKey: cfg.apiKey });
  }
  function setMaxTokens(maxTokens: number): void { cfg = { ...cfg, maxTokens }; }

  async function listModels(): Promise<string[]> {
    try {
      const res = await client.models?.list();
      if (!res) return [];
      const page = res as { data?: { id?: string }[] };
      if (Array.isArray(page.data)) return page.data.map((m) => m.id).filter((id): id is string => Boolean(id));
      // async-iterable response
      const ids: string[] = [];
      for await (const m of res as AsyncIterable<{ id?: string }>) { if (m.id) ids.push(m.id); }
      return ids;
    } catch {
      return [];
    }
  }

  return { streamTurn, setKey, setModel, setEffort, setBaseUrl, setMaxTokens, listModels };
}
