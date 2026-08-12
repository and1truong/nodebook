/** Per-request context: who is acting, and with which request id. */
import type { Env } from "../env";
import type { ActorType } from "../shared/limits";

export interface Actor {
  type: ActorType;
  /** Email for humans, MCP token id for MCP clients, or "system:cron". */
  id: string;
}

export interface Ctx {
  env: Env;
  actor: Actor;
  requestId: string;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function systemCtx(env: Env, label = "system"): Ctx {
  return { env, actor: { type: "system", id: label }, requestId: newRequestId() };
}

export function actorLabel(actor: Actor): string {
  return actor.type === "human" ? actor.id : `${actor.type}:${actor.id}`;
}
