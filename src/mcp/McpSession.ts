/**
 * McpSession Durable Object: protocol/session state for Streamable HTTP MCP.
 * One DO instance per MCP session id. The DO owns:
 *  - session state (initialized flag, client info, protocol version)
 *  - open SSE streams (server → client notifications)
 * Tool execution happens here too (the DO has all bindings), but the actual
 * domain logic is the shared service layer, never direct database access.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "../env";
import type { McpIdentity } from "../server/auth/token-auth";
import { MCP_SESSION_TTL_MS } from "../shared/limits";
import { handlePayload, newSessionState, type SessionState } from "./protocol";
import type { ToolContext } from "./tool-auth";

const STATE_KEY = "session";
const SSE_KEEPALIVE_MS = 25_000;

export class McpSession {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  private keepalive: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const identity = parseIdentity(request);
    if (!identity) {
      return jsonResponse({ error: { code: -32600, message: "Missing MCP identity" } }, 401);
    }

    const method = request.method;
    if (method === "POST") return this.handlePost(request, identity);
    if (method === "GET") return this.handleSse();
    if (method === "DELETE") return this.handleDelete();
    return jsonResponse({ error: { code: -32600, message: "Method not allowed" } }, 405);
  }

  private async handlePost(request: Request, identity: McpIdentity): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: { code: -32700, message: "Parse error" } }, 400);
    }

    const session = await this.loadSession();
    const ctx: ToolContext = { env: this.env, identity, requestId: crypto.randomUUID() };
    const response = await handlePayload(session, payload, ctx);
    await this.saveSession(session);

    // Prefer a single JSON response unless the client asked exclusively for SSE.
    const accept = request.headers.get("accept") ?? "";
    const wantsSse = accept.includes("text/event-stream") && !accept.includes("application/json");
    if (wantsSse && response) {
      return this.sseResponse(() => pushMessage(this.streams, JSON.stringify(response)));
    }
    return jsonResponse(response ?? { jsonrpc: "2.0", result: {} }, 200);
  }

  private handleSse(): Response {
    return this.sseResponse(() => undefined);
  }

  private async handleDelete(): Promise<Response> {
    await this.state.storage.deleteAll();
    this.closeStreams();
    return jsonResponse({}, 200);
  }

  private async loadSession(): Promise<SessionState> {
    const stored = await this.state.storage.get<SessionState>(STATE_KEY);
    return stored ?? newSessionState();
  }

  private async saveSession(session: SessionState): Promise<void> {
    // TTL keeps abandoned sessions from pinning storage forever.
    await this.state.storage.put(STATE_KEY, session, { expirationTtl: MCP_SESSION_TTL_MS / 1000 } as never);
  }

  private sseResponse(onOpen: () => void): Response {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.streams.push(controller);
        this.ensureKeepalive();
        onOpen();
      },
      cancel: () => {
        if (controllerRef) {
          this.streams = this.streams.filter((c) => c !== controllerRef);
        }
        // Stop the keepalive timer once the last SSE stream closes so an
        // abandoned session does not keep firing every 25 s.
        if (this.streams.length === 0 && this.keepalive) {
          clearInterval(this.keepalive);
          this.keepalive = null;
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private ensureKeepalive(): void {
    if (this.keepalive) return;
    this.keepalive = setInterval(() => {
      for (const controller of this.streams) {
        try {
          controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        } catch {
          /* stream closed */
        }
      }
    }, SSE_KEEPALIVE_MS);
  }

  private closeStreams(): void {
    for (const controller of this.streams) {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    }
    this.streams = [];
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }
}

function pushMessage(streams: ReadableStreamDefaultController<Uint8Array>[], text: string): void {
  const encoder = new TextEncoder();
  for (const controller of streams) {
    try {
      controller.enqueue(encoder.encode(`event: message\ndata: ${text}\n\n`));
    } catch {
      /* stream closed */
    }
  }
}

function parseIdentity(request: Request): McpIdentity | null {
  const header = request.headers.get("X-Mcp-Identity");
  if (!header) return null;
  try {
    const parsed = JSON.parse(header) as McpIdentity;
    if (parsed.type === "mcp" && typeof parsed.tokenId === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
