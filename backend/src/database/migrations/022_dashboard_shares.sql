-- =====================================================
-- DataIntel v2 — Migration 022: Dashboard Shares
-- =====================================================
-- Adds simple, user-based per-dashboard sharing (view/edit access granted
-- to specific accounts). Mirrors the card_shares pattern introduced in 020.
-- The dashboard owner (dashboards.created_by) always has full control.

CREATE TABLE IF NOT EXISTS dashboard_shares (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    shared_with  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    shared_by    UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dashboard_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_shares_dashboard   ON dashboard_shares(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_shares_shared_with ON dashboard_shares(shared_with);
