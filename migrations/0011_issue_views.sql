-- 0011_issue_views.sql
-- Workspace-level named filter sets rendered as tabs on the Issues page.

CREATE TABLE issue_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
