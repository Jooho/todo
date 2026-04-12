# Design: task-extensions — Plugin Architecture Foundation

> Created: 2026-04-12
> Architecture: Option C — Pragmatic Balance

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | Flutter 앱 + Plugin 시스템 도입을 위한 아키텍처 기반 마련 |
| **WHO** | 개발자(나) + 미래 plugin 개발자 |
| **RISK** | 기존 웹앱 데이터 호환성, RLS 설정 오류 |
| **SUCCESS** | task_extensions/plugin_registry 생성, 기존 웹앱 무중단, Flutter에서 사용 가능 |
| **SCOPE** | DB 스키마 추가만. 웹앱 코드 변경 없음. |

---

## 1. 선택된 아키텍처: Option C

**결정 이유:**
- DB 전용 feature라 B의 복잡도는 오버엔지니어링
- A보다는 helper function을 추가해 Flutter 앱 개발 편의성 확보
- 웹앱 코드는 일절 변경하지 않아 리스크 제로

---

## 2. 데이터 모델

### 2.1 plugin_registry (먼저 생성 — task_extensions가 참조)

```sql
CREATE TABLE plugin_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved', 'pending', 'rejected')),
    is_builtin BOOLEAN DEFAULT FALSE,
    app_store_url TEXT,
    play_store_url TEXT,
    deep_link TEXT,
    schema JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;

-- 누구나 approved plugin 조회 가능
CREATE POLICY "Anyone can view approved plugins" ON plugin_registry
    FOR SELECT USING (status = 'approved');
```

### 2.2 task_extensions

```sql
CREATE TABLE task_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
    plugin_id TEXT NOT NULL REFERENCES plugin_registry(id),
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, plugin_id)
);

ALTER TABLE task_extensions ENABLE ROW LEVEL SECURITY;

-- 본인 task의 extension만 접근 (+ shared calendar 멤버)
CREATE POLICY "Users access own task extensions" ON task_extensions
    FOR ALL USING (
        task_id IN (
            SELECT id FROM tasks WHERE user_id = auth.uid()
            UNION
            SELECT id FROM tasks WHERE shared_calendar_id IN (
                SELECT calendar_id FROM calendar_members
                WHERE user_id = auth.uid()
            )
        )
    );
```

### 2.3 초기 Plugin 데이터

```sql
INSERT INTO plugin_registry (id, name, description, is_builtin, status) VALUES
    ('subtask',    'Subtasks',         'Subtasks with due dates',            true, 'approved'),
    ('recurrence', 'Recurring Tasks',   'Repeat daily/weekly/monthly/yearly', true, 'approved'),
    ('reminder',   'Reminders',         'Multiple reminders before due time', true, 'approved'),
    ('daily-show', 'Daily Display',     'Show task every day until due date', true, 'approved'),
    ('location',   'Location',          'GPS location and geofence alerts',   true, 'approved'),
    ('photo-item', 'Photo Items',       'Recognize items from photos',        true, 'approved');
```

---

## 3. Helper Functions (Option C 핵심)

Flutter 앱에서 자주 쓸 패턴을 함수로 제공:

### 3.1 task + extensions 한 번에 조회

```sql
-- Flutter 앱에서 자주 쓸 task with extensions view
CREATE OR REPLACE VIEW tasks_with_extensions AS
SELECT
    t.*,
    COALESCE(
        jsonb_object_agg(te.plugin_id, te.data)
        FILTER (WHERE te.plugin_id IS NOT NULL),
        '{}'::jsonb
    ) AS extensions
FROM tasks t
LEFT JOIN task_extensions te ON te.task_id = t.id
GROUP BY t.id;
```

사용 예시:
```sql
-- Flutter에서 오늘 tasks + 모든 extension 한번에
SELECT * FROM tasks_with_extensions
WHERE user_id = auth.uid()
AND due_date = CURRENT_DATE;
```

### 3.2 특정 plugin data 쉽게 조회

```sql
-- 특정 plugin data 조회 helper function
CREATE OR REPLACE FUNCTION get_task_extension(p_task_id UUID, p_plugin_id TEXT)
RETURNS JSONB AS $$
    SELECT data FROM task_extensions
    WHERE task_id = p_task_id AND plugin_id = p_plugin_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- upsert helper (생성 또는 업데이트)
CREATE OR REPLACE FUNCTION upsert_task_extension(
    p_task_id UUID,
    p_plugin_id TEXT,
    p_data JSONB
) RETURNS task_extensions AS $$
    INSERT INTO task_extensions (task_id, plugin_id, data, updated_at)
    VALUES (p_task_id, p_plugin_id, p_data, NOW())
    ON CONFLICT (task_id, plugin_id)
    DO UPDATE SET data = p_data, updated_at = NOW()
    RETURNING *;
$$ LANGUAGE SQL SECURITY DEFINER;
```

---

## 4. Realtime 설정

```sql
-- Flutter 앱 실시간 동기화를 위해
ALTER PUBLICATION supabase_realtime ADD TABLE task_extensions;
ALTER PUBLICATION supabase_realtime ADD TABLE plugin_registry;
ALTER TABLE task_extensions REPLICA IDENTITY FULL;
```

---

## 5. API 접근 패턴

### 5.1 웹앱 (기존 — 변경 없음)
```javascript
// 기존 방식 그대로
supabase.from("tasks").select("*").eq("user_id", userId)
// tasks.subtasks, tasks.recurrence 등 직접 접근
```

### 5.2 Flutter 앱 (신규)
```dart
// task + 모든 extension 한 번에
supabase.from("tasks_with_extensions")
  .select()
  .eq("user_id", userId)
  .eq("due_date", today);

// 특정 extension 조회
supabase.rpc("get_task_extension", {
  "p_task_id": taskId,
  "p_plugin_id": "subtask"
});

// extension 저장/업데이트
supabase.rpc("upsert_task_extension", {
  "p_task_id": taskId,
  "p_plugin_id": "location",
  "p_data": {"lat": 37.5, "lng": 127.0, "radius_m": 500}
});
```

---

## 6. 인덱스 (성능)

```sql
CREATE INDEX idx_task_extensions_task_id ON task_extensions(task_id);
CREATE INDEX idx_task_extensions_plugin_id ON task_extensions(plugin_id);
CREATE INDEX idx_task_extensions_task_plugin ON task_extensions(task_id, plugin_id);
```

---

## 7. 보안 설계

| 레이어 | 역할 |
|--------|------|
| **RLS** | task_id 기반 소유자 + 공유 캘린더 멤버만 접근 |
| **plugin_registry** | approved status plugin만 공개 조회 가능 |
| **Helper functions** | SECURITY DEFINER로 RLS 우회 없이 안전하게 |
| **is_builtin** | 내장 plugin은 삭제 불가 (앱 레벨에서 체크) |

---

## 8. 구현 순서

| 순서 | 작업 | SQL |
|------|------|-----|
| 1 | plugin_registry 테이블 생성 | CREATE TABLE |
| 2 | 초기 plugin 6개 등록 | INSERT |
| 3 | task_extensions 테이블 생성 | CREATE TABLE |
| 4 | RLS 정책 설정 | CREATE POLICY |
| 5 | Helper view 생성 | CREATE VIEW |
| 6 | Helper functions 생성 | CREATE FUNCTION |
| 7 | 인덱스 생성 | CREATE INDEX |
| 8 | Realtime 활성화 | ALTER PUBLICATION |
| 9 | 기존 웹앱 동작 확인 | 수동 테스트 |
| 10 | curl로 API 테스트 | curl |

### 11.3 Session Guide

| Module | Scope Key | 설명 | 예상 작업 |
|--------|-----------|------|-----------|
| DB Schema | `module-1` | 테이블 + RLS + 인덱스 | SQL 실행 |
| Helper Layer | `module-2` | View + Functions + Realtime | SQL 실행 |
| Verification | `module-3` | 기존 웹앱 확인 + API 테스트 | curl 테스트 |

**한 세션에 모두 완료 가능** (순수 SQL 작업이라 빠름)
