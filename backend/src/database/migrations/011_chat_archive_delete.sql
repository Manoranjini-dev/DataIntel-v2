-- ══════════════════════════════════════════════════════════════
-- Migration 011: Chat Archive and Soft-Delete
-- ══════════════════════════════════════════════════════════════

-- Add columns to chats table
ALTER TABLE chats 
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_chats_archived ON chats(is_archived);
CREATE INDEX IF NOT EXISTS idx_chats_deleted ON chats(deleted_at);
