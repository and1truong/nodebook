-- 0010_creator_attribution.sql
-- Keep the machine principal that performed a mutation separate from the
-- human workspace owner on whose behalf it ran. Existing actor/author fields
-- remain unchanged for API and audit compatibility.

-- The credential/connection row is the canonical MCP principal -> owner link.
-- Nullable columns keep credentials created before this migration valid.
ALTER TABLE mcp_tokens ADD COLUMN owner_email TEXT;
ALTER TABLE mcp_tokens ADD COLUMN owner_display_name TEXT;
ALTER TABLE oauth_grants ADD COLUMN owner_email TEXT;
ALTER TABLE oauth_grants ADD COLUMN owner_display_name TEXT;

-- Creation records retain their existing raw actor while adding the human
-- subject and transport. Historical MCP rows remain nullable and are resolved
-- through the connection tables when possible.
ALTER TABLE issues ADD COLUMN created_for TEXT;
ALTER TABLE issues ADD COLUMN created_via TEXT CHECK (created_via IN ('web','mcp','system'));
ALTER TABLE comments ADD COLUMN author_for TEXT;
ALTER TABLE comments ADD COLUMN author_via TEXT CHECK (author_via IN ('web','mcp','system'));
ALTER TABLE relationships ADD COLUMN created_for TEXT;
ALTER TABLE relationships ADD COLUMN created_via TEXT CHECK (created_via IN ('web','mcp','system'));
ALTER TABLE reminders ADD COLUMN created_for TEXT;
ALTER TABLE reminders ADD COLUMN created_via TEXT CHECK (created_via IN ('web','mcp','system'));
ALTER TABLE attachments ADD COLUMN uploaded_for TEXT;
ALTER TABLE attachments ADD COLUMN uploaded_via TEXT CHECK (uploaded_via IN ('web','mcp','system'));

-- Every mutation already emits an immutable audit event. Extend that canonical
-- trail with actor-vs-subject and source semantics, covering updates, closes,
-- deletes, reminder changes, parent changes, and attachment mutations.
ALTER TABLE audit_events ADD COLUMN subject_id TEXT;
ALTER TABLE audit_events ADD COLUMN subject_email TEXT;
ALTER TABLE audit_events ADD COLUMN subject_display_name TEXT;
ALTER TABLE audit_events ADD COLUMN via TEXT CHECK (via IN ('web','mcp','system'));

-- Deterministic backfill for direct human/system history. MCP history is left
-- with a null subject because SQL migrations cannot safely guess an owner;
-- reads resolve it through retained token/grant ownership where available.
UPDATE issues
SET created_for = CASE
      WHEN created_by LIKE 'mcp:%' OR created_by LIKE 'system:%' THEN NULL
      ELSE created_by
    END,
    created_via = CASE
      WHEN created_by LIKE 'mcp:%' THEN 'mcp'
      WHEN created_by LIKE 'system:%' THEN 'system'
      ELSE 'web'
    END
WHERE created_for IS NULL;

UPDATE comments
SET author_for = CASE WHEN author_type = 'human' THEN author ELSE NULL END,
    author_via = CASE author_type WHEN 'mcp' THEN 'mcp' WHEN 'system' THEN 'system' ELSE 'web' END;

UPDATE relationships
SET created_for = CASE
      WHEN created_by LIKE 'mcp:%' OR created_by LIKE 'system:%' THEN NULL
      ELSE created_by
    END,
    created_via = CASE
      WHEN created_by LIKE 'mcp:%' THEN 'mcp'
      WHEN created_by LIKE 'system:%' THEN 'system'
      ELSE 'web'
    END
WHERE created_for IS NULL;

UPDATE reminders
SET created_for = CASE
      WHEN created_by LIKE 'mcp:%' OR created_by LIKE 'system:%' THEN NULL
      ELSE created_by
    END,
    created_via = CASE
      WHEN created_by LIKE 'mcp:%' THEN 'mcp'
      WHEN created_by LIKE 'system:%' THEN 'system'
      ELSE 'web'
    END
WHERE created_for IS NULL;

UPDATE attachments
SET uploaded_for = CASE
      WHEN uploaded_by LIKE 'mcp:%' OR uploaded_by LIKE 'system:%' THEN NULL
      ELSE uploaded_by
    END,
    uploaded_via = CASE
      WHEN uploaded_by LIKE 'mcp:%' THEN 'mcp'
      WHEN uploaded_by LIKE 'system:%' THEN 'system'
      ELSE 'web'
    END
WHERE uploaded_for IS NULL;

UPDATE audit_events
SET subject_id = CASE WHEN actor_type = 'human' THEN actor_id ELSE NULL END,
    subject_email = CASE WHEN actor_type = 'human' THEN actor_id ELSE NULL END,
    via = CASE actor_type WHEN 'mcp' THEN 'mcp' WHEN 'system' THEN 'system' ELSE 'web' END;
