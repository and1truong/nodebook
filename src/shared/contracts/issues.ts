/**
 * API contracts shared by the Worker HTTP routes, the MCP tools, and the
 * browser client. Inputs are validated with zod in one place so HTTP and MCP
 * mutations enforce identical rules.
 */
import { z } from "zod";
import {
  ISSUE_TYPES,
  MCP_SCOPES,
  PRIORITIES,
  RELATIONSHIP_TYPES,
  type ActorType,
  type AttachmentOwnerType,
  type AttachmentStatus,
  type IssueStatus,
  type IssueType,
  type Priority,
  type ReferenceSourceType,
  type RelationshipType,
  type ReminderKind,
  type ReminderStatus,
} from "../limits";
import { parseRecurrenceRule, type RecurrenceFreq } from "../recurrence";
import { isValidTimezone } from "../time";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const issueTypeSchema = z.enum(ISSUE_TYPES);
export const prioritySchema = z.enum(PRIORITIES).nullable().optional();
export const issueStatusSchema = z.enum(["open", "closed"]);

export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .nullable()
  .optional();

export const isoInstantSchema = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Must be an ISO date")
  .nullable()
  .optional();

export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, "Must be a valid IANA timezone");

export const labelNameSchema = z
  .string()
  .trim()
  .min(1, "Label must not be empty")
  .max(32, "Label is too long")
  .transform((s) => s.replace(/\s+/g, " "));

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title must not be empty")
  .max(500, "Title is too long");

export const bodySchema = z.string().max(100_000, "Body is too long").default("");

export const recurrenceRuleSchema = z
  .string()
  .max(500)
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || isSupportedRrule(v), {
    message: "Unsupported recurrence rule",
  });

function isSupportedRrule(value: string): boolean {
  // Lightweight pre-check for the client; the server does the full parse.
  return /^FREQ=(DAILY|WEEKLY|MONTHLY)(;|$)/.test(value);
}

export const issueCreateSchema = z.object({
  type: issueTypeSchema.default("task"),
  title: titleSchema,
  body: bodySchema,
  priority: prioritySchema,
  labels: z.array(labelNameSchema).max(20).default([]),
  start_date: civilDateSchema,
  due_date: civilDateSchema,
  scheduled_date: isoInstantSchema,
  timezone: timezoneSchema.default("UTC"),
  recurrence_rule: recurrenceRuleSchema,
  parent_id: z.string().uuid().nullable().optional(),
});

export const issueUpdateSchema = issueCreateSchema.partial().extend({
  // partial() keeps .default() semantics; make every field optional.
  type: issueTypeSchema.optional(),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  priority: prioritySchema,
  labels: z.array(labelNameSchema).max(20).optional(),
  start_date: civilDateSchema,
  due_date: civilDateSchema,
  scheduled_date: isoInstantSchema,
  timezone: timezoneSchema.optional(),
  recurrence_rule: recurrenceRuleSchema,
  parent_id: z.string().uuid().nullable().optional(),
});

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, "Comment must not be empty").max(50_000, "Comment is too long"),
});
export const commentUpdateSchema = commentCreateSchema;

export const relationshipCreateSchema = z.object({
  target_id: z.string().uuid("target_id must be a UUID"),
  type: z.enum(RELATIONSHIP_TYPES),
});

export const setParentSchema = z.object({
  parent_id: z.string().uuid().nullable(),
});

export const reminderCreateSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("absolute"),
      trigger_at: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid trigger_at"),
    }),
    z.object({
      kind: z.literal("before_due"),
      offset_minutes: z.number().int().min(1).max(60 * 24 * 30),
    }),
    z.object({
      kind: z.literal("recurring"),
      recurrence_rule: z.string().max(500),
      timezone: timezoneSchema,
    }),
  ])
  .superRefine((val, ctx) => {
    if (val.kind === "recurring") {
      try {
        validateRruleStrict(val.recurrence_rule);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
      }
    }
  });

function validateRruleStrict(value: string): void {
  parseRecurrenceRule(value);
}

export const reminderUpdateSchema = z
  .object({
    status: z.enum(["active", "completed", "dismissed", "snoozed"]).optional(),
    snooze_until: z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid snooze_until")
      .optional(),
    trigger_at: z
      .string()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid trigger_at")
      .optional(),
  })
  .refine((v) => v.status !== "snoozed" || v.snooze_until !== undefined, {
    message: "snooze_until is required when snoozing",
  });

export const searchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  type: z.enum(ISSUE_TYPES).optional(),
  status: z.enum(["open", "closed"]).optional(),
  label: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1, "At least one scope is required"),
  expires_in_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
});

export const attachmentUploadLimitsSchema = z.object({
  // Validated by the service against env-configured limits.
  size: z.number().int().positive(),
});

export const mcpAttachFileSchema = z.object({
  issue_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  content_type: z.string().max(255).optional(),
  data: z.string().min(1),
});

// ---------------------------------------------------------------------------
// DTOs (API output shapes)
// ---------------------------------------------------------------------------

export interface IssueDto {
  id: string;
  number: number;
  type: IssueType;
  title: string;
  body: string;
  status: IssueStatus;
  priority: Priority | null;
  labels: string[];
  start_date: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  timezone: string;
  recurrence_rule: string | null;
  parent_id: string | null;
  parent_number: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  completed_at: string | null;
  child_count: number;
  backlink_count: number;
}

export interface IssueListResult {
  issues: IssueDto[];
  total: number;
}

export interface CommentDto {
  id: string;
  issue_id: string;
  issue_number: number;
  body: string;
  author: string;
  author_type: ActorType;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipDto {
  id: string;
  source_id: string;
  source_number: number;
  source_title: string;
  target_id: string;
  target_number: number;
  target_title: string;
  type: RelationshipType;
  created_by: string;
  created_at: string;
}

export interface ReferenceDto {
  id: string;
  source_type: ReferenceSourceType;
  source_id: string;
  source_number: number | null;
  source_title: string | null;
  target_number: number;
  target_issue_id: string | null;
  created_at: string;
}

export interface BacklinkDto {
  id: string;
  source_type: ReferenceSourceType;
  source_id: string;
  source_number: number | null;
  source_title: string | null;
  target_number: number;
  created_at: string;
}

export interface AuditEventDto {
  id: string;
  actor_type: ActorType;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown | null;
  after: unknown | null;
  created_at: string;
}

export interface ReminderDto {
  id: string;
  issue_id: string;
  kind: ReminderKind;
  trigger_at: string | null;
  offset_minutes: number | null;
  recurrence_rule: string | null;
  timezone: string;
  status: ReminderStatus;
  snooze_until: string | null;
  created_at: string;
  last_triggered_at: string | null;
}

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
}

export interface AttachmentDto {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string;
  filename: string;
  content_type: string;
  size: number;
  checksum: string;
  status: AttachmentStatus;
  created_at: string;
  url: string;
}

export interface McpTokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface McpTokenCreatedDto extends McpTokenDto {
  /** Shown exactly once, at creation. */
  token: string;
}

export interface PlanningItemDto {
  issue: IssueDto;
  /** For Today/Upcoming: the instant that matched, or the due date string. */
  matched: string;
  matched_kind: "due" | "scheduled" | "overdue";
}

export interface OccurrenceDto {
  id: string;
  issue_id: string;
  occurred_on: string;
  created_at: string;
}

export interface WikiNodeDto {
  issue: IssueDto;
  children: WikiNodeDto[];
}

export interface SearchResultDto {
  entity_type: string;
  entity_id: string;
  issue_id: string;
  issue_number: number;
  issue_type: IssueType;
  issue_title: string;
  issue_status: IssueStatus;
  issue_labels: string[];
  matched_field: string;
  snippet: string;
  score: number;
}

export interface RecurrenceUiState {
  enabled: boolean;
  freq: RecurrenceFreq;
  interval: number;
  byDay: string[];
  count: number | null;
}
