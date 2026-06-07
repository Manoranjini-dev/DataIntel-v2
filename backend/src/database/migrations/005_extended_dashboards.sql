-- =====================================================
-- DataIntel v2 — Migration 005: Extended Dashboard Architecture
-- =====================================================
-- Extends dashboards with context_type model,
-- introduces dashboard_widgets_v2 (full model with card linkage,
-- responsive layouts, and version tracking), dashboard permissions,
-- and a partitioned widget_executions table.

-- ─────────────────────────────────────────────
-- 1. ENUM TYPES
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE dashboard_context_type AS ENUM ('org_overview', 'connection', 'combo');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dashboard_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE widget_type AS ENUM (
        'metric_card',
        'line_chart',
        'area_chart',
        'bar_chart',
        'pie_chart',
        'donut_chart',
        'table',
        'heatmap',
        'funnel',
        'scatter',
        'pivot',
        'gauge',
        'treemap',
        'sankey',
        'text',
        'image',
        'divider',
        'filter_control'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────
-- 2. EXTEND DASHBOARDS
-- ─────────────────────────────────────────────
ALTER TABLE dashboards
    -- New context model (replaces connection_id/combo_id/is_org_overview pattern)
    ADD COLUMN IF NOT EXISTS context_type   dashboard_context_type NOT NULL DEFAULT 'connection',
    ADD COLUMN IF NOT EXISTS context_id     UUID,                    -- org_id | connection_id | combo_id

    -- Lifecycle
    ADD COLUMN IF NOT EXISTS status         dashboard_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS version        INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS draft_layout   JSONB,                   -- unsaved builder state

    -- Cache
    ADD COLUMN IF NOT EXISTS redis_key      TEXT,                    -- computed: dash:{dashId}

    -- Audit
    ADD COLUMN IF NOT EXISTS updated_by     UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS published_by   UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by     UUID REFERENCES accounts(id);

-- Backfill context_type from legacy columns
UPDATE dashboards
SET context_type = 'org_overview', context_id = org_id
WHERE is_org_overview = TRUE;

UPDATE dashboards
SET context_type = 'combo', context_id = combo_id
WHERE is_org_overview = FALSE AND combo_id IS NOT NULL;

UPDATE dashboards
SET context_type = 'connection', context_id = connection_id
WHERE is_org_overview = FALSE AND connection_id IS NOT NULL AND combo_id IS NULL;

-- Backfill redis_key
UPDATE dashboards SET redis_key = 'dash:' || id::text WHERE redis_key IS NULL;

-- New indexes
CREATE INDEX IF NOT EXISTS idx_dashboards_context ON dashboards(context_type, context_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboards_status  ON dashboards(org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboards_deleted ON dashboards(deleted_at) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────
-- 3. EXTEND DASHBOARD PAGES
-- ─────────────────────────────────────────────
ALTER TABLE dashboard_pages
    ADD COLUMN IF NOT EXISTS is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS order_index  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS permissions  JSONB NOT NULL DEFAULT '{}',
    -- permissions example: { "viewer": ["uuid1"], "editor": ["uuid2"], "roles": ["admin"] }
    ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

-- Ensure at most one default page per dashboard (enforced at app layer + partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_pages_default
    ON dashboard_pages(dashboard_id) WHERE is_default = TRUE AND deleted_at IS NULL;

-- ─────────────────────────────────────────────
-- 4. DASHBOARD WIDGETS V2
-- Full widget model with card linkage, responsive layouts,
-- independent datasource override, and cache metadata.
-- (Existing dashboard_widgets table kept for historical data)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_widgets_v2 (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id                  UUID NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,

    -- Optional card reference
    card_id                  UUID REFERENCES analytics_cards(id) ON DELETE SET NULL,
    -- If card_id is set and pinned_card_version is NULL → always use latest published version
    pinned_card_version      INTEGER,

    -- Widget identity
    widget_type              widget_type NOT NULL DEFAULT 'table',
    title                    VARCHAR(500),

    -- Grid layout (12-column base)
    grid_x                   INTEGER NOT NULL DEFAULT 0,
    grid_y                   INTEGER NOT NULL DEFAULT 0,
    grid_w                   INTEGER NOT NULL DEFAULT 6,
    grid_h                   INTEGER NOT NULL DEFAULT 4,

    -- Responsive layout overrides (JSON: { x, y, w, h })
    layout_desktop           JSONB NOT NULL DEFAULT '{}',
    layout_tablet            JSONB NOT NULL DEFAULT '{}',
    layout_mobile            JSONB NOT NULL DEFAULT '{}',

    -- Query definition (overrides card definition if present)
    datasource_context_type  datasource_context_type,
    datasource_context_id    UUID,
    query_definition         JSONB NOT NULL DEFAULT '{}',
    query_language           VARCHAR(50) NOT NULL DEFAULT 'sql',

    -- Visualization (overrides card config if present)
    visualization_config     JSONB NOT NULL DEFAULT '{}',

    -- Cache
    cached_result            JSONB,
    cached_at                TIMESTAMPTZ,
    cache_ttl_sec            INTEGER NOT NULL DEFAULT 300,

    -- Refresh
    refresh_interval_sec     INTEGER,                        -- NULL = no auto-refresh

    -- State
    sort_order               INTEGER NOT NULL DEFAULT 0,
    is_hidden                BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit
    created_by               UUID NOT NULL REFERENCES accounts(id),
    updated_by               UUID REFERENCES accounts(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_widgets_v2_page   ON dashboard_widgets_v2(page_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_widgets_v2_card   ON dashboard_widgets_v2(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widgets_v2_source ON dashboard_widgets_v2(datasource_context_type, datasource_context_id)
    WHERE datasource_context_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. WIDGET EXECUTIONS (Partitioned)
-- Time-series log of every widget execution for analytics and debugging.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS widget_executions (
    id           UUID NOT NULL DEFAULT uuid_generate_v4(),
    widget_id    UUID NOT NULL,                              -- dashboard_widgets_v2.id
    org_id       UUID NOT NULL,
    dashboard_id UUID NOT NULL,
    page_id      UUID NOT NULL,
    -- Who/what triggered
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'refresh',     -- 'manual' | 'refresh' | 'publish' | 'scheduler'
    account_id   UUID REFERENCES accounts(id),
    -- Link to query execution
    execution_id UUID REFERENCES query_executions(id) ON DELETE SET NULL,
    -- Result
    status       execution_status NOT NULL,
    error        TEXT,
    -- Timing
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms  INTEGER,
    -- Cache
    cached       BOOLEAN NOT NULL DEFAULT FALSE
) PARTITION BY RANGE (started_at);

CREATE TABLE IF NOT EXISTS widget_executions_2026_06 PARTITION OF widget_executions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS widget_executions_2026_07 PARTITION OF widget_executions
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS widget_executions_2026_08 PARTITION OF widget_executions
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS idx_widget_exec_widget    ON widget_executions(widget_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_exec_dashboard ON widget_executions(dashboard_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_exec_org       ON widget_executions(org_id, started_at DESC);

-- ─────────────────────────────────────────────
-- 6. DASHBOARD PERMISSIONS
-- Fine-grained access control per dashboard.
-- Can be granted to specific accounts or to all users with a given org role.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_permissions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,

    -- Subject: account OR org_role (mutually exclusive)
    account_id   UUID REFERENCES accounts(id) ON DELETE CASCADE,
    org_role     org_role,

    -- Permissions
    can_view     BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    can_publish  BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete   BOOLEAN NOT NULL DEFAULT FALSE,
    can_share    BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit
    granted_by   UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,

    CONSTRAINT chk_perm_subject CHECK (
        (account_id IS NOT NULL AND org_role IS NULL) OR
        (account_id IS NULL AND org_role IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_dash_perms_dashboard ON dashboard_permissions(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dash_perms_account   ON dashboard_permissions(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dash_perms_role      ON dashboard_permissions(dashboard_id, org_role) WHERE org_role IS NOT NULL;

-- ─────────────────────────────────────────────
-- 7. EXTEND query_executions for monthly partitioning support
-- (Composite index for partition-pruning queries)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_query_exec_month_org
    ON query_executions(org_id, date_trunc('month', created_at AT TIME ZONE 'UTC'));
