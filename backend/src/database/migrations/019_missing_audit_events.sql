-- =====================================================
-- DataIntel v2 — Migration 019: Missing audit_event_type values
-- =====================================================
-- Adds connection-refresh and connection-sharing audit event
-- types that are used by the application but were never added
-- to the database enum.
-- =====================================================

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_refresh_scheduled';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_refresh_completed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_refresh_failed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_shared';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'connection_share_revoked';
