/** FTS5 search-document index access. */
import type { D1Database } from "@cloudflare/workers-types";

export interface SearchDoc {
  entityType: "issue" | "comment" | "attachment";
  entityId: string;
  issueId: string;
  issueType: string;
  title: string;
  content: string;
  labels: string;
  attachmentMeta: string;
}

export async function upsertSearchDoc(db: D1Database, doc: SearchDoc): Promise<void> {
  // FTS5 virtual tables do not support UPSERT (ON CONFLICT DO UPDATE);
  // delete-then-insert is the idempotent equivalent.
  await db.prepare("DELETE FROM search_docs WHERE entity_id = ?").bind(doc.entityId).run();
  await db
    .prepare(
      `INSERT INTO search_docs (entity_type, entity_id, issue_id, issue_type, title, content, labels, attachment_meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(doc.entityType, doc.entityId, doc.issueId, doc.issueType, doc.title, doc.content, doc.labels, doc.attachmentMeta)
    .run();
}

export async function deleteSearchDoc(db: D1Database, entityId: string): Promise<void> {
  await db.prepare("DELETE FROM search_docs WHERE entity_id = ?").bind(entityId).run();
}

export interface SearchRow {
  entity_type: string;
  entity_id: string;
  issue_id: string;
  issue_type: string;
  title: string;
  labels: string;
  snippet: string | null;
  score: number;
  rank: number;
}

/**
 * Ranked full-text search. `query` must already be FTS-escaped by
 * src/server/services/search-service.ts. Filters are applied after matching so
 * UNINDEXED columns stay cheap.
 */
export async function searchDocs(
  db: D1Database,
  query: string,
  filters: { issueType?: string; issueStatus?: string; label?: string; limit: number },
): Promise<SearchRow[]> {
  const args: unknown[] = [query];
  const andClauses: string[] = [];
  if (filters.issueType) {
    andClauses.push("sd.issue_type = ?");
    args.push(filters.issueType);
  }
  if (filters.issueStatus) {
    andClauses.push("i.status = ?");
    args.push(filters.issueStatus);
  }
  if (filters.label) {
    andClauses.push("EXISTS (SELECT 1 FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = sd.issue_id AND l.name = ? COLLATE NOCASE)");
    args.push(filters.label);
  }
  const andSql = andClauses.length > 0 ? ` AND ${andClauses.join(" AND ")}` : "";
  const sql = `
    SELECT sd.entity_type, sd.entity_id, sd.issue_id, sd.issue_type, sd.title, sd.labels,
           snippet(search_docs, -1, '[', ']', '…', 12) AS snippet,
           bm25(search_docs) AS score
    FROM search_docs sd
    JOIN issues i ON i.id = sd.issue_id
    WHERE search_docs MATCH ?
    ${andSql}
    ORDER BY score ASC
    LIMIT ?`;
  const res = await db.prepare(sql).bind(...args, filters.limit).all<Record<string, unknown>>();
  return res.results.map((row, index) => ({
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    issue_id: String(row.issue_id),
    issue_type: String(row.issue_type),
    title: String(row.title),
    labels: String(row.labels),
    snippet: (row.snippet as string | null) ?? null,
    score: Number(row.score),
    rank: index,
  }));
}

/** Count search-doc rows per entity type (used by rebuild/consistency tests). */
export async function countSearchDocs(db: D1Database, entityType?: string): Promise<number> {
  const row = entityType
    ? await db.prepare("SELECT COUNT(*) AS n FROM search_docs WHERE entity_type = ?").bind(entityType).first<{ n: number }>()
    : await db.prepare("SELECT COUNT(*) AS n FROM search_docs").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function setSearchRebuiltAt(db: D1Database, now: string): Promise<void> {
  await db.prepare("UPDATE meta SET value = ? WHERE key = 'search_rebuilt_at'").bind(now).run();
}

export async function getSearchRebuiltAt(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'search_rebuilt_at'").first<{ value: string }>();
  return row?.value || null;
}

/** Delete every search doc (used by the rebuild). */
export async function clearSearchDocs(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM search_docs").run();
}
