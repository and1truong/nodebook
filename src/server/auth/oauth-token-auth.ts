/**
 * OAuth access-token authentication for /mcp. Access tokens are opaque
 * short-lived `nbo_…` strings; only their SHA-256 hash is stored. The
 * resolved identity is the owning OAuth grant, so audit attribution stays
 * stable across refresh-token rotations.
 */
import type { Env } from "../../env";
import { oauthResource, workspaceOwnerEmail } from "../../env";
import { AuthError } from "../../domain/errors";
import type { McpScope } from "../../shared/limits";
import { sha256Hex } from "./token-auth";
import type { McpIdentity } from "./token-auth";
import { MCP_SCOPES } from "../../shared/limits";

export async function authenticateOauthAccessToken(env: Env, token: string, request?: Request): Promise<McpIdentity> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.kind, t.grant_id, t.scopes_json, t.resource, t.expires_at, t.revoked_at,
            g.revoked_at AS grant_revoked_at, g.owner_email, g.owner_display_name, c.client_name
     FROM oauth_tokens t
     JOIN oauth_grants g ON g.id = t.grant_id
     JOIN oauth_clients c ON c.id = t.client_id
     WHERE t.token_hash = ?`,
  )
    .bind(hash)
    .first<{
      kind: string;
      grant_id: string;
      scopes_json: string;
      resource: string;
      expires_at: string;
      revoked_at: string | null;
      grant_revoked_at: string | null;
      client_name: string;
      owner_email: string | null;
      owner_display_name: string | null;
    }>();
  if (!row) throw new AuthError("Unknown token");
  if (row.kind !== "access") throw new AuthError("Invalid token type");
  if (row.revoked_at) throw new AuthError("Token revoked");
  if (row.grant_revoked_at) throw new AuthError("Grant revoked");
  if (row.expires_at <= new Date().toISOString()) throw new AuthError("Token expired");

  // Tokens are bound to a single resource: this server's /mcp endpoint. A
  // token approved for any other resource is useless here.
  if (row.resource !== oauthResource(env, request)) throw new AuthError("Token resource mismatch");

  const now = new Date().toISOString();
  // Best-effort usage stamping; never fails a request.
  void env.DB
    .prepare("UPDATE oauth_tokens SET last_used_at = ? WHERE token_hash = ?")
    .bind(now, hash)
    .run()
    .catch(() => undefined);
  void env.DB
    .prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?")
    .bind(now, row.grant_id)
    .run()
    .catch(() => undefined);

  let scopes: McpScope[] = [];
  try {
    const parsed = JSON.parse(row.scopes_json) as unknown;
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is McpScope => typeof s === "string" && MCP_SCOPES.includes(s as McpScope));
  } catch {
    scopes = [];
  }

  const ownerEmail = row.owner_email ?? workspaceOwnerEmail(env);
  return {
    type: "mcp",
    kind: "oauth",
    tokenId: row.grant_id,
    name: row.client_name,
    scopes,
    ownerEmail: ownerEmail || null,
    ownerDisplayName: row.owner_display_name ?? env.OWNER_DISPLAY_NAME?.trim() ?? null,
  };
}
