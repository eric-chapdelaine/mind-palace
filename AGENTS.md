# AGENTS.md - Mind Palace Development Guide

This file provides guidance for AI agents working on the Mind Palace codebase.

## Project Overview

Mind Palace is a FastAPI-based central hub that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and automations. It uses SQLite with SQLModel for persistence and integrates with Garmin for health/fitness data, Google Calendar for syncing, and includes built-in fitness/nutrition tracking with a meal planning system.

## Running the Application

```bash
# Using virtual environment
source .venv/bin/activate

# Development server with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Or directly
python main.py
```

## Testing

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
├── test_fitness.py
├── test_nutrition.py
└── test_garmin_sync.py
```

## Linting and Type Checking

```bash
pip install ruff
ruff check .           # Lint all files
ruff check . --fix     # Auto-fix issues
```

## Architecture Overview

```
mind-palace/
├── main.py                    # App entry point, router registration, APScheduler
├── core/
│   ├── config.py              # Settings via env vars
│   └── database.py            # SQLModel engine + session dep, seeding
├── models/                    # SQLModel table definitions (DB schema)
│   ├── items.py               # TodoItem, GroceryItem, Tag, TodoTag, TodoPriority
│   ├── fitness.py             # Exercise, WorkoutTemplate, ScheduledDay, SetLog, etc.
│   └── nutrition.py           # Recipe, MealPlan, CookEvent, PlannedMeal, etc.
├── schemas/                   # Pydantic request/response models (API contract)
│   ├── todos.py               # TodoCreate, TodoRead, TagRead
│   ├── groceries.py           # GroceryItemCreate, GroceryItemRead
│   ├── fitness.py             # SetLogCreate, TodayWorkoutRead, ExerciseDetail, etc.
│   ├── nutrition.py           # CookEventCreate, MealPlanRead, RecipeDetailRead, etc.
│   └── sync.py                # SyncDomainResult, SyncResult
├── services/                  # Business logic (no HTTP, no DB imports in pure services)
│   ├── health_calc.py         # Shared BMR, calorie targets, macro targets
│   ├── scheduler.py           # Week schedule generation algorithm
│   ├── schedule_service.py    # DB-aware schedule ensure/regenerate (single source of truth)
│   ├── progression.py         # Lift progression evaluation engine
│   ├── meal_planner.py        # Deterministic meal planning algorithm
│   ├── garmin_sync.py         # Garmin activity sync, workout matching, progression
│   └── sync_providers/        # Generic sync provider abstraction
│       ├── __init__.py        # SyncProvider protocol
│       └── garmin_provider.py # Sleep + Activity sync to Google Calendar
├── integrations/              # External API clients
│   ├── vikunja.py             # Vikunja API client (available but not currently wired)
│   ├── google_calendar.py     # Google Calendar client (generic + convenience methods)
│   ├── garmin.py              # Garmin Connect client (sleep + activities via garth)
│   └── garmin_fitness.py      # Lightweight activity fetcher for fitness sync
├── api/routers/               # FastAPI route handlers
│   ├── ui.py                  # Static file serving, dashboard route
│   ├── todos.py               # Todo CRUD with tags and priority filtering
│   ├── groceries.py           # Simple grocery list CRUD
│   ├── fitness.py             # Workouts, scheduling, Garmin sync, exercise overrides
│   ├── nutrition.py           # Meal plans, cook events, grocery lists, recipes, pantry
│   ├── auth.py                # Google OAuth flow
│   └── sync.py                # Sync to Google Calendar via SyncProviders
├── ui/
│   ├── templates/
│   │   └── dashboard.html     # Main HTML template
│   └── static/
│       ├── core.js            # Widget system, data layer, modal system, clock
│       ├── widgets.js         # Task widgets + task modal system
│       ├── fitness_widgets.js # Fitness + nutrition widgets
│       └── style.css          # Dark theme CSS
└── data/
    ├── program_templates.json # Seed: 3 workout templates, 10 exercises
    └── recipes.json           # Seed: 20 batch-cook recipes
```

## Key Design Decisions

### Models vs Schemas Separation

- **`models/`** contains SQLModel table definitions (the DB schema). These should never be used as `response_model` directly.
- **`schemas/`** contains Pydantic models for API request/response contracts. Every endpoint should specify its `response_model` using a schema.
- This separation means you can change the DB schema without breaking the API contract, and vice versa.

### Service Layer

- **Pure services** (`scheduler.py`, `progression.py`, `meal_planner.py`, `health_calc.py`) have no DB imports and are easily testable.
- **DB-aware services** (`schedule_service.py`, `garmin_sync.py`) take a `Session` parameter or create their own.
- `schedule_service.ensure_week_schedule()` is the **single place** where schedule rows are created. Never duplicate this logic in routers.
- `health_calc.py` is the **single source of truth** for BMR calculations. Both `meal_planner.py` and `garmin_sync.py` import from it.

### Sync Provider Pattern

The `services/sync_providers/` package defines a `SyncProvider` protocol. Each domain that can sync to Google Calendar implements this protocol. To add a new sync domain:

1. Create a new file in `services/sync_providers/` (e.g., `meal_provider.py`)
2. Implement the `SyncProvider` protocol (`name`, `collect()`, `push()`)
3. Add an instance to the `PROVIDERS` list in `api/routers/sync.py`

### CookEvent / PlannedMeal Model

Meals use a cook-then-eat model:
- **CookEvent**: Records when a recipe is cooked and how many servings it produces
- **PlannedMeal**: A meal slot that optionally references a CookEvent
- Tracking is **soft**: the system shows remaining servings as a guide but does not block over-assignment
- When a batch recipe is placed, a CookEvent is created, and PlannedMeals consume servings from it
- Meals can be moved to different dates/slots via `PATCH /nutrition/planned-meals/{id}/move`

### Task Tags and Priorities

- **Tags**: Free-form, user-created. Stored in a `Tag` table, linked via `TodoTag` join table.
- **Priorities**: Numeric 1-5 (1 = highest). Default is P3.
- Filtering: `GET /todos/?status=TODO&priority=1&tag=work`

### Workout Overrides

Per-day exercise flexibility via `ScheduledExerciseOverride`:
- **override**: Change prescribed sets/reps for an exercise on a specific day
- **skip**: Skip an exercise from the template for that day
- **add**: Add an ad-hoc exercise not in the template

Endpoints:
- `POST /fitness/scheduled-days/{day_id}/overrides`
- `DELETE /fitness/scheduled-days/{day_id}/overrides/{override_id}`

## Code Style Guidelines

### Imports

Organize imports in the following order (use isort conventions):

1. Standard library (`from datetime import datetime`)
2. Third-party packages (`from fastapi import APIRouter`)
3. Local application imports (`from core.config import settings`)

### Type Hints

Use Python 3.10+ union syntax throughout:
```python
# Correct
name: str | None = None
items: list[TodoItem] = []
lookup: dict[int, str] = {}

# Incorrect (legacy)
name: Optional[str] = None
items: List[TodoItem] = []
```

### Naming Conventions

- **Variables/functions**: `snake_case` (`get_session`, `vikunja_client`)
- **Classes**: `PascalCase` (`VikunjaClient`, `TodoItem`)
- **Constants**: `UPPER_SNAKE_CASE` (`DATABASE_URL`)
- **Files**: `snake_case.py` (`core/config.py`, `api/routers/todos.py`)
- **Routes**: Plural nouns (`/todos`, `/groceries`, `/fitness`)
- **DB table names**: Prefix with domain (`fitness_exercise`, `nutrition_recipe`)
- **Schemas**: `{Entity}Create`, `{Entity}Read`, `{Entity}Update`

### Route Organization

Follow this structure in router files:
```python
"""
/endpoint — Description of what this router handles.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from core.database import get_session
from models.domain import Model
from schemas.domain import CreateSchema, ReadSchema

router = APIRouter(prefix="/endpoint", tags=["endpoint"])


# ---------------------------------------------------------------------------
# Helpers (private to this module)
# ---------------------------------------------------------------------------

def _helper_function(...):
    ...


# ---------------------------------------------------------------------------
# Routes (grouped by concern with section comments)
# ---------------------------------------------------------------------------

@router.post("/", response_model=ReadSchema, status_code=201)
def create_item(...):
    ...
```

### Error Handling

```python
# HTTP errors in routes
raise HTTPException(status_code=404, detail="Item not found")

# Custom exceptions in integrations
class VikunjaError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code
```

### Database Sessions

Always use dependency injection:
```python
@router.get("/")
def list_items(db: Session = Depends(get_session)):
    ...
```

### Async/Await

- Use `async def` for routes and functions that perform I/O (HTTP calls to external APIs)
- Use synchronous `def` for simple CPU-bound operations and SQLite queries
- Note: SQLModel with SQLite is synchronous; use `async def` only when calling external APIs

### Docstrings

Use Google-style docstrings for complex functions:
```python
@router.post("/", response_model=TodoRead, status_code=201)
async def create_todo(body: TodoCreate, db: Session = Depends(get_session)):
    """Create a new todo and optionally assign tags.
    
    Args:
        body: Todo creation payload with optional tag_names
        db: Database session
        
    Returns:
        Created todo item with resolved tags
    """
```

### Adding a New Domain Module

To add a new domain (e.g., finance):

1. Create `models/finance.py` with SQLModel tables (prefix table names with `finance_`)
2. Create `schemas/finance.py` with Pydantic request/response models
3. Create `services/finance_service.py` for business logic
4. Create `api/routers/finance.py` with routes
5. Register the router in `main.py`
6. Add seed data in `core/database.py` if needed
7. Add UI widgets in `ui/static/finance_widgets.js`
8. Load the new JS file in `ui/templates/dashboard.html`

## API Endpoints Reference

### Todos (`/todos`)
- `POST /todos/` — Create todo (with tags, priority)
- `GET /todos/` — List todos (filter: `?status=`, `?priority=`, `?tag=`)
- `GET /todos/tags` — List all tags
- `GET /todos/{id}` — Get todo
- `PATCH /todos/{id}` — Update todo (any fields, including tags)
- `DELETE /todos/{id}` — Delete todo

### Groceries (`/groceries`)
- `POST /groceries/` — Add grocery item
- `GET /groceries/` — List items
- `PATCH /groceries/{id}/done` — Mark done

### Fitness (`/fitness`)
- `GET /fitness/widgets/today-workout` — Today's workout with exercises
- `GET /fitness/widgets/week-overview` — 7-day schedule grid
- `GET /fitness/schedule/this-week` — Current week schedule
- `POST /fitness/schedule/generate` — Regenerate next week
- `GET /fitness/schedule/{date}` — Day details
- `PATCH /fitness/scheduled-days/{id}/skip` — Skip a day
- `POST /fitness/scheduled-days/{id}/overrides` — Add exercise override
- `DELETE /fitness/scheduled-days/{id}/overrides/{oid}` — Remove override
- `POST /fitness/sync/garmin` — Full Garmin sync
- `POST /fitness/sync/garmin/date/{date}` — Sync specific date
- `POST /fitness/workout-logs/override` — Override/create workout
- `POST /fitness/workout-logs/{id}/manual-match` — Manual Garmin match
- `POST /fitness/workout-logs/{id}/sets` — Add a set
- `PATCH /fitness/set-logs/{id}` — Update a set
- `DELETE /fitness/set-logs/{id}` — Delete a set
- `GET /fitness/exercises` — List exercises
- `GET /fitness/exercises/{id}/history` — Exercise history
- `POST /fitness/daily-stats/weight` — Log body weight

### Nutrition (`/nutrition`)
- `GET /nutrition/widgets/today` — Today's nutrition summary
- `GET /nutrition/widgets/meal-plan` — Meal plan grid
- `POST /nutrition/meal-plans/generate` — Generate meal plan
- `POST /nutrition/cook-events` — Record a cooking event
- `GET /nutrition/cook-events` — List cook events with remaining servings
- `POST /nutrition/planned-meals/{id}/swap` — Swap meal
- `PATCH /nutrition/planned-meals/{id}/override` — Replace meal
- `PATCH /nutrition/planned-meals/{id}/move` — Move meal to different date/slot
- `DELETE /nutrition/planned-meals/{id}` — Delete meal
- `POST /nutrition/meal-plans/{plan_id}/meals` — Add meal to plan
- `GET /nutrition/grocery-list` — Get grocery list
- `POST /nutrition/grocery-list/generate` — Generate grocery list
- `PATCH /nutrition/grocery-items/{id}/check` — Toggle grocery item
- `GET /nutrition/recipes` — List recipes
- `GET /nutrition/recipes/{id}` — Recipe details with ingredients
- `GET /nutrition/pantry` — List pantry
- `POST /nutrition/pantry` — Add/update pantry item
- `DELETE /nutrition/pantry/{id}` — Delete pantry item

### Sync (`/sync`)
- `POST /sync/to-google` — Sync to Google Calendar (extensible via SyncProviders)

### Auth (`/auth`)
- `GET /auth/google` — Start Google OAuth
- `GET /auth/google/callback` — OAuth callback
- `GET /auth/google/status` — Check config status

## Garmin Integration

### Architecture

Two Garmin integration modules serve different purposes:
- **`integrations/garmin.py`**: Full client for sleep records and activities (used by `/sync` router for Google Calendar)
- **`integrations/garmin_fitness.py`**: Lightweight activity fetcher (used by `services/garmin_sync.py` for fitness DB sync)

### Automatic Sync

APScheduler runs `garmin_sync.sync_garmin()` every 30 minutes. This:
1. Fetches the last 2 days of activities from Garmin
2. Upserts them into `GarminActivity`
3. Auto-matches to scheduled workout days
4. For strength workouts: parses exercise sets, runs progression evaluation per-exercise-session
5. Updates daily calorie stats

### Progression Engine

The progression engine in `services/progression.py` evaluates **per-exercise-session** (all sets for an exercise at once):
- **PASS** (>=95% completion): weight increases by increment
- **CLOSE** (>=80%): weight stays; 2 consecutive CLOSEs promote to PASS
- **FAIL** (<80%): weight stays; 3 consecutive FAILs trigger DELOAD (10% reduction)

### Garmin Compatibility

The `garth` library may have issues with Python 3.14+. Set `GARMIN_ENABLED=false` in `.env` to disable. The app degrades gracefully if garth is not installed.

## Frontend Development

### Tech Stack

- **Vanilla JavaScript** — No build step, no package.json
- **marked.js** via CDN for markdown rendering
- **flatpickr** via CDN for date/time picking

### Widget System

Register widgets with `registerWidget()` in any JS file loaded after `core.js`:

```javascript
registerWidget({
  id: 'my-widget',
  title: 'My Widget',
  async data() { return fetch('/api/data').then(r => r.json()); },
  render(data) { return '<div>...</div>'; },
});
```

### Modal System

```javascript
openModal(renderFn, onAction, onClose);
closeModal();
refreshModal(renderFn);
```

### CSS Variables

```css
:root {
  --bg:      #0e0e0e;   --surface: #161616;   --border:  #2a2a2a;
  --muted:   #555;      --text:    #d4d4d4;   --bright:  #f0f0f0;
  --accent:  #e8ff5a;   --danger:  #ff5f5f;   --warn:    #ffaa44;
  --mono:    'IBM Plex Mono', monospace;
  --sans:    'IBM Plex Sans', sans-serif;
}
```

### Date Handling

Use `parseDate()` and handle null/empty date sentinels:

```javascript
function parseDate(s) {
  if (s == null || s === '' || s === '0001-01-01T00:00:00Z') return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
```

### Adding New Widgets

1. Create a new JS file in `ui/static/` (e.g., `finance_widgets.js`)
2. Use `registerWidget()` to define widgets
3. Load the file in `dashboard.html` after `core.js`

## Data Files

- `data/program_templates.json` — 3 workout templates (Full Body A/B/C), 10 unique exercises
- `data/recipes.json` — 20 batch-cook recipes with nutritional info and ingredients

## Environment Variables

```env
# Required
DATABASE_URL=sqlite:///./mind-palace.db

# Optional - Google Calendar
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALENDAR_ID=...
GOOGLE_REFRESH_TOKEN=...

# Optional - Fitness
LIFTS_PER_WEEK=3

# Optional - Health calculations (shared by meal planner and Garmin sync)
USER_WEIGHT_LBS=175
USER_HEIGHT_IN=71
USER_AGE=28
CALORIE_SURPLUS=300
MISC_MOVEMENT=300

# Optional - Garmin
GARMIN_ENABLED=true

# Optional - Vikunja (not currently wired to routers)
VIKUNJA_TOKEN=your_vikunja_token
VIKUNJA_URL=http://localhost:3456/api/v1
```

## Key Patterns

1. **Offline resilience**: Store locally first, sync later when external services are unavailable
2. **Graceful degradation**: Don't fail requests if external APIs are down
3. **Dependency injection**: Use FastAPI's `Depends()` for DB sessions, clients, etc.
4. **Separation of concerns**: Models, schemas, services, and routes are in separate directories
5. **Single source of truth**: BMR in `health_calc.py`, schedule generation in `schedule_service.py`
6. **Soft tracking**: CookEvent servings are advisory, not enforced
7. **Date fields**: Use `day_date`, `stat_date`, `cook_date` etc. instead of `date` to avoid conflict with Python's built-in
