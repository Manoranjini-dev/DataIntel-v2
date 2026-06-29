-- =====================================================
-- DataIntel v2 — Migration 023: Page & Card (Widget) Shares
-- =====================================================
-- Extends sharing below the dashboard level. Mirrors dashboard_shares (022)
-- and card_shares (020) exactly — same shape, same semantics — but scoped to
-- a single dashboard_pages row or a single dashboard_widgets_v2 row.
--
-- These grants are independent of dashboard-level sharing: a page/widget
-- share gives access to ONLY that page/widget, not the rest of the
-- dashboard. Dashboard-level sharing still grants access to everything it
-- contains (unchanged) — this migration only adds a narrower, additive path.

CREATE TABLE IF NOT EXISTS dashboard_page_shares (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id      UUID NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
    shared_with  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    shared_by    UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_page_shares_page        ON dashboard_page_shares(page_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_page_shares_shared_with ON dashboard_page_shares(shared_with);

CREATE TABLE IF NOT EXISTS dashboard_widget_shares (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    widget_id    UUID NOT NULL REFERENCES dashboard_widgets_v2(id) ON DELETE CASCADE,
    shared_with  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    shared_by    UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (widget_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_widget_shares_widget      ON dashboard_widget_shares(widget_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_shares_shared_with ON dashboard_widget_shares(shared_with);
