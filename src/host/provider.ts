import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./tools";
import type { Effort } from "../shared/protocol";

export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; effort?: Effort; }
export type StreamEvent = { type: "textDelta"; text: string } | { type: "thinkingDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
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

  // Retry transient failures automatically: first attempt + MAX_RETRIES retries.
  const MAX_RETRIES = 5;
  const isRetryable = (e: any): boolean =>
    e?.status >= 500 || e?.status === 429 || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET" || e?.code === "ECONNREFUSED" || e?.code === "EPIPE";

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

    // A single attempt: open the stream and fully consume it. Both the request
    // and the consumption loop can throw (the Anthropic SDK surfaces request
    // errors during iteration), so they share one scope. `emitted` reports
    // whether any content already reached the UI: once the model has started
    // streaming, retrying would duplicate output, so we do not retry then.
    const attemptStream = async (): Promise<{ result: AnthropicMessage[]; emitted: boolean }> => {
      if (signal?.aborted) throw abortError();
      const stream = client.messages.stream(params, { signal });

      let text = "";
      let emitted = false;
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
            emitted = true;
            onEvent({ type: "textDelta", text: ev.delta.text });
          } else if (ev.type === "content_block_delta" && (ev.delta?.type === "thinking_delta" || ev.delta?.type === "reasoning_delta")) {
            // Extended-thinking streams emit the model's reasoning as it forms.
            const chunk = ev.delta.thinking ?? ev.delta.text ?? "";
            if (chunk) { emitted = true; onEvent({ type: "thinkingDelta", text: chunk }); }
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
        // Preserve the emitted flag so the retry loop can decide whether it is
        // safe to retry without duplicating already-streamed output.
        if (emitted && e && typeof e === "object") e.__emitted = true;
        throw e;
      }
      flushTool();

      const content: unknown[] = [];
      if (text) content.push({ type: "text", text });
      for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
      onEvent({ type: "endTurn" });
      return { result: [{ role: "assistant", content }], emitted };
    };

    for (let attempt = 0; ; attempt++) {
      try {
        const { result } = await attemptStream();
        return result;
      } catch (e: any) {
        if (signal?.aborted || e?.name === "AbortError") throw abortError();
        // Only retry transient failures that happened before any output was
        // streamed. Retrying after partial output would duplicate it.
        if (!isRetryable(e) || e?.__emitted === true || attempt >= MAX_RETRIES) throw e;
        // Exponential backoff capped at 8s so 5 retries stay responsive.
        await sleepWithSignal(Math.min(500 * 2 ** attempt, 8000), signal);
      }
    }
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
