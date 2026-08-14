/** Human-friendly attribution without collapsing the auditable actor identity. */
import type { ActorType } from "../../shared/limits";
import type { CreatorAttributionDto } from "../../shared/contracts/issues";
import type { AttributionVia, Ctx } from "../ctx";
import { attributionFromCtx } from "../ctx";
import { workspaceOwnerEmail } from "../../env";

export interface StoredAttribution {
  actorType: ActorType;
  /** Raw id or legacy label such as mcp:<uuid>. */
  actorId: string;
  subjectEmail?: string | null;
  subjectDisplayName?: string | null;
  via?: AttributionVia | null;
}

/** Values persisted next to a creation row. */
export function creationAttribution(ctx: Ctx): {
  actorLabel: string;
  subjectEmail: string | null;
  via: AttributionVia;
} {
  const { subject, via } = attributionFromCtx(ctx);
  return {
    actorLabel: ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`,
    subjectEmail: subject?.email ?? null,
    via,
  };
}

/** Values persisted on every immutable audit event. */
export function auditAttribution(ctx: Ctx): {
  subjectId: string | null;
  subjectEmail: string | null;
  subjectDisplayName: string | null;
  via: AttributionVia;
} {
  const { subject, via } = attributionFromCtx(ctx);
  return {
    subjectId: subject?.id ?? null,
    subjectEmail: subject?.email ?? null,
    subjectDisplayName: subject?.displayName ?? null,
    via,
  };
}

/**
 * Build a client-facing creator object. New rows normally carry subjectEmail;
 * old MCP rows resolve through the retained PAT/OAuth connection. A missing
 * connection is display-only degradation and safely falls back to MCP client.
 */
export async function resolveAttribution(ctx: Ctx, input: StoredAttribution): Promise<CreatorAttributionDto> {
  const actorId = normalizeActorId(input.actorType, input.actorId);
  const via = input.via ?? viaForActor(input.actorType);
  let email = input.subjectEmail ?? null;
  let displayName = input.subjectDisplayName?.trim() || null;

  if (input.actorType === "human") {
    email ??= actorId;
  } else if (input.actorType === "mcp" && !email) {
    const owner = await findMcpOwner(ctx, actorId);
    email = owner?.email ?? null;
    displayName ??= owner?.displayName ?? null;
  }

  if (!displayName && email) {
    const configuredOwner = ctx.env.OWNER_EMAIL?.trim();
    const devOwner = ctx.env.AUTH_DEV_EMAIL?.trim();
    displayName = (email === configuredOwner || email === devOwner)
      ? ctx.env.OWNER_DISPLAY_NAME?.trim() || email
      : email;
  }

  return {
    actor_type: input.actorType,
    actor_id: actorId,
    user_id: email,
    email,
    display_name: displayName ?? fallbackName(input.actorType),
    via,
  };
}

export function inferStoredActor(actorLabel: string, explicitType?: ActorType): { actorType: ActorType; actorId: string } {
  if (explicitType) return { actorType: explicitType, actorId: actorLabel };
  if (actorLabel.startsWith("mcp:")) return { actorType: "mcp", actorId: actorLabel.slice(4) };
  if (actorLabel.startsWith("system:")) return { actorType: "system", actorId: actorLabel.slice(7) };
  return { actorType: "human", actorId: actorLabel };
}

async function findMcpOwner(
  ctx: Ctx,
  principalId: string,
): Promise<{ email: string | null; displayName: string | null } | null> {
  const row = await ctx.env.DB.prepare(
    `SELECT owner_email, owner_display_name FROM mcp_tokens WHERE id = ?
     UNION ALL
     SELECT owner_email, owner_display_name FROM oauth_grants WHERE id = ?
     LIMIT 1`,
  )
    .bind(principalId, principalId)
    .first<{ owner_email: string | null; owner_display_name: string | null }>();
  if (!row) return null;

  // A retained pre-0010 connection has no snapshot. Since NodeBook is a
  // single-owner workspace, its configured owner is the deterministic legacy
  // relationship. Do not apply this fallback when the connection is missing.
  const legacyEmail = workspaceOwnerEmail(ctx.env);
  return {
    email: row.owner_email ?? legacyEmail,
    displayName: row.owner_display_name ?? ctx.env.OWNER_DISPLAY_NAME?.trim() ?? null,
  };
}

function normalizeActorId(type: ActorType, actorId: string): string {
  if (type === "mcp" && actorId.startsWith("mcp:")) return actorId.slice(4);
  if (type === "system" && actorId.startsWith("system:")) return actorId.slice(7);
  return actorId;
}

function viaForActor(type: ActorType): AttributionVia {
  return type === "mcp" ? "mcp" : type === "system" ? "system" : "web";
}

function fallbackName(type: ActorType): string {
  return type === "mcp" ? "MCP client" : type === "system" ? "NodeBook" : "Unknown user";
}
