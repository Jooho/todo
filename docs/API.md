# Todo Manager API

## Base URL
```
https://urkytivapfgzenpvflce.supabase.co/functions/v1/api-proxy
```

## Authentication
All requests require an API token in the Authorization header:
```
Authorization: Bearer mtsk_<your_token>
```

Generate tokens in the app: Settings → API Access → Generate New Token.

## Endpoints

All requests use `POST` method with JSON body. The `action` field determines the operation.

### List Tasks
```bash
curl -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"list"}'
```

Optional filters:
```json
{
  "action": "list",
  "category": "work",
  "completed": false,
  "limit": 10
}
```

Response:
```json
{
  "tasks": [...],
  "count": 5
}
```

### Create Task
```bash
curl -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "text": "Buy groceries",
    "category": "personal",
    "dueDate": "2026-04-10",
    "dueTime": "14:00",
    "description": "Milk, eggs, bread",
    "subtasks": [
      {"text": "Milk", "completed": false},
      {"text": "Eggs", "completed": false}
    ]
  }'
```

Required: `text`
Optional: `category` (default: "work"), `dueDate` (default: today), `dueTime`, `description`, `subtasks`

Response:
```json
{
  "task": {...},
  "message": "Task created"
}
```

### Update Task
```bash
curl -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "id": "task-uuid-here",
    "text": "Updated text",
    "completed": true
  }'
```

Required: `id`
Optional: any task field (`text`, `description`, `category`, `completed`, `dueDate`, `dueTime`, `subtasks`)

### Delete Task
```bash
curl -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"delete","id":"task-uuid-here"}'
```

### Toggle Complete
```bash
curl -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"toggle","id":"task-uuid-here"}'
```

## Task Object

```json
{
  "id": "uuid",
  "text": "Task title",
  "description": "Details...",
  "category": "work",
  "completed": false,
  "due_date": "2026-04-10",
  "due_time": "14:00",
  "subtasks": [
    {"text": "Subtask 1", "completed": true},
    {"text": "Subtask 2", "completed": false}
  ],
  "created_at": "2026-04-06T00:00:00Z",
  "updated_at": "2026-04-06T00:00:00Z"
}
```

## Categories
Default: `work`, `personal`, `study`
Custom categories can be added in Settings.

## Error Responses
```json
{"error": "Missing or invalid API token"}     // 401
{"error": "text is required"}                  // 400
{"error": "Task not found"}                    // 404
```
