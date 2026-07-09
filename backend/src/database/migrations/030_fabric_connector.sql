-- =====================================================
-- DataIntel v2 — Migration 030: Microsoft Fabric Connector (DS2-03)
-- =====================================================
-- Adds 'fabric' to the connector_type enum. Fabric's SQL analytics endpoint
-- speaks T-SQL over TDS (same as MSSQL); the connector reuses MSSQLConnector and
-- overrides only Entra ID (Azure AD) auth. No other schema changes are needed —
-- credentials, sharing, scheduled refresh, and read-only enforcement are all
-- connector-agnostic and already apply.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so this
-- migration intentionally contains no BEGIN/COMMIT (matches 003 / 026).
-- =====================================================

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'fabric';
