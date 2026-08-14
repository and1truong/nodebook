/** Issue lifecycle: create, update, close/reopen, complete, planning fields. */
import type { Ctx } from "../ctx";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "../../domain/errors";
import type { IssueRecord } from "../../domain/models";
import type { IssueDto, IssueListResult } from "../../shared/contracts/issues";
import { BODY_MAX_LENGTH, ISSUE_TYPES, TITLE_MAX_LENGTH } from "../../shared/limits";
import { parseRecurrenceRule, nextOccurrence, type RecurrenceRule } from "../../shared/recurrence";
import { isValidTimezone, nowIso, parseCivilDate, civilDateString, instantFromCivil } from "../../shared/time";
import { recordAudit, listAuditForEntity } from "./audit-service";
import { refreshIssueReferences, resolveReferencesForNewIssue } from "./reference-service";
import { indexIssue, deleteIndexEntry } from "./search-service";
import { toIssueDto, toIssueDtos } from "./dto";
import { validateParentChange } from "./graph-service";
import * as issueRepo from "../repositories/issues";
import * as graphRepo from "../repositories/graph";
import { recalculateBeforeDueRemindersForIssue } from "./reminder-service";

export interface IssueCreateInput {
  type: string;
  title: string;
  body?: string;
  priority?: string | null;
  labels?: string[];
  start_date?: string | null;
  due_date?: string | null;
  scheduled_date?: string | null;
  timezone?: string;
  recurrence_rule?: string | null;
  parent_id?: string | null;
}

export interface IssueUpdateInput {
  expected_version: number;
  type?: string;
  title?: string;
  body?: string;
  priority?: string | null;
  labels?: string[];
  start_date?: string | null;
  due_date?: string | null;
  scheduled_date?: string | null;
  timezone?: string;
  recurrence_rule?: string | null;
  parent_id?: string | null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createIssue(ctx: Ctx, input: IssueCreateInput): Promise<IssueDto> {
  const now = nowIso();
  const type = validateType(input.type);
  const title = validateTitle(input.title);
  const body = validateBody(input.body ?? "");
  const timezone = validateTimezone(input.timezone ?? "UTC");
  const priority = validatePriority(input.priority ?? null);
  const startDate = validateCivilDate(input.start_date ?? null, "start_date");
  const dueDate = validateCivilDate(input.due_date ?? null, "due_date");
  const scheduledDate = validateInstant(input.scheduled_date ?? null, "scheduled_date");
  const recurrenceRule = validateRecurrence(input.recurrence_rule ?? null, timezone);
  const parentId = input.parent_id ?? null;

  if (parentId) {
    const parent = await issueRepo.getIssueById(ctx.env.DB, parentId);
    if (!parent) throw new NotFoundError("Parent issue not found");
  }

  const id = crypto.randomUUID();
  const number = await issueRepo.allocateIssueNumber(ctx.env.DB);

  const record: IssueRecord = {
    id,
    number,
    type,
    title,
    body,
    status: "open",
    priority,
    start_date: startDate,
    due_date: dueDate,
    scheduled_date: scheduledDate,
    timezone,
    recurrence_rule: recurrenceRule,
    parent_id: parentId,
    created_by: actorId(ctx),
    created_at: now,
    updated_at: now,
    version: 1,
    closed_at: null,
    completed_at: null,
  };
  await issueRepo.insertIssue(ctx.env.DB, {
    id,
    number,
    type,
    title,
    body,
    timezone,
    createdBy: actorId(ctx),
    now,
  }, {
    priority,
    start_date: startDate,
    due_date: dueDate,
    scheduled_date: scheduledDate,
    recurrence_rule: recurrenceRule,
    parent_id: parentId,
  });

  const labelNames = input.labels && input.labels.length > 0 ? await issueRepo.setIssueLabels(ctx.env.DB, id, input.labels) : [];
  await refreshIssueReferences(ctx, id, body, number);
  await resolveReferencesForNewIssue(ctx, id, number);
  await indexIssue(ctx, record);

  await recordAudit(ctx, {
    action: "issue.create",
    entityType: "issue",
    entityId: id,
    after: {
      number,
      type,
      title,
      priority,
      labels: labelNames,
      start_date: startDate,
      due_date: dueDate,
      scheduled_date: scheduledDate,
      recurrence_rule: recurrenceRule,
      parent_id: parentId,
    },
  });

  return toIssueDto(ctx, await issueRepo.getIssueById(ctx.env.DB, id) ?? record, labelNames);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getIssue(ctx: Ctx, ref: string): Promise<IssueDto> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  return toIssueDto(ctx, issue);
}

export interface ListIssuesFilters {
  type?: string;
  status?: string;
  label?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listIssues(ctx: Ctx, filters: ListIssuesFilters = {}): Promise<IssueListResult> {
  const issues = await issueRepo.listIssues(ctx.env.DB, filters);
  const total = await issueRepo.countIssues(ctx.env.DB, filters);
  return { issues: await toIssueDtos(ctx, issues), total };
}

export async function getIssueHistory(ctx: Ctx, ref: string): Promise<unknown[]> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  const comments = await issueRepo.listCommentsByIssue(ctx.env.DB, issue.id);
  const commentIds = comments.map((c) => c.id);
  const [issueEvents, ...commentEventLists] = await Promise.all([
    listAuditForEntity(ctx, "issue", issue.id),
    ...commentIds.map((id) => listAuditForEntity(ctx, "comment", id)),
  ]);
  const all = [issueEvents, ...commentEventLists].flat();
  all.sort((a, b) => {
    const aTime = (a as { created_at: string }).created_at;
    const bTime = (b as { created_at: string }).created_at;
    return aTime < bTime ? 1 : aTime > bTime ? -1 : 0;
  });
  return all;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateIssue(ctx: Ctx, ref: string, input: IssueUpdateInput): Promise<IssueDto> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  const before = snapshot(issue);

  const fields: issueRepo.IssueUpdateFields = {};
  if (input.type !== undefined) fields.type = validateType(input.type);
  if (input.title !== undefined) fields.title = validateTitle(input.title);
  if (input.body !== undefined) fields.body = validateBody(input.body);
  if (input.priority !== undefined) fields.priority = validatePriority(input.priority);
  if (input.start_date !== undefined) fields.start_date = validateCivilDate(input.start_date, "start_date");
  if (input.due_date !== undefined) fields.due_date = validateCivilDate(input.due_date, "due_date");
  if (input.scheduled_date !== undefined) fields.scheduled_date = validateInstant(input.scheduled_date, "scheduled_date");
  if (input.timezone !== undefined) {
    const tz = validateTimezone(input.timezone);
    fields.timezone = tz;
    if (fields.recurrence_rule === undefined && issue.recurrence_rule) {
      fields.recurrence_rule = issue.recurrence_rule; // keep rule, revalidated under new tz below
    }
  }
  if (input.recurrence_rule !== undefined) {
    fields.recurrence_rule = validateRecurrence(input.recurrence_rule, input.timezone ?? issue.timezone);
  }
  if (input.parent_id !== undefined) {
    await validateParentChange(ctx, issue.id, input.parent_id);
    fields.parent_id = input.parent_id;
  }

  const now = nowIso();
  const nextVersion = await issueRepo.updateIssue(ctx.env.DB, issue.id, fields, now, input.expected_version);
  if (nextVersion === null) {
    const current = await issueRepo.getIssueById(ctx.env.DB, issue.id);
    if (!current) throw new NotFoundError("Issue not found");
    throw new VersionConflictError(input.expected_version, current.version);
  }

  if (input.labels !== undefined) {
    await issueRepo.setIssueLabels(ctx.env.DB, issue.id, input.labels);
  }

  if (input.body !== undefined) {
    await refreshIssueReferences(ctx, issue.id, input.body, issue.number);
  }

  if (input.parent_id !== undefined && input.parent_id !== issue.parent_id) {
    await recordAudit(ctx, {
      action: "issue.set_parent",
      entityType: "issue",
      entityId: issue.id,
      before: { parent_id: issue.parent_id },
      after: { parent_id: input.parent_id },
    });
  }

  const updated = await issueRepo.getIssueById(ctx.env.DB, issue.id);
  if (!updated) throw new NotFoundError("Issue not found");

  await indexIssue(ctx, updated, input.labels !== undefined ? input.labels : undefined);

  // Due date changed → recalculate before-due reminders.
  if (fields.due_date !== undefined) {
    await recalculateBeforeDueRemindersForIssue(ctx, updated);
  }

  await recordAudit(ctx, {
    action: "issue.update",
    entityType: "issue",
    entityId: issue.id,
    before: before,
    after: snapshot(updated),
  });

  return toIssueDto(ctx, updated);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export async function closeIssue(ctx: Ctx, ref: string): Promise<IssueDto> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  if (issue.status === "closed") throw new ConflictError("Issue is already closed");

  const now = nowIso();
  await issueRepo.updateIssue(ctx.env.DB, issue.id, { status: "closed", closed_at: now, completed_at: now }, now);
  const updated = await issueRepo.getIssueById(ctx.env.DB, issue.id);
  if (!updated) throw new NotFoundError("Issue not found");
  await indexIssue(ctx, updated);
  await recordAudit(ctx, {
    action: "issue.close",
    entityType: "issue",
    entityId: issue.id,
    before: { status: "open" },
    after: { status: "closed", closed_at: now },
  });
  return toIssueDto(ctx, updated);
}

export async function reopenIssue(ctx: Ctx, ref: string): Promise<IssueDto> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  if (issue.status === "open") throw new ConflictError("Issue is already open");

  const now = nowIso();
  await issueRepo.updateIssue(ctx.env.DB, issue.id, { status: "open", closed_at: null, completed_at: null }, now);
  const updated = await issueRepo.getIssueById(ctx.env.DB, issue.id);
  if (!updated) throw new NotFoundError("Issue not found");
  await indexIssue(ctx, updated);
  await recordAudit(ctx, {
    action: "issue.reopen",
    entityType: "issue",
    entityId: issue.id,
    before: { status: "closed" },
    after: { status: "open" },
  });
  return toIssueDto(ctx, updated);
}

/**
 * Complete a task. Recurring tasks record an occurrence and advance the
 * planning dates (start/due/scheduled) atomically, staying open; non-recurring
 * tasks close normally.
 */
export async function completeTask(ctx: Ctx, ref: string): Promise<IssueDto> {
  const issue = await issueRepo.getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  if (issue.status === "closed") throw new ConflictError("Issue is already closed");

  const now = nowIso();
  const before = snapshot(issue);

  if (issue.recurrence_rule) {
    const rule = parseRecurrenceRule(issue.recurrence_rule);
    const next = await advanceRecurringIssue(ctx, issue, rule, now);
    const updated = await issueRepo.getIssueById(ctx.env.DB, issue.id);
    if (!updated) throw new NotFoundError("Issue not found");
    await indexIssue(ctx, updated);
    await recordAudit(ctx, {
      action: "task.complete_recurring",
      entityType: "issue",
      entityId: issue.id,
      before,
      after: {
        ...snapshot(updated),
        next_occurrence: next,
      },
    });
    return toIssueDto(ctx, updated);
  }

  await issueRepo.updateIssue(ctx.env.DB, issue.id, { status: "closed", closed_at: now, completed_at: now }, now);
  const updated = await issueRepo.getIssueById(ctx.env.DB, issue.id);
  if (!updated) throw new NotFoundError("Issue not found");
  await indexIssue(ctx, updated);
  await recordAudit(ctx, {
    action: "task.complete",
    entityType: "issue",
    entityId: issue.id,
    before,
    after: { status: "closed", closed_at: now, completed_at: now },
  });
  return toIssueDto(ctx, updated);
}

async function advanceRecurringIssue(ctx: Ctx, issue: IssueRecord, rule: RecurrenceRule, now: string): Promise<string | null> {
  const tz = issue.timezone;

  // Anchor: the most recent planned instant (due end-of-day, scheduled, or now).
  const anchor = recurrenceAnchor(issue, tz);
  // The next occurrence advances from the last planned occurrence (the one
  // being completed), not from "now" — so early or late completion still rolls
  // the series forward by exactly one interval. Completed occurrences are
  // counted so COUNT-terminated series close when exhausted.
  const completed = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM occurrences WHERE issue_id = ?")
    .bind(issue.id)
    .first<{ n: number }>();
  const initialOrdinal = Number(completed?.n ?? 0) + 1;
  const next = nextOccurrence(rule, tz, anchor, anchor, initialOrdinal);

  // Record the completion occurrence (idempotent per instant).
  await ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO occurrences (id, issue_id, occurred_on, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), issue.id, now, now)
    .run();
  if (!next) {
    // Series exhausted: close the task.
    await issueRepo.updateIssue(ctx.env.DB, issue.id, { status: "closed", closed_at: now, completed_at: now }, now);
    return null;
  }

  const fields: issueRepo.IssueUpdateFields = { completed_at: now };
  // Planning fields advance atomically to the next occurrence. start_date is
  // aligned with the next cycle (never the completion instant) so start > due
  // cannot be rendered even when completion runs late.
  if (issue.start_date) {
    fields.start_date = civilDateString(next, tz);
  }
  if (issue.due_date) {
    fields.due_date = civilDateString(next, tz);
  }
  if (issue.scheduled_date) {
    fields.scheduled_date = next.toISOString();
  }
  if (!issue.start_date && !issue.due_date && !issue.scheduled_date) {
    // A dateless recurring task still rolls forward: the next occurrence is
    // scheduled so the task surfaces in Today/Upcoming on its cycle day.
    fields.scheduled_date = next.toISOString();
  }
  await issueRepo.updateIssue(ctx.env.DB, issue.id, fields, now);
  return next.toISOString();
}

function recurrenceAnchor(issue: IssueRecord, tz: string): Date {
  if (issue.due_date) {
    const civil = parseCivilDate(issue.due_date);
    if (civil) return instantFromCivil(tz, { ...civil, hour: 23, minute: 59, second: 59 });
  }
  if (issue.scheduled_date) return new Date(issue.scheduled_date);
  if (issue.start_date) {
    const civil = parseCivilDate(issue.start_date);
    if (civil) return instantFromCivil(tz, civil);
  }
  return new Date();
}

// ---------------------------------------------------------------------------
// Validation helpers (shared with HTTP and MCP)
// ---------------------------------------------------------------------------

export function validateType(type: string): IssueRecord["type"] {
  if (!ISSUE_TYPES.includes(type as IssueRecord["type"])) {
    throw new ValidationError(`Unknown issue type: ${type}`);
  }
  return type as IssueRecord["type"];
}

export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ValidationError("Title must not be empty");
  if (trimmed.length > TITLE_MAX_LENGTH) throw new ValidationError(`Title is too long (max ${TITLE_MAX_LENGTH} characters)`);
  return trimmed;
}

export function validateBody(body: string): string {
  if (body.length > BODY_MAX_LENGTH) throw new ValidationError(`Body is too long (max ${BODY_MAX_LENGTH} characters)`);
  return body;
}

export function validatePriority(priority: string | null | undefined): IssueRecord["priority"] {
  if (priority === null || priority === undefined || priority === "") return null;
  if (!["low", "medium", "high", "urgent"].includes(priority)) {
    throw new ValidationError(`Unknown priority: ${priority}`);
  }
  return priority as IssueRecord["priority"];
}

export function validateCivilDate(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!parseCivilDate(value)) throw new ValidationError(`${field} must be a YYYY-MM-DD date`);
  return value;
}

export function validateInstant(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be an ISO 8601 instant`);
  return d.toISOString();
}

export function validateTimezone(timezone: string): string {
  if (!isValidTimezone(timezone)) throw new ValidationError(`Invalid timezone: ${timezone}`);
  return timezone;
}

export function validateRecurrence(rule: string | null | undefined, timezone: string): string | null {
  if (rule === null || rule === undefined || rule === "") return null;
  parseRecurrenceRule(rule); // throws ValidationError on unsupported rules
  validateTimezone(timezone);
  return rule;
}

function snapshot(issue: IssueRecord): Record<string, unknown> {
  return {
    type: issue.type,
    title: issue.title,
    body: issue.body,
    status: issue.status,
    priority: issue.priority,
    start_date: issue.start_date,
    due_date: issue.due_date,
    scheduled_date: issue.scheduled_date,
    timezone: issue.timezone,
    recurrence_rule: issue.recurrence_rule,
    parent_id: issue.parent_id,
  };
}

export function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}

export { issueRepo, graphRepo, deleteIndexEntry };
