/** JSON-RPC error type for MCP tool handlers. */
export class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

export function isMcpError(e: unknown): e is McpError {
  return e instanceof McpError;
}
