-- =====================================================
-- DataIntel v2 — Migration 002: Organization Hierarchy
-- =====================================================
-- Adds unlimited-depth org hierarchy using PostgreSQL ltree,
-- a unified org_role_grants table for hierarchical permission resolution,
-- and an org_invitations table with secure token-based invite flow.

-- Enable ltree extension for path-based hierarchy queries
CREATE EXTENSION IF NOT EXISTS ltree;

-- ─────────────────────────────────────────────
-- 1. EXTEND ORGANIZATIONS
-- ─────────────────────────────────────────────
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS parent_org_id   UUID REFERENCES organizations(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS hierarchy_path  LTREE,
    ADD COLUMN IF NOT EXISTS depth           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS plan            VARCHAR(50) NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS max_connections INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS max_members     INTEGER NOT NULL DEFAULT 25,
    ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by      UUID REFERENCES accounts(id);

-- Back-fill hierarchy_path for existing orgs (root orgs get slug-based path)
UPDATE organizations
SET hierarchy_path = text2ltree(regexp_replace(slug, '[^a-zA-Z0-9]', '_', 'g'))
WHERE hierarchy_path IS NULL;

-- Make hierarchy_path NOT NULL after backfill
ALTER TABLE organizations
    ALTER COLUMN hierarchy_path SET NOT NULL;

-- Indexes for hierarchy operations
CREATE INDEX IF NOT EXISTS idx_orgs_hierarchy_gist  ON organizations USING GIST(hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_orgs_hierarchy_btree ON organizations USING BTREE(hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_orgs_parent          ON organizations(parent_org_id) WHERE parent_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_depth           ON organizations(depth);
CREATE INDEX IF NOT EXISTS idx_orgs_deleted         ON organizations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_plan            ON organizations(plan);

-- ─────────────────────────────────────────────
-- 2. ORG ROLE GRANTS
-- Replaces/augments org_members with explicit grant records
-- that support time-bounded grants and hierarchical inheritance.
-- org_members is retained for backward compat during migration.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_role_grants (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role         org_role NOT NULL,
    granted_by   UUID REFERENCES accounts(id),
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,                        -- NULL = permanent
    revoked_at   TIMESTAMPTZ,
    revoked_by   UUID REFERENCES accounts(id),
    UNIQUE(org_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_org_grants_org       ON org_role_grants(org_id);
CREATE INDEX IF NOT EXISTS idx_org_grants_account   ON org_role_grants(account_id);
CREATE INDEX IF NOT EXISTS idx_org_grants_expires   ON org_role_grants(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_grants_active    ON org_role_grants(org_id, account_id) WHERE revoked_at IS NULL;

-- Backfill org_role_grants from existing org_members
INSERT INTO org_role_grants (org_id, account_id, role, granted_by, granted_at)
SELECT org_id, account_id, role, invited_by, joined_at
FROM org_members
ON CONFLICT (org_id, account_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 3. ORG INVITATIONS
-- Secure token-based invitation flow.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_invitations (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email        VARCHAR(255) NOT NULL,
    role         org_role NOT NULL DEFAULT 'viewer',
    invited_by   UUID NOT NULL REFERENCES accounts(id),
    token        TEXT NOT NULL UNIQUE,               -- cryptographically secure random token (32 bytes hex)
    expires_at   TIMESTAMPTZ NOT NULL,               -- typically now() + 7 days
    accepted_at  TIMESTAMPTZ,
    accepted_by  UUID REFERENCES accounts(id),
    revoked_at   TIMESTAMPTZ,
    revoked_by   UUID REFERENCES accounts(id),
    message      TEXT,                               -- optional personal message
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_org     ON org_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email   ON org_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token   ON org_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_pending ON org_invitations(org_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
