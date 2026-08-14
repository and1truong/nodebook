/** MCP personal access token management. */
import type { Ctx } from "../ctx";
import { NotFoundError, ValidationError } from "../../domain/errors";
import type { McpTokenRecord } from "../../domain/models";
import type { McpTokenCreatedDto, McpTokenDto, OauthGrantDto } from "../../shared/contracts/issues";
import { MCP_SCOPES, type McpScope } from "../../shared/limits";
import { recordAudit } from "./audit-service";
import { attributionFromCtx } from "../ctx";
import { generateMcpToken, sha256Hex } from "../auth/token-auth";
import * as tokenRepo from "../repositories/auth";
import * as oauthRepo from "../repositories/oauth";
import { parseScopesJson } from "./oauth-service";

export async function createToken(
  ctx: Ctx,
  input: { name: string; scopes: string[]; expiresInDays?: number | null },
): Promise<McpTokenCreatedDto> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Token name must not be empty");
  if (name.length > 64) throw new ValidationError("Token name is too long");

  const scopes = [...new Set(input.scopes)];
  for (const scope of scopes) {
    if (!MCP_SCOPES.includes(scope as McpScope)) throw new ValidationError(`Unknown scope: ${scope}`);
  }
  if (scopes.length === 0) throw new ValidationError("At least one scope is required");

  const now = new Date().toISOString();
  const { subject } = attributionFromCtx(ctx);
  if (!subject) throw new ValidationError("A human owner is required to create an MCP token");
  const token = generateMcpToken();
  const hash = await sha256Hex(token);
  const record: McpTokenRecord = {
    id: crypto.randomUUID(),
    name,
    prefix: token.slice(0, 10),
    scopes_json: JSON.stringify(scopes),
    created_at: now,
    expires_at: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null,
    last_used_at: null,
    revoked_at: null,
    owner_email: subject.email,
    owner_display_name: subject.displayName,
  };
  await tokenRepo.insertToken(ctx.env.DB, {
    id: record.id,
    name,
    prefix: record.prefix,
    tokenHash: hash,
    scopesJson: record.scopes_json,
    expiresAt: record.expires_at,
    ownerEmail: subject.email,
    ownerDisplayName: record.owner_display_name,
    now,
  });
  await recordAudit(ctx, {
    action: "token.create",
    entityType: "token",
    entityId: record.id,
    after: { name, scopes, expires_at: record.expires_at },
  });
  return { ...toDto(record), token };
}

export async function listTokens(ctx: Ctx): Promise<McpTokenDto[]> {
  const records = await tokenRepo.listTokens(ctx.env.DB);
  return records.map(toDto);
}

export async function revokeToken(ctx: Ctx, tokenId: string): Promise<McpTokenDto> {
  const record = await tokenRepo.getTokenById(ctx.env.DB, tokenId);
  if (!record) throw new NotFoundError("Token not found");
  if (!record.revoked_at) {
    await tokenRepo.revokeToken(ctx.env.DB, tokenId, new Date().toISOString());
    await recordAudit(ctx, {
      action: "token.revoke",
      entityType: "token",
      entityId: tokenId,
      before: { name: record.name },
      after: { revoked_at: new Date().toISOString() },
    });
  }
  const updated = await tokenRepo.getTokenById(ctx.env.DB, tokenId);
  if (!updated) throw new NotFoundError("Token not found");
  return toDto(updated);
}

function toDto(record: McpTokenRecord): McpTokenDto {
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(record.scopes_json) as unknown;
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    scopes = [];
  }
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes,
    created_at: record.created_at,
    expires_at: record.expires_at,
    last_used_at: record.last_used_at,
    revoked_at: record.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// OAuth connections (owner-approved grants)
// ---------------------------------------------------------------------------

export async function listOauthGrants(ctx: Ctx): Promise<OauthGrantDto[]> {
  const rows = await oauthRepo.listGrantsWithClients(ctx.env.DB);
  return rows.map((row) => ({
    id: row.grant.id,
    client_id: row.client_id,
    client_name: row.client_name,
    scopes: parseScopesJson(row.grant.scopes_json),
    created_at: row.grant.created_at,
    last_used_at: row.grant.last_used_at,
    revoked_at: row.grant.revoked_at,
  }));
}

export async function revokeOauthGrant(ctx: Ctx, grantId: string): Promise<OauthGrantDto> {
  const row = await oauthRepo.getGrantWithClient(ctx.env.DB, grantId);
  if (!row) throw new NotFoundError("OAuth connection not found");
  const { grant, client_id, client_name } = row;
  if (!grant.revoked_at) {
    const now = new Date().toISOString();
    // Invalidate the grant and every access/refresh token atomically.
    await oauthRepo.revokeGrantAndTokens(ctx.env.DB, grantId, now);
    await recordAudit(ctx, {
      action: "oauth_grant.revoke",
      entityType: "oauth_grant",
      entityId: grantId,
      before: { client_id, client_name, scopes: parseScopesJson(grant.scopes_json) },
      after: { revoked_at: now },
    });
  }
  const updated = await oauthRepo.getGrantWithClient(ctx.env.DB, grantId);
  if (!updated) throw new NotFoundError("OAuth connection not found");
  return {
    id: updated.grant.id,
    client_id: updated.client_id,
    client_name: updated.client_name,
    scopes: parseScopesJson(updated.grant.scopes_json),
    created_at: updated.grant.created_at,
    last_used_at: updated.grant.last_used_at,
    revoked_at: updated.grant.revoked_at,
  };
}
