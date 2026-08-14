-- 0008_issue_version.sql
-- Monotonic revision used for optimistic locking across browser and MCP edits.

ALTER TABLE issues ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
