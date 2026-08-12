/** Full-text search over issues, comments, labels, and attachment metadata. */
import type { Ctx } from "../ctx";
import type { AttachmentRecord, CommentRecord, IssueRecord } from "../../domain/models";
import type { IssueDto, SearchResultDto } from "../../shared/contracts/issues";
import { SEARCH_RESULT_LIMIT } from "../../shared/limits";
import * as searchRepo from "../repositories/search";
import { cleanSnippet, escapeFtsQuery, hasSearchableTerms } from "./search-utils";
import { getIssueById, getIssueByNumber, getIssueLabels } from "../repositories/issues";
import { NotFoundError } from "../../domain/errors";
import { toIssueDto } from "./dto";

// ---------------------------------------------------------------------------
// Index maintenance (driven by domain mutations)
// ---------------------------------------------------------------------------

export async function indexIssue(ctx: Ctx, issue: IssueRecord, labels?: string[]): Promise<void> {
  const labelNames = labels ?? (await getIssueLabels(ctx.env.DB, issue.id));
  await searchRepo.upsertSearchDoc(ctx.env.DB, {
    entityType: "issue",
    entityId: `issue:${issue.id}`,
    issueId: issue.id,
    issueType: issue.type,
    title: `#${issue.number} ${issue.title}`,
    content: issue.body,
    labels: labelNames.join(" "),
    attachmentMeta: "",
  });
}

export async function indexComment(ctx: Ctx, comment: CommentRecord, issue: IssueRecord): Promise<void> {
  await searchRepo.upsertSearchDoc(ctx.env.DB, {
    entityType: "comment",
    entityId: `comment:${comment.id}`,
    issueId: issue.id,
    issueType: issue.type,
    title: `Comment on #${issue.number} ${issue.title}`,
    content: comment.body,
    labels: "",
    attachmentMeta: "",
  });
}

export async function indexAttachment(ctx: Ctx, attachment: AttachmentRecord): Promise<void> {
  await searchRepo.upsertSearchDoc(ctx.env.DB, {
    entityType: "attachment",
    entityId: `attachment:${attachment.id}`,
    issueId: attachment.owner_type === "issue" ? attachment.owner_id : "",
    issueType: "task",
    title: `Attachment ${attachment.filename}`,
    content: "",
    labels: "",
    attachmentMeta: `${attachment.filename} ${attachment.content_type}`,
  });
}

export async function deleteIndexEntry(ctx: Ctx, entityId: string): Promise<void> {
  await searchRepo.deleteSearchDoc(ctx.env.DB, entityId);
}

/**
 * Idempotent full rebuild of the search index from domain tables.
 * Safe to run at any time (used for recovery).
 */
export async function rebuildSearchIndex(ctx: Ctx): Promise<{ issues: number; comments: number; attachments: number }> {
  await searchRepo.clearSearchDocs(ctx.env.DB);

  const issues = await ctx.env.DB.prepare(
    "SELECT id, number, type, title, body, status, priority, start_date, due_date, scheduled_date, timezone, recurrence_rule, parent_id, created_by, created_at, updated_at, closed_at, completed_at FROM issues",
  ).all<Record<string, unknown>>();
  const issueRecords = issues.results.map((row) => ({
    id: String(row.id),
    number: Number(row.number),
    type: String(row.type) as IssueRecord["type"],
    title: String(row.title),
    body: String(row.body),
    status: String(row.status) as IssueRecord["status"],
    priority: row.priority as IssueRecord["priority"],
    start_date: (row.start_date as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    scheduled_date: (row.scheduled_date as string | null) ?? null,
    timezone: String(row.timezone),
    recurrence_rule: (row.recurrence_rule as string | null) ?? null,
    parent_id: (row.parent_id as string | null) ?? null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    closed_at: (row.closed_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
  }));

  const labelRes = await ctx.env.DB.prepare(
    "SELECT il.issue_id, l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id",
  ).all<{ issue_id: string; name: string }>();
  const labelsByIssue = new Map<string, string[]>();
  for (const row of labelRes.results) {
    const list = labelsByIssue.get(row.issue_id) ?? [];
    list.push(row.name);
    labelsByIssue.set(row.issue_id, list);
  }

  for (const issue of issueRecords) {
    await indexIssue(ctx, issue, labelsByIssue.get(issue.id) ?? []);
  }

  const comments = await ctx.env.DB.prepare("SELECT * FROM comments").all<Record<string, unknown>>();
  const issueById = new Map(issueRecords.map((i) => [i.id, i]));
  for (const row of comments.results) {
    const issue = issueById.get(String(row.issue_id));
    if (!issue) continue;
    await indexComment(
      ctx,
      {
        id: String(row.id),
        issue_id: String(row.issue_id),
        body: String(row.body),
        author: String(row.author),
        author_type: String(row.author_type) as CommentRecord["author_type"],
        edited_at: (row.edited_at as string | null) ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      },
      issue,
    );
  }

  const attachments = await ctx.env.DB.prepare(
    "SELECT id, owner_type, owner_id, filename, content_type, size, checksum, r2_key, status, uploaded_by, created_at, deleted_at FROM attachments WHERE status = 'active'",
  ).all<Record<string, unknown>>();
  for (const row of attachments.results) {
    await indexAttachment(ctx, {
      id: String(row.id),
      owner_type: String(row.owner_type) as AttachmentRecord["owner_type"],
      owner_id: String(row.owner_id),
      filename: String(row.filename),
      content_type: String(row.content_type),
      size: Number(row.size),
      checksum: String(row.checksum),
      r2_key: String(row.r2_key),
      status: "active",
      uploaded_by: String(row.uploaded_by),
      created_at: String(row.created_at),
      deleted_at: null,
    });
  }

  await searchRepo.setSearchRebuiltAt(ctx.env.DB, new Date().toISOString());
  return { issues: issueRecords.length, comments: comments.results.length, attachments: attachments.results.length };
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

export interface SearchFilters {
  type?: string;
  status?: string;
  label?: string;
  limit?: number;
}

export async function searchIssues(ctx: Ctx, rawQuery: string, filters: SearchFilters = {}): Promise<SearchResultDto[]> {
  if (!hasSearchableTerms(rawQuery)) return [];
  const query = escapeFtsQuery(rawQuery);
  const limit = Math.min(filters.limit ?? SEARCH_RESULT_LIMIT, 100);
  const rows = await searchRepo.searchDocs(ctx.env.DB, query, {
    issueType: filters.type,
    issueStatus: filters.status,
    label: filters.label,
    limit,
  });

  const results: SearchResultDto[] = [];
  for (const row of rows) {
    const issue = await getIssueById(ctx.env.DB, row.issue_id);
    if (!issue) continue;
    const labels = await getIssueLabels(ctx.env.DB, issue.id);
    results.push({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      issue_id: row.issue_id,
      issue_number: issue.number,
      issue_type: issue.type,
      issue_title: issue.title,
      issue_status: issue.status,
      issue_labels: labels,
      matched_field: row.entity_type,
      snippet: cleanSnippet(row.snippet),
      score: row.score,
    });
  }
  return results;
}

/**
 * PRD `search_knowledge` semantics: prioritize wiki, decision, finding,
 * incident, and learning types (knowledge types come first in the result set).
 */
export async function searchKnowledge(ctx: Ctx, rawQuery: string, filters: SearchFilters = {}): Promise<SearchResultDto[]> {
  const knowledgeTypes = ["wiki", "decision", "finding", "incident", "learning"];
  const results = await searchIssues(ctx, rawQuery, { ...filters, limit: Math.min(filters.limit ?? SEARCH_RESULT_LIMIT, 100) });
  const knowledge = results.filter((r) => knowledgeTypes.includes(r.issue_type));
  const rest = results.filter((r) => !knowledgeTypes.includes(r.issue_type));
  return [...knowledge, ...rest];
}

/** Load a single issue DTO by number (used by MCP get_issue). */
export async function getIssueByNumberOrThrow(ctx: Ctx, number: number): Promise<IssueDto> {
  const issue = await getIssueByNumber(ctx.env.DB, number);
  if (!issue) throw new NotFoundError(`Issue #${number} not found`);
  return toIssueDto(ctx, issue);
}
