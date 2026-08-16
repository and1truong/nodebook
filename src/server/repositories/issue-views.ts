/** D1 persistence for workspace-level saved issue filters. */
import type { D1Database } from "@cloudflare/workers-types";
import type { IssueViewRecord } from "../../domain/models";

export async function listIssueViews(db: D1Database): Promise<IssueViewRecord[]> {
  const result = await db
    .prepare("SELECT * FROM issue_views ORDER BY rowid ASC")
    .all<Record<string, unknown>>();
  return result.results.map(rowToIssueView);
}

export async function getIssueView(db: D1Database, id: string): Promise<IssueViewRecord | null> {
  const row = await db.prepare("SELECT * FROM issue_views WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToIssueView(row) : null;
}

export async function insertIssueView(db: D1Database, record: IssueViewRecord): Promise<void> {
  await db
    .prepare("INSERT INTO issue_views (id, name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, record.name, record.filters_json, record.created_at, record.updated_at)
    .run();
}

export async function updateIssueView(
  db: D1Database,
  id: string,
  fields: { name?: string; filters_json?: string; updated_at: string },
): Promise<IssueViewRecord | null> {
  const sets = ["updated_at = ?"];
  const values: string[] = [fields.updated_at];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.filters_json !== undefined) {
    sets.push("filters_json = ?");
    values.push(fields.filters_json);
  }
  const row = await db
    .prepare(`UPDATE issue_views SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<Record<string, unknown>>();
  return row ? rowToIssueView(row) : null;
}

export async function deleteIssueView(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM issue_views WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

function rowToIssueView(row: Record<string, unknown>): IssueViewRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    filters_json: String(row.filters_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
