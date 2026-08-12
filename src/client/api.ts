/** Typed fetch client for the NodeBook API. */
import type {
  AttachmentDto,
  AuditEventDto,
  BacklinkDto,
  CommentDto,
  IssueDto,
  IssueListResult,
  McpTokenCreatedDto,
  McpTokenDto,
  NotificationDto,
  PlanningItemDto,
  RelationshipDto,
  ReminderDto,
  SearchResultDto,
  SubIssueSummaryDto,
  WikiNodeDto,
} from "../shared/contracts/issues";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ email: string; actor_type: string }>("/api/me"),

  // Issues
  listIssues: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return request<IssueListResult>(`/api/issues?${qs.toString()}`);
  },
  getIssue: (ref: string) => request<IssueDto>(`/api/issues/${ref}`),
  createIssue: (input: Record<string, unknown>) =>
    request<IssueDto>("/api/issues", { method: "POST", body: JSON.stringify(input) }),
  updateIssue: (ref: string, input: Record<string, unknown>) =>
    request<IssueDto>(`/api/issues/${ref}`, { method: "PATCH", body: JSON.stringify(input) }),
  closeIssue: (ref: string) => request<IssueDto>(`/api/issues/${ref}/close`, { method: "POST" }),
  reopenIssue: (ref: string) => request<IssueDto>(`/api/issues/${ref}/reopen`, { method: "POST" }),
  completeTask: (ref: string) => request<IssueDto>(`/api/issues/${ref}/complete`, { method: "POST" }),
  history: (ref: string) => request<AuditEventDto[]>(`/api/issues/${ref}/history`),

  // Comments
  comments: (ref: string) => request<CommentDto[]>(`/api/issues/${ref}/comments`),
  addComment: (ref: string, body: string) =>
    request<CommentDto>(`/api/issues/${ref}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  updateComment: (id: string, body: string) =>
    request<CommentDto>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),

  // Graph
  children: (ref: string) => request<IssueDto[]>(`/api/graph/${ref}/children`),
  subIssues: (ref: string) => request<SubIssueSummaryDto[]>(`/api/graph/${ref}/sub-issues`),
  subIssueCandidates: (ref: string, q: string, limit: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("limit", String(limit));
    return request<IssueDto[]>(`/api/graph/${ref}/sub-issue-candidates?${qs.toString()}`);
  },
  backlinks: (ref: string) => request<BacklinkDto[]>(`/api/graph/${ref}/backlinks`),
  relationships: (ref: string) => request<RelationshipDto[]>(`/api/graph/${ref}/relationships`),
  related: (ref: string) => request<RelationshipDto[]>(`/api/graph/${ref}/related`),
  setParent: (ref: string, parentId: string | null) =>
    request<{ ok: boolean }>(`/api/graph/${ref}/parent`, { method: "POST", body: JSON.stringify({ parent_id: parentId }) }),
  addRelationship: (ref: string, targetId: string, type: string) =>
    request<RelationshipDto>(`/api/graph/${ref}/relationships`, {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, type }),
    }),
  removeRelationship: (id: string) =>
    request<{ ok: boolean }>(`/api/graph/relationships/${id}`, { method: "DELETE" }),
  wikiTree: () => request<WikiNodeDto[]>("/api/wiki/tree"),
  breadcrumbs: (ref: string) =>
    request<{ id: string; number: number; title: string }[]>(`/api/wiki/${ref}/breadcrumbs`),

  // Search
  search: (params: { q: string; type?: string; status?: string; label?: string; knowledge?: boolean }) => {
    const qs = new URLSearchParams();
    qs.set("q", params.q);
    if (params.type) qs.set("type", params.type);
    if (params.status) qs.set("status", params.status);
    if (params.label) qs.set("label", params.label);
    const base = params.knowledge ? "/api/search/knowledge" : "/api/search";
    return request<{ query: string; results: SearchResultDto[] }>(`${base}?${qs.toString()}`);
  },

  // Planning
  inbox: () => request<PlanningItemDto[]>("/api/planning/inbox"),
  today: (tz?: string) => request<PlanningItemDto[]>(`/api/planning/today${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`),
  upcoming: (tz?: string) =>
    request<PlanningItemDto[]>(`/api/planning/upcoming${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`),

  // Reminders
  reminders: (ref: string) => request<ReminderDto[]>(`/api/reminders/issue/${ref}`),
  createReminder: (ref: string, input: Record<string, unknown>) =>
    request<ReminderDto>(`/api/reminders/issue/${ref}`, { method: "POST", body: JSON.stringify(input) }),
  updateReminder: (id: string, input: Record<string, unknown>) =>
    request<ReminderDto>(`/api/reminders/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  processReminders: () => request<{ claimed: number; delivered: number }>("/api/reminders/process", { method: "POST" }),

  // Notifications
  notifications: (limit = 50) => request<NotificationDto[]>(`/api/notifications?limit=${limit}`),
  unreadCount: () => request<{ count: number }>("/api/notifications/unread-count"),
  markRead: (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" }),

  // Attachments
  uploadAttachment: async (url: string, file: File): Promise<AttachmentDto> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        /* noop */
      }
      throw new ApiError(res.status, "upload_failed", message);
    }
    return (await res.json()) as AttachmentDto;
  },
  attachments: (ownerType: "issue" | "comment", ownerId: string) =>
    request<AttachmentDto[]>(`/api/attachments/${ownerType === "issue" ? "issue" : "comment"}/${ownerType === "issue" ? ownerId : ownerId}`),
  deleteAttachment: (id: string) => request<{ ok: boolean }>(`/api/attachments/${id}`, { method: "DELETE" }),

  // Tokens
  tokens: () => request<McpTokenDto[]>("/api/tokens"),
  createToken: (input: { name: string; scopes: string[]; expires_in_days?: number | null }) =>
    request<McpTokenCreatedDto>("/api/tokens", { method: "POST", body: JSON.stringify(input) }),
  revokeToken: (id: string) => request<McpTokenDto>(`/api/tokens/${id}/revoke`, { method: "POST" }),
};

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  return date;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatInstant(iso);
}
