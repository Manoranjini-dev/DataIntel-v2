-- ══════════════════════════════════════════════════════════════
-- Migration 012: Dashboard Version Snapshot JSONB
-- ══════════════════════════════════════════════════════════════

-- Add snapshot_data to dashboard_versions and make name/context_type nullable
ALTER TABLE dashboard_versions
  ADD COLUMN IF NOT EXISTS snapshot_data JSONB,
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN context_type DROP NOT NULL;
