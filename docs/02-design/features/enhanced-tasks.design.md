# Design: Enhanced Tasks — Detail, Archive, Settings, Supabase

> Created: 2026-04-05
> Architecture: Option B — Module split (script.js UI + db.js data layer)

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 단순 텍스트 task → 상세 내용, 아카이브, 커스텀 카테고리, 영구 저장 |
| **WHO** | 학생/직장인 — 마감일 관리 + 이력 보관 |
| **RISK** | Supabase 의존성, 오프라인 동기화, script.js 크기 증가 |
| **SUCCESS** | Task 상세, 아카이브 CRUD, 커스텀 카테고리, Supabase 동기화 |
| **SCOPE** | script.js 수정 + db.js 신규 + index.html/style.css 수정 |

---

## 1. 파일 구조

```
todo_app/
├── index.html          ← 수정: 상세패널, 아카이브뷰, 설정뷰 추가
├── style.css           ← 수정: 상세패널, 설정, 아카이브 스타일
├── script.js           ← 수정: UI 로직 (Task상세, Archive, Settings, Category)
├── db.js               ← 신규: Supabase 클라이언트 + 동기화 엔진
└── docs/
```

## 2. 데이터 레이어 아키텍처 (db.js)

### 2.1 설계 원칙
- **오프라인 우선**: localStorage가 primary source of truth
- **선택적 Supabase**: 연결 설정이 없으면 localStorage만 사용
- **단방향 동기화**: localStorage → Supabase (수동 Sync 버튼)
- **CDN 로드**: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">` 

### 2.2 db.js 구조
```javascript
const DB = {
    // --- Connection ---
    supabase: null,         // Supabase client instance (null = offline)
    isConnected: false,

    init(url, key),         // Initialize Supabase client
    testConnection(),       // Test and return status
    disconnect(),

    // --- CRUD (localStorage primary) ---
    getTasks(),             // Read from localStorage
    saveTasks(tasks),       // Write to localStorage
    getCategories(),        // Read categories from localStorage
    saveCategories(cats),   // Write categories to localStorage
    getAppSettings(),       // Read app settings
    saveAppSettings(s),     // Write app settings

    // --- Supabase Sync ---
    syncToSupabase(),       // Push localStorage → Supabase
    syncFromSupabase(),     // Pull Supabase → localStorage
    syncCategories(),       // Sync categories table

    // --- Archive specific ---
    getArchivedTasks(),     // Get archived tasks (from localStorage or Supabase)
    archiveTask(task),      // Move to archive
    restoreTask(id),        // Restore from archive
    exportArchive(),        // Download as JSON
};
```

### 2.3 Storage Keys
```javascript
"my-tasks-data"       // Active tasks array
"my-tasks-archive"    // Archived tasks array (NEW)
"my-tasks-categories" // Custom categories array (NEW)
"my-tasks-settings"   // App settings (view, mode, date)
"my-tasks-supabase"   // Supabase connection info (url, key) (NEW)
"my-tasks-filter"     // Active filter
"my-tasks-theme"      // Theme preference
```

## 3. Task 데이터 모델 확장

### 3.1 활성 Task
```javascript
{
    id: "uuid",
    text: "할 일 제목",
    description: "",        // NEW: multi-line description
    category: "work",       // references categories list
    completed: false,
    dueDate: "2026-04-05",  // default: today's date
    dueTime: null,          // null = all day
    createdAt: "ISO8601",
    updatedAt: "ISO8601",   // NEW: last modified timestamp
}
```

### 3.2 아카이브된 Task
```javascript
// Same structure + archived fields
{
    ...task,
    archived: true,
    archivedAt: "ISO8601",
}
```
- `"my-tasks-archive"` localStorage key에 별도 배열로 저장
- 활성 tasks에서 제거, archive 배열에 추가

### 3.3 카테고리 구조
```javascript
// "my-tasks-categories" localStorage key
[
    { id: "work", label: "Work", color: "#4A90E2" },
    { id: "personal", label: "Personal", color: "#27AE60" },
    { id: "study", label: "Study", color: "#8E44AD" },
    // User-added:
    { id: "health", label: "Health", color: "#E67E22" },
]
```
- 기존 하드코딩된 `CATEGORIES` 객체 → `loadCategories()`에서 동적 로드
- 기본 3개는 최초 실행 시 자동 생성
- `getCategoryMap()` 헬퍼로 `{ id: { label, color } }` 형태 반환

## 4. UI 설계 상세

### 4.1 사이드바 View 탭 확장
```html
<div class="view-tabs">
    <button class="view-tab active" data-view="list">📋 List</button>
    <button class="view-tab" data-view="calendar">📅 Calendar</button>
    <button class="view-tab" data-view="archive">📦 Archive</button>
    <button class="view-tab" data-view="settings">⚙️ Settings</button>
</div>
```

### 4.2 Task 상세 패널 (모달)
기존 `task-popup`을 확장. Task 클릭 시 열림.
```html
<div class="detail-modal" id="detail-modal">
    <div class="detail-header">
        <input type="text" id="detail-title" placeholder="Task title...">
        <button class="detail-close" id="detail-close">✕</button>
    </div>
    <div class="detail-meta">
        <select id="detail-category"><!-- dynamic --></select>
        <input type="date" id="detail-date">
        <input type="time" id="detail-time">
    </div>
    <textarea id="detail-desc" placeholder="Add description, notes, links..." rows="6"></textarea>
    <div class="detail-info">
        <span>Created: <span id="detail-created"></span></span>
        <span>Updated: <span id="detail-updated"></span></span>
    </div>
    <div class="detail-actions">
        <button class="detail-btn save" id="detail-save">Save</button>
        <button class="detail-btn archive" id="detail-archive">Archive</button>
        <button class="detail-btn delete" id="detail-delete">Delete</button>
    </div>
</div>
```

### 4.3 Archive 뷰
```html
<div id="archive-view" style="display:none">
    <div class="archive-header">
        <h2>📦 Archive</h2>
        <input type="text" id="archive-search" placeholder="Search archive...">
        <button id="archive-export">Export JSON</button>
    </div>
    <ul id="archive-list"></ul>
</div>
```
- 각 아카이브 항목에 "Restore" 버튼
- 검색 가능
- 카테고리 필터 적용됨

### 4.4 Settings 뷰
```html
<div id="settings-view" style="display:none">
    <!-- Supabase Connection -->
    <section class="settings-section">
        <h3>Database Connection</h3>
        <input type="url" id="sb-url" placeholder="Supabase URL">
        <input type="text" id="sb-key" placeholder="Anon Key">
        <div class="sb-status" id="sb-status">Not connected</div>
        <button id="sb-test">Test Connection</button>
        <button id="sb-sync">Sync Now</button>
    </section>

    <!-- Categories -->
    <section class="settings-section">
        <h3>Categories</h3>
        <div id="cat-list"></div>
        <div class="cat-add-form">
            <input type="text" id="cat-new-label" placeholder="Category name">
            <input type="color" id="cat-new-color" value="#E67E22">
            <button id="cat-add-btn">Add</button>
        </div>
    </section>

    <!-- Data Management -->
    <section class="settings-section">
        <h3>Data</h3>
        <button id="data-export">Export All (JSON)</button>
        <button id="data-import">Import (JSON)</button>
        <input type="file" id="data-import-file" accept=".json" hidden>
    </section>
</div>
```

## 5. Supabase 동기화 전략

### 5.1 동기화 흐름
```
[User Action] → localStorage (즉시) → UI 업데이트
                    ↓ (Sync 버튼 클릭 시)
              Supabase upsert (batch)
```

### 5.2 충돌 해결
- **Last Write Wins**: `updatedAt` 기준으로 최신 데이터 우선
- 동기화는 수동 (자동 동기화는 v2에서)

### 5.3 Supabase 테이블
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY,
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

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#888888',
    sort_order INTEGER DEFAULT 0
);
```

## 6. 기존 코드 변경 영향

### 6.1 script.js 변경 사항
| 영역 | 변경 |
|------|------|
| `CATEGORIES` 상수 | 제거 → `getCategoryMap()` 함수로 대체 |
| `addTask()` | `description` 파라미터 추가, `updatedAt` 추가, dueDate 기본값=오늘 |
| `updateTask()` | `description` 지원, `updatedAt` 갱신 |
| `deleteTask()` | 삭제 대신 `archiveTask()` 호출 옵션 추가 |
| `createTaskElement()` | 클릭 시 detail modal 열기 |
| `render()` → `renderAll()` | archive/settings 뷰 추가 |
| `setActiveView()` | "archive", "settings" 추가 |
| 필터 버튼 | 동적 카테고리 기반 렌더링 |
| Calendar popup | detail modal로 통합 |

### 6.2 하위 호환성
- `description` 없는 기존 task → `""` 기본값
- `updatedAt` 없는 기존 task → `createdAt` 사용
- `"my-tasks-categories"` 없으면 → 기본 3개 생성
- `"my-tasks-archive"` 없으면 → 빈 배열

## 7. Implementation Guide

### 7.1 구현 순서
| 순서 | 모듈 | 파일 | 설명 |
|------|------|------|------|
| 1 | dynamic-categories | script.js | 하드코딩 CATEGORIES → 동적 로드 |
| 2 | task-detail | script.js, index.html, style.css | 상세 모달 + description |
| 3 | default-date | script.js | dueDate 기본값 = 오늘 |
| 4 | archive-core | script.js | archiveTask(), restoreTask(), archive 저장소 |
| 5 | archive-view | script.js, index.html, style.css | 아카이브 뷰 UI |
| 6 | settings-view | script.js, index.html, style.css | 설정 뷰 + 카테고리 관리 |
| 7 | db-layer | db.js | Supabase 클라이언트, 연결, CRUD |
| 8 | sync-engine | db.js, script.js | 동기화 로직 + 설정 UI 연동 |
| 9 | polish | style.css | 반응형, 애니메이션, 에지케이스 |

### 7.2 예상 변경량
| 파일 | 변경 |
|------|------|
| index.html | +80 lines (detail modal, archive view, settings view) |
| style.css | +250 lines (detail, archive, settings 스타일) |
| script.js | +400 lines (수정 + 추가) |
| db.js | +250 lines (신규) |
| **합계** | **~980 lines** |

### 7.3 Session Guide
| 세션 | 모듈 | 설명 |
|------|------|------|
| Session 1 | dynamic-categories, task-detail, default-date | 카테고리 동적화 + 상세 모달 |
| Session 2 | archive-core, archive-view | 아카이브 기능 |
| Session 3 | settings-view | 설정 페이지 + 카테고리 관리 |
| Session 4 | db-layer, sync-engine, polish | Supabase 연동 |
