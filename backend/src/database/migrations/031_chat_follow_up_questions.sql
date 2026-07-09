-- ─────────────────────────────────────────────
-- 31. CHAT FOLLOW-UP QUESTIONS
-- Add JSONB column to chat_messages to persist 
-- generated follow-up questions per assistant response.
-- ─────────────────────────────────────────────

ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS follow_up_questions JSONB;
