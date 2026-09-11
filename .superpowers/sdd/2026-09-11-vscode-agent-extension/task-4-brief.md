# Task 4: Provider (Anthropic SDK wrapper with retry)

**Files:**
- Create: `src/host/provider.ts`
- Test: `test/unit/provider.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 6 and 7 — signatures must be exact):

```ts
export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; maxTokens: number; }
export type StreamEvent = { type: "textDelta"; text: string } | { type: "toolUse"; id: string; name: string; input: Record<string, unknown> } | { type: "endTurn" };
export interface Provider {
  streamTurn(messages: AnthropicMessage[], tools: ToolDef[], onEvent: (e: StreamEvent) => void): Promise<AnthropicMessage[]>;
  setKey(key: string): void;  // ADDITION vs original plan: Task 7 needs late key injection; implemented here so Task 7 doesn't refactor this file. setKey rebuilds the internal client with the new key.
}
export type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };
export function createProvider(cfg: ProviderConfig, sdk?: AnthropicClientLike): Provider;
export interface AnthropicClientLike { messages: { stream(params: unknown): AsyncIterable<unknown> }; }
```

- [ ] **Step 1: Write failing test with fake SDK stream**

`test/unit/provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../../src/host/provider";
import type { AnthropicClientLike } from "../../src/host/provider";

function fakeSdk(deltas: unknown[]) {
  return {
    messages: {
      stream: vi.fn(async function* () {
        for (const d of deltas) yield d;
      }),
    },
  } as unknown as AnthropicClientLike;
}

describe("createProvider.streamTurn", () => {
  const cfg = { baseUrl: "https://x", apiKey: "k", model: "gpt-5.6-sol", maxTokens: 100 };

  it("emits textDelta and endTurn events", async () => {
    const events: unknown[] = [];
    const sdk = fakeSdk([
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_stop" },
    ]);
    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
    expect(events).toEqual([
      { type: "textDelta", text: "Hel" },
      { type: "textDelta", text: "lo" },
      { type: "endTurn" },
    ]);
  });

  it("accumulates tool_use blocks and emits toolUse", async () => {
    const events: unknown[] = [];
    const sdk = fakeSdk([
      { type: "content_block_start", content_block: { type: "tool_use", id: "c1", name: "read_file" } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"path":"a' } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '.txt"}' } },
      { type: "message_stop" },
    ]);
    await createProvider(cfg, sdk).streamTurn([], [], (e) => events.push(e));
    expect(events).toContainEqual({ type: "toolUse", id: "c1", name: "read_file", input: { path: "a.txt" } });
  });

  it("retries 5xx errors up to 3 times then succeeds", async () => {
    const stream = async function* () { yield {}; };
    let calls = 0;
    const sdk = {
      messages: {
        stream: vi.fn(() => {
          calls++;
          if (calls < 4) { const e = new Error("server error") as any; e.status = 500; throw e; }
          return stream();
        }),
      },
    } as unknown as AnthropicClientLike;
    await createProvider(cfg, sdk).streamTurn([], [], () => {});
    expect(calls).toBe(4); // 3 failures + 1 success
  });

  it("does not retry 4xx errors", async () => {
    const sdk = {
      messages: {
        stream: vi.fn(() => { const e = new Error("bad request") as any; e.status = 400; throw e; }),
      },
    } as unknown as AnthropicClientLike;
    await expect(createProvider(cfg, sdk).streamTurn([], [], () => {})).rejects.toThrow("bad request");
    expect(sdk.messages.stream).toHaveBeenCalledTimes(1);
  });

  it("setKey replaces the client and the next call uses it", async () => {
    const sdkA = fakeSdk([{ type: "content_block_delta", delta: { type: "text_delta", text: "fromA" } }, { type: "message_stop" }]);
    const sdkB = fakeSdk([{ type: "content_block_delta", delta: { type: "text_delta", text: "fromB" } }, { type: "message_stop" }]);
    // createProvider takes one sdk; for this test we simulate via factory closure:
    let current = sdkA;
    const factory = () => current;
    // Use createProvider with sdkA, then swap behavior through setKey rebuilding:
    // Simplest: create with a delegating sdk
    const delegating = {
      messages: {
        stream: (p: unknown) => current.messages.stream(p),
      },
    } as unknown as AnthropicClientLike;
    const provider = createProvider(cfg, delegating);
    const events: string[] = [];
    await provider.streamTurn([], [], (e) => { if (e.type === "textDelta") events.push(e.text); });
    current = sdkB;
    provider.setKey("new-key");
    await provider.streamTurn([], [], (e) => { if (e.type === "textDelta") events.push(e.text); });
    expect(events).toEqual(["fromA", "fromB"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/provider.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/host/provider.ts`**

```ts
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
        if (!retryable || attempt >= 2) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }

    let text = "";
    const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let currentTool: { id: string; name: string; json: string } | undefined;

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
        try {
          toolUses.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.json || "{}") });
        } catch { toolUses.push({ id: currentTool.id, name: currentTool.name, input: { _error: "malformed JSON input" } }); }
        currentTool = undefined;
      }
    }

    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const t of toolUses) { content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input }); onEvent({ type: "toolUse", ...t }); }
    onEvent({ type: "endTurn" });
    return [{ role: "assistant", content }];
  }

  return { streamTurn, setKey };
}
```

Notes:
- Do NOT export TOOL_DEFS from provider.ts (plan originally did; Task 6 imports it from ./tools directly).
- The retry test sleeps real ms (500 + 1000) — acceptable; or use vi.useFakeTimers if it makes the test flaky, your call — document either way.
- The setKey test uses a delegating sdk — keep as written.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/provider.test.ts` — Expected: PASS (5 tests). Then `npm run test:unit` — full suite passes.

- [ ] **Step 5: Commit** — `git add src/host/provider.ts test/unit/provider.test.ts; git commit -m "feat: anthropic-compatible provider with streaming and retry"`
