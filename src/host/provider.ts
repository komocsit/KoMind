import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./tools";

export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
export interface Provider {
  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>;
  setKey(key: string): void;
}

export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider {
  let client: AnthropicClientLike = sdk ?? new Anthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function setKey(key: string): void {
    cfg = { ...cfg, apiKey: key };
    if (!sdk) client = new Anthropic({ baseURL: cfg.baseUrl, apiKey: key });
    // when an injected sdk is used (tests), the sdk object stays as-is — key swap is a no-op there
  }

  async function streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]> {
    const params = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      stream: true,
    };
    let stream: AsyncIterable<unknown>;
    for (let attempt = 0; ; attempt++) {
      try { stream = client.messages.stream(params); break; }
      catch (e: any) {
        const retryable = e?.status >= 500 || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET";
        if (!retryable || attempt >= 3) throw e;
        await sleep(500 * 2 ** attempt);
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

    for await (const raw of stream) {
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
    flushTool();

    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
    onEvent({ type: "endTurn" });
    return [{ role: "assistant", content }];
  }

  return { streamTurn, setKey };
}
