/** Scope checks for MCP tool invocations (PRD-defined scopes). */
import { ForbiddenError } from "../../domain/errors";
import type { McpScope } from "../../shared/limits";
import { JSONRPC_INSUFFICIENT_SCOPE } from "../../domain/errors";
import { McpError } from "../../mcp/errors";

export function hasScope(scopes: readonly McpScope[], required: McpScope): boolean {
  return scopes.includes(required);
}

export function assertScope(scopes: readonly McpScope[], required: McpScope): void {
  if (!hasScope(scopes, required)) {
    throw new McpError(JSONRPC_INSUFFICIENT_SCOPE, `Token is missing required scope: ${required}`);
  }
}

export function assertHuman(ctx: { actor: { type: string } }): void {
  if (ctx.actor.type !== "human") {
    throw new ForbiddenError("This operation requires a human actor");
  }
}
