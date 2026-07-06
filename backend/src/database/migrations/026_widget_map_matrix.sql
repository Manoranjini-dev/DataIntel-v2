-- =====================================================
-- DataIntel v2 — Migration 026: Map & Matrix widget types
-- =====================================================
-- Phase 2 advanced visualizations. Funnel / scatter / donut / gauge / pivot
-- already exist in the widget_type enum (migration 005); this adds the two
-- genuinely new values. 'matrix' is the pivot-table-with-drill-down visual
-- (the legacy 'pivot' value continues to render as the same Matrix component).
--
-- ALTER TYPE ... ADD VALUE is safe here: the new values are not referenced in
-- the same transaction that adds them (Postgres 12+).

ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'map';
ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'matrix';
