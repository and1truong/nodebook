-- 0005_reminders.sql
-- Reminders (absolute / before-due / recurring), their materialized delivery
-- occurrences with expiring claim locks, and the in-app notification inbox.

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('absolute','before_due','recurring')),
  trigger_at TEXT,
  offset_minutes INTEGER,
  recurrence_rule TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dismissed','snoozed')),
  snooze_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_triggered_at TEXT
);
CREATE INDEX idx_reminders_issue ON reminders(issue_id);
CREATE INDEX idx_reminders_status ON reminders(status);

-- One row per scheduled delivery. Claims use an expiring lock
-- (status='claimed', claimed_until) so a crashed attempt is retried later.
CREATE TABLE reminder_occurrences (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  occurrence_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','claimed','delivered','failed','cancelled')),
  claimed_at TEXT,
  claimed_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  notification_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_occurrences_due ON reminder_occurrences(status, occurrence_at);
CREATE INDEX idx_occurrences_reminder ON reminder_occurrences(reminder_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  kind TEXT NOT NULL DEFAULT 'reminder',
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_email, read_at, created_at);

-- Delivery dedup: a unique (reminder, occurrence, channel) idempotency key
-- guards notification insertion against duplicate Cron invocations.
CREATE TABLE notification_deliveries (
  idempotency_key TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
