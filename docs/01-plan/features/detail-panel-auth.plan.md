# Plan: Detail Side Panel + Security + Google Auth

> Created: 2026-04-06

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | 데스크톱에서 오른쪽이 비어있어 공간 낭비, DB 키가 평문 노출, 누구나 일정 접근 가능 |
| **Solution** | Task 클릭 시 오른쪽 사이드 패널에 상세 표시 + Key 마스킹 + Supabase Google OAuth 로그인 |
| **Function UX Effect** | 3단 레이아웃(사이드바/리스트/상세)으로 데스크톱 활용 극대화, 로그인으로 프라이버시 보호 |
| **Core Value** | 데스크톱 UX 완성 + 보안 강화 + 개인 데이터 보호 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 오른쪽 빈 공간 활용 + DB 키 보안 + 일정 프라이버시 |
| **WHO** | 개인 사용자 — 자신의 일정을 안전하게 관리 |
| **RISK** | Supabase Auth 설정 복잡도, Google OAuth redirect URI 설정, 모바일 레이아웃 |
| **SUCCESS** | 3단 레이아웃 동작, 키 마스킹, Google 로그인 후에만 앱 접근 |
| **SCOPE** | index.html, style.css, script.js, db.js 수정 + auth.js 신규 |

---

## 1. 요구사항

### 1.1 오른쪽 사이드 패널 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F1 | Task 클릭 시 오른쪽 패널 열기 | 기존 모달 → 오른쪽 고정 패널로 변경 |
| F2 | 패널에 상세 정보 표시 | title, description, category, dueDate, dueTime, 생성일, 수정일 |
| F3 | 패널에서 인라인 편집 | 모든 필드 직접 수정 가능 |
| F4 | 패널 닫기 | X 버튼 또는 다른 task 클릭 시 전환 |
| F5 | 모바일에서는 모달 유지 | 768px 이하에서는 기존 모달 방식 |

### 1.2 Supabase Key 마스킹 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F6 | Key 필드 password 타입 | 기본적으로 ●●●●로 표시 |
| F7 | Show/Hide 토글 버튼 | 눈 아이콘 클릭 시 평문/마스킹 전환 |

### 1.3 Google Login (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F8 | 로그인 페이지 | 앱 로드 시 로그인 여부 확인 → 미로그인이면 로그인 화면 |
| F9 | Google OAuth 버튼 | "Sign in with Google" 버튼 |
| F10 | Supabase Auth 연동 | Supabase의 Google provider 사용 |
| F11 | 세션 유지 | 로그인 후 새로고침해도 세션 유지 |
| F12 | 로그아웃 | 사이드바에 로그아웃 버튼 |
| F13 | 사용자별 데이터 격리 | RLS로 user_id 기반 데이터 접근 제한 |

## 2. UI 설계

### 2.1 3단 레이아웃 (데스크톱)
```
┌─ Sidebar ─┬─── Main (List/Calendar) ──┬─── Detail Panel ────┐
│ 280px     │ flex: 1                   │ 350px               │
│           │                            │                      │
│ View tabs │ [Search]                   │ [Task Title]         │
│ Filters   │ [Input area]              │ [Category] [Date]    │
│ Sort      │                            │ [Time]               │
│           │ ☐ Task 1        →         │                      │
│           │ ☐ Task 2                   │ Description:         │
│           │ ☑ Task 3                   │ [textarea...]        │
│           │                            │                      │
│           │                            │ Created: ...         │
│           │                            │ Updated: ...         │
│           │                            │                      │
│ Shortcuts │                            │ [Save][Archive][Del] │
└───────────┴────────────────────────────┴──────────────────────┘
```

### 2.2 로그인 페이지
```
┌──────────────────────────────────┐
│                                  │
│         My Tasks                 │
│                                  │
│    ┌──────────────────────┐      │
│    │  Sign in to continue │      │
│    │                      │      │
│    │ [G] Sign in with     │      │
│    │     Google           │      │
│    │                      │      │
│    └──────────────────────┘      │
│                                  │
└──────────────────────────────────┘
```

## 3. 기술 설계

### 3.1 Supabase Auth 흐름
```
1. 앱 로드 → supabase.auth.getSession()
2. 세션 없으면 → 로그인 페이지 표시
3. "Sign in with Google" 클릭 → supabase.auth.signInWithOAuth({ provider: 'google' })
4. Google redirect → Supabase callback → 세션 생성
5. 세션 있으면 → 앱 표시 + user_id로 데이터 필터
```

### 3.2 RLS (Row Level Security)
```sql
-- tasks 테이블에 user_id 컬럼 추가
ALTER TABLE tasks ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- RLS 활성화
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- 정책: 자신의 데이터만 접근
CREATE POLICY "Users can CRUD own tasks" ON tasks
    FOR ALL USING (auth.uid() = user_id);
```

### 3.3 파일 변경
| 파일 | 변경 |
|------|------|
| index.html | 로그인 페이지, 상세 패널(오른쪽), Key 마스킹 UI |
| style.css | 3단 레이아웃, 로그인 페이지, 상세 패널 스타일 |
| script.js | 모달 → 사이드 패널 전환, 로그아웃 버튼 |
| db.js | Auth 함수 추가 (login, logout, getSession, user_id 연동) |

## 4. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | Task 클릭 시 오른쪽 패널에 상세 표시 (데스크톱) |
| SC2 | 모바일에서는 기존 모달 동작 |
| SC3 | Supabase Key가 마스킹되고 토글 가능 |
| SC4 | Google 로그인 후에만 앱 접근 가능 |
| SC5 | 새로고침 후 세션 유지 |
| SC6 | 로그아웃 시 로그인 페이지로 전환 |

## 5. 구현 단계

| 단계 | 내용 |
|------|------|
| 1 | 오른쪽 상세 패널 (모달 → 사이드 패널) + 3단 레이아웃 |
| 2 | Supabase Key 마스킹 + show/hide 토글 |
| 3 | Google Login 페이지 + Supabase Auth 연동 |
