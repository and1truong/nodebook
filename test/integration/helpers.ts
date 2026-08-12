/** Integration helpers: authenticated API client against the worker under test. */
import { env, SELF } from "cloudflare:test";
import type { Env } from "../../src/env";

export const OWNER = "owner@test.dev";

export async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; json: <T>() => T }> {
  const res = await SELF.fetch(`https://nodebook.test${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: res.status,
    body,
    json: <T,>() => body as T,
  };
}

export async function post(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function patch(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  return api(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Create an issue via the API and return its DTO. */
export async function createIssue(input: Record<string, unknown> = {}): Promise<{
  id: string;
  number: number;
  title: string;
  type: string;
  status: string;
  [key: string]: unknown;
}> {
  const res = await post("/api/issues", {
    title: `Issue ${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  });
  if (res.status !== 201) throw new Error(`createIssue failed: ${JSON.stringify(res.body)}`);
  return res.body as never;
}

/** Create an MCP token with the given scopes; returns token + id. */
export async function createMcpToken(scopes: string[]): Promise<{ token: string; id: string }> {
  const res = await post("/api/tokens", {
    name: "integration-test",
    scopes,
    expires_in_days: 30,
  });
  if (res.status !== 201) throw new Error(`createMcpToken failed: ${JSON.stringify(res.body)}`);
  const body = res.body as { token: string; id: string };
  return { token: body.token, id: body.id };
}

/** Minimal MCP JSON-RPC client over fetch (per-request session, JSON mode). */
export async function mcpCall(
  token: string,
  method: string,
  params?: unknown,
  sessionId?: string,
): Promise<{ status: number; body: Record<string, unknown>; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await SELF.fetch("https://nodebook.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, sessionId: res.headers.get("mcp-session-id") };
}

export async function mcpInitialize(token: string): Promise<{ sessionId: string }> {
  const res = await mcpCall(token, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  });
  if (res.status !== 200 || res.body.error) throw new Error(`initialize failed: ${JSON.stringify(res.body)}`);
  return { sessionId: res.sessionId! };
}

export function testEnv(): Env {
  return env as unknown as Env;
}
