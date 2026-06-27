-- =====================================================
-- DataIntel v2 — Migration 015: Connection Sharing + Auto-Refresh
-- =====================================================
-- Adds simple, user-based per-connection sharing (view/edit access granted
-- to specific accounts) plus configurable auto-refresh scheduling for
-- datasource connections.
--
-- NOTE: Sharing is purely account/user-based. The connection owner
-- (datasource_connections.created_by) has full control and may grant other
-- users read-only or edit access. There are no organization-role grants.
-- (Migration 016 strips org_role from databases created before this change.)

-- ─────────────────────────────────────────────
-- 1. DATASOURCE PERMISSIONS
-- Per-connection access grants for specific user accounts.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasource_permissions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,

    -- Subject: the user account this grant applies to
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- Access level
    can_view      BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit
    granted_by    UUID NOT NULL REFERENCES accounts(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ,

    CONSTRAINT uq_ds_perm_account UNIQUE (connection_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_ds_perms_connection ON datasource_permissions(connection_id);
CREATE INDEX IF NOT EXISTS idx_ds_perms_account    ON datasource_permissions(account_id);

-- ─────────────────────────────────────────────
-- 2. AUTO-REFRESH SCHEDULING
-- Lets users configure a recurring sync interval (in minutes) per
-- connection — e.g. every 10 minutes, hourly, etc.
-- ─────────────────────────────────────────────
ALTER TABLE datasource_connections
    ADD COLUMN IF NOT EXISTS refresh_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS refresh_interval_minutes  INTEGER,
    ADD COLUMN IF NOT EXISTS next_refresh_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_refresh_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_refresh_status       VARCHAR(20),  -- 'success' | 'error'
    ADD COLUMN IF NOT EXISTS last_refresh_error        TEXT,
    ADD CONSTRAINT chk_refresh_interval CHECK (
        refresh_interval_minutes IS NULL OR
        (refresh_interval_minutes BETWEEN 5 AND 1440)
    );

CREATE INDEX IF NOT EXISTS idx_ds_connections_refresh_due
    ON datasource_connections(next_refresh_at)
    WHERE deleted_at IS NULL AND refresh_enabled = TRUE;
