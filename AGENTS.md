# AGENTS.md - Mind Palace Development Guide

This file provides guidance for AI agents working on the Mind Palace codebase.

## Project Overview

Mind Palace is a FastAPI-based central hub that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and automations. It uses SQLite with SQLModel for persistence and integrates with Vikunja for task management, Garmin for health/fitness data, and includes a built-in fitness/nutrition tracking system.

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
5. **Generic endpoints**: Make endpoints flexible for future expansion (e.g., PATCH accepts dict for any fields)

## Frontend Development

### Tech Stack

- **Vanilla JavaScript** - No build step, no package.json
- **No framework** - Lightweight for Raspberry Pi deployment
- **marked.js** via CDN for markdown rendering
- **flatpickr** via CDN for date/time picking

### File Structure

```
mind-palace/
├── main.py                    # App entry point, router registration, APScheduler
├── core/
│   ├── config.py              # Settings via env vars
│   └── database.py            # SQLModel engine + session dep, seeding
├── models/
│   ├── items.py               # SQLModel tables: TodoItem, GroceryItem
│   ├── fitness.py             # Fitness tables: Exercise, WorkoutTemplate, ScheduledDay, etc.
│   └── nutrition.py           # Nutrition tables: Recipe, MealPlan, GroceryList, etc.
├── services/
│   ├── progression.py         # Lift progression logic
│   ├── scheduler.py           # Weekly workout schedule generator
│   ├── meal_planner.py        # Deterministic meal planning algorithm
│   └── garmin_sync.py         # Garmin Connect sync service
├── integrations/
│   ├── vikunja.py             # Vikunja API client
│   ├── google_calendar.py     # Google Calendar API client
│   └── garmin_fitness.py     # Garmin Connect API (optional)
├── api/routers/
│   ├── todos.py               # Todo CRUD + Vikunja sync
│   ├── groceries.py          # Grocery list
│   ├── fitness.py             # Workout tracking, scheduling, Garmin sync
│   ├── nutrition.py           # Meal planning, grocery generation
│   ├── auth.py               # OAuth authentication
│   └── sync.py               # Sync between integrations
└── ui/
    ├── templates/
    │   └── dashboard.html     # Main HTML template
    └── static/
        ├── core.js           # Data fetching, widget system, modal system
        ├── widgets.js        # Widget definitions & rendering
        ├── fitness_widgets.js # Fitness/nutrition widgets
        └── style.css         # Styles
```

### Adding Dependencies

Since there's no package.json, external JS libraries are loaded via CDN in `ui/templates/dashboard.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
```

### UI Rendering

- **widgets.js** - Contains `registerWidget()` calls that define each widget
- **fitness_widgets.js** - Fitness and nutrition widgets (today-workout, week-overview, nutrition-today, meal-plan, grocery-list)
- **core.js** - Provides `fetchVikunja()`, `fetchGroceries()`, `fetchTodo()`, `updateTodo()`, `createTodo()`, `deleteTodo()`, `fetchFitness()`, `fetchNutrition()`, date utilities, modal system
- Task descriptions from Vikunja are rendered as markdown using `marked.parse()`

### Modal System (core.js)

The modal system uses callbacks for close actions:

```javascript
openModal(renderFn, onAction, onClose);

// Example: open task modal and refresh widgets on close
openModal(
  () => renderTodoModal(todo),
  null,  // action callback (not used)
  () => renderAll()  // called when modal closes
);
```

To prevent modal from closing when a picker is open (e.g., flatpickr):

```javascript
window.flatpickrInstances = [];  // track open pickers
// In closeModal, check if any flatpickr is open before closing
```

### Widget System (widgets.js)

Register widgets with `registerWidget()`:

```javascript
registerWidget({
  id: 'tasks-today',
  title: 'Today & Overdue',
  async data() { return fetchVikunja(); },
  render(tasks) { return tasks.map(t => taskRow(t)).join(''); },
});
```

Task rows should include a checkbox for status toggle:

```javascript
function taskRow(task) {
  return `
    <div class="task-item ${task.done ? 'completed' : ''}">
      <input type="checkbox" ${task.done ? 'checked' : ''} 
        onclick="event.stopPropagation();toggleTaskStatus(${task.id}, ${!task.done})">
      <span class="task-title" onclick="openTaskModal(${task.id})">${esc(task.title)}</span>
    </div>`;
}
```

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

### Date Handling

Use `parseDate()` and handle Vikunja's empty date sentinel:

```javascript
function parseDate(s) { 
  // Handle null, empty string, and Vikunja's default date
  if (s == null || s === '' || s === '0001-01-01T00:00:00Z') return null; 
  const d = new Date(s); 
  return isNaN(d.getTime()) ? null : d; 
}
```

### Animations

Only animate on first render to avoid flicker on updates:

```javascript
let _isFirstRender = true;

async function renderAll() {
  const animate = _isFirstRender;
  _isFirstRender = false;
  
  WIDGETS.forEach(w => renderWidget(w, container, animate));
}
```

CSS uses `.animate-in` class for animations, not the default `.widget` class.

## Vikunja API Integration

### VikunjaClient Methods (integrations/vikunja.py)

The client provides methods for task operations:

- `create_task(title, project_id, notes, due_date)` - Create a new task
- `get_tasks(project_id)` - List tasks in a project
- `get_task(task_id)` - Get a single task
- `update_task(task_id, **fields)` - Update any task fields (generic, uses POST)
- `delete_task(task_id)` - Delete a task

### API Endpoints (api/routers/todos.py)

- `POST /todos/` - Create a new task
- `GET /todos/` - List local tasks
- `GET /todos/vikunja` - List Vikunja tasks (proxy)
- `GET /todos/vikunja/{id}` - Get Vikunja task by ID
- `PATCH /todos/vikunja/{id}` - Update Vikunja task (generic, accepts any fields)
- `DELETE /todos/vikunja/{id}` - Delete Vikunja task

### Task Status

Vikunja uses `done: boolean` for task completion. The frontend uses:
- `TODO` - not completed
- `Completed` - completed (shows strikethrough)

## Garmin Integration

### Setup

Garmin Connect authentication uses the `garth` library:

```bash
# Authenticate (opens browser for OAuth login)
python -c "import garth; garth.login(); garth.save('~/.garth')"
```

Tokens last approximately 1 year.

### GarminClient (integrations/garmin.py)

- `get_sleep_records(start_date, end_date)` - Fetch sleep data for date range
- `get_latest_sleep()` - Get most recent sleep record

### SleepRecord Fields

- `date` - Date of sleep
- `bed_time_start` / `bed_time_end` - Bed times (timezone-aware datetime)
- `sleep_quality` - Overall sleep score (0-100)
- `total_sleep_duration` - Total sleep in minutes
- `deep_sleep_duration`, `light_sleep_duration`, `rem_sleep_duration`, `awake_duration` - Sleep stages in minutes
- `to_calendar_event()` - Convert to Google Calendar event format

### Timezone Handling

Garmin provides both GMT and local timestamps. Use GMT timestamps with `datetime.fromtimestamp().astimezone()` to convert to local timezone:

```python
bed_time_start = datetime.fromtimestamp(
    dto.sleep_start_timestamp_gmt / 1000
).astimezone()
```

## Sync Router

### Endpoint (api/routers/sync.py)

- `POST /sync/to-google` - Sync Vikunja tasks, Garmin sleep, and activities to Google Calendar

Query parameters:
- `project_id` - Filter Vikunja tasks by project
- `include_sleep` - Include Garmin sleep data (default: true)
- `include_activities` - Include Garmin activities (default: true)

### Response Format

```json
{
  "tasks": {"synced": 0, "total": 0, "errors": []},
  "sleep": {"synced": 0, "total": 0, "errors": []},
  "activities": {"synced": 0, "total": 0, "errors": []}
}
```

### Google Calendar Events

- **Tasks**: Tagged with `vikunja_task_id` in extendedProperties
- **Sleep**: Tagged with `garmin_sleep_date` in extendedProperties
- **Activities**: Tagged with `garmin_activity_id` in extendedProperties

Both are updated in place if already exists in calendar.

## Fitness Module

### Models (models/fitness.py)

- **Exercise** - Master exercise list with name, category, equipment, increment_lbs
- **WorkoutTemplate** - Named session definitions (e.g., "Full Body A")
- **TemplateExercise** - Exercises within a template with prescribed sets/reps
- **ScheduledDay** - Scheduled workout days with date, session_type, status
- **ExerciseState** - Current weight and last verdict for each exercise
- **ExerciseHistory** - Historical record of weights and verdicts
- **WorkoutLog** - Completed workout records linked to scheduled days
- **SetLog** - Individual set completion records
- **GarminActivity** - Synced Garmin activities
- **DailyStats** - Daily weight, calories burned, calorie target

### Scheduler (services/scheduler.py)

Generates weekly workout schedules:

```python
def generate_week_schedule(templates, last_template_sort, week_start):
    # LIFTS_PER_WEEK = 3 (configurable via env var)
    # NO_LIFT_DAY = 2 (Tuesday)
    # Cycles through templates: A → B → C → A → ...
```

- `get_this_monday()` - Returns current week's Monday
- `get_next_monday()` - Returns next week's Monday

### Progression Engine (services/progression.py)

Evaluates workout completion and adjusts weights:

- **PASS** - All sets completed at prescribed weight → increase weight
- **CLOSE** - Within 1 rep of target → weight stays same
- **FAIL** - Missed 2+ reps → decrease weight by 10%
- **DELOAD** - 3+ consecutive fails → decrease by 20%, reset streak

### API Endpoints (api/routers/fitness.py)

- `GET /fitness/widgets/today-workout` - Today's workout with exercises
- `GET /fitness/widgets/week-overview` - This week's schedule
- `GET /fitness/schedule/this-week` - Generate/retrieve current week
- `GET /fitness/schedule/{date}` - Get day details with exercises
- `POST /fitness/sync/garmin` - Match Garmin activities to scheduled days
- `PATCH /fitness/scheduled-days/{day_id}/skip` - Skip a workout
- `GET /fitness/exercises/{id}/history` - Exercise progress history

### JavaScript Widgets (ui/static/fitness_widgets.js)

- **today-workout** - Shows today's workout with prescribed vs actual sets
- **week-overview** - 7-day grid, clickable to open day details
- **nutrition-today** - Calorie tracking for the day
- **meal-plan** - This week's meal plan
- **grocery-list** - Current grocery list

### Garmin Integration

**Note:** The `garth` library has compatibility issues with Python 3.14. Set `GARMIN_ENABLED=false` in `.env` to disable Garmin integration if running on Python 3.14+.

## Nutrition Module

### Models (models/nutrition.py)

- **Ingredient** - Master ingredient list with name, category, unit
- **Recipe** - Recipes with name, instructions, prep time, servings
- **RecipeIngredient** - Ingredients in a recipe with quantities
- **MealPlan** - Weekly meal plan with start date
- **PlannedMeal** - Individual meals in a plan (breakfast/lunch/dinner)
- **PantryItem** - Items in pantry (what you have)
- **GroceryList** - Generated grocery lists
- **GroceryItem** - Items in a grocery list

### Meal Planning Algorithm (services/meal_planner.py)

Deterministic algorithm (no AI):
1. Get all batch cook recipes
2. Get all regular recipes
3. Alternate breakfast/lunch/dinner slots
4. Prioritize batch cook recipes (cook once, eat multiple times)
5. Avoid repeating same meals within the week
6. Target configured calorie/macro goals

### API Endpoints (api/routers/nutrition.py)

- `GET /nutrition/widgets/today` - Today's nutrition summary
- `GET /nutrition/widgets/meal-plan` - This week's meal plan
- `POST /nutrition/meal-plans/generate` - Generate meal plan for week
- `GET /nutrition/grocery-lists/latest` - Get current grocery list
- `POST /nutrition/grocery-lists/generate` - Generate from meal plan
- `GET /nutrition/recipes/` - List all recipes
- `POST /nutrition/pantry/` - Add pantry item
- `PATCH /nutrition/pantry/{id}` - Update pantry item

### Calorie/Macro Targets

- `get_calorie_target(calories_burned)` - TDEE + exercise calories - 500 (for weight loss)
- `get_macro_targets(calorie_target)` - Protein: 0.8g/lb, Fat: 0.3g/lb, Carbs: remainder

## Data Files

- `data/program_templates.json` - Beginner workout program (seed data)
- `data/recipes.json` - 20 recipes for meal planning (seed data)

## Environment Variables

```env
# Required
VIKUNJA_TOKEN=your_vikunja_token

# Optional - Google Calendar
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALENDAR_ID=...
GOOGLE_REFRESH_TOKEN=...

# Optional - Fitness
LIFTS_PER_WEEK=3

# Optional - Garmin (set to false on Python 3.14+)
GARMIN_ENABLED=true
```

## Key Patterns

1. **Offline resilience**: Store locally first, sync later when external services unavailable
2. **Graceful degradation**: Don't fail requests if external APIs are down
3. **Dependency injection**: Use FastAPI's `Depends()` for DB sessions, clients, etc.
4. **Separation of concerns**: Keep DB models, schemas, and routes separate
5. **Date fields**: Use `day_date` instead of `date` to avoid conflict with Python's built-in
