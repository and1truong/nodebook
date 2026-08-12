-- 0002_graph.sql
-- Wiki/graph query support: indexes and a projection view used by the wiki
-- navigation, hierarchy tree, and backlink panels.

-- View combining each issue with its child count and incoming-reference count
-- (the "wiki projection" used by navigation and related-content sections).
CREATE VIEW issue_stats AS
SELECT
  i.*,
  (SELECT COUNT(*) FROM issues c WHERE c.parent_id = i.id) AS child_count,
  (SELECT COUNT(*) FROM issue_references r WHERE r.target_issue_id = i.id) AS backlink_count
FROM issues i;
