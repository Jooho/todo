-- =============================================================
-- Todo Manager — Full Database Schema
-- Supabase (PostgreSQL)
-- Last updated: 2026-04-06
--
-- Run this ONCE in Supabase SQL Editor to set up everything.
-- Safe to re-run: uses IF NOT EXISTS and OR REPLACE.
-- =============================================================

-- =============================================================
-- 1. TASKS
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'work',
    completed BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    due_date DATE,
    due_time TIME,
    subtasks JSONB DEFAULT '[]',
    shared_calendar_id UUID,
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. CATEGORIES
-- =============================================================
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#888888',
    sort_order INTEGER DEFAULT 0,
    user_id UUID REFERENCES auth.users(id)
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users own categories" ON categories FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 3. PROFILES (auto-populated from auth.users)
-- =============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Anyone can view profiles" ON profiles FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Users update own profile" ON profiles FOR ALL USING (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- 4. SHARED CALENDARS
-- =============================================================
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

ALTER TABLE shared_calendars ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users manage own calendars" ON shared_calendars FOR ALL USING (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Users view member calendars" ON shared_calendars FOR SELECT USING (
        id IN (SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Anyone view public calendars" ON shared_calendars FOR SELECT USING (is_public = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "Anyone can find calendar by invite token" ON shared_calendars FOR SELECT USING (invite_link_token IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Foreign key: tasks → shared_calendars
DO $$ BEGIN
    ALTER TABLE tasks ADD CONSTRAINT tasks_shared_calendar_fk
        FOREIGN KEY (shared_calendar_id) REFERENCES shared_calendars(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 5. CALENDAR MEMBERS
-- =============================================================
CREATE TABLE IF NOT EXISTS calendar_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID REFERENCES shared_calendars(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer', 'pending')),
    color_override TEXT,
    requested_role TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(calendar_id, user_id)
);

ALTER TABLE calendar_members DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 6. TASKS RLS (personal + shared calendar access)
-- =============================================================
DROP POLICY IF EXISTS "Users own tasks" ON tasks;
DROP POLICY IF EXISTS "Users access own and shared tasks" ON tasks;

CREATE POLICY "Users access own and shared tasks" ON tasks
    FOR ALL USING (
        user_id = auth.uid()
        OR shared_calendar_id IN (
            SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
        )
    );

-- =============================================================
-- 7. API TOKENS (with expiry support)
-- =============================================================
CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    token_hash TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    name TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

-- Migration: add expires_at if table already exists without it
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users manage own tokens" ON api_tokens FOR ALL USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 8. USER ACCESS CONTROL (admin approval required)
-- =============================================================
CREATE TABLE IF NOT EXISTS approved_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

-- Admin email — first approved user (owner)
INSERT INTO approved_users (email, status, reviewed_at, reviewed_by)
VALUES ('ljhiyh@gmail.com', 'approved', NOW(), 'system')
ON CONFLICT (email) DO NOTHING;

-- No RLS — accessible by service role and anon for login check
ALTER TABLE approved_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users check own status" ON approved_users;
DROP POLICY IF EXISTS "Users request access" ON approved_users;
DROP POLICY IF EXISTS "Admin manages approvals" ON approved_users;
DROP POLICY IF EXISTS "Users read own" ON approved_users;
DROP POLICY IF EXISTS "Users insert own" ON approved_users;
DROP POLICY IF EXISTS "Admin update" ON approved_users;
DROP POLICY IF EXISTS "Admin delete" ON approved_users;

CREATE POLICY "Users read own" ON approved_users
    FOR SELECT USING (
        email = auth.jwt()->>'email'
        OR auth.jwt()->>'email' = 'ljhiyh@gmail.com'
    );

CREATE POLICY "Users insert own" ON approved_users
    FOR INSERT WITH CHECK (email = auth.jwt()->>'email');

CREATE POLICY "Admin update" ON approved_users
    FOR UPDATE USING (auth.jwt()->>'email' = 'ljhiyh@gmail.com');

CREATE POLICY "Admin delete" ON approved_users
    FOR DELETE USING (auth.jwt()->>'email' = 'ljhiyh@gmail.com');

-- =============================================================
-- 9. ENABLE REALTIME (auto-refresh on task changes)
-- =============================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 9. BACKFILL EXISTING USERS INTO PROFILES
-- =============================================================
INSERT INTO profiles (id, email, display_name, avatar_url)
SELECT
    id, email,
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email),
    raw_user_meta_data->>'avatar_url'
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url;
