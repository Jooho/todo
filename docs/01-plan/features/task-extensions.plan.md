# Plan: task-extensions — Plugin Architecture Foundation

> Created: 2026-04-12

## Executive Summary

| 관점 | 설명 |
|------|------|
| **Problem** | tasks 테이블이 기능 추가마다 커지고 있어 Flutter/Plugin 확장에 취약한 구조 |
| **Solution** | task_extensions + plugin_registry 테이블로 plugin 데이터를 분리 |
| **Function UX Effect** | 웹앱은 그대로 동작, Flutter 앱부터 확장 가능한 구조로 개발 가능 |
| **Core Value** | 모든 클라이언트(웹/Flutter/봇)가 공유하는 확장 가능한 데이터 레이어 |

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | Flutter 앱 + Plugin 시스템 도입을 위한 아키텍처 기반 마련 |
| **WHO** | 개발자(나) + 미래 plugin 개발자 |
| **RISK** | 기존 웹앱 데이터 호환성, 마이그레이션 중 중단 위험 |
| **SUCCESS** | task_extensions/plugin_registry 테이블 생성, 기존 웹앱 무중단 동작 |
| **SCOPE** | DB 스키마 추가만. 웹앱 코드 변경 최소화. 마이그레이션은 다음 Phase. |

---

## 1. 요구사항

### 1.1 task_extensions 테이블 (P0)

| ID | 요구사항 |
|----|----------|
| F1 | task_id + plugin_id + data(JSONB) 구조로 plugin 데이터 저장 |
| F2 | 하나의 task에 여러 plugin 데이터 첨부 가능 |
| F3 | RLS: 본인 task의 extension만 접근 가능 |
| F4 | 기존 tasks 테이블은 변경 없음 (하위 호환) |

### 1.2 plugin_registry 테이블 (P0)

| ID | 요구사항 |
|----|----------|
| F5 | plugin_id, name, description, version 관리 |
| F6 | status: 'approved' / 'pending' / 'rejected' 로 허용 제어 |
| F7 | app_store_url, play_store_url, deep_link 저장 (미래 Plugin 스토어용) |
| F8 | 현재는 내부 관리 (관리자가 직접 등록) |

### 1.3 초기 Plugin 등록 (P1)

현재 tasks 테이블의 기능들을 plugin으로 등록:

| plugin_id | 설명 | 현재 tasks 컬럼 |
|-----------|------|----------------|
| `subtask` | Subtask 관리 | subtasks JSONB |
| `recurrence` | 반복 task | recurrence, recurrence_parent_id |
| `reminder` | 알림 설정 | reminders |
| `daily-show` | 매일 표시 | show_daily, auto_complete |
| `location` | GPS 위치 | (미래) |
| `photo-item` | 사진 물건 인식 | (미래) |

### 1.4 마이그레이션 전략 (P1)

- **지금**: task_extensions 추가만. tasks 기존 컬럼 유지.
- **웹앱**: 기존 컬럼 계속 사용 (변경 없음)
- **Flutter 앱**: task_extensions 기준으로 개발
- **나중에**: 점진적으로 웹앱도 task_extensions로 전환

## 2. DB 스키마

### 2.1 task_extensions

```sql
CREATE TABLE task_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
    plugin_id TEXT NOT NULL REFERENCES plugin_registry(id),
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, plugin_id)  -- 하나의 task에 plugin 하나
);

ALTER TABLE task_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own task extensions" ON task_extensions
    FOR ALL USING (
        task_id IN (
            SELECT id FROM tasks WHERE user_id = auth.uid()
            UNION
            SELECT id FROM tasks WHERE shared_calendar_id IN (
                SELECT calendar_id FROM calendar_members WHERE user_id = auth.uid()
            )
        )
    );
```

### 2.2 plugin_registry

```sql
CREATE TABLE plugin_registry (
    id TEXT PRIMARY KEY,  -- 'subtask', 'recurrence', 'location', ...
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved', 'pending', 'rejected')),
    is_builtin BOOLEAN DEFAULT FALSE,  -- true = 내장 plugin (삭제 불가)
    app_store_url TEXT,
    play_store_url TEXT,
    deep_link TEXT,
    schema JSONB,  -- plugin data의 expected 구조 (선택적 문서화)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- plugin_registry는 RLS 없음 (누구나 읽기 가능, 쓰기는 service_role만)
-- 대신 Row Security로 공개
ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view approved plugins" ON plugin_registry
    FOR SELECT USING (status = 'approved');
```

### 2.3 초기 데이터

```sql
INSERT INTO plugin_registry (id, name, description, is_builtin, status) VALUES
    ('subtask', 'Subtasks', 'Add subtasks with due dates to a task', true, 'approved'),
    ('recurrence', 'Recurring Tasks', 'Make tasks repeat daily/weekly/monthly', true, 'approved'),
    ('reminder', 'Reminders', 'Set multiple reminders before due time', true, 'approved'),
    ('daily-show', 'Daily Display', 'Show task every day until due date', true, 'approved'),
    ('location', 'Location', 'Attach GPS location and geofence alerts', true, 'approved'),
    ('photo-item', 'Photo Items', 'Recognize items from photos', true, 'approved');
```

## 3. data JSONB 구조 예시

각 plugin의 data 필드 구조:

```json
// subtask plugin
{
  "items": [
    {"text": "4강", "completed": false, "dueDate": "2026-04-12"},
    {"text": "5강", "completed": false, "dueDate": "2026-04-13"}
  ],
  "auto_complete": true
}

// recurrence plugin
{
  "type": "weekly",
  "interval": 1,
  "startDate": "2026-04-12",
  "endDate": null,
  "parentId": "uuid-of-original-task"
}

// reminder plugin
{
  "items": [
    {"before": 10, "unit": "minutes"},
    {"before": 1, "unit": "hours"}
  ]
}

// location plugin (미래)
{
  "lat": 37.5665,
  "lng": 126.9780,
  "name": "학교",
  "radius_m": 500,
  "alert_on_leave": true
}
```

## 4. 성공 기준

| ID | 기준 |
|----|------|
| SC1 | task_extensions 테이블 생성 + RLS 적용 |
| SC2 | plugin_registry 테이블 생성 + 초기 6개 plugin 등록 |
| SC3 | 기존 웹앱 무중단 동작 확인 |
| SC4 | task_extensions에 데이터 CRUD 가능 (API로 테스트) |
| SC5 | 향후 Flutter 앱이 이 구조를 기반으로 개발 가능 |

## 5. 구현 단계

| 단계 | 내용 | Phase |
|------|------|-------|
| 1 | plugin_registry 테이블 + 초기 데이터 | 이번 |
| 2 | task_extensions 테이블 + RLS | 이번 |
| 3 | Supabase Realtime 활성화 | 이번 |
| 4 | API 테스트 (curl로 CRUD 확인) | 이번 |
| 5 | 웹앱 subtasks → task_extensions 마이그레이션 | 다음 Phase |
| 6 | Flutter 앱 task_extensions 기준 개발 | Flutter Phase |

## 6. 리스크

| 리스크 | 대응 |
|--------|------|
| RLS 설정 오류로 데이터 노출 | 철저한 테스트 + 최소 권한 원칙 |
| UNIQUE 제약으로 plugin 중복 방지 | (task_id, plugin_id) UNIQUE 인덱스 |
| 기존 웹앱 영향 | tasks 테이블 변경 없음으로 완전 격리 |
