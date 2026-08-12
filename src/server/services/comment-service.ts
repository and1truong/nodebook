/** Markdown comments with durable edit history. */
import type { Ctx } from "../ctx";
import { NotFoundError, ValidationError } from "../../domain/errors";
import type { CommentRecord } from "../../domain/models";
import type { CommentDto } from "../../shared/contracts/issues";
import { COMMENT_MAX_LENGTH } from "../../shared/limits";
import { recordAudit } from "./audit-service";
import { refreshCommentReferences } from "./reference-service";
import { indexComment, deleteIndexEntry } from "./search-service";
import * as commentRepo from "../repositories/issues";

export async function addComment(ctx: Ctx, issueRef: string, body: string): Promise<CommentDto> {
  const issue = await commentRepo.getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);
  const trimmed = validateCommentBody(body);

  const now = new Date().toISOString();
  const record: CommentRecord = {
    id: crypto.randomUUID(),
    issue_id: issue.id,
    body: trimmed,
    author: actorId(ctx),
    author_type: ctx.actor.type,
    edited_at: null,
    created_at: now,
    updated_at: now,
  };
  await commentRepo.insertComment(ctx.env.DB, {
    id: record.id,
    issueId: issue.id,
    body: trimmed,
    author: record.author,
    authorType: record.author_type,
    now,
  });
  await refreshCommentReferences(ctx, record.id, trimmed);
  await indexComment(ctx, record, issue);
  await recordAudit(ctx, {
    action: "comment.create",
    entityType: "comment",
    entityId: record.id,
    after: { issue_id: issue.id, issue_number: issue.number, body: trimmed },
  });
  return toDto(record, issue.number);
}

export async function updateComment(ctx: Ctx, commentId: string, body: string): Promise<CommentDto> {
  const record = await commentRepo.getCommentById(ctx.env.DB, commentId);
  if (!record) throw new NotFoundError("Comment not found");
  const trimmed = validateCommentBody(body);

  const issue = await commentRepo.getIssueById(ctx.env.DB, record.issue_id);
  if (!issue) throw new NotFoundError("Comment's issue not found");

  const before = { body: record.body };
  await commentRepo.updateCommentBody(ctx.env.DB, commentId, trimmed, new Date().toISOString());
  await refreshCommentReferences(ctx, commentId, trimmed);
  await indexComment(ctx, { ...record, body: trimmed, edited_at: new Date().toISOString(), updated_at: new Date().toISOString() }, issue);
  await recordAudit(ctx, {
    action: "comment.update",
    entityType: "comment",
    entityId: commentId,
    before,
    after: { body: trimmed },
  });

  const updated = await commentRepo.getCommentById(ctx.env.DB, commentId);
  if (!updated) throw new NotFoundError("Comment not found");
  return toDto(updated, issue.number);
}

export async function listComments(ctx: Ctx, issueRef: string): Promise<CommentDto[]> {
  const issue = await commentRepo.getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);
  const records = await commentRepo.listCommentsByIssue(ctx.env.DB, issue.id);
  return records.map((r) => toDto(r, issue.number));
}

export async function getComment(ctx: Ctx, commentId: string): Promise<CommentDto> {
  const record = await commentRepo.getCommentById(ctx.env.DB, commentId);
  if (!record) throw new NotFoundError("Comment not found");
  const issue = await commentRepo.getIssueById(ctx.env.DB, record.issue_id);
  return toDto(record, issue?.number ?? 0);
}

function validateCommentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ValidationError("Comment must not be empty");
  if (trimmed.length > COMMENT_MAX_LENGTH) throw new ValidationError(`Comment is too long (max ${COMMENT_MAX_LENGTH} characters)`);
  return trimmed;
}

function toDto(record: CommentRecord, issueNumber: number): CommentDto {
  return {
    id: record.id,
    issue_id: record.issue_id,
    issue_number: issueNumber,
    body: record.body,
    author: record.author,
    author_type: record.author_type,
    edited_at: record.edited_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}

export { deleteIndexEntry };
