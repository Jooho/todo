# Plan: Enhanced Tasks — Detail, Archive, Settings, Supabase

> Created: 2026-04-05

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | Task에 상세 내용을 기록할 수 없고, 완료된 task가 삭제되어 이력이 사라짐. 카테고리가 고정되어 있고, 데이터가 브라우저에만 저장됨 |
| **Solution** | Task 상세 필드 추가 + Supabase 연동으로 아카이브/영구 저장 + 커스텀 카테고리 설정 + GitHub Pages 배포 |
| **Function UX Effect** | 풍부한 task 상세, 아카이브에서 이전 작업 검색/복원, 설정에서 카테고리 커스터마이즈, 어디서든 접근 |
| **Core Value** | 개인 할 일 관리가 단순 체크리스트에서 완전한 작업 관리 시스템으로 진화 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 단순 텍스트 task → 상세 내용 필요, 완료 task 이력 보존, 카테고리 유연화, 데이터 영구 저장 |
| **WHO** | 학생/직장인 — 시험, 숙제, 업무를 상세하게 관리하고 이력을 보관하는 사용자 |
| **RISK** | Supabase 의존성, 인증 복잡도, 오프라인 시 동기화 |
| **SUCCESS** | Task 상세 편집, 아카이브 저장/복원, 커스텀 카테고리, Supabase 연동 |
| **SCOPE** | 기존 3파일 수정 + Supabase 연동 + GitHub Pages 배포 준비 |

---

## 1. 기능 요구사항

### 1.1 Task 상세 내용 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F1 | Task description 필드 | 여러 줄 텍스트로 상세 내용 기록 (메모, 링크, 참고사항) |
| F2 | Task 클릭 시 상세 패널 | 클릭하면 사이드 패널/모달로 상세 보기/편집 |
| F3 | 기본 날짜 = 오늘 | 새 task 추가 시 dueDate 기본값이 오늘 날짜 |
| F4 | 시간 미입력 = All day | dueTime 없으면 자동으로 all-day 처리 (현재 동작과 동일) |

### 1.2 아카이브 기능 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F5 | 완료 task 아카이브 | 삭제 대신 아카이브로 이동. Supabase `archived_tasks` 테이블에 저장 |
| F6 | 아카이브 뷰 | 아카이브된 task 목록 보기 (검색, 필터 가능) |
| F7 | 아카이브에서 복원 | 아카이브된 task를 다시 활성으로 복원 |
| F8 | 아카이브 JSON 내보내기 | 아카이브 데이터를 JSON으로 다운로드 |

### 1.3 커스텀 카테고리 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F9 | 카테고리 추가 | 설정에서 새 카테고리 이름 + 색상 지정하여 추가 |
| F10 | 카테고리 삭제 | 사용 중이 아닌 카테고리 삭제 (사용 중이면 경고) |
| F11 | 기본 카테고리 3개 유지 | Work/Personal/Study는 기본값, 삭제 가능 |

### 1.4 Settings 메뉴 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F12 | Settings 패널/페이지 | 사이드바에 Settings 탭 추가 |
| F13 | Supabase 연결 설정 | Supabase URL + anon key 입력 (첫 실행 시 설정) |
| F14 | 카테고리 관리 | 카테고리 추가/삭제/색상 변경 |
| F15 | 데이터 동기화 | localStorage ↔ Supabase 동기화 버튼 |

### 1.5 Supabase 연동 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F16 | Supabase 클라이언트 | CDN으로 supabase-js 로드 (빌드 도구 없이) |
| F17 | Tasks 테이블 | Supabase에 `tasks` 테이블 생성 |
| F18 | 오프라인 폴백 | Supabase 연결 안 될 때 localStorage로 폴백 |
| F19 | 동기화 전략 | 온라인 복귀 시 localStorage → Supabase 동기화 |

## 2. 데이터 모델

### 2.1 Task 구조 (확장)
```javascript
{
    id: "uuid",
    text: "할 일 제목",
    description: "",            // NEW: 상세 내용 (여러 줄)
    category: "work",
    completed: false,
    archived: false,            // NEW: 아카이브 여부
    archivedAt: null,           // NEW: 아카이브 시각
    dueDate: "2026-04-05",      // 기본값: 오늘
    dueTime: null,              // null = all day
    createdAt: "ISO8601",
    updatedAt: "ISO8601",       // NEW: 수정 시각
}
```

### 2.2 Supabase 테이블 스키마
```sql
-- tasks 테이블
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'work',
    completed BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    due_date DATE,
    due_time TIME,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- categories 테이블
CREATE TABLE categories (
    id TEXT PRIMARY KEY,         -- "work", "personal", "study", "custom-1"
    label TEXT NOT NULL,
    color TEXT NOT NULL,         -- "#4A90E2"
    is_default BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0
);

-- settings 테이블
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value JSONB
);
```

### 2.3 Settings 구조
```javascript
{
    supabaseUrl: "https://xxx.supabase.co",
    supabaseKey: "eyJ...",
    categories: [
        { id: "work", label: "Work", color: "#4A90E2", isDefault: true },
        { id: "personal", label: "Personal", color: "#27AE60", isDefault: true },
        { id: "study", label: "Study", color: "#8E44AD", isDefault: true },
    ],
    defaultView: "list",
    theme: "light",
}
```

## 3. UI 설계

### 3.1 사이드바 탭 추가
```
[View]
  📋 List
  📅 Calendar
  📦 Archive        ← NEW
  ⚙️ Settings       ← NEW
```

### 3.2 Task 상세 패널
Task 클릭 시 오른쪽 또는 모달로 상세 편집:
```
┌─ Task Detail ───────────────────────┐
│ Title: [                          ] │
│ Category: [Work ▼]                  │
│ Due: [2026-04-05] [14:00]          │
│                                     │
│ Description:                        │
│ ┌─────────────────────────────────┐ │
│ │ 여러 줄 텍스트 입력 가능         │ │
│ │ - 참고 링크                      │ │
│ │ - 메모 사항                      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Created: 2026-04-05 10:00          │
│ [Save] [Archive] [Delete] [Close]   │
└─────────────────────────────────────┘
```

### 3.3 Settings 페이지
```
┌─ Settings ──────────────────────────┐
│                                     │
│ [Supabase Connection]               │
│   URL:  [https://xxx.supabase.co]   │
│   Key:  [eyJ...]                    │
│   Status: ● Connected               │
│   [Test Connection] [Sync Now]      │
│                                     │
│ [Categories]                        │
│   🔵 Work        [Edit] [Delete]    │
│   🟢 Personal    [Edit] [Delete]    │
│   🟣 Study       [Edit] [Delete]    │
│   [+ Add Category]                  │
│                                     │
│ [Data]                              │
│   [Export All (JSON)]               │
│   [Import (JSON)]                   │
│   [Sync to Supabase]               │
│                                     │
└─────────────────────────────────────┘
```

## 4. 기술 제약사항

- **빌드 도구 없음**: Supabase JS SDK는 CDN `<script>` 태그로 로드
- **인증 없음**: 단일 사용자, anon key로 직접 접근 (RLS 설정으로 보안)
- **오프라인 우선**: localStorage가 primary, Supabase는 백업/동기화
- **GitHub Pages 호환**: 정적 파일만 (index.html, style.css, script.js)

## 5. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | Task에 description을 입력/수정할 수 있음 |
| SC2 | 완료된 task를 아카이브하고, 아카이브 뷰에서 검색/복원 가능 |
| SC3 | Settings에서 카테고리를 추가/삭제/색상 변경 가능 |
| SC4 | Supabase 연결 후 데이터가 동기화됨 |
| SC5 | 새 task 추가 시 기본 날짜가 오늘 |
| SC6 | Supabase 미연결 시 localStorage로 정상 동작 |
| SC7 | GitHub Pages에서 정상 동작 |

## 6. 구현 단계

| 단계 | 내용 |
|------|------|
| 1 | Task description 필드 + 상세 패널 + 기본 날짜=오늘 |
| 2 | 아카이브 기능 + 아카이브 뷰 |
| 3 | Settings 페이지 + 커스텀 카테고리 |
| 4 | Supabase 연동 + 동기화 |
| 5 | GitHub Pages 배포 준비 |
