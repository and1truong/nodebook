-- 0003_search.sql
-- FTS5 search-document index. The search service upserts one row per indexed
-- entity (issue, comment, attachment) and supports an idempotent full rebuild.

CREATE VIRTUAL TABLE search_docs USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  issue_id UNINDEXED,
  issue_type UNINDEXED,
  title,
  content,
  labels,
  attachment_meta,
  tokenize = 'porter unicode61'
);

-- Track index completeness for the rebuild operation.
INSERT INTO meta (key, value) VALUES ('search_rebuilt_at', '');
