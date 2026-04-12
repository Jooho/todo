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

-- ============================================================
-- Plugin Architecture Foundation (task-extensions)
-- ============================================================

-- plugin_registry
CREATE TABLE IF NOT EXISTS plugin_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved', 'pending', 'rejected')),
    is_builtin BOOLEAN DEFAULT FALSE,
    app_store_url TEXT,
    play_store_url TEXT,
    deep_link TEXT,
    schema JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Anyone can view approved plugins" ON plugin_registry
        FOR SELECT USING (status = 'approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO plugin_registry (id, name, description, is_builtin, status) VALUES
    ('subtask',    'Subtasks',         'Add subtasks with due dates',              true, 'approved'),
    ('recurrence', 'Recurring Tasks',   'Repeat tasks daily/weekly/monthly/yearly', true, 'approved'),
    ('reminder',   'Reminders',         'Multiple reminders before due time',       true, 'approved'),
    ('daily-show', 'Daily Display',     'Show task every day until due date',       true, 'approved'),
    ('location',   'Location',          'GPS location and geofence alerts',         true, 'approved'),
    ('photo-item', 'Photo Items',       'Recognize items from photos',              true, 'approved')
ON CONFLICT (id) DO NOTHING;

-- task_extensions
CREATE TABLE IF NOT EXISTS task_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
    plugin_id TEXT NOT NULL REFERENCES plugin_registry(id),
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, plugin_id)
);
ALTER TABLE task_extensions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Users access own task extensions" ON task_extensions
        FOR ALL USING (
            task_id IN (
                SELECT id FROM tasks WHERE user_id = auth.uid()
                UNION
                SELECT id FROM tasks WHERE shared_calendar_id IN (
                    SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
                )
            )
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_task_extensions_task_id    ON task_extensions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_extensions_plugin_id  ON task_extensions(plugin_id);
CREATE INDEX IF NOT EXISTS idx_task_extensions_task_plugin ON task_extensions(task_id, plugin_id);

-- Helper view for Flutter app
CREATE OR REPLACE VIEW tasks_with_extensions AS
SELECT t.*, COALESCE(
    jsonb_object_agg(te.plugin_id, te.data) FILTER (WHERE te.plugin_id IS NOT NULL),
    '{}'::jsonb
) AS extensions
FROM tasks t LEFT JOIN task_extensions te ON te.task_id = t.id GROUP BY t.id;

-- Helper functions
CREATE OR REPLACE FUNCTION get_task_extension(p_task_id UUID, p_plugin_id TEXT)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER AS $$
    SELECT data FROM task_extensions WHERE task_id = p_task_id AND plugin_id = p_plugin_id;
$$;

CREATE OR REPLACE FUNCTION upsert_task_extension(p_task_id UUID, p_plugin_id TEXT, p_data JSONB)
RETURNS task_extensions LANGUAGE SQL SECURITY DEFINER AS $$
    INSERT INTO task_extensions (task_id, plugin_id, data, updated_at)
    VALUES (p_task_id, p_plugin_id, p_data, NOW())
    ON CONFLICT (task_id, plugin_id) DO UPDATE SET data = p_data, updated_at = NOW()
    RETURNING *;
$$;

-- Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE task_extensions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE plugin_registry; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE task_extensions REPLICA IDENTITY FULL;

-- Per-task reminders: [{"before": 10, "unit": "minutes"}, {"before": 1, "unit": "hours"}]
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminders JSONB DEFAULT '[]';

-- User notification settings in profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_settings JSONB;
-- Example: {"daily_summary": {"enabled": true, "time": "07:30", "timezone": "Asia/Seoul"}}

-- Push tokens for future native app
CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Users manage own tokens" ON push_tokens
        FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
