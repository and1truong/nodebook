/**
 * MCP personal-access-token authentication. Tokens are high-entropy `nbk_…`
 * strings; only the SHA-256 hash and a display prefix are stored.
 */
import type { Env } from "../../env";
import { workspaceOwnerEmail } from "../../env";
import { AuthError } from "../../domain/errors";
import type { McpTokenRecord } from "../../domain/models";
import type { McpScope } from "../../shared/limits";

export interface McpIdentity {
  type: "mcp";
  /** Stable identity for audit attribution: PAT id, or OAuth grant id. */
  tokenId: string;
  /** Credential kind: personal access token vs. OAuth access token. */
  kind: "pat" | "oauth";
  name: string;
  scopes: McpScope[];
  /** Owner recorded on the credential/connection that authorized this client. */
  ownerEmail: string | null;
  ownerDisplayName: string | null;
}

export async function authenticateMcpToken(env: Env, token: string): Promise<McpIdentity> {
  if (!token.startsWith("nbk_")) throw new AuthError("Invalid token format");
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT id, name, scopes_json, expires_at, revoked_at, owner_email, owner_display_name FROM mcp_tokens WHERE token_hash = ?",
  )
    .bind(hash)
    .first<Pick<McpTokenRecord, "id" | "name" | "scopes_json" | "expires_at" | "revoked_at" | "owner_email" | "owner_display_name">>();
  if (!row) throw new AuthError("Unknown token");

  if (row.revoked_at) throw new AuthError("Token revoked");
  if (row.expires_at && row.expires_at <= new Date().toISOString()) throw new AuthError("Token expired");

  // Best-effort last-use stamping; never fails a request.
  void env.DB.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id)
    .run()
    .catch(() => undefined);

  let scopes: McpScope[] = [];
  try {
    const parsed = JSON.parse(row.scopes_json) as unknown;
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is McpScope => typeof s === "string");
  } catch {
    scopes = [];
  }

  // Pre-migration credentials have no owner snapshot. This is a single-owner
  // workspace, so the configured owner is the canonical backward-compatible
  // fallback while the connection row still exists.
  const ownerEmail = row.owner_email ?? workspaceOwnerEmail(env);
  return {
    type: "mcp",
    kind: "pat",
    tokenId: row.id,
    name: row.name,
    scopes,
    ownerEmail: ownerEmail || null,
    ownerDisplayName: row.owner_display_name ?? env.OWNER_DISPLAY_NAME?.trim() ?? null,
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a new high-entropy `nbk_…` token (32 random bytes, base64url). */
export function generateMcpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `nbk_${b64}`;
}
