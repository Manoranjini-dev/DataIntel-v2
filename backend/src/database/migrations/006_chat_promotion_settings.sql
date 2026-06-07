-- =====================================================
-- DataIntel v2 — Migration 006: Chat Promotion, Settings & Query Approval
-- =====================================================
-- Adds:
-- - Chat message → Analytics card promotion tracking
-- - Widget ↔ card placement table
-- - User settings (theme, auto-execute, query visibility)
-- - Organization settings (query mode, cache, retention)
-- - AI provider configuration per org
-- - Query approval workflow

-- ─────────────────────────────────────────────
-- 1. CHAT → CARD PROMOTIONS
-- Records every time a chat message visualization is saved as a card.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_card_promotions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES query_executions(id) ON DELETE SET NULL,
    card_id      UUID NOT NULL REFERENCES analytics_cards(id) ON DELETE CASCADE,
    promoted_by  UUID NOT NULL REFERENCES accounts(id),
    promoted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_org      ON chat_card_promotions(org_id);
CREATE INDEX IF NOT EXISTS idx_promotions_chat     ON chat_card_promotions(chat_id);
CREATE INDEX IF NOT EXISTS idx_promotions_card     ON chat_card_promotions(card_id);
CREATE INDEX IF NOT EXISTS idx_promotions_message  ON chat_card_promotions(message_id);
CREATE INDEX IF NOT EXISTS idx_promotions_account  ON chat_card_promotions(promoted_by);

-- ─────────────────────────────────────────────
-- 2. WIDGET ↔ CARD PLACEMENTS
-- Tracks which card version is used in each widget placement.
-- pinned_version = TRUE: widget uses a locked version (does not auto-update on card publish)
-- pinned_version = FALSE: widget always uses latest published version
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS widget_card_placements (
    widget_id      UUID NOT NULL,                            -- dashboard_widgets_v2.id
    card_id        UUID NOT NULL REFERENCES analytics_cards(id) ON DELETE CASCADE,
    card_version   INTEGER NOT NULL,
    pinned_version BOOLEAN NOT NULL DEFAULT FALSE,
    added_by       UUID NOT NULL REFERENCES accounts(id),
    added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (widget_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_wcp_card ON widget_card_placements(card_id);

-- ─────────────────────────────────────────────
-- 3. USER SETTINGS
-- Per-user preferences stored in PostgreSQL.
-- Cached in Redis (user:settings:{accountId}) for fast reads.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    account_id          UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

    -- UI preferences
    theme               VARCHAR(20) NOT NULL DEFAULT 'dark',    -- dark | light | system
    language            VARCHAR(10) NOT NULL DEFAULT 'en',

    -- Query behavior
    query_visibility    VARCHAR(20) NOT NULL DEFAULT 'visible',  -- visible | hidden
    auto_execute        BOOLEAN NOT NULL DEFAULT TRUE,
    result_row_limit    INTEGER NOT NULL DEFAULT 500,

    -- SQL editor preferences
    sql_editor_prefs    JSONB NOT NULL DEFAULT '{}',
    -- Example: { "fontSize": 14, "tabSize": 2, "wordWrap": true, "minimap": false }

    -- Notification preferences
    notification_prefs  JSONB NOT NULL DEFAULT '{}',
    -- Example: { "email": { "queryFailed": true, "reportReady": true }, "inApp": true }

    -- Dashboard defaults
    dashboard_prefs     JSONB NOT NULL DEFAULT '{}',

    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create user settings on account creation via trigger
CREATE OR REPLACE FUNCTION create_user_settings_on_account_insert()
RETURNS trigger AS $$
BEGIN
    INSERT INTO user_settings (account_id) VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_user_settings ON accounts;
CREATE TRIGGER trg_create_user_settings
    AFTER INSERT ON accounts
    FOR EACH ROW EXECUTE FUNCTION create_user_settings_on_account_insert();

-- Backfill for existing accounts
INSERT INTO user_settings (account_id)
SELECT id FROM accounts
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- 4. ORGANIZATION SETTINGS
-- Per-org configuration for query behavior, cache, retention, and AI.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_settings (
    org_id                     UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

    -- Query behavior
    default_query_mode         VARCHAR(20) NOT NULL DEFAULT 'auto',    -- auto | manual
    query_approval_required    BOOLEAN NOT NULL DEFAULT FALSE,
    max_query_rows             INTEGER NOT NULL DEFAULT 5000,
    query_timeout_ms           INTEGER NOT NULL DEFAULT 30000,

    -- Dashboard defaults
    dashboard_defaults         JSONB NOT NULL DEFAULT '{}',
    -- Example: { "defaultRefreshSec": 300, "defaultPageSize": 10 }

    -- Cache + retention
    cache_ttl_sec              INTEGER NOT NULL DEFAULT 300,
    widget_cache_ttl_sec       INTEGER NOT NULL DEFAULT 300,
    retention_days             INTEGER NOT NULL DEFAULT 90,            -- audit/query history retention

    -- AI defaults (overridden by ai_provider_configs)
    ai_config                  JSONB NOT NULL DEFAULT '{}',
    -- Example: { "provider": "openrouter", "model": "gpt-4o", "temperature": 0.0 }

    -- Feature flags (override global flags per-org)
    feature_flags              JSONB NOT NULL DEFAULT '{}',
    -- Example: { "dashboardGeneration": true, "federatedQuery": true, "cardLibrary": true }

    -- Limits
    max_connections            INTEGER NOT NULL DEFAULT 10,
    max_combos                 INTEGER NOT NULL DEFAULT 20,
    max_dashboards             INTEGER NOT NULL DEFAULT 100,
    max_cards                  INTEGER NOT NULL DEFAULT 500,

    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by                 UUID REFERENCES accounts(id)
);

-- Auto-create org settings on org creation via trigger
CREATE OR REPLACE FUNCTION create_org_settings_on_org_insert()
RETURNS trigger AS $$
BEGIN
    INSERT INTO org_settings (org_id) VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_org_settings ON organizations;
CREATE TRIGGER trg_create_org_settings
    AFTER INSERT ON organizations
    FOR EACH ROW EXECUTE FUNCTION create_org_settings_on_org_insert();

-- Backfill for existing orgs
INSERT INTO org_settings (org_id)
SELECT id FROM organizations
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- 5. AI PROVIDER CONFIGURATIONS
-- Per-org LLM provider configuration.
-- Organizations can configure multiple providers with one as default.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_provider_configs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Provider identity
    provider           VARCHAR(50) NOT NULL,                 -- openai | anthropic | openrouter | cerebras | azure_openai
    model              VARCHAR(100) NOT NULL,                -- gpt-4o | claude-3-5-sonnet | gpt-oss-120b
    api_key_encrypted  TEXT NOT NULL,                        -- AES-256-GCM encrypted key
    base_url           TEXT,                                 -- for custom endpoints / Azure

    -- Model parameters
    max_tokens         INTEGER NOT NULL DEFAULT 4096,
    temperature        REAL NOT NULL DEFAULT 0.0,
    top_p              REAL,

    -- Cost controls
    cost_limit_usd_monthly DECIMAL(10,2),                   -- monthly spend cap (NULL = no limit)
    cost_used_usd_month    DECIMAL(10,4) NOT NULL DEFAULT 0,
    cost_reset_at          TIMESTAMPTZ,                      -- next reset date

    -- State
    is_default         BOOLEAN NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,

    -- Audit
    created_by         UUID NOT NULL REFERENCES accounts(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by         UUID REFERENCES accounts(id)
);

-- Enforce exactly one default per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_default
    ON ai_provider_configs(org_id) WHERE is_default = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ai_config_org    ON ai_provider_configs(org_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_config_provider ON ai_provider_configs(org_id, provider);

-- ─────────────────────────────────────────────
-- 6. QUERY APPROVAL WORKFLOW
-- When org_settings.query_approval_required = TRUE,
-- query executions must be approved before running.
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'auto_approved', 'expired');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS query_approvals (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id         UUID NOT NULL REFERENCES organizations(id),
    execution_id   UUID NOT NULL REFERENCES query_executions(id) ON DELETE CASCADE,

    -- Status
    status         approval_status NOT NULL DEFAULT 'pending',

    -- Requester
    requested_by   UUID NOT NULL REFERENCES accounts(id),
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Reviewer
    reviewed_by    UUID REFERENCES accounts(id),
    review_comment TEXT,
    reviewed_at    TIMESTAMPTZ,

    -- Auto-expiry
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',

    UNIQUE(execution_id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_org_pending ON query_approvals(org_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approvals_execution   ON query_approvals(execution_id);
CREATE INDEX IF NOT EXISTS idx_approvals_requester   ON query_approvals(requested_by);
CREATE INDEX IF NOT EXISTS idx_approvals_expires     ON query_approvals(expires_at) WHERE status = 'pending';

-- ─────────────────────────────────────────────
-- 7. EXTEND CHATS with soft-delete + title auto-generation flag
-- ─────────────────────────────────────────────
ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by      UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS auto_title      BOOLEAN NOT NULL DEFAULT TRUE,  -- if true, title generated from first message
    ADD COLUMN IF NOT EXISTS message_count   INTEGER NOT NULL DEFAULT 0,     -- denormalized for performance
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chats_deleted  ON chats(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chats_active   ON chats(org_id, last_message_at DESC) WHERE deleted_at IS NULL;
