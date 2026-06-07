-- =====================================================
-- DataIntel v2 — Migration 010: Dashboard Versioning
-- =====================================================

CREATE TABLE IF NOT EXISTS dashboard_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id    UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    context_type    dashboard_context_type NOT NULL,
    context_id      UUID,
    change_summary  TEXT,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by    UUID REFERENCES accounts(id),
    UNIQUE(dashboard_id, version)
);

CREATE TABLE IF NOT EXISTS dashboard_page_versions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_version_id  UUID NOT NULL REFERENCES dashboard_versions(id) ON DELETE CASCADE,
    original_page_id      UUID NOT NULL,
    name                  VARCHAR(255) NOT NULL,
    order_index           INTEGER NOT NULL DEFAULT 0,
    is_default            BOOLEAN NOT NULL DEFAULT FALSE,
    permissions           JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS dashboard_widget_versions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_version_id       UUID NOT NULL REFERENCES dashboard_page_versions(id) ON DELETE CASCADE,
    original_widget_id    UUID NOT NULL,
    card_id               UUID,
    pinned_card_version   INTEGER,
    widget_type           widget_type NOT NULL DEFAULT 'table',
    title                 VARCHAR(500),
    grid_x                INTEGER NOT NULL DEFAULT 0,
    grid_y                INTEGER NOT NULL DEFAULT 0,
    grid_w                INTEGER NOT NULL DEFAULT 6,
    grid_h                INTEGER NOT NULL DEFAULT 4,
    layout_desktop        JSONB NOT NULL DEFAULT '{}',
    layout_tablet         JSONB NOT NULL DEFAULT '{}',
    layout_mobile         JSONB NOT NULL DEFAULT '{}',
    datasource_context_type datasource_context_type,
    datasource_context_id UUID,
    query_definition      JSONB NOT NULL DEFAULT '{}',
    query_language        VARCHAR(50) NOT NULL DEFAULT 'sql',
    visualization_config  JSONB NOT NULL DEFAULT '{}'
);
