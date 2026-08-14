/**
 * Domain record types: the durable shapes stored in D1. API-facing DTOs live
 * in src/shared/contracts/issues.ts.
 */
import type {
  ActorType,
  AttachmentOwnerType,
  AttachmentStatus,
  IssueStatus,
  IssueType,
  OccurrenceStatus,
  Priority,
  ReferenceSourceType,
  RelationshipType,
  ReminderKind,
  ReminderStatus,
} from "../shared/limits";

export interface IssueRecord {
  id: string;
  number: number;
  type: IssueType;
  title: string;
  body: string;
  status: IssueStatus;
  priority: Priority | null;
  start_date: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  timezone: string;
  recurrence_rule: string | null;
  parent_id: string | null;
  created_by: string;
  created_for: string | null;
  created_via: "web" | "mcp" | "system" | null;
  created_at: string;
  updated_at: string;
  version: number;
  closed_at: string | null;
  completed_at: string | null;
}

export interface LabelRecord {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface CommentRecord {
  id: string;
  issue_id: string;
  body: string;
  author: string;
  author_type: ActorType;
  author_for: string | null;
  author_via: "web" | "mcp" | "system" | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipRecord {
  id: string;
  source_id: string;
  target_id: string;
  type: RelationshipType;
  created_by: string;
  created_for: string | null;
  created_via: "web" | "mcp" | "system" | null;
  created_at: string;
}

export interface ReferenceRecord {
  id: string;
  source_type: ReferenceSourceType;
  source_id: string;
  target_number: number;
  target_issue_id: string | null;
  created_by: string;
  created_at: string;
}

export interface AuditRecord {
  id: string;
  actor_type: ActorType;
  actor_id: string;
  subject_id: string | null;
  subject_email: string | null;
  subject_display_name: string | null;
  via: "web" | "mcp" | "system" | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  request_id: string | null;
  created_at: string;
}

export interface McpTokenRecord {
  id: string;
  name: string;
  prefix: string;
  scopes_json: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
}

export interface OauthClientRecord {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  created_at: string;
}

export interface OauthGrantRecord {
  id: string;
  client_id: string;
  scopes_json: string;
  owner_email: string | null;
  owner_display_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface OauthCodeRecord {
  code_hash: string;
  client_id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes_json: string;
  resource: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface OauthTokenRecord {
  token_hash: string;
  kind: "access" | "refresh";
  grant_id: string;
  client_id: string;
  scopes_json: string;
  resource: string;
  expires_at: string;
  rotated_from_hash: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ReminderRecord {
  id: string;
  issue_id: string;
  kind: ReminderKind;
  trigger_at: string | null;
  offset_minutes: number | null;
  recurrence_rule: string | null;
  timezone: string;
  status: ReminderStatus;
  snooze_until: string | null;
  created_by: string;
  created_for: string | null;
  created_via: "web" | "mcp" | "system" | null;
  created_at: string;
  last_triggered_at: string | null;
}

export interface ReminderOccurrenceRecord {
  id: string;
  reminder_id: string;
  occurrence_at: string;
  status: OccurrenceStatus;
  claimed_at: string | null;
  claimed_until: string | null;
  attempt_count: number;
  notification_id: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  user_email: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
}

export interface AttachmentRecord {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string;
  filename: string;
  content_type: string;
  size: number;
  checksum: string;
  r2_key: string;
  status: AttachmentStatus;
  uploaded_by: string;
  uploaded_for: string | null;
  uploaded_via: "web" | "mcp" | "system" | null;
  created_at: string;
  deleted_at: string | null;
}

export interface OccurrenceRecord {
  id: string;
  issue_id: string;
  occurred_on: string;
  created_at: string;
}
