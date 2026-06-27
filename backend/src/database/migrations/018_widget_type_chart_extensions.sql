-- =====================================================
-- DataIntel v2 — Migration 018: Widget Type Chart Extensions
-- =====================================================
-- Adds the remaining dashboard-editor chart types that are genuinely new
-- data-driven visualizations: Stacked Bar, Stacked Area, and the Line+Bar
-- Combo (dual-axis) chart. 'text' and 'image' already exist in the
-- widget_type enum (added in migration 005) and only needed frontend work.
--
-- ALTER TYPE ... ADD VALUE is safe inside this migration's own transaction
-- on Postgres 12+, since the new values are not referenced in the same
-- transaction that adds them.

ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'stacked_bar';
ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'stacked_area_chart';
ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'combo_chart';
