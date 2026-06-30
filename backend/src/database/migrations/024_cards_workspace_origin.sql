-- =====================================================
-- DataIntel v2 — Migration 024: Cards Workspace Origin
-- =====================================================
-- Adds a third dashboard_origin value, 'cards', for the new Cards module —
-- a dedicated workspace (dashboards row) with no fixed data source, no
-- default seeded charts, and no publish step. Pages and cards inside it are
-- ordinary dashboard_pages / dashboard_widgets_v2 rows, so all existing
-- layout, sharing, move/copy, and AI-assist functionality applies unchanged.

ALTER TYPE dashboard_origin ADD VALUE IF NOT EXISTS 'cards';
