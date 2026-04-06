# Design: Calendar View for Todo Manager

> Created: 2026-04-05
> Architecture: Option C — Single file, Calendar object pattern

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | task에 시간 개념이 없어 시험/숙제 등 마감일 관리 불가 → 캘린더 뷰로 시간 기반 관리 |
| **WHO** | 학생/직장인 — 시험, 숙제, 업무 마감일을 관리하는 사용자 |
| **RISK** | 순수 JS로 캘린더 구현 시 복잡도 증가, 드래그 앤 드롭 모바일 호환성 |
| **SUCCESS** | 월/주/일 뷰 전환, 캘린더 CRUD + 드래그, 반응형, 기존 task 호환 |
| **SCOPE** | index.html, style.css, script.js 3파일 수정 |

---

## 1. Overview

기존 Todo Manager에 캘린더 뷰를 추가한다. `script.js`를 섹션으로 구조화하고 `Calendar` 객체로 캘린더 로직을 캡슐화한다.

**선택된 아키텍처**: Option C — 한 파일 유지, 내부 섹션 분리 + Calendar 객체 패턴

## 2. 데이터 모델

### 2.1 Task 구조 변경
```javascript
// 기존 필드 유지 + 2개 추가
{
    id: string,
    text: string,
    category: "work" | "personal" | "study",
    completed: boolean,
    createdAt: string,       // ISO 8601
    dueDate: string | null,  // "YYYY-MM-DD" or null
    dueTime: string | null,  // "HH:MM" or null
}
```

### 2.2 Settings 추가
```javascript
// SETTINGS_KEY = "my-tasks-settings"
{
    activeView: "list" | "calendar",   // default: "list"
    calendarMode: "month" | "week" | "day",  // default: "month"
    calendarDate: "YYYY-MM-DD",        // default: today
}
```

### 2.3 하위 호환성
- 기존 task에 `dueDate`/`dueTime`이 없으면 `null`로 취급
- 리스트 뷰는 기존과 동일하게 동작
- 캘린더 뷰에서 `dueDate` 없는 task는 표시되지 않음 (리스트 뷰에서만 보임)

## 3. script.js 구조 (섹션 맵)

```
// ============================================================
// Section 1: Constants & State (~30 lines)
// ============================================================
// STORAGE_KEY, FILTER_KEY, THEME_KEY, SETTINGS_KEY
// CATEGORIES, QUOTES
// tasks, activeFilter, searchQuery, settings

// ============================================================
// Section 2: Storage (load/save) (~50 lines)
// ============================================================
// loadTasks(), saveTasks(), loadFilter(), saveFilter()
// loadSettings(), saveSettings(), loadTheme(), saveTheme()

// ============================================================
// Section 3: Task CRUD (~80 lines)
// ============================================================
// addTask(text, category, dueDate, dueTime)  ← 2 params added
// deleteTask(id), toggleTask(id), updateTask(id, ...)
// clearCompleted()

// ============================================================
// Section 4: List View (~200 lines)
// ============================================================
// render(), renderDashboard(), renderFilters(), renderTaskList()
// createTaskElement(task), startEdit(li, task)
// highlightText(text), renderClearBtn()

// ============================================================
// Section 5: Calendar Object (~700 lines)
// ============================================================
const Calendar = {
    // --- State ---
    mode: "month",        // "month" | "week" | "day"
    viewDate: new Date(), // current view reference date

    // --- Navigation ---
    prev(),               // go to previous month/week/day
    next(),               // go to next month/week/day
    goToday(),            // jump to today
    setMode(mode),        // switch month/week/day

    // --- Rendering ---
    render(),             // dispatch to correct renderer
    renderHeader(),       // "◀ April 2026 ▶  [M] [W] [D] [Today]"
    renderMonth(),        // 7-col grid with tasks
    renderWeek(),         // 7-col + time rows
    renderDay(),          // single day timeline (0-23h)
    renderAllDayBar(),    // tasks without dueTime

    // --- Task display ---
    getTasksForDate(date),          // filter tasks by date
    createCalendarTaskEl(task),     // mini task chip for month
    createTimeBlockEl(task),        // time block for week/day

    // --- CRUD in calendar ---
    showTaskPopup(task, anchorEl),  // edit/delete popup
    handleCellClick(date, time),    // create task at date/time
    closePopup(),

    // --- Drag & Drop ---
    handleDragStart(e, task),
    handleDragOver(e),
    handleDrop(e, targetDate),

    // --- Helpers ---
    getDaysInMonth(year, month),
    getWeekStart(date),
    formatDateKey(date),  // "YYYY-MM-DD"
    isToday(date),
    isDueSoon(task),      // within 24 hours
};

// ============================================================
// Section 6: View Switching (~30 lines)
// ============================================================
// setActiveView(view)  — "list" or "calendar"
// renderActiveView()   — render correct view

// ============================================================
// Section 7: Events & Shortcuts (~100 lines)
// ============================================================
// DOMContentLoaded handler, keyboard shortcuts
// search input, filter buttons, theme toggle
// view tab buttons
```

## 4. HTML 변경

### 4.1 사이드바 — View 탭 추가
```html
<!-- 기존 Filter 섹션 위에 추가 -->
<div class="sidebar-section">
    <div class="section-label">View</div>
    <div class="view-tabs">
        <button class="view-tab active" data-view="list">📋 List</button>
        <button class="view-tab" data-view="calendar">📅 Calendar</button>
    </div>
</div>
```

### 4.2 메인 콘텐츠 — 캘린더 뷰 컨테이너 추가
```html
<main class="main-content">
    <!-- List View (기존) -->
    <div id="list-view">
        <!-- 기존 search, input, task-list, clear-completed -->
    </div>

    <!-- Calendar View (신규) -->
    <div id="calendar-view" style="display:none">
        <div class="cal-header">
            <button class="cal-nav-btn" id="cal-prev" aria-label="Previous">◀</button>
            <span class="cal-title" id="cal-title">April 2026</span>
            <button class="cal-nav-btn" id="cal-next" aria-label="Next">▶</button>
            <div class="cal-mode-btns">
                <button class="cal-mode-btn active" data-mode="month">Month</button>
                <button class="cal-mode-btn" data-mode="week">Week</button>
                <button class="cal-mode-btn" data-mode="day">Day</button>
            </div>
            <button class="cal-today-btn" id="cal-today">Today</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
    </div>

    <!-- Task popup (shared) -->
    <div class="task-popup" id="task-popup" style="display:none">
        <input type="text" class="popup-input" id="popup-text" placeholder="Task...">
        <input type="date" class="popup-date" id="popup-date">
        <input type="time" class="popup-time" id="popup-time">
        <select class="popup-cat" id="popup-cat">
            <option value="work">Work</option>
            <option value="personal">Personal</option>
            <option value="study">Study</option>
        </select>
        <div class="popup-actions">
            <button class="popup-save" id="popup-save">Save</button>
            <button class="popup-delete" id="popup-delete">Delete</button>
            <button class="popup-cancel" id="popup-cancel">Cancel</button>
        </div>
    </div>
</main>
```

### 4.3 입력 영역 — 날짜/시간 필드 추가
```html
<div class="input-area">
    <input type="text" id="task-input" placeholder="Add a new task...">
    <input type="date" id="due-date-input" aria-label="Due date">
    <input type="time" id="due-time-input" aria-label="Due time">
    <select id="category-select">...</select>
    <button id="add-btn">Add</button>
</div>
```

## 5. CSS 설계

### 5.1 캘린더 헤더
```css
.cal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
}
```

### 5.2 월간 뷰 — CSS Grid
```css
.cal-month {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: var(--border);
}

.cal-cell {
    background: var(--surface);
    min-height: 100px;       /* desktop */
    padding: 4px;
    cursor: pointer;
}

.cal-cell.today {
    background: var(--accent-light);
}
```

### 5.3 주간/일간 뷰 — 시간 그리드
```css
.cal-time-grid {
    display: grid;
    grid-template-columns: 60px 1fr;  /* day view */
    /* or: 60px repeat(7, 1fr);        week view */
}

.cal-hour-row {
    height: 60px;
    border-bottom: 1px solid var(--border-light);
}

.cal-time-block {
    position: absolute;
    left: 2px;
    right: 2px;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.8rem;
    cursor: pointer;
}
```

### 5.4 Task 팝업
```css
.task-popup {
    position: absolute;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 4px 20px var(--shadow);
    z-index: 50;
    min-width: 280px;
}
```

### 5.5 반응형
```css
/* Mobile: month view shrinks */
@media (max-width: 768px) {
    .cal-cell { min-height: 60px; }
    .cal-task-chip { font-size: 0.7rem; }
    .cal-time-grid { grid-template-columns: 40px 1fr; }

    /* Week view → show only 3 days on mobile */
    .cal-week { grid-template-columns: 40px repeat(3, 1fr); }
}

@media (max-width: 480px) {
    .cal-cell { min-height: 40px; }
    /* Show dots instead of text in month cells */
    .cal-task-chip-text { display: none; }
    .cal-task-dot { display: inline-block; }
}
```

## 6. 캘린더 렌더링 상세

### 6.1 월간 뷰 렌더링 알고리즘
```
1. Get first day of month → find its weekday (Mon=0)
2. Calculate padding days from previous month
3. Render 7 header cells (Mon~Sun)
4. Render 5-6 rows × 7 cells:
   - Each cell: date number + task chips (max 3)
   - If more: "+N more" link → click switches to day view
5. Highlight today cell
6. Empty cells are clickable → create task
```

### 6.2 주간 뷰 렌더링 알고리즘
```
1. Get Monday of current week from viewDate
2. Render header: Mon~Sun with dates
3. Render "All day" row for tasks without dueTime
4. Render 24 hour rows (0:00~23:00)
5. Position task blocks based on dueTime
6. Each column = 1 day, relative positioning within column
```

### 6.3 일간 뷰 렌더링 알고리즘
```
1. Single day = viewDate
2. Render "All day" section for dateless tasks
3. Render 24 hour slots vertically
4. Position task blocks at correct hour
5. Hour slot click → create task at that time
6. Current hour indicator line (red)
```

## 7. 드래그 앤 드롭 설계

### 7.1 월간 뷰 드래그
```javascript
// dragstart: store task id in dataTransfer
// dragover on cell: highlight cell, preventDefault
// drop on cell: update task.dueDate to cell's date
```

### 7.2 주간/일간 뷰 드래그
```javascript
// dragstart: store task id
// dragover on hour-cell: calculate nearest hour
// drop: update task.dueDate + dueTime
```

### 7.3 모바일 폴백
- 모바일에서는 드래그 대신 팝업으로 날짜 변경
- task 길게 누르기(long press) → 팝업 표시

## 8. Task 팝업 설계

```
┌─ Task Popup ────────────────┐
│ [Task text input         ]  │
│ [Date: 2026-04-10] [14:00]  │
│ [Category: Work ▼]          │
│                             │
│ [Save] [Delete] [Cancel]    │
└─────────────────────────────┘
```
- **새 task**: 빈 팝업, Delete 버튼 숨김
- **기존 task**: 기존 값 채워짐, 3개 버튼 모두 표시
- **위치**: 클릭한 셀 근처에 absolute positioning
- **닫기**: 외부 클릭 또는 Cancel 또는 Esc

## 9. 마감 임박 표시

```javascript
function isDueSoon(task) {
    if (!task.dueDate) return false;
    const due = new Date(task.dueDate + "T" + (task.dueTime || "23:59"));
    const diff = due - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;  // 24h
}
```
- 임박 task: 빨간색 border-left + pulsing dot
- 완료된 task는 임박 표시 안 함

## 10. 키보드 단축키 추가

| 단축키 | 기능 |
|--------|------|
| `Alt+L` | List 뷰로 전환 |
| `Alt+C` | Calendar 뷰로 전환 |
| `Alt+T` | Today로 이동 (캘린더 뷰) |

## 11. Implementation Guide

### 11.1 구현 순서
| 순서 | 모듈 | 파일 | 설명 |
|------|------|------|------|
| 1 | data-model | script.js | Task 구조에 dueDate/dueTime 추가, Settings load/save |
| 2 | input-ui | index.html, style.css | 날짜/시간 입력 필드, 뷰 탭 |
| 3 | view-switch | script.js, index.html | List/Calendar 뷰 전환 로직 |
| 4 | month-view | script.js, style.css | 월간 그리드 렌더링 |
| 5 | week-view | script.js, style.css | 주간 시간 그리드 |
| 6 | day-view | script.js, style.css | 일간 타임라인 |
| 7 | cal-crud | script.js, style.css | 팝업 CRUD + 셀 클릭 생성 |
| 8 | drag-drop | script.js, style.css | 드래그 앤 드롭 이동 |
| 9 | polish | style.css | 반응형, 마감 임박, 오늘 표시 |

### 11.2 예상 변경량
| 파일 | 추가 라인 |
|------|-----------|
| index.html | ~60 lines |
| style.css | ~300 lines |
| script.js | ~700 lines |
| **합계** | **~1060 lines** |

### 11.3 Session Guide

| 세션 | 모듈 | 추정 시간 |
|------|------|-----------|
| Session 1 | data-model, input-ui, view-switch | 기초 인프라 |
| Session 2 | month-view, cal-crud | 월간 뷰 + 편집 |
| Session 3 | week-view, day-view | 시간 기반 뷰 |
| Session 4 | drag-drop, polish | 드래그 + 마무리 |
