-- =====================================================
-- DataIntel v2 — Migration 028: Dashboard Filters v2
-- =====================================================
-- Migration 009 created dashboard_filters with only (filter_type, config), but
-- the service layer writes structured filter conditions (a target dimension,
-- an operator, and a typed value). This migration reshapes the table to store
-- one dashboard-global filter *condition* per row, matching the client-side
-- FilterCondition model (see frontend/src/lib/filters.ts). Global filters
-- cascade to any widget whose result columns include the target column, and
-- combine with each widget's own filters under AND.
-- =====================================================

-- Structured columns for the condition. `config` (already present) holds the
-- full serialized FilterCondition payload (value / values / relativeN /
-- relativeUnit / from / to) so new operators never need a schema change.
ALTER TABLE dashboard_filters ADD COLUMN IF NOT EXISTS column_name VARCHAR(255);
ALTER TABLE dashboard_filters ADD COLUMN IF NOT EXISTS col_type    VARCHAR(20);
ALTER TABLE dashboard_filters ADD COLUMN IF NOT EXISTS operator    VARCHAR(40);

-- filter_type was NOT NULL in 009 but is unused by the structured model; relax
-- it so inserts that only set the structured columns succeed.
ALTER TABLE dashboard_filters ALTER COLUMN filter_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_filters_column
  ON dashboard_filters(dashboard_id, column_name);
