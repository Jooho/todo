# Design: Shared Calendar — Multi-user & Collaboration

> Created: 2026-04-06
> Architecture: Option B — shared.js separation

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 단일 유저 → 팀/가족 일정 공유 필요 |
| **WHO** | 학생, 직장인, 가족 — 일정 공유 그룹 |
| **RISK** | RLS 복잡도, 실시간 동기화, 초대 시스템 |
| **SUCCESS** | 공유 캘린더 CRUD, 초대/권한, 오버레이, 실시간 |
| **SCOPE** | shared.js(new) + db.js/script.js/index.html/style.css 수정 + Supabase SQL |

---

## 1. 파일 구조

```
todo_app/
├── index.html          ← 수정: 캘린더 목록 사이드바, 생성/멤버 모달
├── style.css           ← 수정: 캘린더 목록, 모달, 오버레이 색상
├── script.js           ← 수정: Calendar 오버레이, 공유 task 표시
├── db.js               ← 수정: 공유 캘린더 Supabase 쿼리 추가
├── auth.js             ← 변경 없음
├── detail-panel.js     ← 수정: 공유 캘린더 선택 드롭다운 추가
├── shared.js           ← 신규: SharedCalendar 객체 (CRUD, 초대, UI)
└── docs/
```

## 2. shared.js 구조

```javascript
const SharedCalendar = {
    // --- State ---
    calendars: [],          // user's shared calendars list
    enabledCalendarIds: [], // which calendars are visible (toggled on)

    // --- CRUD ---
    async loadCalendars(),        // fetch from Supabase
    async createCalendar(name, color, description),
    async deleteCalendar(calId),
    async updateCalendar(calId, data),

    // --- Members ---
    async getMembers(calId),
    async inviteMember(calId, email, role),
    async removeMember(calId, userId),
    async updateMemberRole(calId, userId, role),

    // --- Invite Link ---
    async generateInviteLink(calId),
    async joinByLink(token),

    // --- Tasks ---
    async getSharedTasks(calendarIds),  // fetch tasks for enabled calendars
    getTaskCalendarColor(task),          // return calendar color for overlay

    // --- UI ---
    renderCalendarList(),    // sidebar calendar checkboxes
    showCreateModal(),       // new calendar modal
    showMembersModal(calId), // members management
    toggleCalendar(calId),   // show/hide in calendar view

    // --- Realtime ---
    subscribeToChanges(),    // Supabase Realtime subscription
    unsubscribe(),

    // --- Init ---
    async init(),
};
```

## 3. DB 스키마 (Supabase SQL)

### 3.1 새 테이블
```sql
-- shared_calendars: 공유 캘린더 정의
CREATE TABLE shared_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT NOT NULL DEFAULT '#FF6B6B',
    owner_id UUID REFERENCES auth.users(id) NOT NULL,
    invite_link_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- calendar_members: 멤버십
CREATE TABLE calendar_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id UUID REFERENCES shared_calendars(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(calendar_id, user_id)
);

-- tasks에 shared_calendar_id 추가
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
    shared_calendar_id UUID REFERENCES shared_calendars(id) ON DELETE SET NULL;
```

### 3.2 RLS 정책
```sql
-- shared_calendars RLS
ALTER TABLE shared_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage calendars" ON shared_calendars
    FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "Members view calendars" ON shared_calendars
    FOR SELECT USING (
        id IN (SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid())
    );

-- calendar_members RLS
ALTER TABLE calendar_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see membership" ON calendar_members
    FOR SELECT USING (
        calendar_id IN (
            SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Owners manage members" ON calendar_members
    FOR ALL USING (
        calendar_id IN (
            SELECT id FROM shared_calendars WHERE owner_id = auth.uid()
        )
    );

-- tasks RLS 업데이트: 기존 + 공유 task 접근
DROP POLICY IF EXISTS "Users own tasks" ON tasks;

CREATE POLICY "Users access own and shared tasks" ON tasks
    FOR ALL USING (
        user_id = auth.uid()
        OR shared_calendar_id IN (
            SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
        )
    );
```

## 4. UI 설계

### 4.1 사이드바 — Calendars 섹션
```html
<!-- Filter 섹션 아래에 추가 -->
<div class="sidebar-section">
    <div class="section-label">Calendars</div>
    <div id="calendar-list">
        <!-- 동적: 체크박스 + 색상 + 이름 + 설정 -->
    </div>
    <button class="cal-add-btn" id="shared-cal-create">+ New calendar</button>
</div>
```

### 4.2 공유 캘린더 생성 모달
```html
<div class="shared-modal" id="shared-create-modal" style="display:none">
    <h3>New Shared Calendar</h3>
    <input type="text" id="sc-name" placeholder="Calendar name">
    <input type="color" id="sc-color" value="#FF6B6B">
    <textarea id="sc-desc" placeholder="Description (optional)"></textarea>
    <div class="modal-actions">
        <button id="sc-create-btn">Create</button>
        <button id="sc-cancel-btn">Cancel</button>
    </div>
</div>
```

### 4.3 멤버 관리 모달
```html
<div class="shared-modal" id="shared-members-modal" style="display:none">
    <h3>Members: <span id="sm-cal-name"></span></h3>
    <div id="sm-member-list"></div>
    <div class="sm-invite-row">
        <input type="email" id="sm-invite-email" placeholder="Email to invite">
        <select id="sm-invite-role">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
        </select>
        <button id="sm-invite-btn">Invite</button>
    </div>
    <div class="sm-link-row">
        <span>Invite link:</span>
        <button id="sm-copy-link">Copy Link</button>
    </div>
    <button id="sm-close-btn">Close</button>
</div>
```

### 4.4 캘린더 오버레이 표시
- `Calendar.getTasksForDate()` 확장: 개인 task + 활성화된 공유 캘린더 task
- 공유 task의 chip/block 색상 = 캘린더 색상 (카테고리 색상 대신)
- 공유 task에 작은 "공유" 아이콘 표시

## 5. 데이터 흐름

### 5.1 캘린더 로드
```
앱 시작 → SharedCalendar.init()
  → Supabase에서 내가 속한 캘린더 목록 로드
  → 사이드바에 캘린더 체크박스 렌더링
  → 활성화된 캘린더의 task 로드
  → Calendar 뷰에 오버레이
```

### 5.2 초대 링크 참여
```
유저가 초대 링크 클릭 (?join=<token>)
  → SharedCalendar.joinByLink(token)
  → calendar_members에 insert
  → 캘린더 목록 새로고침
```

### 5.3 Task 생성 (공유)
```
Task 추가 시 "캘린더 선택" 드롭다운 표시
  → "Personal" 또는 공유 캘린더 선택
  → shared_calendar_id 설정
  → Supabase에 저장 → RLS가 멤버에게 노출
```

## 6. script.js 변경

### 6.1 Calendar 오버레이
```javascript
// Calendar.getTasksForDate 확장
getTasksForDate(dateKey) {
    let list = tasks.filter(t => t.dueDate === dateKey && !t.shared_calendar_id);
    // 공유 캘린더 task 추가
    if (typeof SharedCalendar !== "undefined") {
        const sharedTasks = SharedCalendar._sharedTasks.filter(t => t.dueDate === dateKey);
        list = list.concat(sharedTasks);
    }
    if (activeFilter !== "all") list = list.filter(t => t.category === activeFilter);
    return list;
}
```

### 6.2 Task 입력 — 캘린더 선택
```javascript
// input-area에 캘린더 선택 드롭다운 추가
// "Personal" + 공유 캘린더 목록
```

## 7. Implementation Guide

### 7.1 구현 순서
| 순서 | 모듈 | 파일 | 설명 |
|------|------|------|------|
| 1 | db-schema | Supabase SQL | 테이블 생성 + RLS |
| 2 | shared-crud | shared.js, db.js | 캘린더 CRUD + 멤버 관리 |
| 3 | sidebar-ui | shared.js, index.html, style.css | 사이드바 캘린더 목록 + 토글 |
| 4 | create-modal | shared.js, index.html, style.css | 생성/멤버 모달 |
| 5 | invite-link | shared.js | 링크 생성 + 참여 |
| 6 | overlay | script.js, shared.js | 캘린더 뷰 오버레이 |
| 7 | task-calendar | script.js, detail-panel.js | task 생성 시 캘린더 선택 |
| 8 | realtime | shared.js | Supabase Realtime 구독 |
| 9 | polish | style.css | 반응형, 애니메이션 |

### 7.2 예상 변경량
| 파일 | 변경 |
|------|------|
| Supabase SQL | ~50 lines (테이블 + RLS) |
| shared.js | ~350 lines (신규) |
| db.js | +50 lines (공유 쿼리) |
| script.js | +100 lines (오버레이, 캘린더 선택) |
| detail-panel.js | +20 lines (캘린더 드롭다운) |
| index.html | +80 lines (모달, 사이드바) |
| style.css | +150 lines |
| **합계** | **~800 lines** |

### 7.3 Session Guide
| 세션 | 모듈 | 설명 |
|------|------|------|
| Session 1 | db-schema, shared-crud, sidebar-ui | DB + CRUD + 사이드바 목록 |
| Session 2 | create-modal, invite-link | 모달 + 초대 링크 |
| Session 3 | overlay, task-calendar | 캘린더 오버레이 + task 캘린더 선택 |
| Session 4 | realtime, polish | 실시간 + 마무리 |
