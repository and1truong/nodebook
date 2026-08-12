/** MCP personal access token management. */
import type { Ctx } from "../ctx";
import { NotFoundError, ValidationError } from "../../domain/errors";
import type { McpTokenRecord } from "../../domain/models";
import type { McpTokenCreatedDto, McpTokenDto } from "../../shared/contracts/issues";
import { MCP_SCOPES, type McpScope } from "../../shared/limits";
import { recordAudit } from "./audit-service";
import { generateMcpToken, sha256Hex } from "../auth/token-auth";
import * as tokenRepo from "../repositories/auth";

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
  };
  await tokenRepo.insertToken(ctx.env.DB, {
    id: record.id,
    name,
    prefix: record.prefix,
    tokenHash: hash,
    scopesJson: record.scopes_json,
    expiresAt: record.expires_at,
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
