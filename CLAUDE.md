# Todo Manager

## Project Overview
Personal task management web app with calendar view, shared calendars, and API access.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build tools)
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
- **Auth**: Google OAuth via Supabase Auth
- **Hosting**: GitHub Pages compatible (static files)

## Architecture
```
todo_app/
├── index.html          — Main HTML (login page + app)
├── style.css           — All styles (dark/light, responsive)
├── script.js           — Core app logic (CRUD, calendar, views)
├── db.js               — Supabase data layer (sync, row conversion)
├── auth.js             — Google OAuth (login/logout/session)
├── detail-panel.js     — Right side detail panel
├── shared.js           — Shared calendar (CRUD, invite, realtime)
├── supabase/functions/api-proxy/ — Edge Function for API access
└── docs/               — PDCA documents, SQL schemas, API docs
```

## Supabase Config
- **Project**: todo-app
- **Project ID**: urkytivapfgzenpvflce
- **URL**: https://urkytivapfgzenpvflce.supabase.co
- **Anon Key**: (in script.js DEFAULT_SB_KEY)

## API
- **Base URL**: https://urkytivapfgzenpvflce.supabase.co/functions/v1/api-proxy
- **Auth**: Bearer token (mtsk_xxx)
- **Docs**: docs/API.md
- **Claude Skill**: /todo

## DB Schema
- Full schema: docs/full-schema.sql
- Tables: tasks, categories, profiles, shared_calendars, calendar_members, api_tokens

## Key Features
- Task CRUD with description, subtasks, due date/time
- Calendar view (month/week/day)
- Archive (instead of delete)
- Custom categories
- Shared calendars with invite links
- Google login + RLS data isolation
- Dark/light mode
- API access for Claude/scripts
- 3-column responsive layout (sidebar + main + detail panel)

## Code Conventions
- All code and comments in English
- No build tools, no npm packages (CDN only for Supabase JS)
- localStorage as offline fallback, Supabase as primary when logged in
