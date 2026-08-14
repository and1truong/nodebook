/** D1 data access for attachments (metadata only; blobs live in R2). */
import type { D1Database } from "@cloudflare/workers-types";
import type { AttachmentRecord } from "../../domain/models";
import type { AttachmentOwnerType, AttachmentStatus } from "../../shared/limits";

export interface AttachmentInsert {
  id: string;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  checksum: string;
  r2Key: string;
  uploadedBy: string;
  uploadedFor: string | null;
  uploadedVia: "web" | "mcp" | "system";
  now: string;
}

export async function insertAttachment(db: D1Database, input: AttachmentInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO attachments (id, owner_type, owner_id, filename, content_type, size, checksum, r2_key, status,
        uploaded_by, uploaded_for, uploaded_via, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
    )
    .bind(
      input.id,
      input.ownerType,
      input.ownerId,
      input.filename,
      input.contentType,
      input.size,
      input.checksum,
      input.r2Key,
      input.uploadedBy,
      input.uploadedFor,
      input.uploadedVia,
      input.now,
    )
    .run();
}

export async function getAttachmentById(db: D1Database, id: string): Promise<AttachmentRecord | null> {
  const row = await db.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToAttachment(row) : null;
}

export async function listAttachmentsForOwner(db: D1Database, ownerType: AttachmentOwnerType, ownerId: string): Promise<AttachmentRecord[]> {
  const res = await db
    .prepare("SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? AND status = 'active' ORDER BY created_at ASC, id ASC")
    .bind(ownerType, ownerId)
    .all<Record<string, unknown>>();
  return res.results.map(rowToAttachment);
}

export async function countActiveByR2Key(db: D1Database, r2Key: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE r2_key = ? AND status = 'active'").bind(r2Key).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function softDeleteAttachment(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE attachments SET status = 'deleted', deleted_at = ? WHERE id = ? AND status = 'active'").bind(now, id).run();
}

/** Deleted attachments past the grace period, grouped by R2 key. */
export async function listGarbageCandidates(db: D1Database, cutoff: string, limit: number): Promise<AttachmentRecord[]> {
  const res = await db
    .prepare("SELECT * FROM attachments WHERE status = 'deleted' AND deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at ASC LIMIT ?")
    .bind(cutoff, limit)
    .all<Record<string, unknown>>();
  return res.results.map(rowToAttachment);
}

export async function deleteAttachmentRows(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .prepare(`DELETE FROM attachments WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .run();
}

export async function listAllAttachmentKeysForRebuild(db: D1Database): Promise<{ id: string; owner_type: string; owner_id: string; filename: string; content_type: string }[]> {
  const res = await db
    .prepare("SELECT id, owner_type, owner_id, filename, content_type FROM attachments WHERE status = 'active'")
    .all<{ id: string; owner_type: string; owner_id: string; filename: string; content_type: string }>();
  return res.results;
}

function rowToAttachment(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: String(row.id),
    owner_type: row.owner_type as AttachmentOwnerType,
    owner_id: String(row.owner_id),
    filename: String(row.filename),
    content_type: String(row.content_type),
    size: Number(row.size),
    checksum: String(row.checksum),
    r2_key: String(row.r2_key),
    status: row.status as AttachmentStatus,
    uploaded_by: String(row.uploaded_by),
    uploaded_for: (row.uploaded_for as string | null) ?? null,
    uploaded_via: (row.uploaded_via as AttachmentRecord["uploaded_via"]) ?? null,
    created_at: String(row.created_at),
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}
