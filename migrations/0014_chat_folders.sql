CREATE TABLE chat_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 80 AND name = trim(name)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE chat_conversations
  ADD COLUMN folder_id TEXT REFERENCES chat_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_conversations_folder ON chat_conversations(folder_id);
