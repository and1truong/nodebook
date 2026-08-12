-- 0004_planning.sql
-- Recurring-task completion occurrences (planning view support).

CREATE TABLE occurrences (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (issue_id, occurred_on)
);
CREATE INDEX idx_occurrences_issue ON occurrences(issue_id);
