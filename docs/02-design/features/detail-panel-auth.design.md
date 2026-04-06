# Design: Detail Side Panel + Security + Google Auth

> Created: 2026-04-06
> Architecture: Option C — Full separation (auth.js + detail-panel.js)

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 오른쪽 빈 공간 활용 + DB 키 보안 + 일정 프라이버시 |
| **WHO** | 개인 사용자 — 자신의 일정을 안전하게 관리 |
| **RISK** | Supabase Auth 설정 복잡도, Google OAuth redirect URI, 모바일 레이아웃 |
| **SUCCESS** | 3단 레이아웃, 키 마스킹, Google 로그인 후에만 접근 |
| **SCOPE** | 6개 파일: index.html, style.css, script.js, db.js, auth.js(new), detail-panel.js(new) |

---

## 1. 파일 구조

```
todo_app/
├── index.html          ← 수정: 로그인 페이지, 상세 패널, Key 마스킹
├── style.css           ← 수정: 3단 레이아웃, 로그인, 상세 패널 스타일
├── script.js           ← 수정: openDetailModal → DetailPanel.open 연동
├── db.js               ← 수정: user_id 지원, auth 관련 CRUD
├── auth.js             ← 신규: Supabase Auth (Google OAuth)
├── detail-panel.js     ← 신규: 오른쪽 상세 패널 로직
└── docs/
```

## 2. auth.js 구조

```javascript
const Auth = {
    user: null,            // current user object
    _supabase: null,       // reference to DB.supabase

    // Initialize: check existing session
    async init(supabaseClient) {},

    // Google OAuth sign in
    async signInWithGoogle() {},

    // Sign out
    async signOut() {},

    // Get current user
    getUser() {},

    // Get user ID for RLS
    getUserId() {},

    // Listen for auth state changes
    onAuthStateChange(callback) {},

    // Show/hide login page vs app
    updateUI(isLoggedIn) {},
};
```

### 2.1 Auth 흐름
```
[Page Load]
  → DB.init(savedUrl, savedKey)
  → Auth.init(DB.supabase)
  → supabase.auth.getSession()
  → Session exists? → Auth.updateUI(true) → show app
  → No session? → Auth.updateUI(false) → show login page

[Login Button Click]
  → Auth.signInWithGoogle()
  → supabase.auth.signInWithOAuth({ provider: 'google' })
  → Google redirect → Supabase callback
  → onAuthStateChange fires → Auth.updateUI(true)

[Logout Button Click]
  → Auth.signOut()
  → supabase.auth.signOut()
  → Auth.updateUI(false) → show login page
```

### 2.2 로그인 없이도 동작 (폴백)
- Supabase 미설정 시: Auth 건너뛰고 바로 앱 표시
- localStorage만 사용하는 경우 로그인 불필요
- Settings에서 Supabase 연결 후에야 Auth 활성화

## 3. detail-panel.js 구조

```javascript
const DetailPanel = {
    _taskId: null,        // currently displayed task
    _isOpen: false,

    // Open panel with task data
    open(task) {},

    // Close panel
    close() {},

    // Save changes
    save() {},

    // Archive from panel
    archive() {},

    // Delete from panel
    deleteCurrent() {},

    // Check if mobile → use modal instead
    isMobile() { return window.innerWidth <= 768; },

    // Render panel contents
    render(task) {},

    // Initialize event listeners
    init() {},
};
```

### 3.1 데스크톱 vs 모바일 분기
```javascript
// In script.js, when task text is clicked:
textSpan.addEventListener("click", () => {
    if (DetailPanel.isMobile()) {
        openDetailModal(task);  // existing modal
    } else {
        DetailPanel.open(task); // new side panel
    }
});
```

## 4. HTML 변경

### 4.1 로그인 페이지 (앱 외부)
```html
<!-- Login page — shown when not authenticated -->
<div class="login-page" id="login-page" style="display:none">
    <div class="login-card">
        <h1>My Tasks</h1>
        <p>Sign in to manage your tasks</p>
        <button class="google-login-btn" id="google-login-btn">
            <svg><!-- Google G icon --></svg>
            Sign in with Google
        </button>
        <p class="login-skip">
            <a href="#" id="login-skip">Continue without sign in</a>
        </p>
    </div>
</div>
```

### 4.2 오른쪽 상세 패널
```html
<!-- Detail side panel (desktop) — inside .app after main -->
<aside class="detail-panel" id="detail-panel" style="display:none">
    <div class="detail-panel-header">
        <h3>Task Details</h3>
        <button class="detail-panel-close" id="dp-close">✕</button>
    </div>
    <div class="detail-panel-body">
        <input type="text" id="dp-title" class="dp-field" placeholder="Title">
        <div class="dp-meta">
            <select id="dp-category" class="dp-field"></select>
            <input type="date" id="dp-date" class="dp-field">
            <input type="time" id="dp-time" class="dp-field">
        </div>
        <textarea id="dp-desc" class="dp-textarea" placeholder="Description..." rows="8"></textarea>
        <div class="dp-info">
            <span>Created: <span id="dp-created"></span></span>
            <span>Updated: <span id="dp-updated"></span></span>
        </div>
    </div>
    <div class="detail-panel-actions">
        <button class="dp-btn save" id="dp-save">Save</button>
        <button class="dp-btn archive" id="dp-archive">Archive</button>
        <button class="dp-btn delete" id="dp-delete">Delete</button>
    </div>
</aside>
```

### 4.3 Key 마스킹
```html
<!-- Settings view에서 sb-key 변경 -->
<div class="input-with-toggle">
    <input type="password" id="sb-key" class="settings-input" placeholder="Anon Key">
    <button class="key-toggle" id="sb-key-toggle" type="button" aria-label="Toggle key visibility">
        👁
    </button>
</div>
```

### 4.4 사이드바 — 로그아웃 + 사용자 표시
```html
<!-- sidebar-header에 추가 -->
<div class="user-info" id="user-info" style="display:none">
    <img class="user-avatar" id="user-avatar" src="" alt="">
    <span class="user-name" id="user-name"></span>
    <button class="icon-btn" id="logout-btn" title="Sign out">↩</button>
</div>
```

## 5. CSS 설계

### 5.1 3단 레이아웃
```css
.app {
    display: flex;
    min-height: 100vh;
}

/* Sidebar: 280px (existing) */
/* Main: flex: 1 (existing) */

/* Detail panel: right side, fixed width */
.detail-panel {
    width: 350px;
    border-left: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    overflow-y: auto;
    z-index: 10;
}

/* When panel is open, main-content shrinks */
.main-content.panel-open {
    margin-right: 350px;
}
```

### 5.2 로그인 페이지
```css
.login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg);
}

.login-card {
    background: var(--surface);
    padding: 48px;
    border-radius: 16px;
    text-align: center;
    box-shadow: 0 4px 24px var(--shadow);
    max-width: 400px;
}

.google-login-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    font-size: 1rem;
    cursor: pointer;
    width: 100%;
    justify-content: center;
}
```

### 5.3 반응형
```css
@media (max-width: 768px) {
    /* Panel hides on mobile — modal is used instead */
    .detail-panel { display: none !important; }
    .main-content.panel-open { margin-right: 0; }
}
```

## 6. Supabase 설정 가이드 (사용자용)

### 6.1 Google OAuth 설정
1. Supabase Dashboard → Authentication → Providers → Google
2. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client
3. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Client ID & Secret을 Supabase에 입력

### 6.2 RLS SQL
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own categories" ON categories FOR ALL USING (auth.uid() = user_id);
```

## 7. db.js 변경

```javascript
// user_id를 CRUD에 자동 추가
_taskToRow(task) {
    return {
        ...existingFields,
        user_id: Auth.getUserId(),  // NEW: attach user_id
    };
},

// Sync 시 user_id 필터링은 RLS가 자동 처리
```

## 8. Implementation Guide

### 8.1 구현 순서
| 순서 | 모듈 | 파일 | 설명 |
|------|------|------|------|
| 1 | detail-panel | detail-panel.js, index.html, style.css | 오른쪽 상세 패널 + 3단 레이아웃 |
| 2 | key-masking | index.html, script.js | password type + 눈 토글 |
| 3 | login-page | index.html, style.css | 로그인 페이지 UI |
| 4 | auth-core | auth.js | Supabase Auth 로직 |
| 5 | auth-integration | script.js, db.js | Auth ↔ 앱 연동, user_id, 로그아웃 |
| 6 | polish | style.css | 반응형, 애니메이션 |

### 8.2 예상 변경량
| 파일 | 변경 |
|------|------|
| index.html | +60 lines (login page, detail panel, key mask, user info) |
| style.css | +200 lines (3-col, login, detail panel, key toggle) |
| script.js | +30 lines (DetailPanel 연동, key toggle) |
| db.js | +20 lines (user_id in CRUD) |
| detail-panel.js | +150 lines (신규) |
| auth.js | +120 lines (신규) |
| **합계** | **~580 lines** |

### 8.3 Session Guide
| 세션 | 모듈 | 설명 |
|------|------|------|
| Session 1 | detail-panel, key-masking | 상세 패널 + 키 마스킹 |
| Session 2 | login-page, auth-core, auth-integration, polish | Google Auth |
