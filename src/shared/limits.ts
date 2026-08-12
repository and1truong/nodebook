/**
 * Shared domain constants and limits. Imported by the Worker, the MCP layer,
 * and the browser client.
 */

export const ISSUE_TYPES = [
  "task",
  "bug",
  "epic",
  "story",
  "decision",
  "finding",
  "incident",
  "learning",
  "wiki",
  "note",
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_STATUSES = ["open", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RELATIONSHIP_TYPES = [
  "related",
  "depends_on",
  "blocks",
  "supersedes",
  "duplicates",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const ACTOR_TYPES = ["human", "mcp", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const REMINDER_KINDS = ["absolute", "before_due", "recurring"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ["active", "completed", "dismissed", "snoozed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const OCCURRENCE_STATUSES = ["due", "claimed", "delivered", "failed", "cancelled"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const ATTACHMENT_OWNER_TYPES = ["issue", "comment"] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export const ATTACHMENT_STATUSES = ["active", "deleted"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const REFERENCE_SOURCE_TYPES = ["issue", "comment"] as const;
export type ReferenceSourceType = (typeof REFERENCE_SOURCE_TYPES)[number];

/** MCP token scopes (PRD-defined). */
export const MCP_SCOPES = [
  "read:issue",
  "write:issue",
  "read:search",
  "read:graph",
  "write:graph",
  "read:planning",
  "read:attachment",
  "write:attachment",
  "write:comment",
  "write:reminder",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Content types that may be previewed inline in the browser. Everything else is forced to download. */
export const PREVIEW_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "application/pdf",
]);

export const TITLE_MAX_LENGTH = 500;
export const BODY_MAX_LENGTH = 100_000;
export const LABEL_MAX_LENGTH = 32;
export const MAX_LABELS_PER_ISSUE = 20;
export const COMMENT_MAX_LENGTH = 50_000;
export const AUDIT_JSON_MAX_LENGTH = 16_000;
export const SEARCH_RESULT_LIMIT = 50;
export const DEFAULT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MCP_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
export const REMINDER_LOCK_MS = 5 * 60 * 1000;
export const REMINDER_MAX_ATTEMPTS = 3;
export const ATTACHMENT_GC_GRACE_MS = 24 * 60 * 60 * 1000;
export const MCP_SESSION_TTL_MS = 30 * 60 * 1000;

export function isPreviewContentType(contentType: string): boolean {
  return PREVIEW_CONTENT_TYPES.has(contentType.toLowerCase());
}
