-- =====================================================
-- DataIntel v2 — Migration 020: Card Sharing
-- =====================================================
-- Adds explicit user-level sharing grants for analytics cards.
-- Mirrors the datasource_permissions pattern used for connections.
-- Supports view (read-only) and edit permissions per grantee.

CREATE TABLE IF NOT EXISTS card_shares (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    card_id      UUID NOT NULL REFERENCES analytics_cards(id) ON DELETE CASCADE,
    shared_with  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
    shared_by    UUID NOT NULL REFERENCES accounts(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (card_id, shared_with)
);

CREATE INDEX IF NOT EXISTS idx_card_shares_card        ON card_shares(card_id);
CREATE INDEX IF NOT EXISTS idx_card_shares_shared_with ON card_shares(shared_with);
