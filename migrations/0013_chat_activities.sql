CREATE TABLE chat_message_activities (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  label TEXT NOT NULL,
  input_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('complete', 'error')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_message_activities_message ON chat_message_activities(message_id, created_at);
