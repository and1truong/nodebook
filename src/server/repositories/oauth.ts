/** D1 data access for the OAuth authorization server. */
import type { D1Database } from "@cloudflare/workers-types";
import type {
  OauthClientRecord,
  OauthCodeRecord,
  OauthGrantRecord,
  OauthTokenRecord,
} from "../../domain/models";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function insertClient(
  db: D1Database,
  input: { id: string; clientId: string; clientName: string; redirectUrisJson: string; now: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO oauth_clients (id, client_id, client_name, redirect_uris_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(input.id, input.clientId, input.clientName, input.redirectUrisJson, input.now)
    .run();
}

export async function getClientByClientId(db: D1Database, clientId: string): Promise<OauthClientRecord | null> {
  const row = await db
    .prepare("SELECT * FROM oauth_clients WHERE client_id = ?")
    .bind(clientId)
    .first<Record<string, unknown>>();
  return row ? rowToClient(row) : null;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export async function insertGrant(
  db: D1Database,
  input: { id: string; clientId: string; scopesJson: string; now: string },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO oauth_grants (id, client_id, scopes_json, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, NULL, NULL)",
    )
    .bind(input.id, input.clientId, input.scopesJson, input.now)
    .run();
}

export async function findActiveGrantForClient(db: D1Database, clientId: string): Promise<OauthGrantRecord | null> {
  const row = await db
    .prepare(
      "SELECT * FROM oauth_grants WHERE client_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(clientId)
    .first<Record<string, unknown>>();
  return row ? rowToGrant(row) : null;
}

export async function getGrantById(db: D1Database, id: string): Promise<OauthGrantRecord | null> {
  const row = await db.prepare("SELECT * FROM oauth_grants WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToGrant(row) : null;
}

export interface GrantWithClient {
  grant: OauthGrantRecord;
  client_id: string;
  client_name: string;
}

export async function listGrantsWithClients(db: D1Database): Promise<GrantWithClient[]> {
  const res = await db
    .prepare(
      `SELECT g.id, g.client_id, g.scopes_json, g.created_at, g.last_used_at, g.revoked_at, c.client_id AS client_id, c.client_name
       FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
       ORDER BY g.created_at DESC, g.id DESC`,
    )
    .all<Record<string, unknown>>();
  return res.results.map((row) => ({
    grant: {
      id: String(row.id),
      client_id: String(row.client_id),
      scopes_json: String(row.scopes_json),
      created_at: String(row.created_at),
      last_used_at: (row.last_used_at as string | null) ?? null,
      revoked_at: (row.revoked_at as string | null) ?? null,
    },
    client_id: String(row.client_id),
    client_name: String(row.client_name),
  }));
}

export async function getGrantWithClient(db: D1Database, id: string): Promise<GrantWithClient | null> {
  const row = await db
    .prepare(
      `SELECT g.id, g.client_id, g.scopes_json, g.created_at, g.last_used_at, g.revoked_at, c.client_id AS client_id, c.client_name
       FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
       WHERE g.id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    grant: {
      id: String(row.id),
      client_id: String(row.client_id),
      scopes_json: String(row.scopes_json),
      created_at: String(row.created_at),
      last_used_at: (row.last_used_at as string | null) ?? null,
      revoked_at: (row.revoked_at as string | null) ?? null,
    },
    client_id: String(row.client_id),
    client_name: String(row.client_name),
  };
}

export async function updateGrantScopes(db: D1Database, id: string, scopesJson: string): Promise<void> {
  await db.prepare("UPDATE oauth_grants SET scopes_json = ? WHERE id = ?").bind(scopesJson, id).run();
}

export async function touchGrant(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").bind(now, id).run();
}

/** Revoke a grant; returns true when the grant was still active. */
export async function revokeGrant(db: D1Database, id: string, now: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, id)
    .run();
  return res.meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export async function insertCode(
  db: D1Database,
  input: {
    codeHash: string;
    clientId: string;
    grantId: string;
    redirectUri: string;
    codeChallenge: string;
    scopesJson: string;
    resource: string;
    expiresAt: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, grant_id, redirect_uri, code_challenge, scopes_json, resource, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      input.codeHash,
      input.clientId,
      input.grantId,
      input.redirectUri,
      input.codeChallenge,
      input.scopesJson,
      input.resource,
      input.expiresAt,
      input.now,
    )
    .run();
}

export async function getCodeByHash(db: D1Database, codeHash: string): Promise<OauthCodeRecord | null> {
  const row = await db
    .prepare("SELECT * FROM oauth_codes WHERE code_hash = ?")
    .bind(codeHash)
    .first<Record<string, unknown>>();
  return row ? rowToCode(row) : null;
}

/** Atomically mark a code consumed; returns true when this call won the race. */
export async function consumeCode(db: D1Database, codeHash: string, now: string): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(now, codeHash, now)
    .run();
  return res.meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function insertToken(
  db: D1Database,
  input: {
    tokenHash: string;
    kind: "access" | "refresh";
    grantId: string;
    clientId: string;
    scopesJson: string;
    resource: string;
    expiresAt: string;
    rotatedFromHash: string | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, grant_id, client_id, scopes_json, resource, expires_at, rotated_from_hash, revoked_at, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    )
    .bind(
      input.tokenHash,
      input.kind,
      input.grantId,
      input.clientId,
      input.scopesJson,
      input.resource,
      input.expiresAt,
      input.rotatedFromHash,
      input.now,
    )
    .run();
}

export async function getTokenByHash(db: D1Database, tokenHash: string): Promise<OauthTokenRecord | null> {
  const row = await db
    .prepare("SELECT * FROM oauth_tokens WHERE token_hash = ?")
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  return row ? rowToToken(row) : null;
}

export async function getTokenWithContext(
  db: D1Database,
  tokenHash: string,
): Promise<(OauthTokenRecord & { grant_revoked_at: string | null; client_name: string }) | null> {
  const row = await db
    .prepare(
      `SELECT t.token_hash, t.kind, t.grant_id, t.client_id, t.scopes_json, t.resource, t.expires_at, t.rotated_from_hash, t.revoked_at, t.created_at, t.last_used_at,
              g.revoked_at AS grant_revoked_at, c.client_name
       FROM oauth_tokens t
       JOIN oauth_grants g ON g.id = t.grant_id
       JOIN oauth_clients c ON c.id = t.client_id
       WHERE t.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    ...rowToToken(row),
    grant_revoked_at: (row.grant_revoked_at as string | null) ?? null,
    client_name: String(row.client_name),
  };
}

/** Revoke every token belonging to a grant (used by grant revocation). */
export async function revokeTokensForGrant(db: D1Database, grantId: string, now: string): Promise<void> {
  await db
    .prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL")
    .bind(now, grantId)
    .run();
}

/** Revoke one token; returns true when the token was still active (rotation race guard). */
export async function revokeToken(db: D1Database, tokenHash: string, now: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(now, tokenHash)
    .run();
  return res.meta.changes > 0;
}

export async function touchToken(db: D1Database, tokenHash: string, now: string): Promise<void> {
  await db.prepare("UPDATE oauth_tokens SET last_used_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToClient(row: Record<string, unknown>): OauthClientRecord {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    client_name: String(row.client_name),
    redirect_uris_json: String(row.redirect_uris_json),
    created_at: String(row.created_at),
  };
}

function rowToGrant(row: Record<string, unknown>): OauthGrantRecord {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    scopes_json: String(row.scopes_json),
    created_at: String(row.created_at),
    last_used_at: (row.last_used_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
  };
}

function rowToCode(row: Record<string, unknown>): OauthCodeRecord {
  return {
    code_hash: String(row.code_hash),
    client_id: String(row.client_id),
    grant_id: String(row.grant_id),
    redirect_uri: String(row.redirect_uri),
    code_challenge: String(row.code_challenge),
    scopes_json: String(row.scopes_json),
    resource: String(row.resource),
    expires_at: String(row.expires_at),
    consumed_at: (row.consumed_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

function rowToToken(row: Record<string, unknown>): OauthTokenRecord {
  return {
    token_hash: String(row.token_hash),
    kind: row.kind === "refresh" ? "refresh" : "access",
    grant_id: String(row.grant_id),
    client_id: String(row.client_id),
    scopes_json: String(row.scopes_json),
    resource: String(row.resource),
    expires_at: String(row.expires_at),
    rotated_from_hash: (row.rotated_from_hash as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
    created_at: String(row.created_at),
    last_used_at: (row.last_used_at as string | null) ?? null,
  };
}
