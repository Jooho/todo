-- =============================================================
-- Migration: 2026-04-06
-- For existing DBs — adds new columns/features.
-- Safe to re-run.
-- =============================================================

-- API token expiry support
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Realtime for auto-refresh
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
