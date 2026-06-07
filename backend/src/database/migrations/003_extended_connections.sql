-- =====================================================
-- DataIntel v2 — Migration 003: Extended Datasource Connections
-- =====================================================
-- Adds new connector types (Snowflake, BigQuery, MSSQL, Oracle, Redshift),
-- connection pooling + timeout configuration, credential rotation log,
-- and a partitioned health log table.

-- ─────────────────────────────────────────────
-- 1. EXTEND connector_type ENUM
-- ─────────────────────────────────────────────
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'snowflake';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'bigquery';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'mssql';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'oracle';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'redshift';

-- ─────────────────────────────────────────────
-- 2. EXTEND datasource_connections
-- ─────────────────────────────────────────────
ALTER TABLE datasource_connections
    -- UI / display
    ADD COLUMN IF NOT EXISTS display_name          VARCHAR(255),
    ADD COLUMN IF NOT EXISTS color                 VARCHAR(20),
    ADD COLUMN IF NOT EXISTS icon                  VARCHAR(100),
    -- Connection pooling
    ADD COLUMN IF NOT EXISTS pool_min              INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS pool_max              INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS pool_acquire_timeout_ms INTEGER NOT NULL DEFAULT 30000,
    ADD COLUMN IF NOT EXISTS pool_idle_timeout_ms  INTEGER NOT NULL DEFAULT 10000,
    -- Query limits
    ADD COLUMN IF NOT EXISTS query_timeout_ms      INTEGER NOT NULL DEFAULT 30000,
    ADD COLUMN IF NOT EXISTS max_query_rows        INTEGER NOT NULL DEFAULT 5000,
    -- Schema sync schedule (JSONB: { cron: "0 */6 * * *", timezone: "UTC" })
    ADD COLUMN IF NOT EXISTS sync_schedule         JSONB,
    -- Error tracking
    ADD COLUMN IF NOT EXISTS error_count           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    -- Soft delete + audit
    ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by            UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS updated_by            UUID REFERENCES accounts(id);

-- Additional indexes
CREATE INDEX IF NOT EXISTS idx_ds_connections_deleted    ON datasource_connections(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ds_connections_health_due ON datasource_connections(last_health_check, health_check_interval_sec)
    WHERE deleted_at IS NULL AND status = 'active';

-- ─────────────────────────────────────────────
-- 3. DATASOURCE COMBO EXTENSIONS
-- ─────────────────────────────────────────────
ALTER TABLE datasource_combos
    ADD COLUMN IF NOT EXISTS color      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS icon       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES accounts(id);

CREATE INDEX IF NOT EXISTS idx_combos_deleted ON datasource_combos(deleted_at) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────
-- 4. CONNECTION HEALTH LOGS (Partitioned)
-- Partitioned by checked_at for scalable time-series storage.
-- Partitions created monthly by the scheduler worker.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connection_health_logs (
    id            UUID NOT NULL DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_healthy    BOOLEAN NOT NULL,
    latency_ms    INTEGER,
    error_message TEXT,
    error_code    VARCHAR(100),
    checked_by    VARCHAR(50) NOT NULL DEFAULT 'scheduler'   -- 'scheduler' | 'manual' | 'api'
) PARTITION BY RANGE (checked_at);

-- Initial partitions (current + next 2 months)
CREATE TABLE IF NOT EXISTS connection_health_logs_2026_06 PARTITION OF connection_health_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS connection_health_logs_2026_07 PARTITION OF connection_health_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS connection_health_logs_2026_08 PARTITION OF connection_health_logs
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS idx_health_logs_conn   ON connection_health_logs(connection_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_org    ON connection_health_logs(org_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_status ON connection_health_logs(is_healthy, checked_at DESC);

-- ─────────────────────────────────────────────
-- 5. CONNECTION CREDENTIAL ROTATION LOG
-- Audits every credential rotation event.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connection_credential_rotations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL,
    rotated_by      UUID NOT NULL REFERENCES accounts(id),
    rotation_reason TEXT,
    previous_username VARCHAR(255),                          -- old username (for audit; no password stored)
    rotated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cred_rotations_conn ON connection_credential_rotations(connection_id);
CREATE INDEX IF NOT EXISTS idx_cred_rotations_org  ON connection_credential_rotations(org_id);

-- ─────────────────────────────────────────────
-- 6. EXTEND connection_schemas with soft-delete + version
-- ─────────────────────────────────────────────
ALTER TABLE connection_schemas
    ADD COLUMN IF NOT EXISTS version    INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS synced_by  VARCHAR(50) NOT NULL DEFAULT 'manual',  -- 'manual' | 'scheduler' | 'auto'
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE connection_tables
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE connection_columns
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
