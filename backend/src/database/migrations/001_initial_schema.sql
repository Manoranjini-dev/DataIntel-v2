-- =====================================================
-- DataIntel v2 — Neon Postgres Schema Migration
-- =====================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. ACCOUNTS (Users)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    display_name    VARCHAR(255) NOT NULL,
    password_hash   TEXT NOT NULL,
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

-- ─────────────────────────────────────────────
-- 2. ORGANIZATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    logo_url        TEXT,
    owner_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);

-- ─────────────────────────────────────────────
-- 3. ORG MEMBERS
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS org_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role            org_role NOT NULL DEFAULT 'viewer',
    invited_by      UUID REFERENCES accounts(id),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_account ON org_members(account_id);

-- ─────────────────────────────────────────────
-- 4. DATASOURCE CONNECTIONS
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE connector_type AS ENUM ('mysql', 'postgres', 'elasticsearch', 'mongodb', 'databricks');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE connection_status AS ENUM ('active', 'inactive', 'error', 'testing');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS datasource_connections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    connector_type  connector_type NOT NULL,
    host            VARCHAR(512) NOT NULL,
    port            INTEGER NOT NULL,
    database_name   VARCHAR(255) NOT NULL,
    username        VARCHAR(255) NOT NULL,
    encrypted_password TEXT NOT NULL,
    ssl_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    ssl_config      JSONB,
    connection_options JSONB NOT NULL DEFAULT '{}',
    status          connection_status NOT NULL DEFAULT 'inactive',
    last_health_check TIMESTAMPTZ,
    last_health_ok  BOOLEAN,
    health_check_interval_sec INTEGER NOT NULL DEFAULT 300,
    schema_synced_at TIMESTAMPTZ,
    created_by      UUID NOT NULL REFERENCES accounts(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ds_connections_org ON datasource_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_ds_connections_status ON datasource_connections(status);
CREATE INDEX IF NOT EXISTS idx_ds_connections_type ON datasource_connections(connector_type);

-- ─────────────────────────────────────────────
-- 4a. NORMALIZED SCHEMA CACHE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connection_schemas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    schema_name     VARCHAR(255) NOT NULL,
    description     TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, schema_name)
);

CREATE INDEX IF NOT EXISTS idx_conn_schemas_connection ON connection_schemas(connection_id);

CREATE TABLE IF NOT EXISTS connection_tables (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schema_id       UUID NOT NULL REFERENCES connection_schemas(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    table_name      VARCHAR(255) NOT NULL,
    table_type      VARCHAR(50) NOT NULL DEFAULT 'table',
    row_count_estimate BIGINT,
    description     TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(schema_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_conn_tables_schema ON connection_tables(schema_id);
CREATE INDEX IF NOT EXISTS idx_conn_tables_connection ON connection_tables(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_tables_name ON connection_tables(table_name);

CREATE TABLE IF NOT EXISTS connection_columns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_id        UUID NOT NULL REFERENCES connection_tables(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    column_name     VARCHAR(255) NOT NULL,
    data_type       VARCHAR(100) NOT NULL,
    is_nullable     BOOLEAN NOT NULL DEFAULT TRUE,
    is_primary_key  BOOLEAN NOT NULL DEFAULT FALSE,
    is_foreign_key  BOOLEAN NOT NULL DEFAULT FALSE,
    fk_ref_table    VARCHAR(255),
    fk_ref_column   VARCHAR(255),
    default_value   TEXT,
    ordinal_position INTEGER NOT NULL DEFAULT 0,
    description     TEXT,
    UNIQUE(table_id, column_name)
);

CREATE INDEX IF NOT EXISTS idx_conn_columns_table ON connection_columns(table_id);
CREATE INDEX IF NOT EXISTS idx_conn_columns_connection ON connection_columns(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_columns_name ON connection_columns(column_name);

-- ─────────────────────────────────────────────
-- 5. DATASOURCE COMBOS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasource_combos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    created_by      UUID NOT NULL REFERENCES accounts(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS datasource_combo_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    combo_id        UUID NOT NULL REFERENCES datasource_combos(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    alias           VARCHAR(100),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(combo_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_combo_members_combo ON datasource_combo_members(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_members_conn ON datasource_combo_members(connection_id);

-- ─────────────────────────────────────────────
-- 6. CHATS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id   UUID REFERENCES datasource_connections(id) ON DELETE SET NULL,
    combo_id        UUID REFERENCES datasource_combos(id) ON DELETE SET NULL,
    title           VARCHAR(500),
    created_by      UUID NOT NULL REFERENCES accounts(id),
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_chat_scope CHECK (
        (connection_id IS NOT NULL AND combo_id IS NULL) OR
        (connection_id IS NULL AND combo_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_chats_org ON chats(org_id);
CREATE INDEX IF NOT EXISTS idx_chats_connection ON chats(connection_id);
CREATE INDEX IF NOT EXISTS idx_chats_combo ON chats(combo_id);
CREATE INDEX IF NOT EXISTS idx_chats_created_by ON chats(created_by);

-- ─────────────────────────────────────────────
-- 7. CHAT MESSAGES
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role            message_role NOT NULL,
    content         TEXT NOT NULL,
    execution_id    UUID,
    ui_hint         VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- ─────────────────────────────────────────────
-- 7a. QUERY EXECUTIONS
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE execution_status AS ENUM ('pending', 'running', 'success', 'failed', 'timeout', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS query_executions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    chat_id         UUID REFERENCES chats(id) ON DELETE SET NULL,
    message_id      UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    connection_id   UUID REFERENCES datasource_connections(id) ON DELETE SET NULL,
    combo_id        UUID REFERENCES datasource_combos(id) ON DELETE SET NULL,
    executed_by     UUID NOT NULL REFERENCES accounts(id),
    prompt          TEXT,
    generated_query TEXT NOT NULL,
    query_explanation TEXT,
    tables_used     TEXT[],
    confidence      REAL,
    validation_verdict VARCHAR(20),
    validation_reasons TEXT[],
    status          execution_status NOT NULL DEFAULT 'pending',
    execution_time_ms INTEGER,
    row_count       INTEGER,
    total_hits      BIGINT,
    result_preview  JSONB,
    result_columns  TEXT[],
    error_message   TEXT,
    error_code      VARCHAR(100),
    insight         TEXT,
    sub_queries     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_query_exec_org ON query_executions(org_id);
CREATE INDEX IF NOT EXISTS idx_query_exec_chat ON query_executions(chat_id);
CREATE INDEX IF NOT EXISTS idx_query_exec_connection ON query_executions(connection_id);
CREATE INDEX IF NOT EXISTS idx_query_exec_combo ON query_executions(combo_id);
CREATE INDEX IF NOT EXISTS idx_query_exec_status ON query_executions(status);
CREATE INDEX IF NOT EXISTS idx_query_exec_executed_by ON query_executions(executed_by);
CREATE INDEX IF NOT EXISTS idx_query_exec_created ON query_executions(created_at DESC);

-- Add FK from chat_messages -> query_executions
DO $$ BEGIN
    ALTER TABLE chat_messages
        ADD CONSTRAINT fk_chat_messages_execution
        FOREIGN KEY (execution_id) REFERENCES query_executions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────
-- 8. DASHBOARDS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id   UUID REFERENCES datasource_connections(id) ON DELETE SET NULL,
    combo_id        UUID REFERENCES datasource_combos(id) ON DELETE SET NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    is_org_overview BOOLEAN NOT NULL DEFAULT FALSE,
    thumbnail_url   TEXT,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_by      UUID NOT NULL REFERENCES accounts(id),
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboards_org ON dashboards(org_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_connection ON dashboards(connection_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_combo ON dashboards(combo_id);

-- ─────────────────────────────────────────────
-- 9. DASHBOARD PAGES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_pages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id    UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL DEFAULT 'Page 1',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    layout          JSONB NOT NULL DEFAULT '[]',
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_pages_dashboard ON dashboard_pages(dashboard_id);

-- ─────────────────────────────────────────────
-- 10. DASHBOARD WIDGETS
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE datasource_scope_type AS ENUM ('connection', 'combo', 'org');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id         UUID NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
    datasource_scope_type  datasource_scope_type NOT NULL DEFAULT 'connection',
    datasource_scope_id    UUID NOT NULL,
    title           VARCHAR(500) NOT NULL,
    prompt          TEXT NOT NULL,
    generated_query TEXT,
    ui_hint         VARCHAR(50) NOT NULL DEFAULT 'data_table',
    layout_x        INTEGER NOT NULL DEFAULT 0,
    layout_y        INTEGER NOT NULL DEFAULT 0,
    layout_w        INTEGER NOT NULL DEFAULT 6,
    layout_h        INTEGER NOT NULL DEFAULT 4,
    settings        JSONB NOT NULL DEFAULT '{}',
    result_rows     JSONB,
    result_columns  JSONB,
    cached_result   JSONB,
    cached_at       TIMESTAMPTZ,
    refresh_interval_sec INTEGER,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_page ON dashboard_widgets(page_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_scope ON dashboard_widgets(datasource_scope_type, datasource_scope_id);

-- ─────────────────────────────────────────────
-- 11. SESSIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ─────────────────────────────────────────────
-- 12. AUDIT LOG
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE audit_event_type AS ENUM (
        'account_created', 'login_success', 'login_failed', 'logout', 'password_changed',
        'org_created', 'org_updated', 'member_invited', 'member_removed', 'member_role_changed',
        'connection_created', 'connection_updated', 'connection_deleted',
        'connection_test_success', 'connection_test_failed', 'connection_health_check',
        'query_generated', 'query_validated', 'query_executed', 'query_failed',
        'chat_created', 'chat_archived',
        'dashboard_created', 'dashboard_updated', 'dashboard_published', 'dashboard_deleted',
        'widget_added', 'widget_removed',
        'combo_created', 'combo_updated', 'combo_deleted'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
    account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
    event_type      audit_event_type NOT NULL,
    resource_type   VARCHAR(100),
    resource_id     UUID,
    details         JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_account ON audit_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ─────────────────────────────────────────────
-- 13. SCHEMA BOOKMARKS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_bookmarks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES datasource_connections(id) ON DELETE CASCADE,
    table_name      VARCHAR(255) NOT NULL,
    column_name     VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(account_id, connection_id, table_name, column_name)
);

-- ─────────────────────────────────────────────
-- 14. PINNED QUERIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_queries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    connection_id   UUID REFERENCES datasource_connections(id) ON DELETE CASCADE,
    combo_id        UUID REFERENCES datasource_combos(id) ON DELETE CASCADE,
    prompt          TEXT NOT NULL,
    generated_query TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pinned_queries_account ON pinned_queries(account_id);
