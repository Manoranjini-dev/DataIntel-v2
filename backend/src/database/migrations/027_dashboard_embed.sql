-- =====================================================
-- DataIntel v2 — Migration 027: Dashboard Embedding (DB2-03)
-- =====================================================
-- Lets a published dashboard be embedded in external sites via an opaque,
-- revocable embed token. The token is the capability: the public embed
-- endpoint only serves a dashboard when embed_enabled = true AND status =
-- 'published', so revoking (disable) or unpublishing immediately cuts access.
-- =====================================================

ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS embed_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS embed_token   TEXT;

-- One token → one dashboard; fast public lookups by token.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboards_embed_token
  ON dashboards(embed_token) WHERE embed_token IS NOT NULL;
