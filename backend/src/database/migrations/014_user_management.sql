-- =====================================================
-- 014 — Phase 1 User Management
-- Extends `accounts` with platform role, lifecycle status,
-- invitation / password-reset tokens, and soft-delete columns.
-- Reuses the existing `accounts` and `audit_logs` tables —
-- no duplicate user entity is introduced.
-- =====================================================

-- ─────────────────────────────────────────────
-- Enums: platform role & user lifecycle status
-- ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE platform_role AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('PENDING_INVITATION', 'ACTIVE', 'INACTIVE', 'DELETED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────
-- Extend accounts
-- ─────────────────────────────────────────────
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS role                       platform_role NOT NULL DEFAULT 'VIEWER',
    ADD COLUMN IF NOT EXISTS status                     user_status   NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS invitation_token           TEXT,
    ADD COLUMN IF NOT EXISTS invitation_expires_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reset_password_token       TEXT,
    ADD COLUMN IF NOT EXISTS reset_password_expires_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_deleted                 BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at                 TIMESTAMPTZ;

-- Invited users have no password until they activate their account.
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;

-- ─────────────────────────────────────────────
-- Indexes (PRD: role, status, isDeleted; email already UNIQUE)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounts_role        ON accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_status      ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_is_deleted  ON accounts(is_deleted);

-- Fast, secure token lookups (partial — only rows with a live token)
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_invitation_token
    ON accounts(invitation_token) WHERE invitation_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_reset_token
    ON accounts(reset_password_token) WHERE reset_password_token IS NOT NULL;

-- ─────────────────────────────────────────────
-- Bootstrap: promote all pre-existing accounts to ADMIN so the
-- platform is manageable immediately after this migration.
-- (Decision: migration promotes existing accounts.)
-- ─────────────────────────────────────────────
UPDATE accounts
   SET role   = 'ADMIN',
       status = CASE WHEN is_active THEN 'ACTIVE'::user_status ELSE 'INACTIVE'::user_status END;

-- ─────────────────────────────────────────────
-- Extend audit_event_type with user-management actions
-- ─────────────────────────────────────────────
DO $$ BEGIN
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_created';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_updated';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_activated';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_deactivated';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_reactivated';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'user_deleted';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'password_reset_requested';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'password_reset_completed';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'invitation_sent';
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'invitation_resent';
END $$;
