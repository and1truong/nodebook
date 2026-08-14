/** D1 data access for the issue graph: hierarchy, relationships, references. */
import type { D1Database } from "@cloudflare/workers-types";
import type { ReferenceRecord, RelationshipRecord } from "../../domain/models";
import type { IssueStatus, IssueType, ReferenceSourceType } from "../../shared/limits";

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

export async function getParentChain(db: D1Database, issueId: string): Promise<{ id: string; parent_id: string | null }[]> {
  const res = await db
    .prepare("SELECT id, parent_id FROM issues WHERE id = ? OR parent_id = ?")
    .bind(issueId, issueId)
    .all<{ id: string; parent_id: string | null }>();
  return res.results;
}

/** Walk ancestors of `issueId`; returns ids from parent upward. */
export async function listAncestors(db: D1Database, issueId: string): Promise<string[]> {
  const ancestors: string[] = [];
  let current: string | null = issueId;
  let guard = 0;
  while (current && guard < 100) {
    const row: { parent_id: string | null } | null = await db
      .prepare("SELECT parent_id FROM issues WHERE id = ?")
      .bind(current)
      .first();
    if (!row || !row.parent_id) break;
    ancestors.push(row.parent_id);
    current = row.parent_id;
    guard += 1;
  }
  return ancestors;
}

export async function getChildren(db: D1Database, issueId: string): Promise<{ id: string; number: number; title: string; status: string; type: string; due_date: string | null }[]> {
  const res = await db
    .prepare(
      "SELECT id, number, title, status, type, due_date FROM issues WHERE parent_id = ? ORDER BY number ASC",
    )
    .bind(issueId)
    .all<{ id: string; number: number; title: string; status: string; type: string; due_date: string | null }>();
  return res.results;
}

export interface WikiIssueRow {
  id: string;
  number: number;
  type: IssueType;
  title: string;
  status: IssueStatus;
  parent_id: string | null;
  updated_at: string;
  labels: string[];
}

/**
 * Every issue under a top-level wiki root, with only the fields needed by the
 * navigation tree. The recursive CTE and label join replace the previous
 * per-node child, issue, label, count, and attribution query waterfall.
 */
export async function listWikiIssues(db: D1Database): Promise<WikiIssueRow[]> {
  const res = await db
    .prepare(
      `WITH RECURSIVE wiki_issues(id, number, type, title, status, parent_id, updated_at) AS (
         SELECT id, number, type, title, status, parent_id, updated_at
         FROM issues
         WHERE parent_id IS NULL AND type = 'wiki'
         UNION ALL
         SELECT i.id, i.number, i.type, i.title, i.status, i.parent_id, i.updated_at
         FROM issues i
         JOIN wiki_issues parent ON i.parent_id = parent.id
       )
       SELECT w.id, w.number, w.type, w.title, w.status, w.parent_id, w.updated_at,
              l.name AS label_name
       FROM wiki_issues w
       LEFT JOIN issue_labels il ON il.issue_id = w.id
       LEFT JOIN labels l ON l.id = il.label_id
       ORDER BY w.number ASC, l.name COLLATE NOCASE`,
    )
    .all<{
      id: string;
      number: number;
      type: IssueType;
      title: string;
      status: IssueStatus;
      parent_id: string | null;
      updated_at: string;
      label_name: string | null;
    }>();

  const byId = new Map<string, WikiIssueRow>();
  for (const row of res.results) {
    let issue = byId.get(row.id);
    if (!issue) {
      issue = {
        id: row.id,
        number: Number(row.number),
        type: row.type,
        title: row.title,
        status: row.status,
        parent_id: row.parent_id,
        updated_at: row.updated_at,
        labels: [],
      };
      byId.set(row.id, issue);
    }
    if (row.label_name !== null) issue.labels.push(row.label_name);
  }
  return [...byId.values()];
}

/** Resolve root-to-issue breadcrumbs in one recursive query. */
export async function listBreadcrumbs(
  db: D1Database,
  issueId: string,
): Promise<{ id: string; number: number; title: string }[]> {
  const res = await db
    .prepare(
      `WITH RECURSIVE ancestors(id, number, title, parent_id, depth) AS (
         SELECT id, number, title, parent_id, 0 FROM issues WHERE id = ?
         UNION ALL
         SELECT i.id, i.number, i.title, i.parent_id, ancestors.depth + 1
         FROM issues i
         JOIN ancestors ON i.id = ancestors.parent_id
         WHERE ancestors.depth < 99
       )
       SELECT id, number, title FROM ancestors ORDER BY depth DESC`,
    )
    .bind(issueId)
    .all<{ id: string; number: number; title: string }>();
  return res.results.map((row) => ({ ...row, number: Number(row.number) }));
}

export interface SubIssueRow {
  id: string;
  number: number;
  title: string;
  status: string;
  parent_id: string | null;
  child_count: number;
  closed_child_count: number;
}

/**
 * Direct children of `issueId` only (one hierarchy level), ordered by
 * number. Each row carries its own direct-child counts so the client can
 * render expand controls and progress badges without fetching descendants.
 */
export async function listDirectChildren(db: D1Database, issueId: string): Promise<SubIssueRow[]> {
  const res = await db
    .prepare(
      `SELECT i.id, i.number, i.title, i.status, i.parent_id,
              (SELECT COUNT(*) FROM issues c WHERE c.parent_id = i.id) AS child_count,
              (SELECT COUNT(*) FROM issues c WHERE c.parent_id = i.id AND c.status = 'closed') AS closed_child_count
       FROM issues i WHERE i.parent_id = ? ORDER BY i.number ASC`,
    )
    .bind(issueId)
    .all<SubIssueRow>();
  return res.results;
}

/**
 * Issues that may be linked under `rootId`: every issue except the root
 * itself and all of its descendants (server-side recursive CTE), so the
 * picker never exposes tree members regardless of what the client has
 * loaded. `query` filters title/body LIKE matches; rows are newest first.
 */
export async function listLinkCandidates(
  db: D1Database,
  rootId: string,
  query: string | null,
  limit: number,
): Promise<SubIssueRow[]> {
  const where: string[] = ["i.id <> ?", "i.id NOT IN (SELECT id FROM subtree)"];
  const args: string[] = [rootId];
  if (query) {
    where.push("(i.title LIKE ? ESCAPE '\\' OR i.body LIKE ? ESCAPE '\\')");
    const escaped = escapeLikePattern(query);
    args.push(`%${escaped}%`, `%${escaped}%`);
  }
  const res = await db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM issues WHERE parent_id = ?
         UNION ALL
         SELECT i.id FROM issues i JOIN subtree s ON i.parent_id = s.id
       )
       SELECT i.id, i.number, i.title, i.status, i.parent_id,
              (SELECT COUNT(*) FROM issues c WHERE c.parent_id = i.id) AS child_count,
              (SELECT COUNT(*) FROM issues c WHERE c.parent_id = i.id AND c.status = 'closed') AS closed_child_count
       FROM issues i
       WHERE ${where.join(" AND ")}
       ORDER BY i.number DESC
       LIMIT ?`,
    )
    .bind(rootId, ...args, limit)
    .all<SubIssueRow>();
  return res.results;
}

/**
 * Escape LIKE wildcards so user input matches literally: `%`, `_`, and the
 * escape character itself are backslash-escaped (paired with `ESCAPE '\'` in
 * the query above). Without this, `q=%` matches every issue and `_` matches
 * any single character.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Whether `issueId` is the root itself or one of its descendants. */
export async function isInSubtree(db: D1Database, rootId: string, issueId: string): Promise<boolean> {
  if (rootId === issueId) return true;
  const res = await db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM issues WHERE parent_id = ?
         UNION ALL
         SELECT i.id FROM issues i JOIN subtree s ON i.parent_id = s.id
       )
       SELECT 1 AS hit FROM subtree WHERE id = ? LIMIT 1`,
    )
    .bind(rootId, issueId)
    .first<{ hit: number }>();
  return res !== null;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export async function insertRelationship(
  db: D1Database,
  input: {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    createdBy: string;
    createdFor: string | null;
    createdVia: "web" | "mcp" | "system";
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO relationships (id, source_id, target_id, type, created_by, created_for, created_via, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.sourceId, input.targetId, input.type, input.createdBy, input.createdFor, input.createdVia, input.now)
    .run();
}

export async function deleteRelationship(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM relationships WHERE id = ?").bind(id).run();
}

export async function getRelationshipById(db: D1Database, id: string): Promise<RelationshipRecord | null> {
  const row = await db.prepare("SELECT * FROM relationships WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToRelationship(row) : null;
}

export async function findRelationship(
  db: D1Database,
  sourceId: string,
  targetId: string,
  type: string,
): Promise<RelationshipRecord | null> {
  const row = await db
    .prepare("SELECT * FROM relationships WHERE source_id = ? AND target_id = ? AND type = ?")
    .bind(sourceId, targetId, type)
    .first<Record<string, unknown>>();
  return row ? rowToRelationship(row) : null;
}

export async function listRelationships(db: D1Database, issueId: string): Promise<RelationshipRecord[]> {
  const res = await db
    .prepare(
      "SELECT * FROM relationships WHERE source_id = ? OR target_id = ? ORDER BY created_at ASC, id ASC",
    )
    .bind(issueId, issueId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToRelationship);
}

export async function listRelatedIssues(db: D1Database, issueId: string): Promise<RelationshipRecord[]> {
  const res = await db
    .prepare("SELECT * FROM relationships WHERE source_id = ? OR target_id = ?")
    .bind(issueId, issueId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToRelationship);
}

function rowToRelationship(row: Record<string, unknown>): RelationshipRecord {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    target_id: String(row.target_id),
    type: row.type as RelationshipRecord["type"],
    created_by: String(row.created_by),
    created_for: (row.created_for as string | null) ?? null,
    created_via: (row.created_via as RelationshipRecord["created_via"]) ?? null,
    created_at: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export async function replaceReferences(
  db: D1Database,
  sourceType: ReferenceSourceType,
  sourceId: string,
  numbers: number[],
  createdBy: string,
): Promise<ReferenceRecord[]> {
  await db.prepare("DELETE FROM issue_references WHERE source_type = ? AND source_id = ?").bind(sourceType, sourceId).run();
  const now = new Date().toISOString();
  const records: ReferenceRecord[] = [];
  for (const number of numbers) {
    const target = await db.prepare("SELECT id FROM issues WHERE number = ?").bind(number).first<{ id: string }>();
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO issue_references (id, source_type, source_id, target_number, target_issue_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, sourceType, sourceId, number, target?.id ?? null, createdBy, now)
      .run();
    records.push({
      id,
      source_type: sourceType,
      source_id: sourceId,
      target_number: number,
      target_issue_id: target?.id ?? null,
      created_by: createdBy,
      created_at: now,
    });
  }
  return records;
}

/** Resolve previously-unresolved references that point at `number` (now created). */
export async function resolvePendingReferences(db: D1Database, number: number, issueId: string): Promise<number> {
  const res = await db
    .prepare("UPDATE issue_references SET target_issue_id = ? WHERE target_number = ? AND target_issue_id IS NULL")
    .bind(issueId, number)
    .run();
  return res.meta.changes ?? 0;
}

export async function listReferencesForSource(db: D1Database, sourceType: ReferenceSourceType, sourceId: string): Promise<ReferenceRecord[]> {
  const res = await db
    .prepare("SELECT * FROM issue_references WHERE source_type = ? AND source_id = ? ORDER BY target_number ASC")
    .bind(sourceType, sourceId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToReference);
}

/** Incoming references (backlinks) to an issue, both resolved and pending. */
export async function listBacklinks(db: D1Database, issueId: string): Promise<ReferenceRecord[]> {
  const res = await db
    .prepare(
      `SELECT r.* FROM issue_references r
       WHERE r.target_issue_id = ?
          OR r.target_number = (SELECT number FROM issues WHERE id = ?)
       ORDER BY r.created_at DESC`,
    )
    .bind(issueId, issueId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToReference);
}

/** Incoming-reference counts for many issues at once. */
export async function getBacklinkCounts(db: D1Database, issueIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (issueIds.length === 0) return map;
  for (const id of issueIds) map.set(id, 0);
  // Count references whose target_issue_id matches, plus unresolved references
  // whose target_number equals this issue's number.
  const numbers = await db
    .prepare(`SELECT id, number FROM issues WHERE id IN (${issueIds.map(() => "?").join(",")})`)
    .bind(...issueIds)
    .all<{ id: string; number: number }>();
  const numberById = new Map(numbers.results.map((r) => [r.id, Number(r.number)]));
  const counts = new Map(issueIds.map((id) => [id, 0]));
  // The count query binds each issue twice (UUID and number). Keep each
  // statement below D1's 100-variable SQLite limit.
  const chunks = chunk(issueIds, 45);
  for (const chunkIds of chunks) {
    const res = await db
      .prepare(
        `SELECT target_issue_id, target_number, COUNT(*) AS n FROM issue_references
         WHERE target_issue_id IN (${chunkIds.map(() => "?").join(",")}) OR target_number IN (${chunkIds.map(() => "?").join(",")})
         GROUP BY target_issue_id, target_number`,
      )
      .bind(...chunkIds, ...chunkIds.map((id) => numberById.get(id) ?? 0))
      .all<{ target_issue_id: string | null; target_number: number; n: number }>();
    for (const row of res.results) {
      if (row.target_issue_id && counts.has(row.target_issue_id)) {
        counts.set(row.target_issue_id, (counts.get(row.target_issue_id) ?? 0) + Number(row.n));
      } else {
        for (const id of chunkIds) {
          if (numberById.get(id) === Number(row.target_number)) {
            counts.set(id, (counts.get(id) ?? 0) + Number(row.n));
          }
        }
      }
    }
  }
  return counts;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function rowToReference(row: Record<string, unknown>): ReferenceRecord {
  return {
    id: String(row.id),
    source_type: row.source_type as ReferenceSourceType,
    source_id: String(row.source_id),
    target_number: Number(row.target_number),
    target_issue_id: (row.target_issue_id as string | null) ?? null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
  };
}

export async function listReferenceSources(db: D1Database, referenceIds: string[]): Promise<Map<string, { sourceNumber: number | null; sourceTitle: string | null }>> {
  const map = new Map<string, { sourceNumber: number | null; sourceTitle: string | null }>();
  if (referenceIds.length === 0) return map;
  // Resolve via SQL: references with source_type 'issue' map to issues directly.
  const res = await db
    .prepare(
      `SELECT r.id, i.number AS issue_number, i.title AS issue_title
       FROM issue_references r LEFT JOIN issues i ON r.source_type = 'issue' AND i.id = r.source_id
       WHERE r.id IN (${referenceIds.map(() => "?").join(",")})`,
    )
    .bind(...referenceIds)
    .all<{ id: string; issue_number: number | null; issue_title: string | null }>();
  for (const row of res.results) {
    map.set(row.id, { sourceNumber: row.issue_number, sourceTitle: row.issue_title });
  }
  return map;
}

/** Load comment reference sources (source_type='comment') by joining comments→issues. */
export async function listCommentReferenceSources(db: D1Database, referenceIds: string[]): Promise<Map<string, { sourceNumber: number | null; sourceTitle: string | null }>> {
  const map = new Map<string, { sourceNumber: number | null; sourceTitle: string | null }>();
  if (referenceIds.length === 0) return map;
  const res = await db
    .prepare(
      `SELECT r.id, i.number AS issue_number, i.title AS issue_title
       FROM issue_references r JOIN comments c ON r.source_type = 'comment' AND c.id = r.source_id
       JOIN issues i ON i.id = c.issue_id
       WHERE r.id IN (${referenceIds.map(() => "?").join(",")})`,
    )
    .bind(...referenceIds)
    .all<{ id: string; issue_number: number | null; issue_title: string | null }>();
  for (const row of res.results) {
    map.set(row.id, { sourceNumber: row.issue_number, sourceTitle: row.issue_title });
  }
  return map;
}
