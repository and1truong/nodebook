import { z } from "zod";
import type { Ctx } from "../ctx";
import type { ChatActionDto, ChatActionType } from "../../shared/contracts/chat";
import { CHAT_ACTION_TYPES } from "../../shared/contracts/chat";
import {
  issueCreateSchema, issueUpdateSchema, reminderCreateSchema, reminderUpdateSchema,
  issueViewCreateSchema, issueViewUpdateSchema,
} from "../../shared/contracts/issues";
import { RELATIONSHIP_TYPES, type RelationshipType } from "../../shared/limits";
import { ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import * as issueService from "./issue-service";
import * as commentService from "./comment-service";
import * as graphService from "./graph-service";
import * as reminderService from "./reminder-service";
import * as issueViewService from "./issue-view-service";
import * as store from "./chat-store";

const refSchema = z.union([z.string().trim().min(1).max(40), z.number().int().positive()]).transform((value) => String(value).replace(/^#/, ""));
const objectSchema = z.record(z.unknown());

export async function prepareAction(ctx: Ctx, actionType: ChatActionType, raw: Record<string, unknown>): Promise<{ payload: Record<string, unknown>; review: Record<string, unknown> }> {
  if (!CHAT_ACTION_TYPES.includes(actionType)) throw new ValidationError("Unsupported chat action");
  switch (actionType) {
    case "issue.create": {
      const parentRef = raw.parent_ref === undefined || raw.parent_ref === null ? null : refSchema.parse(raw.parent_ref);
      const parent = parentRef ? await issueService.getIssue(ctx, parentRef) : null;
      const input = issueCreateSchema.parse({ ...raw, parent_id: parent?.id ?? raw.parent_id });
      if (input.parent_id) await issueService.getIssue(ctx, input.parent_id);
      return { payload: input, review: { operation: "Create issue", after: input } };
    }
    case "issue.edit": {
      const issue = await issueService.getIssue(ctx, refSchema.parse(raw.issue_ref));
      const changes = objectSchema.parse(raw.changes ?? {});
      const input = issueUpdateSchema.parse({ ...changes, expected_version: issue.version });
      if (input.parent_id !== undefined) await graphService.validateParentChange(ctx, issue.id, input.parent_id);
      return { payload: { issue_ref: String(issue.number), ...input }, review: { operation: `Edit #${issue.number}`, before: pick(issue as unknown as Record<string, unknown>, Object.keys(changes)), after: changes } };
    }
    case "issue.complete": case "issue.close": case "issue.reopen": {
      const issue = await issueService.getIssue(ctx, refSchema.parse(raw.issue_ref));
      return { payload: { issue_ref: String(issue.number) }, review: { operation: `${actionType.split(".")[1]} #${issue.number}`, before: { status: issue.status }, after: { status: actionType === "issue.reopen" ? "open" : "closed" } } };
    }
    case "comment.add": {
      const issue = await issueService.getIssue(ctx, refSchema.parse(raw.issue_ref));
      const body = z.string().trim().min(1).max(50_000).parse(raw.body);
      return { payload: { issue_ref: String(issue.number), body }, review: { operation: `Add comment to #${issue.number}`, after: { body } } };
    }
    case "comment.edit": {
      const commentId = z.string().uuid().parse(raw.comment_id); const comment = await commentService.getComment(ctx, commentId);
      const body = z.string().trim().min(1).max(50_000).parse(raw.body);
      return { payload: { comment_id: commentId, body }, review: { operation: `Edit comment on #${comment.issue_number}`, before: { body: comment.body }, after: { body } } };
    }
    case "parent.set": {
      const issue = await issueService.getIssue(ctx, refSchema.parse(raw.issue_ref));
      const parent = raw.parent_ref == null ? null : await issueService.getIssue(ctx, refSchema.parse(raw.parent_ref));
      await graphService.validateParentChange(ctx, issue.id, parent?.id ?? null);
      return { payload: { issue_id: issue.id, parent_id: parent?.id ?? null }, review: { operation: `Set parent of #${issue.number}`, before: { parent_number: issue.parent_number }, after: { parent_number: parent?.number ?? null } } };
    }
    case "relationship.add": {
      const source = await issueService.getIssue(ctx, refSchema.parse(raw.source_ref));
      const target = await issueService.getIssue(ctx, refSchema.parse(raw.target_ref));
      const type = z.enum(RELATIONSHIP_TYPES).parse(raw.type);
      const existing = await ctx.env.DB.prepare(`SELECT id FROM relationships WHERE type = ? AND
        ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)) LIMIT 1`)
        .bind(type, source.id, target.id, target.id, source.id).first();
      if (existing) throw new ConflictError("Relationship already exists");
      return { payload: { source_id: source.id, target_id: target.id, type }, review: { operation: "Add relationship", after: { source: `#${source.number}`, target: `#${target.number}`, type } } };
    }
    case "relationship.remove": {
      const id = z.string().uuid().parse(raw.relationship_id);
      const relation = await ctx.env.DB.prepare("SELECT * FROM relationships WHERE id = ?").bind(id).first<Record<string, unknown>>();
      if (!relation) throw new NotFoundError("Relationship not found");
      return { payload: { relationship_id: id }, review: { operation: "Remove relationship", before: relation } };
    }
    case "reminder.create": {
      const issue = await issueService.getIssue(ctx, refSchema.parse(raw.issue_ref));
      const reminder = reminderCreateSchema.parse(raw.reminder ?? raw);
      return { payload: { issue_ref: String(issue.number), reminder }, review: { operation: `Create reminder for #${issue.number}`, after: reminder } };
    }
    case "reminder.update": {
      const id = z.string().uuid().parse(raw.reminder_id); const before = await reminderService.getReminder(ctx, id);
      const changes = reminderUpdateSchema.parse(raw.changes ?? raw);
      return { payload: { reminder_id: id, changes }, review: { operation: "Update reminder", before, after: changes } };
    }
    case "saved_view.create": {
      const input = issueViewCreateSchema.parse(raw);
      if ((await issueViewService.listIssueViews(ctx)).some((view) => view.name.toLowerCase() === input.name.toLowerCase())) throw new ConflictError("An issue view with that name already exists");
      return { payload: input, review: { operation: "Create saved view", after: input } };
    }
    case "saved_view.update": {
      const id = z.string().uuid().parse(raw.view_id); const existing = (await issueViewService.listIssueViews(ctx)).find((view) => view.id === id);
      if (!existing) throw new NotFoundError("Issue view not found");
      const changes = issueViewUpdateSchema.parse(raw.changes ?? raw);
      if (changes.name && (await issueViewService.listIssueViews(ctx)).some((view) => view.id !== id && view.name.toLowerCase() === changes.name!.toLowerCase())) throw new ConflictError("An issue view with that name already exists");
      return { payload: { view_id: id, changes }, review: { operation: "Update saved view", before: existing, after: changes } };
    }
    case "saved_view.delete": {
      const id = z.string().uuid().parse(raw.view_id); const existing = (await issueViewService.listIssueViews(ctx)).find((view) => view.id === id);
      if (!existing) throw new NotFoundError("Issue view not found");
      return { payload: { view_id: id }, review: { operation: "Delete saved view", before: existing } };
    }
  }
}

export async function confirmAction(ctx: Ctx, id: string): Promise<ChatActionDto> {
  const current = await store.getAction(ctx, id);
  if (current.status === "succeeded" || current.status === "failed") return current;
  if (current.status === "rejected") throw new ConflictError("Rejected actions cannot be confirmed");
  const action = await store.claimAction(ctx, id);
  if (!action) return store.getAction(ctx, id);
  try {
    const result = await execute(ctx, action);
    return store.settleAction(ctx, id, "succeeded", result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return store.settleAction(ctx, id, "failed", undefined, message);
  }
}

async function execute(ctx: Ctx, action: ChatActionDto): Promise<unknown> {
  const payload = action.payload;
  switch (action.action_type) {
    case "issue.create": return issueService.createIssue(ctx, issueCreateSchema.parse(payload));
    case "issue.edit": { const { issue_ref, ...input } = payload; return issueService.updateIssue(ctx, String(issue_ref), issueUpdateSchema.parse(input)); }
    case "issue.complete": return issueService.completeTask(ctx, String(payload.issue_ref));
    case "issue.close": return issueService.closeIssue(ctx, String(payload.issue_ref));
    case "issue.reopen": return issueService.reopenIssue(ctx, String(payload.issue_ref));
    case "comment.add": return commentService.addComment(ctx, String(payload.issue_ref), String(payload.body));
    case "comment.edit": return commentService.updateComment(ctx, String(payload.comment_id), String(payload.body));
    case "parent.set": await graphService.setParent(ctx, String(payload.issue_id), payload.parent_id == null ? null : String(payload.parent_id)); return { ok: true };
    case "relationship.add": return graphService.addRelationship(ctx, String(payload.source_id), String(payload.target_id), payload.type as RelationshipType);
    case "relationship.remove": await graphService.removeRelationship(ctx, String(payload.relationship_id)); return { ok: true };
    case "reminder.create": { const input = reminderCreateSchema.parse(payload.reminder); return reminderService.createReminder(ctx, String(payload.issue_ref), { kind: input.kind, triggerAt: "trigger_at" in input ? input.trigger_at : undefined, offsetMinutes: "offset_minutes" in input ? input.offset_minutes : undefined, recurrenceRule: "recurrence_rule" in input ? input.recurrence_rule : undefined, timezone: "timezone" in input ? input.timezone : undefined }); }
    case "reminder.update": { const input = reminderUpdateSchema.parse(payload.changes); return reminderService.updateReminder(ctx, String(payload.reminder_id), input); }
    case "saved_view.create": return issueViewService.createIssueView(ctx, issueViewCreateSchema.parse(payload));
    case "saved_view.update": { const input = issueViewUpdateSchema.parse(payload.changes); return issueViewService.updateIssueView(ctx, String(payload.view_id), input); }
    case "saved_view.delete": await issueViewService.deleteIssueView(ctx, String(payload.view_id)); return { ok: true };
  }
}

function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
