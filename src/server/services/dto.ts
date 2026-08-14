/** Issue DTO assembly (labels, counts, parent number) with batched queries. */
import type { Ctx } from "../ctx";
import type { IssueRecord } from "../../domain/models";
import type { IssueDto } from "../../shared/contracts/issues";
import { getChildCounts, getIssueById, getLabelsForIssues, getNumbersByIds } from "../repositories/issues";
import { getBacklinkCounts } from "../repositories/graph";

export async function toIssueDto(ctx: Ctx, issue: IssueRecord, labels?: string[]): Promise<IssueDto> {
  const [labelNames, childCounts, backlinkCounts, numbers] = await Promise.all([
    labels ? Promise.resolve(labels) : getLabelsForIssues(ctx.env.DB, [issue.id]).then((m) => m.get(issue.id) ?? []),
    getChildCounts(ctx.env.DB, [issue.id]),
    getBacklinkCounts(ctx.env.DB, [issue.id]),
    issue.parent_id ? getNumbersByIds(ctx.env.DB, [issue.parent_id]) : Promise.resolve(new Map<string, number>()),
  ]);
  return toIssueDtoWith(issue, labelNames, childCounts.get(issue.id) ?? 0, backlinkCounts.get(issue.id) ?? 0, numbers.get(issue.parent_id ?? "") ?? null);
}

/** Batch DTO assembly for a list of issues (single round of label/count queries). */
export async function toIssueDtos(ctx: Ctx, issues: IssueRecord[]): Promise<IssueDto[]> {
  if (issues.length === 0) return [];
  const ids = issues.map((i) => i.id);
  const [labelsByIssue, childCounts, backlinkCounts, numbers] = await Promise.all([
    getLabelsForIssues(ctx.env.DB, ids),
    getChildCounts(ctx.env.DB, ids),
    getBacklinkCounts(ctx.env.DB, ids),
    getNumbersByIds(
      ctx.env.DB,
      issues.map((i) => i.parent_id).filter((p): p is string => p !== null),
    ),
  ]);
  return issues.map((issue) =>
    toIssueDtoWith(
      issue,
      labelsByIssue.get(issue.id) ?? [],
      childCounts.get(issue.id) ?? 0,
      backlinkCounts.get(issue.id) ?? 0,
      issue.parent_id ? (numbers.get(issue.parent_id) ?? null) : null,
    ),
  );
}

function toIssueDtoWith(
  issue: IssueRecord,
  labels: string[],
  childCount: number,
  backlinkCount: number,
  parentNumber: number | null,
): IssueDto {
  return {
    id: issue.id,
    number: issue.number,
    type: issue.type,
    title: issue.title,
    body: issue.body,
    status: issue.status,
    priority: issue.priority,
    labels,
    start_date: issue.start_date,
    due_date: issue.due_date,
    scheduled_date: issue.scheduled_date,
    timezone: issue.timezone,
    recurrence_rule: issue.recurrence_rule,
    parent_id: issue.parent_id,
    parent_number: parentNumber,
    created_by: issue.created_by,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    version: issue.version,
    closed_at: issue.closed_at,
    completed_at: issue.completed_at,
    child_count: childCount,
    backlink_count: backlinkCount,
  };
}

export { getIssueById };
