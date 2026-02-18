# Mind Palace

Central hub running on a Raspberry Pi that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and future automations.

## Project Structure

```
mind-palace/
├── main.py                    # App entry point, router registration
├── core/
│   ├── config.py              # All settings via env vars
│   └── database.py            # SQLite engine + session dep
├── models/
│   └── items.py               # SQLModel table definitions
├── integrations/
│   └── vikunja.py             # Vikunja API client
└── api/
    └── routers/
        ├── capture.py         # Simple intake (Shortcuts/IoT)
        ├── todos.py           # Full todo CRUD + Vikunja sync
        └── groceries.py       # Grocery list
```

Adding a new integration = add a file to `integrations/`, a router to `api/routers/`, and one line in `main.py`.

## API Reference

### Quick Capture (iPhone Shortcuts / IoT)

```
POST /capture?text=Buy+milk&category=grocery
POST /capture?text=Call+dentist&category=task
POST /capture?text=Call+dentist&category=task&notes=Ask+about+cleaning

# or JSON body:
POST /capture
{"text": "Buy milk", "category": "grocery"}
{"text": "Call dentist", "category": "task", "notes": "10am slot", "due_date": "2025-07-01T10:00:00"}
```

### Todos

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/todos/` | Create todo → push to Vikunja (queues locally if offline) |
| `GET` | `/todos/` | List local todos (`?synced=false` for pending) |
| `POST` | `/todos/sync` | Push all unsynced local items to Vikunja |
| `GET` | `/todos/vikunja` | Live fetch from Vikunja (`?project_id=2`) |

**Create todo body:**
```json
{
  "title": "Call dentist",
  "notes": "Ask about cleaning",
  "due_date": "2025-07-01T10:00:00",
  "project_id": 1
}
```

### Groceries

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/groceries/?name=Milk` | Add item |
| `GET` | `/groceries/` | List pending items |
| `PATCH` | `/groceries/{id}/done` | Mark purchased |

### Meta

```
GET /health      → {"status": "ok", ...}
GET /docs        → Interactive API docs (Swagger UI)
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in VIKUNJA_TOKEN
python main.py
```

## iPhone Shortcut

1. Add a **Get Contents of URL** action
2. URL: `http://pi-3b.local:8000/todo`
3. Method: `POST`
4. Request Body: `JSON` → `{"text": "[Ask for Input]", "category": "task"}`

## Offline Resilience

If Vikunja is unreachable, todos are saved locally with `synced=false`. Call `POST /todos/sync` when connectivity is restored to flush the queue.
