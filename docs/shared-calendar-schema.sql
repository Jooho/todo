-- Shared Calendar DB Schema
-- Run this in Supabase SQL Editor

-- 1. shared_calendars table
CREATE TABLE IF NOT EXISTS shared_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT NOT NULL DEFAULT '#FF6B6B',
    owner_id UUID REFERENCES auth.users(id) NOT NULL,
    invite_link_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. calendar_members table
CREATE TABLE IF NOT EXISTS calendar_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID REFERENCES shared_calendars(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(calendar_id, user_id)
);

-- 3. Add shared_calendar_id to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    shared_calendar_id UUID REFERENCES shared_calendars(id) ON DELETE SET NULL;

-- 4. RLS for shared_calendars
ALTER TABLE shared_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage calendars" ON shared_calendars
    FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "Members view calendars" ON shared_calendars
    FOR SELECT USING (
        id IN (SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid())
    );

-- 5. RLS for calendar_members
ALTER TABLE calendar_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see membership" ON calendar_members
    FOR SELECT USING (
        calendar_id IN (
            SELECT calendar_id FROM calendar_members cm WHERE cm.user_id = auth.uid()
        )
    );

CREATE POLICY "Owners manage members" ON calendar_members
    FOR ALL USING (
        calendar_id IN (
            SELECT id FROM shared_calendars WHERE owner_id = auth.uid()
        )
    );

-- 6. Update tasks RLS to include shared tasks
DROP POLICY IF EXISTS "Users own tasks" ON tasks;
DROP POLICY IF EXISTS "Users access own and shared tasks" ON tasks;

CREATE POLICY "Users access own and shared tasks" ON tasks
    FOR ALL USING (
        user_id = auth.uid()
        OR shared_calendar_id IN (
            SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
        )
    );
