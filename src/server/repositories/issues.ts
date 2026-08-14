/**
 * D1 data access for issues, labels, and comments. All queries are plain
 * SQL against the D1 binding; domain rules live in the services.
 */
import type { D1Database, D1Result } from "@cloudflare/workers-types";
import type { CommentRecord, IssueRecord, LabelRecord } from "../../domain/models";

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** Atomically allocate the next global issue number. */
export async function allocateIssueNumber(db: D1Database): Promise<number> {
  const row = await db
    .prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'issue_seq' RETURNING value")
    .first<{ value: string }>();
  if (!row) throw new Error("issue_seq meta row missing");
  return Number(row.value);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export const ISSUE_COLUMNS = `
  id, number, type, title, body, status, priority, start_date, due_date,
  scheduled_date, timezone, recurrence_rule, parent_id, created_by, created_at,
  updated_at, version, closed_at, completed_at
`;

export function rowToIssue(row: Record<string, unknown>): IssueRecord {
  return {
    id: String(row.id),
    number: Number(row.number),
    type: row.type as IssueRecord["type"],
    title: String(row.title),
    body: String(row.body),
    status: row.status as IssueRecord["status"],
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
    version: Number(row.version),
    closed_at: (row.closed_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
  };
}

export interface IssueRowInput {
  id: string;
  number: number;
  type: string;
  title: string;
  body: string;
  timezone: string;
  createdBy: string;
  now: string;
}

export async function insertIssue(db: D1Database, input: IssueRowInput, extra: Partial<IssueRecord> = {}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO issues (id, number, type, title, body, status, priority, start_date, due_date, scheduled_date,
        timezone, recurrence_rule, parent_id, created_by, created_at, updated_at, closed_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.number,
      input.type,
      input.title,
      input.body,
      extra.status ?? "open",
      extra.priority ?? null,
      extra.start_date ?? null,
      extra.due_date ?? null,
      extra.scheduled_date ?? null,
      input.timezone,
      extra.recurrence_rule ?? null,
      extra.parent_id ?? null,
      input.createdBy,
      input.now,
      input.now,
      extra.closed_at ?? null,
      extra.completed_at ?? null,
    )
    .run();
}

export async function getIssueById(db: D1Database, id: string): Promise<IssueRecord | null> {
  const row = await db.prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE id = ?`).bind(id).first();
  return row ? rowToIssue(row) : null;
}

/** Batch variant of getIssueById, preserving no particular order. */
export async function getIssuesByIds(db: D1Database, ids: string[]): Promise<IssueRecord[]> {
  if (ids.length === 0) return [];
  const res = await db
    .prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all();
  return res.results.map(rowToIssue);
}

export async function getIssueByNumber(db: D1Database, number: number): Promise<IssueRecord | null> {
  const row = await db.prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE number = ?`).bind(number).first();
  return row ? rowToIssue(row) : null;
}

export async function getIssueByRef(db: D1Database, ref: string): Promise<IssueRecord | null> {
  const number = Number(ref);
  if (Number.isInteger(number) && number > 0) return getIssueByNumber(db, number);
  return getIssueById(db, ref);
}

export interface IssueFilters {
  type?: string | string[];
  status?: string;
  label?: string | string[];
  parent_id?: string | null;
  query?: string;
  limit?: number;
  offset?: number;
}

function issueFilterSql(filters: IssueFilters): { where: string[]; args: string[] } {
  const where: string[] = [];
  const args: string[] = [];
  const types = Array.isArray(filters.type) ? filters.type : filters.type ? [filters.type] : [];
  const labels = Array.isArray(filters.label) ? filters.label : filters.label ? [filters.label] : [];

  if (types.length > 0) {
    where.push(`type IN (${types.map(() => "?").join(", ")})`);
    args.push(...types);
  }
  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) where.push("parent_id IS NULL");
    else {
      where.push("parent_id = ?");
      args.push(filters.parent_id);
    }
  }
  if (labels.length > 0) {
    where.push(
      `id IN (
        SELECT il.issue_id FROM issue_labels il
        JOIN labels l ON l.id = il.label_id
        WHERE ${labels.map(() => "l.name = ? COLLATE NOCASE").join(" OR ")}
      )`,
    );
    args.push(...labels);
  }
  if (filters.query) {
    where.push("(title LIKE ? OR body LIKE ?)");
    args.push(`%${filters.query}%`, `%${filters.query}%`);
  }

  return { where, args };
}

export async function listIssues(db: D1Database, filters: IssueFilters = {}): Promise<IssueRecord[]> {
  const { where, args } = issueFilterSql(filters);
  const sql = `SELECT ${ISSUE_COLUMNS} FROM issues ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY number DESC LIMIT ? OFFSET ?`;
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const res = await db.prepare(sql).bind(...args, limit, offset).all<Record<string, unknown>>();
  return res.results.map(rowToIssue);
}

export async function countIssues(db: D1Database, filters: IssueFilters = {}): Promise<number> {
  const { where, args } = issueFilterSql(filters);
  const sql = `SELECT COUNT(*) AS n FROM issues ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const row = await db.prepare(sql).bind(...args).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Calendar range
// ---------------------------------------------------------------------------

/**
 * Bounds for the calendar range query. Due dates are civil strings compared
 * against `startDate`/`endDate`; scheduled instants are UTC ISO strings
 * compared against the timezone-derived instant bounds of the same civil
 * window, so an instant belongs to the range exactly when its civil date in
 * the viewer's timezone does (correct across DST transitions; see
 * shared/time.ts instantFromCivil).
 */
export interface CalendarIssueFilter {
  startDate: string;
  endDate: string;
  startInstant: string;
  endInstant: string;
}

/** Open issues whose due date or scheduled instant intersects [start, end). */
export async function listCalendarIssues(db: D1Database, f: CalendarIssueFilter): Promise<IssueRecord[]> {
  const res = await db
    .prepare(
      `SELECT ${ISSUE_COLUMNS} FROM issues
       WHERE status = 'open'
         AND (
           (due_date IS NOT NULL AND due_date >= ? AND due_date < ?)
           OR (scheduled_date IS NOT NULL AND scheduled_date >= ? AND scheduled_date < ?)
         )
       ORDER BY number`,
    )
    .bind(f.startDate, f.endDate, f.startInstant, f.endInstant)
    .all<Record<string, unknown>>();
  return res.results.map(rowToIssue);
}

export type IssueUpdateFields = Partial<
  Pick<
    IssueRecord,
    | "type"
    | "title"
    | "body"
    | "priority"
    | "start_date"
    | "due_date"
    | "scheduled_date"
    | "timezone"
    | "recurrence_rule"
    | "parent_id"
    | "status"
    | "closed_at"
    | "completed_at"
  >
>;

export async function updateIssue(
  db: D1Database,
  id: string,
  fields: IssueUpdateFields,
  now: string,
  expectedVersion?: number,
): Promise<number | null> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  const sets = entries.map(([key]) => `${key} = ?`);
  const args = entries.map(([, v]) => (v === null ? null : String(v)));
  sets.push("updated_at = ?", "version = version + 1");
  args.push(now);

  const guarded = expectedVersion !== undefined;
  const row = await db
    .prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?${guarded ? " AND version = ?" : ""} RETURNING version`)
    .bind(...args, id, ...(guarded ? [expectedVersion] : []))
    .first<{ version: number }>();
  return row ? Number(row.version) : null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export async function ensureLabel(db: D1Database, name: string): Promise<LabelRecord> {
  await db
    .prepare("INSERT OR IGNORE INTO labels (id, name, created_at) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), name, new Date().toISOString())
    .run();
  const row = await db.prepare("SELECT id, name, color, created_at FROM labels WHERE name = ? COLLATE NOCASE").bind(name).first<Record<string, unknown>>();
  if (!row) throw new Error(`Failed to ensure label ${name}`);
  return { id: String(row.id), name: String(row.name), color: (row.color as string | null) ?? null, created_at: String(row.created_at) };
}

export async function setIssueLabels(db: D1Database, issueId: string, names: string[]): Promise<string[]> {
  // Dedupe case-insensitively (labels are unique COLLATE NOCASE); first spelling wins.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const normalized = name.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  const labelIds: string[] = [];
  for (const name of unique) {
    const label = await ensureLabel(db, name);
    labelIds.push(label.id);
  }
  await db.prepare("DELETE FROM issue_labels WHERE issue_id = ?").bind(issueId).run();
  for (const labelId of labelIds) {
    await db.prepare("INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)").bind(issueId, labelId).run();
  }
  return unique;
}

export async function getIssueLabels(db: D1Database, issueId: string): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT l.name FROM labels l JOIN issue_labels il ON il.label_id = l.id WHERE il.issue_id = ? ORDER BY l.name COLLATE NOCASE`,
    )
    .bind(issueId)
    .all<{ name: string }>();
  return res.results.map((r) => r.name);
}

export async function listAllLabels(db: D1Database): Promise<LabelRecord[]> {
  const res = await db.prepare("SELECT id, name, color, created_at FROM labels ORDER BY name COLLATE NOCASE").all<Record<string, unknown>>();
  return res.results.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    color: (row.color as string | null) ?? null,
    created_at: String(row.created_at),
  }));
}

/** Labels for many issues at once (avoids N+1 DTO assembly). */
export async function getLabelsForIssues(db: D1Database, issueIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (issueIds.length === 0) return map;
  for (const id of issueIds) map.set(id, []);
  const res = await db
    .prepare(
      `SELECT il.issue_id, l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id
       WHERE il.issue_id IN (${issueIds.map(() => "?").join(",")}) ORDER BY l.name COLLATE NOCASE`,
    )
    .bind(...issueIds)
    .all<{ issue_id: string; name: string }>();
  for (const row of res.results) {
    map.get(row.issue_id)?.push(row.name);
  }
  return map;
}

/** Child counts for many issues at once. */
export async function getChildCounts(db: D1Database, issueIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (issueIds.length === 0) return map;
  for (const id of issueIds) map.set(id, 0);
  const res = await db
    .prepare(`SELECT parent_id, COUNT(*) AS n FROM issues WHERE parent_id IN (${issueIds.map(() => "?").join(",")}) GROUP BY parent_id`)
    .bind(...issueIds)
    .all<{ parent_id: string; n: number }>();
  for (const row of res.results) {
    map.set(row.parent_id, Number(row.n));
  }
  return map;
}

/** Issue numbers for many ids at once. */
export async function getNumbersByIds(db: D1Database, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const res = await db
    .prepare(`SELECT id, number FROM issues WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string; number: number }>();
  for (const row of res.results) map.set(row.id, Number(row.number));
  return map;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function insertComment(
  db: D1Database,
  input: {
    id: string;
    issueId: string;
    body: string;
    author: string;
    authorType: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO comments (id, issue_id, body, author, author_type, edited_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(input.id, input.issueId, input.body, input.author, input.authorType, input.now, input.now)
    .run();
}

export async function getCommentById(db: D1Database, id: string): Promise<CommentRecord | null> {
  const row = await db.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    issue_id: String(row.issue_id),
    body: String(row.body),
    author: String(row.author),
    author_type: row.author_type as CommentRecord["author_type"],
    edited_at: (row.edited_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function updateCommentBody(db: D1Database, id: string, body: string, now: string): Promise<void> {
  await db
    .prepare("UPDATE comments SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?")
    .bind(body, now, now, id)
    .run();
}

export async function listCommentsByIssue(db: D1Database, issueId: string): Promise<CommentRecord[]> {
  const res = await db
    .prepare("SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC, id ASC")
    .bind(issueId)
    .all<Record<string, unknown>>();
  return res.results.map((row) => ({
    id: String(row.id),
    issue_id: String(row.issue_id),
    body: String(row.body),
    author: String(row.author),
    author_type: row.author_type as CommentRecord["author_type"],
    edited_at: (row.edited_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

export type { D1Result };
