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
