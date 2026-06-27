-- =====================================================
-- DataIntel v2 — Migration 016: Simplify Connection Sharing (user-based only)
-- =====================================================
-- Removes organization-role sharing from datasource_permissions, leaving a
-- purely account/user-based sharing model. Connection sharing is now driven
-- entirely by the owner (datasource_connections.created_by) granting specific
-- users read-only or edit access.
--
-- Idempotent: safe to run against databases created with either the original
-- (015 with org_role) or the updated 015 schema.

-- Drop any org-role-only grants — they are no longer supported.
DELETE FROM datasource_permissions WHERE account_id IS NULL;

-- Remove the account/org_role mutual-exclusion check (referenced org_role).
ALTER TABLE datasource_permissions DROP CONSTRAINT IF EXISTS chk_ds_perm_subject;

-- Drop the org-role lookup index and column.
DROP INDEX IF EXISTS idx_ds_perms_role;
ALTER TABLE datasource_permissions DROP COLUMN IF EXISTS org_role;

-- can_share is unused: only the owner (created_by) can manage shares.
ALTER TABLE datasource_permissions DROP COLUMN IF EXISTS can_share;

-- account_id is now the required subject of every grant.
ALTER TABLE datasource_permissions ALTER COLUMN account_id SET NOT NULL;

-- Replace the partial account index (WHERE account_id IS NOT NULL) with a plain one.
DROP INDEX IF EXISTS idx_ds_perms_account;
CREATE INDEX IF NOT EXISTS idx_ds_perms_account ON datasource_permissions(account_id);
