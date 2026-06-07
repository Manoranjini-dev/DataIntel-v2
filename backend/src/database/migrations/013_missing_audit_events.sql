-- ══════════════════════════════════════════════════════════════
-- Migration 013: Missing audit_event_type enum values
-- ══════════════════════════════════════════════════════════════

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'chat_deleted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'chat_unarchived';
