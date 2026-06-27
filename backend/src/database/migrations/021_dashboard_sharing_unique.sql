-- ──────────────────────────────────────────────
-- Migration 021: Unique index for account-based dashboard sharing
-- Enables ON CONFLICT upsert when granting/updating dashboard access.
-- ──────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_dash_perms_account
  ON dashboard_permissions(dashboard_id, account_id)
  WHERE account_id IS NOT NULL;
