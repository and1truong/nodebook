/** D1 data access for MCP tokens. */
import type { D1Database } from "@cloudflare/workers-types";
import type { McpTokenRecord } from "../../domain/models";

export async function insertToken(
  db: D1Database,
  input: {
    id: string;
    name: string;
    prefix: string;
    tokenHash: string;
    scopesJson: string;
    expiresAt: string | null;
    ownerEmail: string;
    ownerDisplayName: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mcp_tokens (id, name, prefix, token_hash, scopes_json, created_at, expires_at,
        last_used_at, revoked_at, owner_email, owner_display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(
      input.id,
      input.name,
      input.prefix,
      input.tokenHash,
      input.scopesJson,
      input.now,
      input.expiresAt,
      input.ownerEmail,
      input.ownerDisplayName,
    )
    .run();
}

export async function listTokens(db: D1Database): Promise<McpTokenRecord[]> {
  const res = await db
    .prepare("SELECT * FROM mcp_tokens ORDER BY created_at DESC, id DESC")
    .all<Record<string, unknown>>();
  return res.results.map(rowToToken);
}

export async function getTokenById(db: D1Database, id: string): Promise<McpTokenRecord | null> {
  const row = await db.prepare("SELECT * FROM mcp_tokens WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToToken(row) : null;
}

export async function revokeToken(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
}

function rowToToken(row: Record<string, unknown>): McpTokenRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    scopes_json: String(row.scopes_json),
    created_at: String(row.created_at),
    expires_at: (row.expires_at as string | null) ?? null,
    last_used_at: (row.last_used_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
    owner_email: (row.owner_email as string | null) ?? null,
    owner_display_name: (row.owner_display_name as string | null) ?? null,
  };
}
