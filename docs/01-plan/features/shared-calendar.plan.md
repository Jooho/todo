# Plan: Shared Calendar — Multi-user & Collaboration

> Created: 2026-04-06

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | 현재 단일 유저 전용이라 팀/가족/스터디 그룹과 일정 공유가 불가능 |
| **Solution** | 공유 캘린더 생성 + 유저 초대(이메일/링크) + 읽기/편집 권한 분리 + 다른 유저 캘린더 보기 |
| **Function UX Effect** | 내 캘린더 옆에 공유 캘린더 목록이 표시되고, 다른 사람의 일정을 오버레이로 확인 가능 |
| **Core Value** | 개인 할 일 관리에서 팀 협업 일정 관리로 진화 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 단일 유저 → 팀/가족 일정 공유 필요. 스터디 그룹 시험 일정, 팀 프로젝트 마감일 등 |
| **WHO** | 학생(스터디 그룹), 직장인(팀), 가족 — 일정을 공유해야 하는 그룹 |
| **RISK** | DB 스키마 대규모 변경, RLS 복잡도 증가, 실시간 동기화 필요성, 초대 시스템 |
| **SUCCESS** | 공유 캘린더 CRUD, 유저 초대/권한, 다른 유저 캘린더 오버레이, 실시간 반영 |
| **SCOPE** | Supabase 테이블 추가 + RLS 정책 + UI (공유 캘린더 목록, 초대, 오버레이) |

---

## 1. 요구사항

### 1.1 공유 캘린더 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F1 | 공유 캘린더 생성 | 이름, 색상, 설명으로 새 공유 캘린더 생성 |
| F2 | 캘린더에 task 추가 | 공유 캘린더에 task를 추가하면 모든 멤버가 볼 수 있음 |
| F3 | 내 캘린더 + 공유 캘린더 동시 표시 | 캘린더 뷰에서 개인 task + 공유 task 오버레이 |
| F4 | 캘린더 on/off 토글 | 사이드바에서 각 공유 캘린더 표시/숨기기 |

### 1.2 초대 & 권한 (P0)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F5 | 이메일 초대 | 공유 캘린더에 유저를 이메일로 초대 |
| F6 | 링크 공유 | 초대 링크 생성 → 링크를 가진 사람이 참여 가능 |
| F7 | 권한 레벨 | viewer (보기만) / editor (편집 가능) / owner (관리) |
| F8 | 멤버 관리 | 멤버 목록 보기, 권한 변경, 멤버 제거 |

### 1.3 다른 유저 캘린더 보기 (P1)

| ID | 요구사항 | 설명 |
|----|----------|------|
| F9 | 유저 검색 | 이메일로 다른 유저 검색 |
| F10 | 캘린더 구독 요청 | 다른 유저에게 캘린더 보기 요청 → 승인 시 열람 가능 |
| F11 | 공개 캘린더 | 유저가 자신의 캘린더를 public으로 설정 가능 |

## 2. 데이터 모델

### 2.1 새 테이블: shared_calendars
```sql
CREATE TABLE shared_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT NOT NULL DEFAULT '#FF6B6B',
    owner_id UUID REFERENCES auth.users(id) NOT NULL,
    invite_link_token TEXT UNIQUE,  -- for link sharing
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 새 테이블: calendar_members
```sql
CREATE TABLE calendar_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID REFERENCES shared_calendars(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    role TEXT NOT NULL DEFAULT 'viewer',  -- 'owner', 'editor', 'viewer'
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(calendar_id, user_id)
);
```

### 2.3 tasks 테이블 변경
```sql
-- 기존 tasks에 shared_calendar_id 추가 (null = 개인 task)
ALTER TABLE tasks ADD COLUMN shared_calendar_id UUID REFERENCES shared_calendars(id);
```

### 2.4 RLS 정책
```sql
-- 공유 캘린더: 멤버만 접근
CREATE POLICY "Members can view shared calendars" ON shared_calendars
    FOR SELECT USING (
        owner_id = auth.uid() OR
        id IN (SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid())
    );

-- 공유 task: 해당 캘린더 멤버만 접근
CREATE POLICY "Members can view shared tasks" ON tasks
    FOR SELECT USING (
        user_id = auth.uid() OR
        shared_calendar_id IN (
            SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
        )
    );

-- 공유 task 편집: editor/owner만
CREATE POLICY "Editors can modify shared tasks" ON tasks
    FOR UPDATE USING (
        user_id = auth.uid() OR
        shared_calendar_id IN (
            SELECT calendar_id FROM calendar_members
            WHERE user_id = auth.uid() AND role IN ('editor', 'owner')
        )
    );
```

## 3. UI 설계

### 3.1 사이드바 — 캘린더 목록
```
[Calendars]
  ☑ 🔵 My Tasks (개인)
  ☑ 🔴 스터디 그룹        [⚙]
  ☑ 🟢 팀 프로젝트        [⚙]
  ☐ 🟡 가족 일정          [⚙]
  [+ New shared calendar]
```
- 체크박스로 표시/숨기기
- ⚙ 클릭 → 멤버 관리, 설정
- 색상이 캘린더 뷰에서 task 배경색으로 사용

### 3.2 공유 캘린더 생성 모달
```
┌─ New Shared Calendar ────────┐
│ Name: [스터디 그룹         ]  │
│ Color: [🔴]                   │
│ Description: [...]            │
│                               │
│ [Create]  [Cancel]            │
└───────────────────────────────┘
```

### 3.3 멤버 초대/관리
```
┌─ Members: 스터디 그룹 ────────┐
│ 👤 jooho@gmail.com   Owner    │
│ 👤 friend@gmail.com  Editor ▼ │
│ 👤 other@gmail.com   Viewer ▼ │
│                               │
│ Invite: [email@...] [Invite]  │
│ Or share link: [Copy Link]    │
│                               │
│ [Close]                       │
└───────────────────────────────┘
```

### 3.4 캘린더 오버레이
- 월/주/일 뷰에서 공유 캘린더 task가 각각의 색상으로 표시
- 개인 task = 카테고리 색상
- 공유 task = 캘린더 색상 + 작은 공유 아이콘

## 4. 기술 제약사항

- **이메일 발송**: Supabase Edge Functions 또는 외부 이메일 서비스 필요
  - 대안: 링크 공유만 먼저 구현 (이메일은 v2)
- **실시간 동기화**: Supabase Realtime 구독으로 다른 유저 변경 감지
- **성능**: 공유 캘린더가 많아지면 쿼리 최적화 필요

## 5. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | 공유 캘린더를 생성하고 task를 추가할 수 있음 |
| SC2 | 링크로 다른 유저를 초대할 수 있음 |
| SC3 | viewer는 보기만, editor는 편집 가능 |
| SC4 | 캘린더 뷰에서 개인 + 공유 task가 색상으로 구분되어 표시 |
| SC5 | 사이드바에서 캘린더 on/off 토글 가능 |
| SC6 | 멤버 관리 (권한 변경, 제거) 가능 |

## 6. 구현 단계

| 단계 | 내용 | 복잡도 |
|------|------|--------|
| 1 | DB 스키마 (shared_calendars, calendar_members, RLS) | 중 |
| 2 | 공유 캘린더 CRUD + 사이드바 목록 | 중 |
| 3 | 멤버 초대 (링크 공유) + 권한 관리 | 높 |
| 4 | 캘린더 뷰 오버레이 (색상 구분) | 중 |
| 5 | 실시간 동기화 (Supabase Realtime) | 높 |
| 6 | 이메일 초대 (선택적, v2) | 높 |

## 7. 리스크

| 리스크 | 영향 | 완화 방안 |
|--------|------|-----------|
| RLS 복잡도 증가 | 높 | 정책을 단순하게, 테스트 철저히 |
| 이메일 발송 인프라 | 중 | 링크 공유 먼저, 이메일은 나중에 |
| 실시간 동기화 비용 | 중 | Supabase 무료 한도 내에서 |
| N+1 쿼리 | 중 | 공유 캘린더 task를 배치로 로드 |
