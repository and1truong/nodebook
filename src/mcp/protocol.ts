/**
 * Streamable HTTP MCP protocol handling: JSON-RPC 2.0 dispatch, initialize
 * handshake, tools/list, tools/call, ping. Session state is owned by the
 * McpSession Durable Object; tool execution happens with the DO's bindings.
 */
import {
  JSONRPC_CONFLICT,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_NOT_FOUND,
  JSONRPC_PAYLOAD_TOO_LARGE,
  JSONRPC_SESSION_NOT_INITIALIZED,
  JSONRPC_VERSION_CONFLICT,
} from "../domain/errors";
import { isMcpError } from "./errors";
import { tools, getToolByName } from "./tools";
import { toolList, parseToolArgs } from "./tool-auth";
import type { ToolContext } from "./tool-auth";

export const PROTOCOL_VERSION = "2025-03-26";
export const SERVER_INFO = { name: "nodebook", version: "0.1.0" };

export interface SessionState {
  initialized: boolean;
  protocolVersion?: string;
  clientInfo?: unknown;
  createdAt: string;
}

export function newSessionState(): SessionState {
  return { initialized: false, createdAt: new Date().toISOString() };
}

export interface JsonRpcMessage {
  jsonrpc: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/** Handle one JSON-RPC message; returns a response message when one is due. */
export async function handleMessage(
  state: SessionState,
  message: JsonRpcMessage,
  ctx: ToolContext,
): Promise<JsonRpcMessage | null> {
  if (message.jsonrpc !== "2.0") return errorResponse(message.id, JSONRPC_INVALID_REQUEST, "Invalid Request: jsonrpc must be '2.0'");
  const method = message.method ?? "";

  if (method === "initialize") {
    const params = (message.params ?? {}) as { protocolVersion?: string; clientInfo?: unknown };
    state.initialized = true;
    state.protocolVersion = params.protocolVersion ?? PROTOCOL_VERSION;
    state.clientInfo = params.clientInfo;
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "NodeBook workspace. Issue numbers are referenced as #123. " +
          "Scopes are enforced per tool; see token settings for available scopes.",
      },
    };
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null; // notification: no response
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }

  if (!state.initialized) {
    return errorResponse(message.id, JSONRPC_SESSION_NOT_INITIALIZED, "Server not initialized. Call initialize first.");
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: toolList(tools) } };
  }

  if (method === "tools/call") {
    const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof params.name !== "string") {
      return errorResponse(message.id, JSONRPC_INVALID_REQUEST, "tools/call requires a string name");
    }
    const tool = getToolByName(params.name);
    if (!tool) {
      return errorResponse(message.id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
    }
    try {
      const args = parseToolArgs(tool, params.arguments ?? {});
      const result = await tool.handler(ctx, args);
      const structuredContent = typeof result === "object" && result !== null && !Array.isArray(result)
        ? { structuredContent: result }
        : {};
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...structuredContent,
        },
      };
    } catch (e) {
      if (isMcpError(e)) {
        return errorResponse(message.id, e.code, e.message, e.data);
      }
      if (isAppError(e)) {
        if (e.code === "version_conflict") {
          return errorResponse(message.id, JSONRPC_VERSION_CONFLICT, e.message, e.details);
        }
        if (e.code === "not_found") {
          return errorResponse(message.id, JSONRPC_NOT_FOUND, e.message);
        }
        if (e.code === "validation_error") {
          return errorResponse(message.id, JSONRPC_INVALID_PARAMS, e.message);
        }
        if (e.code === "payload_too_large") {
          return errorResponse(message.id, JSONRPC_PAYLOAD_TOO_LARGE, e.message);
        }
        if (e.code === "conflict") {
          return errorResponse(message.id, JSONRPC_CONFLICT, e.message);
        }
        return errorResponse(message.id, JSONRPC_INTERNAL_ERROR, `${e.code}: ${e.message}`);
      }
      console.error("tools/call failed", params.name, e);
      return errorResponse(message.id, JSONRPC_INTERNAL_ERROR, `Internal error executing ${params.name}`);
    }
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id: message.id, result: { resources: [] } };
  }
  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id: message.id, result: { prompts: [] } };
  }

  return errorResponse(message.id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
}

/** Handle a request body that may be a single message or a batch. */
export async function handlePayload(
  state: SessionState,
  payload: unknown,
  ctx: ToolContext,
): Promise<JsonRpcMessage | JsonRpcMessage[] | null> {
  if (Array.isArray(payload)) {
    const responses: JsonRpcMessage[] = [];
    for (const item of payload) {
      if (!isMessage(item)) {
        responses.push(errorResponse(undefined, JSONRPC_INVALID_REQUEST, "Invalid Request"));
        continue;
      }
      const res = await handleMessage(state, item, ctx);
      if (res) responses.push(res);
    }
    return responses.length > 0 ? responses : null;
  }
  if (!isMessage(payload)) {
    return errorResponse(undefined, JSONRPC_INVALID_REQUEST, "Invalid Request");
  }
  return handleMessage(state, payload, ctx);
}

function isMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorResponse(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function isAppError(e: unknown): e is { code: string; message: string; details?: unknown } {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}
