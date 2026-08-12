/** MCP tool registry: every tool maps to the shared domain services. */
import type { Env } from "../env";
import type { McpIdentity } from "../server/auth/token-auth";
import type { McpScope } from "../shared/limits";
import type { Ctx } from "../server/ctx";
import { zodToJsonSchema } from "./schemas";
import type { z } from "zod";
import { McpError } from "./errors";
import { JSONRPC_INVALID_PARAMS } from "../domain/errors";

export interface ToolContext {
  env: Env;
  identity: McpIdentity;
  requestId: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** PRD scope required to invoke this tool. */
  scope: McpScope;
  handler: (ctx: ToolContext, args: unknown) => Promise<unknown>;
}

export function toCtx(ctx: ToolContext): Ctx {
  return { env: ctx.env, actor: { type: "mcp", id: ctx.identity.tokenId }, requestId: ctx.requestId };
}

export function defineTool<TSchema extends z.ZodTypeAny>(tool: {
  name: string;
  description: string;
  inputSchema: TSchema;
  scope: McpScope;
  handler: (ctx: ToolContext, args: z.infer<TSchema>) => Promise<unknown>;
}): McpTool {
  return tool as McpTool;
}

export function toolList(tools: McpTool[]): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  }));
}

export function parseToolArgs(tool: McpTool, args: unknown): unknown {
  const result = tool.inputSchema.safeParse(args);
  if (!result.success) {
    throw new McpError(JSONRPC_INVALID_PARAMS, `Invalid arguments for ${tool.name}: ${result.error.issues.map((i) => i.message).join("; ")}`);
  }
  return result.data;
}
