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

-- Enable FULL replica identity so DELETE events include old row data
ALTER TABLE tasks REPLICA IDENTITY FULL;

-- Show daily until due date feature
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS show_daily BOOLEAN DEFAULT FALSE;

-- User access control
CREATE TABLE IF NOT EXISTS approved_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

ALTER TABLE approved_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users check own status" ON approved_users
        FOR SELECT USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Admin manages approvals" ON approved_users
        FOR ALL USING (
            (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ljhiyh@gmail.com'
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO approved_users (email, status, reviewed_at, reviewed_by)
VALUES ('ljhiyh@gmail.com', 'approved', NOW(), 'system')
ON CONFLICT (email) DO NOTHING;

-- Security: only approved users can access tasks
DROP POLICY IF EXISTS "Users access own and shared tasks" ON tasks;
CREATE POLICY "Users access own and shared tasks" ON tasks
    FOR ALL USING (
        auth.jwt()->>'email' IN (SELECT email FROM approved_users WHERE status = 'approved')
        AND (
            user_id = auth.uid()
            OR shared_calendar_id IN (
                SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
            )
        )
    );
