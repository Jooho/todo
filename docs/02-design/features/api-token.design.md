# Design: API Token — External Access for Claude & Tools

> Created: 2026-04-06
> Architecture: Option C — Pragmatic Balance (existing structure + missing features)

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | Claude/스크립트에서 task 자동 생성 필요 → API 접근 경로 |
| **WHO** | 개발자, Claude Code 사용자 — API로 task 관리하고 싶은 사용자 |
| **RISK** | Token 유출 시 데이터 접근 가능, rate limit 필요, token 관리 |
| **SUCCESS** | API token으로 task CRUD 가능, Settings에서 token 생성/삭제/복사, 문서화 |
| **SCOPE** | Supabase api_tokens 테이블 + Settings UI + Supabase Edge Function |

---

## 1. Overview

외부 도구(Claude Code, curl, scripts)에서 Todo Manager의 task를 CRUD할 수 있도록 API token 기반 인증 시스템을 제공한다.

**선택된 아키텍처**: Option C — 기존 구현 구조 유지(script.js + Edge Function 단일 파일), 누락된 rate limit과 Settings 내 API docs 인라인 표시만 보강.

### 1.1 Design Goals
- 단순한 token 기반 인증 (OAuth 없이)
- `service_role` key로 RLS 우회 후 Edge Function에서 user 격리
- 기존 코드 구조(script.js, index.html) 유지

### 1.2 Design Principles
- Token은 hash만 저장 (원문 저장 안 함)
- 사용자당 활성 토큰 1개 (simplicity)
- Edge Function이 모든 API 로직을 처리 (단일 진입점)

---

## 2. Architecture

### 2.0 Architecture Comparison

| Criteria | Option A: Minimal | Option B: Clean | Option C: Pragmatic |
|----------|:-:|:-:|:-:|
| **Approach** | 현재 코드 그대로 | api-token.js 분리, handler 모듈화 | 현재 구조 + rate limit + docs UI |
| **New Files** | 0 | 3+ | 0 |
| **Modified Files** | 0 | 4+ | 3 |
| **Complexity** | Low | High | Low~Medium |
| **Maintainability** | Medium | High | High |
| **Effort** | Minimal | High | Low |
| **Risk** | Low | Medium (Deno bundling) | Low |

**Selected**: Option C — **Rationale**: 이미 대부분 구현 완료. 누락 기능만 보강하면 되므로 구조 변경 불필요.

### 2.1 Component Diagram

```
Claude/Script/curl
  │
  │  POST + Authorization: Bearer mtsk_xxx
  ▼
┌──────────────────────────────────┐
│  Supabase Edge Function          │
│  (api-proxy/index.ts)            │
│                                  │
│  1. Extract Bearer token         │
│  2. SHA-256 hash → lookup        │
│  3. Rate limit check (in-memory) │
│  4. Route by action field        │
│  5. CRUD via service_role client │
│  6. Return JSON response         │
└──────────┬───────────────────────┘
           │ service_role key
           ▼
┌──────────────────────────────────┐
│  Supabase PostgreSQL             │
│  ┌──────────┐  ┌──────────────┐  │
│  │api_tokens│  │    tasks     │  │
│  │(hash→uid)│  │(user's data) │  │
│  └──────────┘  └──────────────┘  │
└──────────────────────────────────┘
```

### 2.2 Data Flow

```
Token Generation:
  User → Settings UI → Generate button
  → crypto.getRandomValues() → "mtsk_" + 32 hex chars
  → SHA-256(rawToken) → INSERT api_tokens(token_hash, token_prefix, user_id)
  → Show rawToken once → User copies

API Request:
  Client → POST /functions/v1/api-proxy
  → Extract token from Authorization header
  → SHA-256(token) → SELECT api_tokens WHERE token_hash = hash
  → Get user_id → Execute action on tasks WHERE user_id = uid
  → Return JSON
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| Edge Function | Supabase service_role key | Bypass RLS, access all tables |
| Edge Function | api_tokens table | Token → user_id resolution |
| Settings UI | Supabase auth session | Only logged-in users can manage tokens |
| Settings UI | Web Crypto API | SHA-256 hashing in browser |

---

## 3. Data Model

### 3.1 api_tokens Table

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    token_hash TEXT NOT NULL,         -- SHA-256 hash of full token
    token_prefix TEXT NOT NULL,       -- First 13 chars ("mtsk_" + 8) for UI display
    name TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tokens" ON api_tokens
    FOR ALL USING (user_id = auth.uid());
```

### 3.2 Token Format

```
mtsk_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
 ^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 prefix      32 bytes = 64 hex characters
```

- Prefix: `mtsk_` (My Task Key)
- Body: 32 bytes random → 64 hex chars
- Total: 69 characters
- Storage: only SHA-256 hash stored in DB

### 3.3 Constraints

- 사용자당 활성 토큰 1개 (재생성 시 기존 is_active=false)
- Token 원문은 DB에 저장하지 않음
- 생성 직후 한 번만 전체 표시

---

## 4. API Specification

### 4.1 Endpoint

Single endpoint, action-based routing:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/functions/v1/api-proxy` | All task operations |
| OPTIONS | `/functions/v1/api-proxy` | CORS preflight |

### 4.2 Authentication

```
Authorization: Bearer mtsk_<token>
```

### 4.3 Actions

#### list — Get Tasks

**Request:**
```json
{
  "action": "list",
  "category": "work",        // optional filter
  "completed": false,         // optional filter
  "limit": 10                // optional limit
}
```

**Response (200):**
```json
{
  "tasks": [{...}, {...}],
  "count": 5
}
```

#### create — Create Task

**Request:**
```json
{
  "action": "create",
  "text": "Buy groceries",           // required
  "category": "personal",            // optional, default: "work"
  "dueDate": "2026-04-10",           // optional, default: today
  "dueTime": "14:00",                // optional
  "description": "Milk, eggs",       // optional
  "subtasks": [{"text":"Milk","completed":false}]  // optional
}
```

**Response (201):**
```json
{
  "task": {...},
  "message": "Task created"
}
```

#### update — Update Task

**Request:**
```json
{
  "action": "update",
  "id": "uuid",              // required
  "text": "Updated text",    // optional
  "completed": true           // optional
}
```

**Response (200):**
```json
{
  "task": {...},
  "message": "Task updated"
}
```

#### delete — Delete Task

**Request:**
```json
{
  "action": "delete",
  "id": "uuid"               // required
}
```

**Response (200):**
```json
{
  "message": "Task deleted"
}
```

#### toggle — Toggle Complete

**Request:**
```json
{
  "action": "toggle",
  "id": "uuid"               // required
}
```

**Response (200):**
```json
{
  "task": {...},
  "message": "Task completed"
}
```

### 4.4 Error Responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "text is required"}` | Missing required field |
| 400 | `{"error": "Unknown action: xxx"}` | Invalid action |
| 401 | `{"error": "Missing or invalid API token"}` | No/bad token format |
| 401 | `{"error": "Invalid or revoked token"}` | Token not in DB |
| 404 | `{"error": "Task not found"}` | Task doesn't exist for user |
| 429 | `{"error": "Rate limit exceeded. Try again later."}` | Rate limit hit |
| 500 | `{"error": "..."}` | Server error |

---

## 5. UI/UX Design

### 5.1 Settings — API Access Section

```
┌─ Settings ─────────────────────────────────────┐
│                                                 │
│  [API Access]                                   │
│                                                 │
│  Your API Token:                                │
│  ┌────────────────────────────────────────────┐ │
│  │ mtsk_a1b2c3d4••••••••                      │ │
│  │ Created: 2026-04-06 12:00                  │ │
│  │ [Copy]  [Revoke]                           │ │
│  └────────────────────────────────────────────┘ │
│  [Generate New Token]                           │
│                                                 │
│  ─── API Documentation ───                      │
│                                                 │
│  Base URL:                                      │
│  https://xxx.supabase.co/functions/v1/api-proxy │
│                                                 │
│  Example — Create a task:                       │
│  ┌────────────────────────────────────────────┐ │
│  │ curl -X POST $BASE_URL \                   │ │
│  │   -H "Authorization: Bearer $TOKEN" \      │ │
│  │   -H "Content-Type: application/json" \    │ │
│  │   -d '{"action":"create","text":"..."}'    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  Example — List tasks:                          │
│  ┌────────────────────────────────────────────┐ │
│  │ curl -X POST $BASE_URL \                   │ │
│  │   -H "Authorization: Bearer $TOKEN" \      │ │
│  │   -H "Content-Type: application/json" \    │ │
│  │   -d '{"action":"list"}'                   │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  Full API docs: docs/API.md                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 5.2 UI States

| State | Display |
|-------|---------|
| No token | Generate button only |
| Token exists | Masked token + Copy/Revoke + API docs |
| Just generated | Full token shown + "Copy now!" warning |
| After revoke | Back to "No token" state |
| Not logged in | API Access section hidden |

### 5.3 Page UI Checklist

#### Settings — API Access Section

- [ ] Button: "Generate New Token" (generates mtsk_ token)
- [ ] Display: Masked token value (prefix + dots)
- [ ] Display: Token creation date
- [ ] Button: "Copy" (copy full token to clipboard, only on just-generated)
- [ ] Button: "Revoke" (deactivate token with confirmation)
- [ ] Display: API Base URL
- [ ] Display: curl example — create task
- [ ] Display: curl example — list tasks
- [ ] Display: Link to full API docs

---

## 6. Error Handling

### 6.1 Edge Function Errors

| Error | Handling |
|-------|----------|
| No Authorization header | 401 + clear message |
| Token not starting with `mtsk_` | 401 + format hint |
| Token hash not found in DB | 401 + "Invalid or revoked" |
| Missing required field (text, id) | 400 + field name |
| Unknown action | 400 + list of valid actions |
| Rate limit exceeded | 429 + retry message |
| DB error | 400 + Supabase error message |
| Unexpected error | 500 + error message |

### 6.2 Settings UI Errors

| Error | Handling |
|-------|----------|
| Token generation fails | Alert dialog with error + SQL hint |
| Copy fails (no clipboard API) | Fallback: select text |
| Network error | Toast notification |

---

## 7. Security Considerations

- [x] Token stored as SHA-256 hash only (no plaintext)
- [x] Token shown once at generation, never retrievable
- [x] service_role key only in Edge Function env (never exposed to client)
- [x] User isolation via user_id matching (not RLS — Edge Function enforces)
- [x] CORS headers for cross-origin access
- [ ] **Rate limiting** — 분당 60회 제한 (TODO: 구현 필요)
- [x] Token prefix `mtsk_` for easy identification/rotation
- [x] Revoke immediately deactivates token

### 7.1 Rate Limit Design

```typescript
// In-memory rate limiter (per Edge Function instance)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(userId);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (limit.count >= 60) return false;
  limit.count++;
  return true;
}
```

**Note**: Deno Deploy Edge Functions are stateless — in-memory rate limiting resets on cold start. This is acceptable for personal use. For stricter enforcement, use Supabase `api_rate_limits` table (deferred, not P0).

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|-------|
| L1: API Tests | Edge Function endpoints | curl | Do |
| L2: UI Action Tests | Settings token management | Manual | Do |

### 8.2 L1: API Test Scenarios

| # | Action | Test Description | Expected Status | Expected Response |
|---|--------|-----------------|:--------------:|-------------------|
| 1 | list | List tasks with valid token | 200 | `.tasks` is array, `.count` >= 0 |
| 2 | create | Create task with text | 201 | `.task.text` matches, `.message` = "Task created" |
| 3 | create | Create without text | 400 | `.error` = "text is required" |
| 4 | update | Update task text | 200 | `.task.text` updated |
| 5 | delete | Delete existing task | 200 | `.message` = "Task deleted" |
| 6 | toggle | Toggle task completion | 200 | `.task.completed` flipped |
| 7 | - | Request without Authorization header | 401 | `.error` contains "Missing" |
| 8 | - | Request with invalid token | 401 | `.error` contains "Invalid" |
| 9 | list | Request with rate limit exceeded | 429 | `.error` contains "Rate limit" |

### 8.3 L2: UI Action Test Scenarios

| # | Page | Action | Expected Result |
|---|------|--------|----------------|
| 1 | Settings | Click "Generate New Token" | Full token displayed, copy button active |
| 2 | Settings | Click "Copy" | Token copied to clipboard |
| 3 | Settings | Click "Revoke" | Confirmation → token removed |
| 4 | Settings | Reload after generation | Masked token shown |
| 5 | Settings | Not logged in | API Access section hidden |

---

## 9. Implementation Guide

### 9.1 Current Implementation Status

| Component | Status | File | Notes |
|-----------|--------|------|-------|
| api_tokens schema | Done | docs/api-token-schema.sql | RLS enabled |
| Edge Function | Done | supabase/functions/api-proxy/index.ts | 5 actions implemented |
| Settings UI — Token CRUD | Done | index.html:213-221 | Generate/Copy/Revoke |
| Settings UI — Token logic | Done | script.js:1360-1461 | SHA-256, insert, revoke |
| API documentation | Done | docs/API.md | All endpoints documented |
| Rate limiting | **TODO** | supabase/functions/api-proxy/index.ts | In-memory rate limiter |
| Settings — API docs inline | **TODO** | index.html | curl examples in Settings |

### 9.2 Implementation Order (Remaining Work)

| 순서 | 모듈 | 파일 | 설명 |
|------|------|------|------|
| 1 | rate-limit | supabase/functions/api-proxy/index.ts | In-memory rate limiter 추가 |
| 2 | api-docs-ui | index.html, style.css | Settings에 API 문서 인라인 표시 |

### 9.3 Estimated Changes

| 파일 | 변경 |
|------|------|
| supabase/functions/api-proxy/index.ts | +20 lines (rate limiter) |
| index.html | +30 lines (API docs section) |
| style.css | +15 lines (API docs styling) |
| **합계** | **~65 lines** |

### 9.4 Session Guide

| Module | Scope Key | Description | Estimated Turns |
|--------|-----------|-------------|:---------------:|
| Rate Limiter | `module-1` | Edge Function에 in-memory rate limit 추가 | 5-10 |
| API Docs UI | `module-2` | Settings에 API 문서/예시 인라인 표시 | 10-15 |

#### Recommended Session Plan

| Session | Scope | Description |
|---------|-------|-------------|
| Session 1 | `--scope module-1,module-2` | 소규모 작업이므로 한 세션에 완료 가능 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-04-06 | Initial draft — documenting existing implementation + gaps | Claude |
