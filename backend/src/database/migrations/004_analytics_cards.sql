-- =====================================================
-- DataIntel v2 — Migration 004: Analytics Card Library
-- =====================================================
-- Introduces the first-class AnalyticsCard entity with:
-- versioning (draft → published → archived), folder hierarchy,
-- tag index for full-text search, and visibility scoping.

-- ─────────────────────────────────────────────
-- 1. ENUM TYPES
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE card_visibility AS ENUM ('private', 'org_shared', 'public');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE card_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE chart_type AS ENUM (
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

DO $$ BEGIN
    CREATE TYPE datasource_context_type AS ENUM ('connection', 'combo');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────
-- 2. CARD FOLDERS
-- Hierarchical folder tree for organizing cards.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_folders (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_id    UUID REFERENCES card_folders(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    color        VARCHAR(20),
    created_by   UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_card_folders_org    ON card_folders(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_card_folders_parent ON card_folders(parent_id) WHERE parent_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 3. ANALYTICS CARDS (Root entity)
-- A reusable query + visualization unit that can be placed
-- in multiple dashboards and promoted from chat responses.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_cards (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    folder_id                UUID REFERENCES card_folders(id) ON DELETE SET NULL,

    -- Identity
    name                     VARCHAR(500) NOT NULL,
    description              TEXT,

    -- Datasource context
    datasource_context_type  datasource_context_type NOT NULL,
    datasource_context_id    UUID NOT NULL,          -- connection_id OR combo_id

    -- Query definition (structured)
    query_definition         JSONB NOT NULL DEFAULT '{}',
    -- Example: {
    --   "sql": "SELECT ...",
    --   "dialect": "postgres",
    --   "parameters": [],
    --   "filters": [],
    --   "limit": 500
    -- }
    raw_query                TEXT,                   -- actual SQL / ES DSL / Mongo agg string
    query_language           VARCHAR(50) NOT NULL DEFAULT 'sql',
    -- Values: sql | elasticsearch_dsl | mongo_aggregation | databricks_sql | bigquery_sql

    -- Visualization
    chart_type               chart_type NOT NULL DEFAULT 'table',
    visualization_config     JSONB NOT NULL DEFAULT '{}',
    -- Example: {
    --   "xAxis": "date", "yAxis": "revenue",
    --   "colors": ["#6366f1"], "legend": true,
    --   "thresholds": [{ "value": 1000, "color": "red" }]
    -- }

    -- Versioning
    current_version          INTEGER NOT NULL DEFAULT 1,
    status                   card_status NOT NULL DEFAULT 'draft',

    -- Sharing
    visibility               card_visibility NOT NULL DEFAULT 'private',

    -- Metadata
    tags                     TEXT[] NOT NULL DEFAULT '{}',

    -- Audit
    created_by               UUID NOT NULL REFERENCES accounts(id),
    updated_by               UUID REFERENCES accounts(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ,
    deleted_by               UUID REFERENCES accounts(id),

    -- Execution cache reference
    last_executed_at         TIMESTAMPTZ,
    last_execution_id        UUID    -- references query_executions(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_org          ON analytics_cards(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_folder       ON analytics_cards(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_datasource   ON analytics_cards(datasource_context_type, datasource_context_id);
CREATE INDEX IF NOT EXISTS idx_cards_tags         ON analytics_cards USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_cards_created_by   ON analytics_cards(created_by);
CREATE INDEX IF NOT EXISTS idx_cards_status       ON analytics_cards(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_visibility   ON analytics_cards(org_id, visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_updated      ON analytics_cards(org_id, updated_at DESC) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────
-- 4. ANALYTICS CARD VERSIONS
-- Immutable version snapshots. Every publish creates a new version row.
-- draft → published transition sets published_at.
-- rollback creates a new version copying from target version.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_card_versions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    card_id              UUID NOT NULL REFERENCES analytics_cards(id) ON DELETE CASCADE,
    version              INTEGER NOT NULL,

    -- Snapshotted state at this version
    query_definition     JSONB NOT NULL,
    raw_query            TEXT,
    chart_type           chart_type NOT NULL,
    visualization_config JSONB NOT NULL,
    query_language       VARCHAR(50) NOT NULL DEFAULT 'sql',

    -- Change metadata
    change_summary       TEXT,                       -- user-provided description of what changed
    is_rollback          BOOLEAN NOT NULL DEFAULT FALSE,
    rollback_from_version INTEGER,

    -- Publish lifecycle
    published_at         TIMESTAMPTZ,
    published_by         UUID REFERENCES accounts(id),

    -- Audit
    created_by           UUID NOT NULL REFERENCES accounts(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(card_id, version)
);

CREATE INDEX IF NOT EXISTS idx_card_versions_card ON analytics_card_versions(card_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_card_versions_pub  ON analytics_card_versions(card_id, published_at DESC)
    WHERE published_at IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. CARD TAG INDEX (Normalized for fast tag search)
-- Denormalized from analytics_cards.tags array for index-based tag filtering.
-- Maintained via trigger.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_tag_index (
    card_id UUID NOT NULL REFERENCES analytics_cards(id) ON DELETE CASCADE,
    tag     VARCHAR(100) NOT NULL,
    PRIMARY KEY (card_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_card_tag_tag ON card_tag_index(tag);

-- Trigger to keep tag_index in sync
CREATE OR REPLACE FUNCTION sync_card_tags() RETURNS trigger AS $$
DECLARE
    t TEXT;
BEGIN
    DELETE FROM card_tag_index WHERE card_id = NEW.id;
    FOREACH t IN ARRAY NEW.tags LOOP
        INSERT INTO card_tag_index (card_id, tag) VALUES (NEW.id, t)
        ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_card_tags ON analytics_cards;
CREATE TRIGGER trg_sync_card_tags
    AFTER INSERT OR UPDATE OF tags ON analytics_cards
    FOR EACH ROW EXECUTE FUNCTION sync_card_tags();
