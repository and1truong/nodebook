/**
 * NodeBook Worker entrypoint.
 *
 * Path architecture:
 *  - /api/*      REST API, protected by Cloudflare Access (owner-only)
 *  - /mcp        Streamable HTTP MCP, protected by scoped personal access tokens
 *  - everything  else → static assets (SPA) via the ASSETS binding
 *  - scheduled() → reminder processing (every minute) and attachment GC (daily)
 */
import type { ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
import type { Request as CfRequest } from "@cloudflare/workers-types";
import type { Env } from "./env";
import { createApp, accessAuthMiddleware, mcpAuthMiddleware } from "./server/routes/helpers";
import { issuesRoutes } from "./server/routes/issues";
import { commentsRoutes } from "./server/routes/comments";
import { graphRoutes, wikiRoutes } from "./server/routes/graph";
import { searchRoutes } from "./server/routes/search";
import { planningRoutes } from "./server/routes/planning";
import { remindersRoutes } from "./server/routes/reminders";
import { notificationsRoutes } from "./server/routes/notifications";
import { attachmentsRoutes } from "./server/routes/attachments";
import { tokensRoutes } from "./server/routes/tokens";
import { runScheduledReminders } from "./server/scheduled/reminders";
import { runScheduledAttachmentGc } from "./server/scheduled/attachment-gc";

// Durable Object classes must be exported from the entrypoint module.
export { McpSession } from "./mcp/McpSession";

const app = createApp();

app.use("/api/*", accessAuthMiddleware);
app.use("/mcp", mcpAuthMiddleware);

app.route("/api/issues", issuesRoutes);
app.route("/api/comments", commentsRoutes);
app.route("/api/graph", graphRoutes);
app.route("/api/wiki", wikiRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/planning", planningRoutes);
app.route("/api/reminders", remindersRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/attachments", attachmentsRoutes);
app.route("/api/tokens", tokensRoutes);

// Me endpoint: current identity for the web UI.
app.get("/api/me", (c) => {
  const actor = c.get("actor");
  return c.json({ email: actor.id, actor_type: actor.type });
});

// ---------------------------------------------------------------------------
// MCP: Streamable HTTP, session state in the McpSession Durable Object.
// ---------------------------------------------------------------------------

app.all("/mcp", async (c) => {
  const corsHeaders = mcpCorsHeaders(c.env);
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const identity = c.get("mcpIdentity");
  if (!identity) return c.json({ error: { code: -32600, message: "Missing MCP identity" } }, 401);

  const sessionId = c.req.header("mcp-session-id");
  let id: DurableObjectId;
  if (sessionId) {
    try {
      id = c.env.MCP_SESSION.idFromString(sessionId);
    } catch {
      return c.json({ error: { code: -32600, message: "Invalid session id" } }, 400);
    }
  } else if (c.req.method === "POST") {
    id = c.env.MCP_SESSION.newUniqueId();
  } else {
    return c.json({ error: { code: -32600, message: "Session id required" } }, 400);
  }

  const stub = c.env.MCP_SESSION.get(id);
  // Incoming request headers are immutable; build a forwarded request carrying
  // the verified identity.
  const forwardedHeaders = new Headers();
  c.req.raw.headers.forEach((value, key) => forwardedHeaders.set(key, value));
  forwardedHeaders.set("X-Mcp-Identity", JSON.stringify(identity));
  const forwarded = new Request(c.req.raw.url, {
    method: c.req.method,
    headers: forwardedHeaders as unknown as HeadersInit,
    body: c.req.method === "POST" ? (c.req.raw.body as BodyInit | null) : null,
  }) as unknown as CfRequest;
  try {
    const response = await stub.fetch(forwarded);
    const headers = new Headers(response.headers as unknown as HeadersInit);
    headers.set("Mcp-Session-Id", id.toString());
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body as BodyInit | null, { status: response.status, headers });
  } catch (e) {
    console.error("MCP session error", e);
    return c.json({ error: { code: -32603, message: "MCP session error" } }, 500);
  }
});

// Health check (unauthenticated, no data access).
app.get("/healthz", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Assets + fallbacks
// ---------------------------------------------------------------------------

app.all("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path === "/api" || path.startsWith("/mcp")) {
    return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
});

// ---------------------------------------------------------------------------
// Scheduled handlers
// ---------------------------------------------------------------------------

async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  switch (event.cron) {
    case "* * * * *":
      await runScheduledReminders(env);
      break;
    case "0 3 * * *":
      await runScheduledAttachmentGc(env);
      break;
    default:
      console.warn("Unknown cron schedule", event.cron);
  }
}

function mcpCorsHeaders(env: Env): Record<string, string> {
  const configured = env.MCP_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  const origin = configured && configured.length > 0 ? configured[0]! : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  fetch: app.fetch as unknown as ExportedHandler<Env>["fetch"],
  scheduled,
} satisfies ExportedHandler<Env>;
