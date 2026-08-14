/** The NodeBook MCP tools. Every mutation goes through the shared services,
 * producing the same audit records as browser actions. */
import { defineTool } from "./tool-auth";
import type { ToolContext } from "./tool-auth";
import { toCtx } from "./tool-auth";
import { assertScope } from "../server/auth/permissions";
import type { McpScope } from "../shared/limits";
import {
  addChildSchema,
  addCommentSchema,
  attachFileSchema,
  closeIssueSchema,
  completeTaskSchema,
  createIssueSchema,
  createReminderSchema,
  getBacklinksSchema,
  getChildrenSchema,
  getIssueSchema,
  getTodaySchema,
  getUpcomingSchema,
  linkIssuesSchema,
  listAttachmentsSchema,
  searchIssuesSchema,
  updateIssueSchema,
  updateReminderSchema,
} from "./schemas";
import * as issueService from "../server/services/issue-service";
import * as commentService from "../server/services/comment-service";
import * as graphService from "../server/services/graph-service";
import * as searchService from "../server/services/search-service";
import * as planningService from "../server/services/planning-service";
import * as reminderService from "../server/services/reminder-service";
import * as attachmentService from "../server/services/attachment-service";
import { mcpUploadLimitBytes } from "../env";
import { PayloadTooLargeError } from "../domain/errors";

function withScope<TArgs>(scope: McpScope, fn: (ctx: ToolContext, args: TArgs) => Promise<unknown>) {
  return (ctx: ToolContext, args: TArgs): Promise<unknown> => {
    assertScope(ctx.identity.scopes, scope);
    return fn(ctx, args);
  };
}

const requireIssueId = (id: string | number): string => String(id);

export const tools = [
  // ---------------------------------------------------------------- read tools
  defineTool({
    name: "get_issue",
    description: "Fetch an issue by its number or UUID, including labels and graph counts.",
    inputSchema: getIssueSchema,
    scope: "read:issue",
    handler: withScope("read:issue", async (ctx: ToolContext, args) => {
      const ref = "issue_id" in args ? requireIssueId(args.issue_id) : String(args.number);
      return issueService.getIssue(toCtx(ctx), ref);
    }),
  }),

  defineTool({
    name: "search_issues",
    description: "Full-text search over issue titles, bodies, comments, labels, and attachment metadata.",
    inputSchema: searchIssuesSchema,
    scope: "read:search",
    handler: withScope("read:search", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const results = await searchService.searchIssues(c, args.query, {
        type: args.type,
        status: args.status,
        label: args.label,
        limit: args.limit,
      });
      return { query: args.query, count: results.length, results };
    }),
  }),

  defineTool({
    name: "get_children",
    description: "List the child issues of an issue (hierarchy).",
    inputSchema: getChildrenSchema,
    scope: "read:graph",
    handler: withScope("read:graph", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return graphService.getChildrenDtos(c, issue.id);
    }),
  }),

  defineTool({
    name: "get_backlinks",
    description: "List incoming #-references (backlinks) to an issue.",
    inputSchema: getBacklinksSchema,
    scope: "read:graph",
    handler: withScope("read:graph", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return graphService.getBacklinkDtos(c, issue.id);
    }),
  }),

  defineTool({
    name: "search_knowledge",
    description: "Search prioritizing knowledge types: wiki, decision, finding, incident, learning.",
    inputSchema: searchIssuesSchema,
    scope: "read:search",
    handler: withScope("read:search", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const results = await searchService.searchKnowledge(c, args.query, {
        type: args.type,
        status: args.status,
        label: args.label,
        limit: args.limit,
      });
      return { query: args.query, count: results.length, results };
    }),
  }),

  defineTool({
    name: "get_today",
    description: "Open work due or scheduled in the owner's local day, plus overdue work.",
    inputSchema: getTodaySchema,
    scope: "read:planning",
    handler: withScope("read:planning", async (ctx: ToolContext, args) => {
      return planningService.getToday(toCtx(ctx), args.timezone);
    }),
  }),

  defineTool({
    name: "get_upcoming",
    description: "Open work scheduled or due after today.",
    inputSchema: getUpcomingSchema,
    scope: "read:planning",
    handler: withScope("read:planning", async (ctx: ToolContext, args) => {
      return planningService.getUpcoming(toCtx(ctx), args.timezone);
    }),
  }),

  defineTool({
    name: "list_attachments",
    description: "List attachments for an issue (uuid or number).",
    inputSchema: listAttachmentsSchema,
    scope: "read:attachment",
    handler: withScope("read:attachment", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return attachmentService.listAttachments(c, "issue", issue.id);
    }),
  }),

  // ------------------------------------------------------------- write tools
  defineTool({
    name: "create_issue",
    description: "Create a new issue (task, bug, epic, story, decision, finding, incident, learning, wiki, note).",
    inputSchema: createIssueSchema,
    scope: "write:issue",
    handler: withScope("write:issue", async (ctx: ToolContext, args) => {
      // Setting a parent mutates the graph: require the graph scope as well.
      if (args.parent_id !== undefined && args.parent_id !== null) {
        assertScope(ctx.identity.scopes, "write:graph");
      }
      return issueService.createIssue(toCtx(ctx), {
        type: args.type ?? "task",
        title: args.title,
        body: args.body ?? "",
        priority: args.priority ?? null,
        labels: args.labels ?? [],
        due_date: args.due_date ?? null,
        scheduled_date: args.scheduled_date ?? null,
        timezone: args.timezone ?? "UTC",
        recurrence_rule: args.recurrence_rule ?? null,
        parent_id: args.parent_id ?? null,
      });
    }),
  }),

  defineTool({
    name: "update_issue",
    description: "Update issue fields using optimistic locking. First read the issue, then pass its version as expected_version; refetch after a version conflict.",
    inputSchema: updateIssueSchema,
    scope: "write:issue",
    handler: withScope("write:issue", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      const { issue_id: _id, expected_version, ...rest } = args;
      // Changing the parent mutates the graph: require the graph scope as well.
      if ("parent_id" in rest && rest.parent_id !== undefined) {
        assertScope(ctx.identity.scopes, "write:graph");
      }
      return issueService.updateIssue(c, issue.id, {
        expected_version,
        type: rest.type,
        title: rest.title,
        body: rest.body,
        priority: rest.priority,
        labels: rest.labels,
        due_date: rest.due_date,
        scheduled_date: rest.scheduled_date,
        timezone: rest.timezone,
        recurrence_rule: rest.recurrence_rule,
        parent_id: rest.parent_id,
      });
    }),
  }),

  defineTool({
    name: "close_issue",
    description: "Close an open issue.",
    inputSchema: closeIssueSchema,
    scope: "write:issue",
    handler: withScope("write:issue", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return issueService.closeIssue(c, issue.id);
    }),
  }),

  defineTool({
    name: "complete_task",
    description: "Complete a task. Recurring tasks record an occurrence and advance planning dates; others close.",
    inputSchema: completeTaskSchema,
    scope: "write:issue",
    handler: withScope("write:issue", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return issueService.completeTask(c, issue.id);
    }),
  }),

  defineTool({
    name: "add_comment",
    description: "Add a Markdown comment to an issue.",
    inputSchema: addCommentSchema,
    scope: "write:comment",
    handler: withScope("write:comment", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return commentService.addComment(c, issue.id, args.body);
    }),
  }),

  defineTool({
    name: "add_child",
    description: "Create a child issue under a parent identified by issue number or UUID (hierarchy).",
    inputSchema: addChildSchema,
    scope: "write:graph",
    handler: withScope("write:graph", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const parent = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.parent_id));
      return issueService.createIssue(c, {
        type: args.type ?? "task",
        title: args.title,
        body: args.body ?? "",
        parent_id: parent.id,
      });
    }),
  }),

  defineTool({
    name: "link_issues",
    description: "Create a typed relationship: related, depends_on, blocks, supersedes, duplicates.",
    inputSchema: linkIssuesSchema,
    scope: "write:graph",
    handler: withScope("write:graph", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const source = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.source_id));
      const target = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.target_id));
      return graphService.addRelationship(c, source.id, target.id, args.type);
    }),
  }),

  defineTool({
    name: "create_reminder",
    description: "Create an absolute, before-due, or recurring reminder on an issue.",
    inputSchema: createReminderSchema,
    scope: "write:reminder",
    handler: withScope("write:reminder", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      return reminderService.createReminder(c, issue.id, {
        kind: args.kind,
        triggerAt: args.kind === "absolute" ? args.trigger_at : undefined,
        offsetMinutes: args.kind === "before_due" ? args.offset_minutes : undefined,
        recurrenceRule: args.kind === "recurring" ? args.recurrence_rule : undefined,
        timezone: args.timezone,
      });
    }),
  }),

  defineTool({
    name: "update_reminder",
    description: "Snooze, dismiss, reactivate, or reschedule a reminder.",
    inputSchema: updateReminderSchema,
    scope: "write:reminder",
    handler: withScope("write:reminder", async (ctx: ToolContext, args) => {
      return reminderService.updateReminder(toCtx(ctx), args.reminder_id, {
        status: args.status,
        snooze_until: args.snooze_until,
        trigger_at: args.trigger_at,
      });
    }),
  }),

  defineTool({
    name: "attach_file",
    description: "Attach a base64 file to an issue identified by number or UUID. Size limited to 5 MB for MCP uploads.",
    inputSchema: attachFileSchema,
    scope: "write:attachment",
    handler: withScope("write:attachment", async (ctx: ToolContext, args) => {
      const c = toCtx(ctx);
      const issue = await graphService.getIssueByRefOrThrow(c, requireIssueId(args.issue_id));
      const maxBytes = mcpUploadLimitBytes(ctx.env);
      if (estimatedBase64DecodedSize(args.data) > maxBytes) {
        throw new PayloadTooLargeError(
          `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB MCP upload limit`,
        );
      }
      const bytes = base64ToBytes(args.data);
      return attachmentService.uploadAttachment(c, {
        ownerType: "issue",
        ownerId: issue.id,
        filename: args.filename,
        contentType: args.content_type ?? "application/octet-stream",
        bytes,
        maxBytes,
      });
    }),
  }),
];

export type ToolName = (typeof tools)[number]["name"];

export function getToolByName(name: string) {
  return tools.find((t) => t.name === name);
}

function estimatedBase64DecodedSize(data: string): number {
  const compact = data.replace(/\s/g, "");
  const withoutPadding = compact.replace(/=+$/, "");
  return Math.floor((withoutPadding.length * 3) / 4);
}

export function base64ToBytes(data: string): ArrayBuffer {
  const b64 = data.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
