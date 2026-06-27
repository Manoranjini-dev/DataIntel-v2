-- =====================================================
-- DataIntel v2 — Migration 017: Remove Organizations
-- =====================================================
-- Removes the Organizations concept entirely. The application now operates
-- directly at the account/user level:
--   • Every resource's sole ownership reference is its existing `created_by`
--     column (already present on every table below).
--   • Cross-user sharing is account-to-account only, via the existing
--     `datasource_permissions` (connections) and `dashboard_permissions`
--     (dashboards) tables — both already migrated off org_role in/with this
--     change. Cards, combos, and chats have no sharing table; they become
--     strictly owner-only (this is an intentional scope reduction — there was
--     no per-resource sharing UI for these beyond org-wide visibility).
--
-- NOTE on RLS: the row-level-security policies introduced in 007/008 were
-- already inert in practice — no application code ever executed
-- `SET app.current_org_id`, so `current_org_id()` always evaluated to NULL.
-- Real access control has always been enforced at the application layer
-- (OrgService/OrgPermissionsService, now removed). Dropping these policies
-- changes nothing about actual enforcement.
--
-- All ALTER/DROP statements use IF EXISTS — some tables/columns documented
-- in earlier migrations (e.g. connection_credential_rotations) were never
-- actually materialized in every environment, independent of this change.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. DROP RLS POLICIES + HELPER FUNCTION
-- Must happen before dropping org_id columns, since the policies
-- reference them.
-- ─────────────────────────────────────────────
DO $$
DECLARE
    t_name text;
BEGIN
    FOR t_name IN
        SELECT tablename FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON public.%I', t_name);
    END LOOP;
END
$$;

DROP POLICY IF EXISTS tenant_isolation_connections  ON datasource_connections;
DROP POLICY IF EXISTS tenant_isolation_combos       ON datasource_combos;
DROP POLICY IF EXISTS tenant_isolation_cards        ON analytics_cards;
DROP POLICY IF EXISTS tenant_isolation_dashboards   ON dashboards;
DROP POLICY IF EXISTS tenant_isolation_chats        ON chats;
DROP POLICY IF EXISTS tenant_isolation_org_settings ON org_settings;
DROP POLICY IF EXISTS tenant_isolation_ai_configs   ON ai_provider_configs;

ALTER TABLE IF EXISTS datasource_connections        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS datasource_combos             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analytics_cards               DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dashboards                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chats                         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS organizations                 DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS current_org_id();

-- ─────────────────────────────────────────────
-- 2. DROP org_role FROM dashboard_permissions
-- Mirrors migration 016 (which did this for datasource_permissions).
-- Dashboard sharing becomes purely account-based: owner (dashboards.created_by)
-- grants specific users view/edit/publish/delete access.
-- ─────────────────────────────────────────────
DELETE FROM dashboard_permissions WHERE account_id IS NULL;
ALTER TABLE IF EXISTS dashboard_permissions DROP CONSTRAINT IF EXISTS chk_perm_subject;
DROP INDEX IF EXISTS idx_dash_perms_role;
ALTER TABLE IF EXISTS dashboard_permissions DROP COLUMN IF EXISTS org_role;
ALTER TABLE IF EXISTS dashboard_permissions ALTER COLUMN account_id SET NOT NULL;
DROP INDEX IF EXISTS idx_dash_perms_account;
CREATE INDEX IF NOT EXISTS idx_dash_perms_account ON dashboard_permissions(account_id);

-- ─────────────────────────────────────────────
-- 3. DROP org_id COLUMNS
-- created_by remains the sole ownership reference on every table below.
-- ─────────────────────────────────────────────
DROP INDEX IF EXISTS idx_ds_connections_org;
ALTER TABLE IF EXISTS datasource_connections        DROP COLUMN IF EXISTS org_id;

ALTER TABLE IF EXISTS datasource_combos             DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_chats_org;
DROP INDEX IF EXISTS idx_chats_active;
ALTER TABLE IF EXISTS chats                         DROP COLUMN IF EXISTS org_id;
CREATE INDEX IF NOT EXISTS idx_chats_active ON chats(last_message_at DESC) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_query_exec_org;
DROP INDEX IF EXISTS idx_query_exec_month_org;
ALTER TABLE IF EXISTS query_executions              DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_dashboards_org;
DROP INDEX IF EXISTS idx_dashboards_status;
ALTER TABLE IF EXISTS dashboards                    DROP COLUMN IF EXISTS org_id;
CREATE INDEX IF NOT EXISTS idx_dashboards_status ON dashboards(status) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_card_folders_org;
ALTER TABLE IF EXISTS card_folders                  DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_cards_org;
DROP INDEX IF EXISTS idx_cards_visibility;
DROP INDEX IF EXISTS idx_cards_updated;
ALTER TABLE IF EXISTS analytics_cards               DROP COLUMN IF EXISTS org_id;
CREATE INDEX IF NOT EXISTS idx_cards_visibility ON analytics_cards(visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_updated   ON analytics_cards(updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE IF EXISTS connection_health_logs        DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS connection_credential_rotations DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS connection_rotation_logs      DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_gen_jobs_org;
ALTER TABLE IF EXISTS dashboard_generation_jobs     DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_widget_exec_org;
ALTER TABLE IF EXISTS widget_executions             DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_promotions_org;
ALTER TABLE IF EXISTS chat_card_promotions          DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_templates_org;
ALTER TABLE IF EXISTS dashboard_templates           DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS idx_audit_logs_org;
ALTER TABLE IF EXISTS audit_logs                    DROP COLUMN IF EXISTS org_id;

-- ─────────────────────────────────────────────
-- 4. DROP ORG-ONLY TABLES
-- query_approvals: the human-in-the-loop approval workflow was gated entirely
-- by org_settings.query_approval_required (an org-admin toggle). With no
-- organization to administer it, the workflow has no trigger condition;
-- queries continue to auto-execute (the existing default behavior).
-- ─────────────────────────────────────────────
DROP TABLE IF EXISTS query_approvals;
DROP TABLE IF EXISTS ai_provider_configs;
DROP TABLE IF EXISTS org_settings;
DROP TABLE IF EXISTS org_invitations;
DROP TABLE IF EXISTS org_role_grants;
DROP TABLE IF EXISTS org_members;
DROP TABLE IF EXISTS organizations;

-- ─────────────────────────────────────────────
-- 5. DROP org_role ENUM
-- Safe now that every column referencing it (org_members.role,
-- org_role_grants.role, org_invitations.role, dashboard_permissions.org_role)
-- has been dropped along with its table.
-- ─────────────────────────────────────────────
DROP TYPE IF EXISTS org_role;

COMMIT;
