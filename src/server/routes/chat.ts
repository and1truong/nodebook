import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import { ValidationError } from "../../domain/errors";
import {
  chatConnectionCreateSchema, chatConnectionUpdateSchema, chatConversationCreateSchema,
  chatConversationUpdateSchema, chatMessageCreateSchema,
} from "../../shared/contracts/chat";
import type { ChatStreamEvent } from "../../shared/contracts/chat";
import type { Ctx } from "../ctx";
import * as store from "../services/chat-store";
import { decryptCredential } from "../services/chat-crypto";
import { buildChatContext } from "../services/chat-context";
import { streamProvider } from "../services/chat-provider";
import { confirmAction, prepareAction } from "../services/chat-actions";

export const chatRoutes = new Hono<AppEnv>();

function context(c: { env: AppEnv["Bindings"]; get: (key: "actor") => AppEnv["Variables"]["actor"] }): Ctx {
  return { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
}

async function json(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => { throw new ValidationError("Invalid JSON body"); });
}

chatRoutes.get("/connections", async (c) => c.json(await store.listConnections(context(c))));
chatRoutes.post("/connections", async (c) => c.json(await store.createConnection(context(c), chatConnectionCreateSchema.parse(await json(c))), 201));
chatRoutes.patch("/connections/:id", async (c) => c.json(await store.updateConnection(context(c), c.req.param("id"), chatConnectionUpdateSchema.parse(await json(c)))));
chatRoutes.delete("/connections/:id", async (c) => { await store.deleteConnection(context(c), c.req.param("id")); return c.body(null, 204); });

chatRoutes.get("/conversations", async (c) => c.json(await store.listConversations(context(c))));
chatRoutes.post("/conversations", async (c) => {
  const input = chatConversationCreateSchema.parse(await json(c));
  return c.json(await store.createConversation(context(c), input.connection_id, input.model), 201);
});
chatRoutes.get("/conversations/:id", async (c) => c.json(await store.conversationDetail(context(c), c.req.param("id"))));
chatRoutes.patch("/conversations/:id", async (c) => c.json(await store.updateConversation(context(c), c.req.param("id"), chatConversationUpdateSchema.parse(await json(c)))));
chatRoutes.delete("/conversations/:id", async (c) => { await store.deleteConversation(context(c), c.req.param("id")); return c.body(null, 204); });

chatRoutes.post("/conversations/:id/messages", async (c) => {
  const ctx = context(c); const conversationId = c.req.param("id");
  const input = chatMessageCreateSchema.parse(await json(c));
  const conversation = await store.getConversation(ctx, conversationId);
  const connection = await store.getConnectionSecret(ctx, conversation.connection_id);
  const [detail, nodebookContext, apiKey] = await Promise.all([
    store.conversationDetail(ctx, conversationId), buildChatContext(ctx, conversationId, input.content),
    decryptCredential(ctx.env.CHAT_CREDENTIAL_KEY, connection.id, { ciphertext: connection.api_key_ciphertext, iv: connection.api_key_iv }),
  ]);
  const lease = await store.acquireGeneration(ctx, conversationId);
  await store.insertGenerationMessages(ctx, lease, conversationId, input.content);
  const activity = nodebookContext.activity
    ? await store.insertActivity(ctx, lease.assistantMessageId, nodebookContext.activity)
    : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      emit({ type: "start", user_message_id: lease.userMessageId, assistant_message_id: lease.assistantMessageId });
      if (activity) emit({ type: "activity", activity });
      const abort = new AbortController();
      let abortKind: "client" | "timeout" | null = null;
      const timeout = setTimeout(() => { abortKind = "timeout"; abort.abort("timeout"); }, 5 * 60_000);
      let content = "";
      let persistedContent = "";
      const partialTimer = setInterval(() => {
        if (content === persistedContent) return;
        persistedContent = content;
        void store.persistPartialMessage(ctx, lease.assistantMessageId, content).catch(() => { /* final persistence still runs */ });
      }, 1000);
      c.req.raw.signal.addEventListener("abort", () => { if (!abort.signal.aborted) { abortKind = "client"; abort.abort("client"); } }, { once: true });
      void (async () => {
        try {
          const messages = detail.messages.filter((message) => message.status !== "streaming").slice(-40).map((message) => ({ role: message.role, content: message.content }));
          messages.push({ role: "user", content: input.content });
          const result = await streamProvider({
            provider: connection.provider, baseUrl: connection.base_url, apiKey, model: conversation.model,
            system: nodebookContext.system, messages, toolSupport: connection.tool_support, signal: abort.signal,
            onDelta(delta) { content += delta; emit({ type: "delta", delta }); },
          });
          if (result.toolsRejected) await store.setToolSupport(ctx, connection.id, "unsupported");
          else if (result.toolCalls.length > 0 && connection.tool_support === "unknown") await store.setToolSupport(ctx, connection.id, "supported");
          for (const call of result.toolCalls) {
            try {
              const prepared = await prepareAction(ctx, call.input.action_type, call.input.payload);
              const proposal = await store.insertAction(ctx, lease.assistantMessageId, call.input.action_type, prepared.payload, prepared.review);
              emit({ type: "proposal", proposal });
            } catch (error) {
              content += `\n\n> Action proposal omitted: ${error instanceof Error ? error.message : "invalid action"}`;
            }
          }
          const message = await store.finishGeneration(ctx, { conversationId, generationId: lease.generationId, messageId: lease.assistantMessageId, content, status: "complete", sourceIds: nodebookContext.issueIds });
          emit({ type: "done", message });
        } catch (error) {
          const stopped = abortKind === "client";
          const message = abortKind === "timeout" ? "Chat generation timed out" : error instanceof Error ? error.message : "Chat generation failed";
          await store.finishGeneration(ctx, { conversationId, generationId: lease.generationId, messageId: lease.assistantMessageId, content, status: stopped ? "stopped" : "error", error: stopped ? undefined : message, sourceIds: nodebookContext.issueIds });
          if (!stopped) emit({ type: "error", message });
        } finally {
          clearTimeout(timeout);
          clearInterval(partialTimer);
          try { controller.close(); } catch { /* client disconnected */ }
        }
      })();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
});

chatRoutes.post("/actions/:id/confirm", async (c) => c.json(await confirmAction(context(c), c.req.param("id"))));
chatRoutes.post("/actions/:id/reject", async (c) => c.json(await store.rejectAction(context(c), c.req.param("id"))));
