/** Immutable audit trail. Every mutation records actor, action, and before/after payloads. */
import type { Ctx } from "../ctx";
import { AUDIT_JSON_MAX_LENGTH } from "../../shared/limits";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export function recordAudit(ctx: Ctx, input: AuditInput): Promise<unknown> {
  return ctx.env.DB.prepare(
    `INSERT INTO audit_events (id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      ctx.actor.type,
      ctx.actor.id,
      input.action,
      input.entityType,
      input.entityId,
      input.before !== undefined ? truncateJson(input.before) : null,
      input.after !== undefined ? truncateJson(input.after) : null,
      ctx.requestId,
      new Date().toISOString(),
    )
    .run();
}

export function truncateJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text) return "";
  return text.length > AUDIT_JSON_MAX_LENGTH ? text.slice(0, AUDIT_JSON_MAX_LENGTH) : text;
}

export async function listAuditForEntity(ctx: Ctx, entityType: string, entityId: string): Promise<unknown[]> {
  const rows = await ctx.env.DB.prepare(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at
     FROM audit_events
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
  )
    .bind(entityType, entityId)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id),
    actor_type: String(row.actor_type),
    actor_id: String(row.actor_id),
    action: String(row.action),
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    before: typeof row.before_json === "string" ? safeParse(row.before_json) : null,
    after: typeof row.after_json === "string" ? safeParse(row.after_json) : null,
    created_at: String(row.created_at),
  }));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
