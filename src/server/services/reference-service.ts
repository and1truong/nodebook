/** Issue-reference (`#123`) storage: parse Markdown and persist references. */
import type { Ctx } from "../ctx";
import { extractIssueReferences } from "../../shared/refs";
import { replaceReferences, resolvePendingReferences } from "../repositories/graph";
import { recordAudit } from "./audit-service";

export async function refreshIssueReferences(ctx: Ctx, issueId: string, body: string, sourceNumber: number): Promise<number> {
  const numbers = extractIssueReferences(body);
  const records = await replaceReferences(ctx.env.DB, "issue", issueId, numbers, actorId(ctx));
  if (records.length > 0) {
    await recordAudit(ctx, {
      action: "references.update",
      entityType: "issue",
      entityId: issueId,
      after: { source_number: sourceNumber, references: numbers },
    });
  }
  return records.length;
}

export async function refreshCommentReferences(ctx: Ctx, commentId: string, body: string): Promise<number> {
  const numbers = extractIssueReferences(body);
  const records = await replaceReferences(ctx.env.DB, "comment", commentId, numbers, actorId(ctx));
  if (records.length > 0) {
    await recordAudit(ctx, {
      action: "references.update",
      entityType: "comment",
      entityId: commentId,
      after: { references: numbers },
    });
  }
  return records.length;
}

/**
 * When a new issue number appears, resolve previously-unresolved references
 * that pointed at it. Returns the number of references resolved.
 */
export async function resolveReferencesForNewIssue(ctx: Ctx, issueId: string, number: number): Promise<number> {
  return resolvePendingReferences(ctx.env.DB, number, issueId);
}

function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}
