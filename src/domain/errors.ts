/** Domain errors shared by the HTTP API and the MCP layer. */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "unauthorized");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(message, 400, "validation_error");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409, "conflict");
  }
}

export class VersionConflictError extends AppError {
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(expectedVersion: number, currentVersion: number) {
    super(
      "Issue changed since it was loaded. Refresh the issue and reapply your changes.",
      409,
      "version_conflict",
      { expected_version: expectedVersion, current_version: currentVersion },
    );
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large") {
    super(message, 413, "payload_too_large");
  }
}

/** JSON-RPC error codes used by the MCP layer (see MCP spec). */
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;
export const JSONRPC_SESSION_NOT_INITIALIZED = -32002;
export const JSONRPC_INSUFFICIENT_SCOPE = -32003;
export const JSONRPC_VERSION_CONFLICT = -32009;
