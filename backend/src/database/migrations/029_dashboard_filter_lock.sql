-- =====================================================
-- DataIntel v2 — Migration 029: Lockable Dashboard Filters (DC-04)
-- =====================================================
-- A dashboard-global filter can be LOCKED by an editor so that viewers (and the
-- published / embedded experiences) cannot modify or remove it. Enforcement is
-- server-side: filter mutations already require can_edit, and a locked filter
-- additionally cannot be changed or deleted without being explicitly unlocked
-- first. `locked` is a first-class column (not buried in `config`) so the guard
-- can check it without parsing JSON.
-- =====================================================

ALTER TABLE dashboard_filters
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
