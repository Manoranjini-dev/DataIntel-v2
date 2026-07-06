-- =====================================================
-- DataIntel v2 — Migration 025: SSO Authentication
-- =====================================================
-- Adds enterprise Single Sign-On:
--   • Identity linking columns on `accounts` so an account can be bound to an
--     external IdP subject (Google / Entra / LDAP) while password login stays
--     available (password_hash is already nullable — migration 014).
--   • `sso_providers`: instance-level provider configuration managed by ADMIN
--     users (organizations were removed in migration 017, so configuration is
--     global for the deployment). Secrets (OAuth client secret, LDAP bind
--     password) are stored encrypted (AES-256-GCM) in `encrypted_secret`.
-- =====================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Account ↔ external identity linking
-- ─────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sso_provider VARCHAR(32);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sso_subject  VARCHAR(255);

-- One IdP subject maps to at most one account (per provider).
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_sso_identity
  ON accounts (sso_provider, sso_subject)
  WHERE sso_provider IS NOT NULL AND sso_subject IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. Provider configuration (instance-level, ADMIN-managed)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sso_providers (
    provider          VARCHAR(32) PRIMARY KEY,             -- 'google' | 'entra' | 'ldap'
    enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
    display_name      VARCHAR(128),
    config            JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- non-secret config (clientId, tenantId, issuer, ldap url/baseDN/filter…)
    encrypted_secret  TEXT,                                       -- OAuth client secret / LDAP bind password (encrypted)
    auto_provision    BOOLEAN     NOT NULL DEFAULT FALSE,        -- JIT-create accounts on first login
    allowed_domains   TEXT[]      NOT NULL DEFAULT '{}',         -- email-domain allowlist for provisioning/login
    default_role      VARCHAR(16) NOT NULL DEFAULT 'VIEWER',     -- role for JIT-provisioned accounts
    updated_by        UUID        REFERENCES accounts(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the three known providers as disabled so the admin UI can render them.
INSERT INTO sso_providers (provider, display_name) VALUES
    ('google', 'Google Workspace'),
    ('entra',  'Microsoft Entra ID'),
    ('ldap',   'Active Directory (LDAP)')
ON CONFLICT (provider) DO NOTHING;

COMMIT;
