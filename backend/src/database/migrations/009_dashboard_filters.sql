-- =====================================================
-- DataIntel v2 — Migration 009: Dashboard Filters
-- =====================================================

CREATE TABLE IF NOT EXISTS dashboard_filters (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    filter_type  VARCHAR(50) NOT NULL,
    config       JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_filters_dash ON dashboard_filters(dashboard_id);
