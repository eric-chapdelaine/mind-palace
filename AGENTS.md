# AGENTS.md - Mind Palace Development Guide

This file provides guidance for AI agents working on the Mind Palace codebase.

## Project Overview

Mind Palace is a FastAPI-based central hub that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and automations. It uses SQLite with SQLModel for persistence and integrates with Vikunja for task management.

## Running the Application

```bash
# Development server with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Or directly
python main.py
```

## Testing

**No test framework is currently set up.** To add tests:

```bash
# Install pytest
pip install pytest pytest-asyncio httpx

# Run all tests
pytest

# Run a single test file
pytest tests/test_todos.py

# Run a single test function
pytest tests/test_todos.py::test_create_todo
```

Recommended test structure:
```
tests/
├── conftest.py          # Shared fixtures
├── test_todos.py
├── test_groceries.py
└── test_vikunja.py
```

## Linting and Type Checking

Install and run Ruff (recommended for this project):

```bash
pip install ruff
ruff check .           # Lint all files
ruff check path/to/file.py
ruff check . --fix     # Auto-fix issues
```

For type checking with mypy:

```bash
pip install mypy
mypy .
```

## Code Style Guidelines

### Imports

Organize imports in the following order (use isort conventions):

1. Standard library (`from datetime import datetime`)
2. Third-party packages (`from fastapi import APIRouter`)
3. Local application imports (`from core.config import settings`)

```python
# Correct
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from core.config import settings
from core.database import get_session
from integrations.vikunja import VikunjaClient
from models.items import TodoItem
```

### Type Hints

- Use Python 3.10+ union syntax: `str | None` instead of `Optional[str]`
- Use built-in collection types: `list[TodoItem]` instead of `List[TodoItem]`
- Include return types on all functions:

```python
def get_session():
    with Session(engine) as session:
        yield session

async def create_todo(body: TodoCreate, db: Session) -> TodoRead:
    ...
```

### Naming Conventions

- **Variables/functions**: `snake_case` (`get_session`, `vikunja_client`)
- **Classes**: `PascalCase` (`VikunjaClient`, `TodoItem`)
- **Constants**: `UPPER_SNAKE_CASE` (`DATABASE_URL`)
- **Files**: `snake_case.py` (`core/config.py`, `api/routers/todos.py`)
- **Routes**: Plural nouns (`/todos`, `/groceries`, `/capture`)

### Pydantic Models

Separate request/response schemas from DB models:

```python
# Request schema (what client sends)
class TodoCreate(BaseModel):
    title: str
    notes: str | None = None
    due_date: datetime | None = None
    project_id: int | None = None

# Response schema (what client receives)
class TodoRead(BaseModel):
    id: int
    title: str
    # ... all fields with types
    model_config = {"from_attributes": True}
```

### SQLModel Models

Add docstrings and use Field for customization:

```python
class TodoItem(SQLModel, table=True):
    """Local mirror/queue for todo items before/after Vikunja sync."""
    id: int | None = Field(default=None, primary_key=True)
    title: str
    synced: bool = False
```

### Error Handling

Use custom exception classes for domain errors:

```python
class VikunjaError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code

# In routes, raise HTTPException for HTTP-level errors
raise HTTPException(status_code=404, detail="Item not found")

# Raise custom exceptions for service-level errors
raise VikunjaError("Could not reach Vikunja", status_code=503)
```

### Async/Await

- Use `async def` for routes and functions that perform I/O (HTTP calls, DB queries with async drivers)
- Use synchronous `def` for simple CPU-bound operations
- Note: SQLModel with SQLite is synchronous; use `async def` only when calling external APIs

```python
# External API call - async
async def create_task(...) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        ...

# Database operation - sync (with SQLModel/SQLite)
@router.get("/")
def list_todos(db: Session = Depends(get_session)):
    ...
```

### Database Sessions

Always use dependency injection for database sessions:

```python
from fastapi import Depends
from sqlmodel import Session
from core.database import get_session

@router.get("/")
def list_items(db: Session = Depends(get_session)):
    ...
```

### Route Organization

Follow this structure in router files:

```python
"""
/endpoint — Description of what this router handles.
"""
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from core.database import get_session
from models.items import Item

router = APIRouter(prefix="/items", tags=["items"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------
class ItemCreate(BaseModel):
    ...

class ItemRead(BaseModel):
    ...
    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post("/", response_model=ItemRead, status_code=201)
def create_item(...):
    ...
```

### Configuration

Store all settings in `core/config.py` using environment variables:

```python
import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    APP_TITLE: str = "Mind Palace"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./mind-palace.db")
    VIKUNJA_TOKEN: str | None = os.getenv("VIKUNJA_TOKEN")

settings = Settings()
```

### Docstrings

Use Google-style docstrings for routes and complex functions:

```python
@router.post("/", response_model=TodoRead, status_code=201)
async def create_todo(
    body: TodoCreate,
    db: Session = Depends(get_session),
):
    """
    Create a new todo and immediately push it to Vikunja.
    Falls back to local-only storage if Vikunja is unreachable.
    
    Args:
        body: Todo creation payload
        db: Database session
        
    Returns:
        Created todo item
    """
```

### Key Patterns

1. **Offline resilience**: Store locally first, sync later when external services unavailable
2. **Graceful degradation**: Don't fail requests if external APIs are down
3. **Dependency injection**: Use FastAPI's `Depends()` for DB sessions, clients, etc.
4. **Separation of concerns**: Keep DB models, schemas, and routes separate

## Frontend Development

### Tech Stack

- **Vanilla JavaScript** - No build step, no package.json
- **No framework** - Lightweight for Raspberry Pi deployment
- **marked.js** via CDN for markdown rendering

### File Structure

```
mind-palace/
├── main.py                    # App entry point, router registration
├── core/
│   ├── config.py              # Settings via env vars
│   └── database.py            # SQLModel engine + session dep
├── models/
│   └── items.py               # SQLModel table definitions
├── integrations/
│   └── vikunja.py             # External API clients
├── api/
│   └── routers/
│       ├── todos.py           # REST endpoints
│       ├── groceries.py
│       └── ui.py              # Static files
└── ui/
    ├── templates/
    │   └── dashboard.html    # Main HTML template
    └── static/
        ├── core.js            # Data fetching, utilities
        ├── widgets.js         # Widget definitions & rendering
        └── style.css          # Styles
```

### Adding Dependencies

Since there's no package.json, external JS libraries are loaded via CDN in `ui/templates/dashboard.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

### UI Rendering

- **widgets.js** - Contains `registerWidget()` calls that define each widget
- **core.js** - Provides `fetchVikunja()`, `fetchGroceries()`, date utilities, etc.
- Task descriptions from Vikunja are rendered as markdown using `marked.parse()`

### CSS Variables

The UI uses CSS custom properties defined in `ui/static/style.css`:

```css
:root {
  --bg:        #0e0e0e;
  --surface:   #161616;
  --border:    #2a2a2a;
  --muted:     #555;
  --text:      #d4d4d4;
  --bright:    #f0f0f0;
  --accent:    #e8ff5a;
  --danger:    #ff5f5f;
  --warn:      #ffaa44;
  --mono:      'IBM Plex Mono', monospace;
  --sans:      'IBM Plex Sans', sans-serif;
}
```
