# Plan: API Token — External Access for Claude & Tools

> Created: 2026-04-06

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | Claude Code나 외부 도구에서 task를 생성/수정/삭제할 수 없음. UI를 통해서만 가능 |
| **Solution** | 사용자별 API token 생성 → Supabase REST API + token으로 외부에서 CRUD 가능 |
| **Function UX Effect** | Claude가 대화 중 "할 일 추가해줘" → API로 직접 task 생성. 자동화 스크립트 연동 |
| **Core Value** | UI 없이도 프로그래밍 방식으로 task 관리 가능 — AI 에이전트 연동의 문 열기 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | Claude/스크립트에서 task 자동 생성 필요 → API 접근 경로 |
| **WHO** | 개발자, Claude Code 사용자 — API로 task 관리하고 싶은 사용자 |
| **RISK** | Token 유출 시 데이터 접근 가능, rate limit 필요, token 관리 |
| **SUCCESS** | API token으로 task CRUD 가능, Settings에서 token 생성/삭제/복사, 문서화 |
| **SCOPE** | Supabase api_tokens 테이블 + Settings UI + Supabase Edge Function |

---

## 1. 요구사항

### 1.1 API Token 관리 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F1 | Token 생성 | Settings에서 "Generate API Token" 버튼 → 랜덤 토큰 생성 |
| F2 | Token 표시 | 생성 직후 한 번만 전체 표시, 이후 마스킹 (처음 4자만) |
| F3 | Token 복사 | Copy 버튼으로 클립보드 복사 |
| F4 | Token 삭제 | 기존 토큰 폐기 (revoke) |
| F5 | 토큰당 1개 | 사용자당 활성 토큰 1개 (재생성 시 기존 폐기) |

### 1.2 API 엔드포인트 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F6 | Task 생성 | POST /tasks — text, category, dueDate, dueTime, description |
| F7 | Task 목록 | GET /tasks — 필터(category, completed, date range) |
| F8 | Task 수정 | PATCH /tasks/:id — 부분 업데이트 |
| F9 | Task 삭제 | DELETE /tasks/:id |
| F10 | Task 완료 토글 | PATCH /tasks/:id/toggle |

### 1.3 보안 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F11 | Token 인증 | `Authorization: Bearer <token>` 헤더 |
| F12 | RLS 유지 | API로 접근해도 자기 데이터만 접근 |
| F13 | Rate limit | 분당 60회 제한 |

### 1.4 문서화 (P1)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F14 | API 문서 페이지 | Settings 또는 별도 탭에 API 사용법 표시 |
| F15 | Claude 예시 | Claude에서 사용하는 curl/fetch 예시 |

## 2. 기술 설계

### 2.1 아키텍처

Supabase REST API를 직접 사용하되, API token → JWT 교환을 Supabase Edge Function으로 처리:

```
Claude/Script
  → POST /functions/v1/api-auth (token → JWT)
  → GET/POST/PATCH/DELETE /rest/v1/tasks (JWT 인증)
```

또는 더 단순한 방식:

```
Claude/Script
  → Supabase Edge Function (token + 요청 내용)
  → Edge Function이 service_role로 DB 접근 (RLS 대신 token→user 매핑)
  → 결과 반환
```

### 2.2 DB 스키마

```sql
CREATE TABLE api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    token_hash TEXT NOT NULL,        -- SHA-256 hash (원본 저장 안 함)
    token_prefix TEXT NOT NULL,      -- 처음 8자 (UI 식별용)
    name TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, is_active)       -- 사용자당 활성 토큰 1개
);
```

### 2.3 Edge Function (api-proxy)

```javascript
// supabase/functions/api-proxy/index.ts
// 1. Authorization 헤더에서 token 추출
// 2. api_tokens에서 token_hash로 user_id 조회
// 3. user_id로 tasks 테이블 CRUD
// 4. 결과 반환
```

## 3. Settings UI

```
[API Access]
  Your API Token:
  ┌──────────────────────────────────────┐
  │ mtsk_a1b2****  Created: 2026-04-06  │
  │ [Copy Token] [Revoke]               │
  └──────────────────────────────────────┘
  [Generate New Token]

  API Documentation:
  ┌──────────────────────────────────────┐
  │ Base URL:                            │
  │ https://xxx.supabase.co/functions/   │
  │   v1/api-proxy                       │
  │                                      │
  │ Example (create task):               │
  │ curl -X POST <url> \                 │
  │   -H "Authorization: Bearer mtsk_"   │
  │   -d '{"text":"Buy milk"}'           │
  └──────────────────────────────────────┘
```

## 4. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | Settings에서 API token 생성/복사/폐기 가능 |
| SC2 | curl로 task 생성/조회/수정/삭제 가능 |
| SC3 | 잘못된 token으로 접근 시 401 반환 |
| SC4 | 다른 유저 데이터 접근 불가 |

## 5. 구현 단계

| 단계 | 내용 |
|------|------|
| 1 | api_tokens 테이블 생성 + Settings UI (생성/복사/폐기) |
| 2 | Supabase Edge Function (api-proxy) — CRUD 엔드포인트 |
| 3 | 문서화 + Claude 사용 예시 |
