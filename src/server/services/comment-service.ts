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
import { creationAttribution, resolveAttribution } from "./attribution-service";

export async function addComment(ctx: Ctx, issueRef: string, body: string): Promise<CommentDto> {
  const issue = await commentRepo.getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);
  const trimmed = validateCommentBody(body);

  const now = new Date().toISOString();
  const attribution = creationAttribution(ctx);
  const record: CommentRecord = {
    id: crypto.randomUUID(),
    issue_id: issue.id,
    body: trimmed,
    author: attribution.actorLabel,
    author_type: ctx.actor.type,
    author_for: attribution.subjectEmail,
    author_via: attribution.via,
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
    authorFor: record.author_for,
    authorVia: record.author_via ?? attribution.via,
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
  return toDto(ctx, record, issue.number);
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
  return toDto(ctx, updated, issue.number);
}

export async function listComments(ctx: Ctx, issueRef: string): Promise<CommentDto[]> {
  const issue = await commentRepo.getIssueByRef(ctx.env.DB, issueRef);
  if (!issue) throw new NotFoundError(`Issue ${issueRef} not found`);
  const records = await commentRepo.listCommentsByIssue(ctx.env.DB, issue.id);
  return Promise.all(records.map((r) => toDto(ctx, r, issue.number)));
}

export async function getComment(ctx: Ctx, commentId: string): Promise<CommentDto> {
  const record = await commentRepo.getCommentById(ctx.env.DB, commentId);
  if (!record) throw new NotFoundError("Comment not found");
  const issue = await commentRepo.getIssueById(ctx.env.DB, record.issue_id);
  return toDto(ctx, record, issue?.number ?? 0);
}

function validateCommentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ValidationError("Comment must not be empty");
  if (trimmed.length > COMMENT_MAX_LENGTH) throw new ValidationError(`Comment is too long (max ${COMMENT_MAX_LENGTH} characters)`);
  return trimmed;
}

async function toDto(ctx: Ctx, record: CommentRecord, issueNumber: number): Promise<CommentDto> {
  const creator = await resolveAttribution(ctx, {
    actorType: record.author_type,
    actorId: record.author,
    subjectEmail: record.author_for,
    via: record.author_via,
  });
  return {
    id: record.id,
    issue_id: record.issue_id,
    issue_number: issueNumber,
    body: record.body,
    author: record.author,
    author_type: record.author_type,
    creator,
    edited_at: record.edited_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export { deleteIndexEntry };
