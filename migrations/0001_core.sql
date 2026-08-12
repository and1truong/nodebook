-- 0001_core.sql
-- Core tables: issues, labels, comments, relationships, references,
-- audit events, MCP tokens.

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Global sequential issue-number counter. Allocated atomically with a single
-- UPDATE ... RETURNING so concurrent creates never observe the same number.
INSERT INTO meta (key, value) VALUES ('issue_seq', '0');

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('task','bug','epic','story','decision','finding','incident','learning','wiki','note')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  priority TEXT CHECK (priority IN ('low','medium','high','urgent') OR priority IS NULL),
  start_date TEXT,
  due_date TEXT,
  scheduled_date TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence_rule TEXT,
  parent_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES issues(id)
);

CREATE INDEX idx_issues_parent ON issues(parent_id);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_type ON issues(type);
CREATE INDEX idx_issues_due ON issues(due_date);
CREATE INDEX idx_issues_scheduled ON issues(scheduled_date);

CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE issue_labels (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX idx_issue_labels_label ON issue_labels(label_id);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'human',
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_comments_issue ON comments(issue_id);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('related','depends_on','blocks','supersedes','duplicates')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, target_id, type)
);
CREATE INDEX idx_relationships_source ON relationships(source_id);
CREATE INDEX idx_relationships_target ON relationships(target_id);

-- Issue references (#123) found in issue/comment Markdown. target_issue_id is
-- NULL until the referenced number exists; late-resolving is handled by the
-- reference service whenever an issue with that number is created.
-- (Table named issue_references: `references` is a SQLite reserved word.)
CREATE TABLE issue_references (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('issue','comment')),
  source_id TEXT NOT NULL,
  target_number INTEGER NOT NULL,
  target_issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_type, source_id, target_number)
);
CREATE INDEX idx_issue_references_target ON issue_references(target_issue_id);
CREATE INDEX idx_issue_references_number ON issue_references(target_number);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','mcp','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_events(created_at);

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_tokens_hash ON mcp_tokens(token_hash);
