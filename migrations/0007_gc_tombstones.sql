-- 0007_gc_tombstones.sql
-- Tombstones for attachment garbage collection. The GC writes a tombstone for
-- a blob before deleting it; a concurrent upload that lands a row for the same
-- checksum around the deletion repairs the blob (re-put) and clears the
-- tombstone. The GC re-checks the tombstone and the active-row count right
-- before deleting, and the upload verifies the blob after repairing, so a
-- delete can never land after a completed repair. This closes the D1/R2
-- cross-store race where a blob could be deleted between an upload's put and
-- its row insert.

CREATE TABLE gc_tombstones (
  r2_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
