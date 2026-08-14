/** Per-request context: who is acting, and with which request id. */
import type { Env } from "../env";
import type { ActorType } from "../shared/limits";

export interface Actor {
  type: ActorType;
  /** Email for humans, MCP token id for MCP clients, or "system:cron". */
  id: string;
}

export type AttributionVia = "web" | "mcp" | "system";

export interface HumanSubject {
  /** NodeBook currently uses the owner's email as its stable human id. */
  id: string;
  email: string;
  displayName: string | null;
}

export interface Ctx {
  env: Env;
  actor: Actor;
  /** Human account on whose behalf the actor is operating. */
  subject?: HumanSubject | null;
  /** Request channel; inferred from actor type for older/internal callers. */
  via?: AttributionVia;
  requestId: string;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function systemCtx(env: Env, label = "system"): Ctx {
  return { env, actor: { type: "system", id: label }, subject: null, via: "system", requestId: newRequestId() };
}

export function actorLabel(actor: Actor): string {
  return actor.type === "human" ? actor.id : `${actor.type}:${actor.id}`;
}

/** Resolve attribution without changing the auditable actor identity. */
export function attributionFromCtx(ctx: Ctx): { subject: HumanSubject | null; via: AttributionVia } {
  if (ctx.subject !== undefined) {
    return { subject: ctx.subject, via: ctx.via ?? viaForActor(ctx.actor.type) };
  }
  if (ctx.actor.type === "human") {
    const displayName = ctx.env.OWNER_DISPLAY_NAME?.trim() || null;
    return {
      subject: { id: ctx.actor.id, email: ctx.actor.id, displayName },
      via: ctx.via ?? "web",
    };
  }
  return { subject: null, via: ctx.via ?? viaForActor(ctx.actor.type) };
}

function viaForActor(type: ActorType): AttributionVia {
  return type === "mcp" ? "mcp" : type === "system" ? "system" : "web";
}
