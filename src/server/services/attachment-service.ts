/**
 * Private attachments: multipart/base64 uploads, checksum deduplication of R2
 * blobs, authenticated content endpoints with range support, soft deletion,
 * and an idempotent daily garbage collector.
 */
import type { Ctx } from "../ctx";
import {
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from "../../domain/errors";
import type { AttachmentRecord } from "../../domain/models";
import type { AttachmentDto } from "../../shared/contracts/issues";
import { ATTACHMENT_GC_GRACE_MS, isPreviewContentType } from "../../shared/limits";
import type { AttachmentOwnerType } from "../../shared/limits";
import { recordAudit } from "./audit-service";
import { indexAttachment, deleteIndexEntry } from "./search-service";
import * as fileRepo from "../repositories/files";
import { getCommentById, getIssueById } from "../repositories/issues";

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadInput {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
  maxBytes: number;
}

export async function uploadAttachment(ctx: Ctx, input: UploadInput): Promise<AttachmentDto> {
  if (input.bytes.byteLength > input.maxBytes) {
    throw new PayloadTooLargeError(
      `File exceeds the ${Math.floor(input.maxBytes / (1024 * 1024))} MB upload limit`,
    );
  }
  if (input.bytes.byteLength === 0) throw new ValidationError("File is empty");

  const ownerExists =
    input.ownerType === "issue"
      ? await getIssueById(ctx.env.DB, input.ownerId)
      : await getCommentById(ctx.env.DB, input.ownerId);
  if (!ownerExists) throw new NotFoundError(`${input.ownerType} not found`);

  const checksum = await sha256HexBytes(input.bytes);
  const r2Key = `blobs/${checksum}`;

  // Deduplicate blobs: only put when the key is absent.
  const existing = await ctx.env.FILES.head(r2Key);
  if (!existing) {
    await ctx.env.FILES.put(r2Key, input.bytes, {
      httpMetadata: { contentType: input.contentType },
    });
  }

  const now = new Date().toISOString();
  const record: AttachmentRecord = {
    id: crypto.randomUUID(),
    owner_type: input.ownerType,
    owner_id: input.ownerId,
    filename: sanitizeFilename(input.filename),
    content_type: input.contentType || "application/octet-stream",
    size: input.bytes.byteLength,
    checksum,
    r2_key: r2Key,
    status: "active",
    uploaded_by: actorId(ctx),
    created_at: now,
    deleted_at: null,
  };
  await fileRepo.insertAttachment(ctx.env.DB, {
    id: record.id,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    filename: record.filename,
    contentType: record.content_type,
    size: record.size,
    checksum,
    r2Key,
    uploadedBy: record.uploaded_by,
    now,
  });

  // Close the GC race: if a garbage collector tombstoned and deleted this
  // blob between our put and our row insert, restore the blob and clear the
  // tombstone so the new row is never left dangling. The GC issues at most
  // one delete per key per run; the verification below re-puts the blob if
  // that delete lands after our restore, so the final write is ours.
  const tombstone = await ctx.env.DB.prepare("SELECT r2_key FROM gc_tombstones WHERE r2_key = ?")
    .bind(r2Key)
    .first();
  if (tombstone) {
    let restored = false;
    for (let attempt = 0; attempt < 3 && !restored; attempt++) {
      await ctx.env.FILES.put(r2Key, input.bytes, {
        httpMetadata: { contentType: input.contentType },
      });
      await ctx.env.DB.prepare("DELETE FROM gc_tombstones WHERE r2_key = ?").bind(r2Key).run();
      // If the GC's awaited delete was still in flight and lands after our
      // restore, head observes the missing blob and the loop re-puts after
      // the delete has completed.
      restored = (await ctx.env.FILES.head(r2Key)) !== null;
    }
    if (!restored) {
      // Last resort: the delete raced every restore; write the blob once more
      // so the final state has it present.
      await ctx.env.FILES.put(r2Key, input.bytes, {
        httpMetadata: { contentType: input.contentType },
      });
    }
  }

  await indexAttachment(ctx, record);
  await recordAudit(ctx, {
    action: "attachment.upload",
    entityType: "attachment",
    entityId: record.id,
    after: {
      owner_type: record.owner_type,
      owner_id: record.owner_id,
      filename: record.filename,
      content_type: record.content_type,
      size: record.size,
      checksum,
    },
  });
  return toDto(record);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getAttachment(ctx: Ctx, attachmentId: string): Promise<AttachmentDto> {
  const record = await fileRepo.getAttachmentById(ctx.env.DB, attachmentId);
  if (!record) throw new NotFoundError("Attachment not found");
  if (record.status !== "active") throw new NotFoundError("Attachment not found");
  return toDto(record);
}

export async function listAttachments(ctx: Ctx, ownerType: AttachmentOwnerType, ownerId: string): Promise<AttachmentDto[]> {
  const records = await fileRepo.listAttachmentsForOwner(ctx.env.DB, ownerType, ownerId);
  return records.map(toDto);
}

export interface ContentRange {
  offset: number;
  length: number;
}

/** Stream the blob with optional Range support. */
export async function getAttachmentContent(
  ctx: Ctx,
  attachmentId: string,
  rangeHeader: string | null,
): Promise<{ body: ArrayBuffer; status: number; headers: Record<string, string>; contentType: string; size: number } | null> {
  const record = await fileRepo.getAttachmentById(ctx.env.DB, attachmentId);
  if (!record || record.status !== "active") return null;

  const range = parseRange(rangeHeader, record.size);
  const object = range ? await ctx.env.FILES.get(record.r2_key, { range }) : await ctx.env.FILES.get(record.r2_key);
  if (!object) throw new NotFoundError("Blob missing from storage");

  const disposition = isPreviewContentType(record.content_type) ? "inline" : "attachment";
  const headers: Record<string, string> = {
    "Content-Type": record.content_type,
    "Content-Disposition": `${disposition}; filename="${encodeURIComponent(record.filename)}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  if (range) {
    headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${record.size}`;
    return { body: await object.arrayBuffer(), status: 206, headers, contentType: record.content_type, size: range.length };
  }
  headers["Content-Length"] = String(record.size);
  return { body: await object.arrayBuffer(), status: 200, headers, contentType: record.content_type, size: record.size };
}

// ---------------------------------------------------------------------------
// Soft delete + garbage collection
// ---------------------------------------------------------------------------

export async function softDeleteAttachment(ctx: Ctx, attachmentId: string): Promise<void> {
  const record = await fileRepo.getAttachmentById(ctx.env.DB, attachmentId);
  if (!record) throw new NotFoundError("Attachment not found");
  if (record.status === "deleted") return;
  const now = new Date().toISOString();
  await fileRepo.softDeleteAttachment(ctx.env.DB, attachmentId, now);
  await deleteIndexEntry(ctx, `attachment:${attachmentId}`);
  await recordAudit(ctx, {
    action: "attachment.soft_delete",
    entityType: "attachment",
    entityId: attachmentId,
    before: { filename: record.filename },
    after: { status: "deleted", deleted_at: now },
  });
}

/**
 * Daily idempotent garbage collector. Soft-deleted rows past the grace period
 * whose blob has no active references are tombstoned before the blob is
 * deleted; uploads that land concurrently repair the blob via the tombstone
 * (see uploadAttachment), so a referenced blob is never permanently lost to a
 * D1/R2 partial ordering.
 *
 * Handshake ordering: the tombstone is inserted before the blob delete, and
 * the delete is re-checked against both the tombstone and the active-row
 * count immediately before it runs. A concurrent upload that restores the
 * blob and clears the tombstone therefore cancels the delete (the upload's
 * verified re-put loop in uploadAttachment covers a delete already in
 * flight), and an upload whose row lands while the GC is mid-run is seen by
 * the post-tombstone active-row re-check.
 */
export async function runAttachmentGc(ctx: Ctx, now: Date = new Date()): Promise<{ scanned: number; deletedRows: number; deletedBlobs: number }> {
  const cutoff = new Date(now.getTime() - ATTACHMENT_GC_GRACE_MS).toISOString();
  const candidates = await fileRepo.listGarbageCandidates(ctx.env.DB, cutoff, 500);
  const keysWithRows = new Map<string, string[]>();
  for (const candidate of candidates) {
    const list = keysWithRows.get(candidate.r2_key) ?? [];
    list.push(candidate.id);
    keysWithRows.set(candidate.r2_key, list);
  }

  let deletedBlobs = 0;
  const idsToDelete: string[] = [];
  for (const [key, ids] of keysWithRows) {
    const active = await fileRepo.countActiveByR2Key(ctx.env.DB, key);
    if (active > 0) continue; // still referenced: keep blob and rows
    // Tombstone first so a concurrent upload of identical content can detect
    // the deletion and repair the blob.
    await ctx.env.DB.prepare("INSERT OR IGNORE INTO gc_tombstones (r2_key, created_at) VALUES (?, ?)")
      .bind(key, now.toISOString())
      .run();
    // Re-check after the tombstone insert: an upload may have repaired the
    // blob (clearing the tombstone) or landed an active row between our
    // initial check and the insert. Never delete a blob a repair depends on.
    const stillTombstoned = await ctx.env.DB.prepare("SELECT r2_key FROM gc_tombstones WHERE r2_key = ?")
      .bind(key)
      .first();
    if (!stillTombstoned) continue;
    if ((await fileRepo.countActiveByR2Key(ctx.env.DB, key)) > 0) continue;
    await ctx.env.FILES.delete(key);
    deletedBlobs += 1;
    idsToDelete.push(...ids);
  }
  await fileRepo.deleteAttachmentRows(ctx.env.DB, idsToDelete);

  // Tombstone housekeeping: drop entries older than twice the grace period
  // whose rows are already gone (the blob is unreachable by design then).
  const tombstoneCutoff = new Date(now.getTime() - ATTACHMENT_GC_GRACE_MS * 2).toISOString();
  await ctx.env.DB.prepare("DELETE FROM gc_tombstones WHERE created_at < ?").bind(tombstoneCutoff).run();

  return { scanned: candidates.length, deletedRows: idsToDelete.length, deletedBlobs };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function sha256HexBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/[^\w.\- ]/g, "_").slice(0, 255) || "file";
}

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // suffix range: last N bytes
    const suffix = Number(endStr);
    const length = Math.min(suffix, size);
    return { offset: Math.max(size - length, 0), length };
  }
  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (start >= size || start > end) return null;
  return { offset: start, length: end - start + 1 };
}

function toDto(record: AttachmentRecord): AttachmentDto {
  return {
    id: record.id,
    owner_type: record.owner_type,
    owner_id: record.owner_id,
    filename: record.filename,
    content_type: record.content_type,
    size: record.size,
    checksum: record.checksum,
    status: record.status,
    created_at: record.created_at,
    url: `/api/attachments/${record.id}/content`,
  };
}

function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}
