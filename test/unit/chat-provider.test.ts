import { afterEach, describe, expect, it, vi } from "vitest";
import { readSse, streamProvider } from "../../src/server/services/chat-provider";

afterEach(() => vi.unstubAllGlobals());

function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""), { status: 200 });
}

describe("provider SSE parsing", () => {
  it("assembles events split across stream chunks", async () => {
    const values = ["data: {\"a\":", "1}\n\ndata: second\n", "\n"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { for (const value of values) controller.enqueue(new TextEncoder().encode(value)); controller.close(); },
    });
    const events: string[] = [];
    await readSse(stream, (data) => events.push(data));
    expect(events).toEqual(["{\"a\":1}", "second"]);
  });

  it("normalizes OpenAI text and assembles tool arguments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([
      { choices: [{ delta: { content: "Hello " } }] },
      { choices: [{ delta: { content: "world", tool_calls: [{ index: 0, id: "call-1", function: { arguments: '{"action_type":"issue.close",' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"payload":{"issue_ref":"1"}}' } }] } }] },
      "[DONE]",
    ])));
    let text = "";
    const result = await streamProvider({ provider: "openai", baseUrl: "https://provider.test/v1", apiKey: "secret", model: "model", system: "system", messages: [], toolSupport: "unknown", signal: new AbortController().signal, onDelta: (delta) => { text += delta; } });
    expect(text).toBe("Hello world");
    expect(result.toolCalls[0]?.input).toEqual({ action_type: "issue.close", payload: { issue_ref: "1" } });
  });

  it("normalizes Anthropic text and tool input deltas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"action_type":"issue.reopen","payload":{"issue_ref":"2"}}' } },
    ])));
    let text = "";
    const result = await streamProvider({ provider: "anthropic", baseUrl: "https://provider.test/v1", apiKey: "secret", model: "model", system: "system", messages: [], toolSupport: "unknown", signal: new AbortController().signal, onDelta: (delta) => { text += delta; } });
    expect(text).toBe("Done");
    expect(result.toolCalls[0]?.input.action_type).toBe("issue.reopen");
  });

  it("retries an OpenAI-compatible backend once without unsupported tools", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("tool definitions are unsupported", { status: 400 }))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: "Read-only answer" } }] }, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    let text = "";
    const result = await streamProvider({ provider: "openai", baseUrl: "https://provider.test/v1", apiKey: "secret", model: "model", system: "system", messages: [], toolSupport: "unknown", signal: new AbortController().signal, onDelta: (delta) => { text += delta; } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).not.toHaveProperty("tools");
    expect(result.toolsRejected).toBe(true);
    expect(text).toBe("Read-only answer");
  });
});
