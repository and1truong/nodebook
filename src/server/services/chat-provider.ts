import type { ChatProvider, ChatToolSupport } from "../../shared/contracts/chat";
import { chatToolInputSchema } from "../../shared/contracts/chat";

export interface ProviderMessage { role: "user" | "assistant"; content: string }
export interface ProviderToolCall { id: string; input: ReturnType<typeof chatToolInputSchema.parse> }
export interface ProviderRequest {
  provider: ChatProvider; baseUrl: string; apiKey: string; model: string; system: string; messages: ProviderMessage[];
  toolSupport: ChatToolSupport; signal: AbortSignal; onDelta: (delta: string) => void;
}
export interface ProviderResult { toolCalls: ProviderToolCall[]; toolsRejected: boolean }

const ACTION_TOOL = {
  name: "propose_nodebook_action",
  description: "Propose one owner-confirmed NodeBook write. Never call this unless the user explicitly requested the write.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["action_type", "payload"],
    properties: {
      action_type: { type: "string", enum: ["issue.create", "issue.edit", "issue.complete", "issue.close", "issue.reopen", "comment.add", "comment.edit", "parent.set", "relationship.add", "relationship.remove", "reminder.create", "reminder.update", "saved_view.create", "saved_view.update", "saved_view.delete"] },
      payload: { type: "object", description: "Action fields. Refer to issues with issue_ref/source_ref/target_ref/parent_ref using #123." },
    },
  },
};

export async function streamProvider(input: ProviderRequest): Promise<ProviderResult> {
  return input.provider === "anthropic" ? streamAnthropic(input) : streamOpenAi(input, input.toolSupport !== "unsupported");
}

async function streamOpenAi(input: ProviderRequest, withTools: boolean): Promise<ProviderResult> {
  const response = await fetch(`${input.baseUrl}/chat/completions`, {
    method: "POST", signal: input.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.model, stream: true, messages: [{ role: "system", content: input.system }, ...input.messages],
      ...(withTools ? { tools: [{ type: "function", function: { name: ACTION_TOOL.name, description: ACTION_TOOL.description, parameters: ACTION_TOOL.input_schema } }], tool_choice: "auto" } : {}) }),
  });
  if (!response.ok) {
    const error = await boundedBody(response);
    if (withTools && input.toolSupport === "unknown" && response.status >= 400 && response.status < 500 && /tool|function/i.test(error)) {
      const retried = await streamOpenAi(input, false);
      return { ...retried, toolsRejected: true };
    }
    throw new Error(`Provider returned ${response.status}: ${error}`);
  }
  if (!response.body) throw new Error("Provider returned no response stream");
  const calls = new Map<number, { id: string; arguments: string }>();
  await readSse(response.body, (event) => {
    if (event === "[DONE]") return;
    const data = JSON.parse(event) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { arguments?: string } }> } }> };
    const delta = data.choices?.[0]?.delta;
    if (delta?.content) input.onDelta(delta.content);
    for (const call of delta?.tool_calls ?? []) {
      const current = calls.get(call.index) ?? { id: call.id ?? crypto.randomUUID(), arguments: "" };
      if (call.id) current.id = call.id;
      current.arguments += call.function?.arguments ?? "";
      calls.set(call.index, current);
    }
  });
  return { toolCalls: parseToolCalls([...calls.values()]), toolsRejected: false };
}

async function streamAnthropic(input: ProviderRequest): Promise<ProviderResult> {
  const response = await fetch(`${input.baseUrl}/messages`, {
    method: "POST", signal: input.signal,
    headers: { "Content-Type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: input.model, max_tokens: 4096, stream: true, system: input.system, messages: input.messages,
      ...(input.toolSupport === "unsupported" ? {} : { tools: [ACTION_TOOL] }) }),
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${await boundedBody(response)}`);
  if (!response.body) throw new Error("Provider returned no response stream");
  const calls = new Map<number, { id: string; arguments: string }>();
  await readSse(response.body, (event) => {
    const data = JSON.parse(event) as { type?: string; index?: number; content_block?: { type?: string; id?: string; input?: unknown }; delta?: { type?: string; text?: string; partial_json?: string } };
    if (data.delta?.type === "text_delta" && data.delta.text) input.onDelta(data.delta.text);
    if (data.type === "content_block_start" && data.content_block?.type === "tool_use") calls.set(data.index ?? 0, { id: data.content_block.id ?? crypto.randomUUID(), arguments: "" });
    if (data.delta?.type === "input_json_delta") {
      const current = calls.get(data.index ?? 0) ?? { id: crypto.randomUUID(), arguments: "" };
      current.arguments += data.delta.partial_json ?? ""; calls.set(data.index ?? 0, current);
    }
  });
  return { toolCalls: parseToolCalls([...calls.values()]), toolsRejected: false };
}

function parseToolCalls(calls: Array<{ id: string; arguments: string }>): ProviderToolCall[] {
  const result: ProviderToolCall[] = [];
  for (const call of calls) {
    try { result.push({ id: call.id, input: chatToolInputSchema.parse(JSON.parse(call.arguments)) }); } catch { /* malformed calls are inert */ }
  }
  return result;
}

export async function readSse(stream: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const chunks = buffer.split(/\r?\n\r?\n/); buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) onData(data);
    }
    if (done) break;
  }
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) return response.statusText;
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let body = "";
  while (body.length < 4096) { const { value, done } = await reader.read(); if (done) break; body += decoder.decode(value, { stream: true }); }
  await reader.cancel(); return body.slice(0, 4096) || response.statusText;
}
