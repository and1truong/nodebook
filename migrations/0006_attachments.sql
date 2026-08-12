-- 0006_attachments.sql
-- Private attachment metadata. Blob content lives in R2 under
-- `blobs/<sha256>`; rows are soft-deleted and garbage-collected daily so a
-- D1/R2 partial failure never deletes a still-referenced blob.

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('issue','comment')),
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id, status);
CREATE INDEX idx_attachments_checksum ON attachments(checksum);
CREATE INDEX idx_attachments_deleted ON attachments(status, deleted_at);
