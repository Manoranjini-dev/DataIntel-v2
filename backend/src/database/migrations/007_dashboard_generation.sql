-- =====================================================
-- DataIntel v2 — Migration 007: Dashboard Generation Engine
-- =====================================================
-- Adds:
-- - Dashboard templates (system + org-specific)
-- - AI dashboard generation job queue table
-- - Row-Level Security (RLS) policies
-- - Partition management helper function
-- - Additional audit_event_type values for new domains

-- ─────────────────────────────────────────────
-- 1. EXTEND audit_event_type ENUM
-- ─────────────────────────────────────────────
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'card_created';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'card_updated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'card_published';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'card_deleted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'card_version_rollback';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_health_check';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_schema_synced';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_credentials_rotated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'dashboard_page_created';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'dashboard_page_deleted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'widget_executed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'widget_cache_invalidated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'chat_message_promoted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'org_invitation_sent';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'org_invitation_accepted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'org_invitation_revoked';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'query_approval_requested';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'query_approval_granted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'query_approval_rejected';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'dashboard_generated';

-- ─────────────────────────────────────────────
-- 2. DASHBOARD TEMPLATES
-- System templates (is_system=TRUE, org_id=NULL) are built-in blueprints.
-- Org templates (org_id set) are custom templates created by organizations.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_templates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id           UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = system template

    -- Identity
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    thumbnail_url    TEXT,

    -- Applicability
    context_type     dashboard_context_type NOT NULL,
    connector_types  TEXT[] NOT NULL DEFAULT '{}',     -- applicable connector types (empty = all)
    tags             TEXT[] NOT NULL DEFAULT '{}',

    -- Template definition
    template_config  JSONB NOT NULL DEFAULT '{}',
    -- Schema:
    -- {
    --   "pages": [
    --     {
    --       "name": "Overview",
    --       "isDefault": true,
    --       "widgets": [
    --         {
    --           "widgetType": "metric_card",
    --           "title": "Total Records",
    --           "gridX": 0, "gridY": 0, "gridW": 3, "gridH": 2,
    --           "queryTemplate": "SELECT COUNT(*) FROM {primary_table}",
    --           "vizConfig": {}
    --         }
    --       ]
    --     }
    --   ]
    -- }

    -- Flags
    is_system        BOOLEAN NOT NULL DEFAULT FALSE,
    is_public        BOOLEAN NOT NULL DEFAULT FALSE,   -- visible to all orgs (for org templates)

    -- Stats
    usage_count      INTEGER NOT NULL DEFAULT 0,

    -- Audit
    created_by       UUID REFERENCES accounts(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_system    ON dashboard_templates(is_system) WHERE is_system = TRUE;
CREATE INDEX IF NOT EXISTS idx_templates_org       ON dashboard_templates(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_templates_public    ON dashboard_templates(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_templates_context   ON dashboard_templates(context_type);
CREATE INDEX IF NOT EXISTS idx_templates_tags      ON dashboard_templates USING GIN(tags);

-- ─────────────────────────────────────────────
-- 3. DASHBOARD GENERATION JOBS
-- Records every AI dashboard generation request with full lifecycle tracking.
-- The actual heavy work is done by the dashboard-generation BullMQ queue.
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE generation_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS dashboard_generation_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    chat_id         UUID REFERENCES chats(id) ON DELETE SET NULL,
    dashboard_id    UUID REFERENCES dashboards(id) ON DELETE SET NULL,  -- populated on completion
    template_id     UUID REFERENCES dashboard_templates(id) ON DELETE SET NULL,
    bull_job_id     TEXT,                                                -- BullMQ job ID for status lookup

    -- Input context
    context         JSONB NOT NULL DEFAULT '{}',
    -- {
    --   "datasourceContextType": "connection",
    --   "datasourceContextId": "uuid",
    --   "userIntent": "Create a sales analytics dashboard",
    --   "suggestedMetrics": [...],
    --   "connectorType": "postgres"
    -- }

    -- Lifecycle
    status          generation_status NOT NULL DEFAULT 'queued',
    progress        INTEGER NOT NULL DEFAULT 0,   -- 0-100
    progress_steps  JSONB NOT NULL DEFAULT '[]',  -- [{ step, label, completedAt }]

    -- Result
    result          JSONB,                        -- generated pages/widgets blueprint
    error           TEXT,

    -- Requester
    requested_by    UUID NOT NULL REFERENCES accounts(id),

    -- Timestamps
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gen_jobs_org     ON dashboard_generation_jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_status  ON dashboard_generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_chat    ON dashboard_generation_jobs(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gen_jobs_account ON dashboard_generation_jobs(requested_by);

-- ─────────────────────────────────────────────
-- 4. ROW-LEVEL SECURITY (RLS)
-- Defense-in-depth: ensures tenant isolation even if application layer has a bug.
-- NestJS DatabaseService must execute SET LOCAL app.current_org_id = '<uuid>'
-- and SET LOCAL app.current_account_id = '<uuid>' at the start of every transaction.
-- ─────────────────────────────────────────────

-- Enable RLS on all tenant-scoped tables
ALTER TABLE datasource_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasource_combos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_cards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs           ENABLE ROW LEVEL SECURITY;

-- Helper function (avoids exception when setting not initialized)
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_org_id', TRUE)::UUID;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS Policies
-- IMPORTANT: these policies apply to app role only.
-- The superuser / migration role bypasses RLS.

-- datasource_connections
CREATE POLICY tenant_isolation_connections ON datasource_connections
    USING (org_id = current_org_id());

-- datasource_combos
CREATE POLICY tenant_isolation_combos ON datasource_combos
    USING (org_id = current_org_id());

-- analytics_cards
CREATE POLICY tenant_isolation_cards ON analytics_cards
    USING (org_id = current_org_id() AND deleted_at IS NULL);

-- dashboards
CREATE POLICY tenant_isolation_dashboards ON dashboards
    USING (org_id = current_org_id() AND deleted_at IS NULL);

-- chats
CREATE POLICY tenant_isolation_chats ON chats
    USING (org_id = current_org_id() AND deleted_at IS NULL);

-- org_settings
CREATE POLICY tenant_isolation_org_settings ON org_settings
    USING (org_id = current_org_id());

-- ai_provider_configs
CREATE POLICY tenant_isolation_ai_configs ON ai_provider_configs
    USING (org_id = current_org_id());

-- ─────────────────────────────────────────────
-- 5. PARTITION MANAGEMENT FUNCTION
-- Called by a monthly scheduler job to pre-create next month's partitions.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_monthly_partitions(target_date DATE DEFAULT CURRENT_DATE + INTERVAL '1 month')
RETURNS void AS $$
DECLARE
    partition_start DATE;
    partition_end   DATE;
    partition_name  TEXT;
    month_str       TEXT;
BEGIN
    partition_start := date_trunc('month', target_date)::DATE;
    partition_end   := (partition_start + INTERVAL '1 month')::DATE;
    month_str       := to_char(partition_start, 'YYYY_MM');

    -- widget_executions
    partition_name := 'widget_executions_' || month_str;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = partition_name) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF widget_executions FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;

    -- connection_health_logs
    partition_name := 'connection_health_logs_' || month_str;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = partition_name) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF connection_health_logs FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;

    RAISE NOTICE 'Partition management complete for %', month_str;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 6. INSERT SYSTEM DASHBOARD TEMPLATES
-- ─────────────────────────────────────────────
INSERT INTO dashboard_templates (name, description, context_type, connector_types, tags, is_system, is_public, template_config)
VALUES
(
    'Database Overview',
    'A general-purpose overview dashboard for any relational database connection.',
    'connection',
    ARRAY['postgres', 'mysql', 'mssql', 'oracle'],
    ARRAY['overview', 'relational'],
    TRUE,
    TRUE,
    '{
        "pages": [
            {
                "name": "Overview",
                "isDefault": true,
                "widgets": [
                    { "widgetType": "metric_card", "title": "Table Count", "gridX": 0, "gridY": 0, "gridW": 3, "gridH": 2, "queryTemplate": "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ''public''" },
                    { "widgetType": "table", "title": "Largest Tables", "gridX": 3, "gridY": 0, "gridW": 9, "gridH": 4, "queryTemplate": "SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size FROM information_schema.tables WHERE table_schema = ''public'' ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC LIMIT 10" }
                ]
            }
        ]
    }'::jsonb
),
(
    'Sales Analytics',
    'Revenue, orders, and customer analytics for e-commerce databases.',
    'connection',
    ARRAY['postgres', 'mysql', 'snowflake', 'bigquery', 'redshift', 'databricks'],
    ARRAY['sales', 'revenue', 'ecommerce'],
    TRUE,
    TRUE,
    '{"pages": [{"name": "Revenue", "isDefault": true, "widgets": []}, {"name": "Orders", "isDefault": false, "widgets": []}, {"name": "Customers", "isDefault": false, "widgets": []}]}'::jsonb
),
(
    'Multi-Source Federation',
    'Cross-datasource analytics for combo workspaces.',
    'combo',
    ARRAY[]::TEXT[],
    ARRAY['federation', 'multi-source', 'cross-source'],
    TRUE,
    TRUE,
    '{"pages": [{"name": "Overview", "isDefault": true, "widgets": []}, {"name": "Data Quality", "isDefault": false, "widgets": []}]}'::jsonb
)
ON CONFLICT DO NOTHING;
