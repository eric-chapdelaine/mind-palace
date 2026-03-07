# Mind Palace

Central hub running on a Raspberry Pi that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and future automations.

## Project Structure

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
├── services/                  # Business logic
│   ├── health_calc.py         # Shared BMR, calorie targets, macro targets
│   ├── scheduler.py           # Week schedule generation algorithm
│   ├── schedule_service.py    # DB-aware schedule ensure/regenerate
│   ├── progression.py         # Lift progression evaluation engine
│   ├── meal_planner.py        # Deterministic meal planning algorithm
│   ├── garmin_sync.py         # Garmin activity sync, workout matching, progression
│   └── sync_providers/        # Generic sync provider abstraction
│       ├── __init__.py        # SyncProvider protocol
│       └── garmin_provider.py # Sleep + Activity sync to Google Calendar
├── integrations/              # External API clients
│   ├── vikunja.py             # Vikunja API client (available but not currently wired)
│   ├── google_calendar.py     # Google Calendar client
│   ├── garmin.py              # Garmin Connect client (sleep + activities via garth)
│   └── garmin_fitness.py      # Lightweight activity fetcher for fitness sync
├── api/routers/
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

## Running the Application

```bash
# Using virtual environment
source .venv/bin/activate

# Development server with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Or directly
python main.py
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # configure optional integrations (Garmin, Google Calendar)
python main.py
```

## API Reference

### Todos

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/todos/` | Create todo (with tags, priority) |
| `GET` | `/todos/` | List todos (`?status=TODO`, `?priority=1`, `?tag=work`) |
| `GET` | `/todos/tags` | List all tags |
| `GET` | `/todos/{id}` | Get a specific todo |
| `PATCH` | `/todos/{id}` | Update todo (any fields, including tags) |
| `DELETE` | `/todos/{id}` | Delete a todo |

### Fitness

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/fitness/widgets/today-workout` | Today's workout with prescribed and actual sets |
| `GET` | `/fitness/widgets/week-overview` | 7-day schedule grid (Mon-Sun) |
| `GET` | `/fitness/schedule/this-week` | Current week schedule |
| `POST` | `/fitness/schedule/generate` | Regenerate next week's schedule |
| `GET` | `/fitness/schedule/{date}` | Day details with exercises |
| `PATCH` | `/fitness/scheduled-days/{id}/skip` | Skip a workout day |
| `POST` | `/fitness/scheduled-days/{id}/overrides` | Add exercise override (override/skip/add) |
| `DELETE` | `/fitness/scheduled-days/{id}/overrides/{oid}` | Remove exercise override |
| `POST` | `/fitness/sync/garmin` | Full Garmin sync |
| `POST` | `/fitness/sync/garmin/date/{date}` | Sync specific date |
| `POST` | `/fitness/workout-logs/override` | Override/create workout log |
| `POST` | `/fitness/workout-logs/{id}/manual-match` | Manual Garmin activity match |
| `POST` | `/fitness/workout-logs/{id}/sets` | Add a set to a workout |
| `PATCH` | `/fitness/set-logs/{id}` | Update a set |
| `DELETE` | `/fitness/set-logs/{id}` | Delete a set |
| `GET` | `/fitness/exercises` | List all exercises |
| `GET` | `/fitness/exercises/{id}/history` | Exercise progress history |
| `POST` | `/fitness/daily-stats/weight` | Log body weight |

### Nutrition

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/nutrition/widgets/today` | Today's nutrition summary (calories, macros) |
| `GET` | `/nutrition/widgets/meal-plan` | This week's meal plan |
| `POST` | `/nutrition/meal-plans/generate` | Generate meal plan for the week |
| `POST` | `/nutrition/cook-events` | Record a cooking event |
| `GET` | `/nutrition/cook-events` | List cook events with remaining servings |
| `POST` | `/nutrition/planned-meals/{id}/swap` | Swap a meal |
| `PATCH` | `/nutrition/planned-meals/{id}/override` | Replace meal with specific recipe |
| `PATCH` | `/nutrition/planned-meals/{id}/move` | Move meal to different date/slot |
| `DELETE` | `/nutrition/planned-meals/{id}` | Delete a planned meal |
| `POST` | `/nutrition/meal-plans/{plan_id}/meals` | Add a meal to plan |
| `GET` | `/nutrition/grocery-list` | Get grocery list |
| `POST` | `/nutrition/grocery-list/generate` | Generate grocery list from meal plan |
| `PATCH` | `/nutrition/grocery-items/{id}/check` | Toggle grocery item checked |
| `GET` | `/nutrition/recipes` | List all recipes |
| `GET` | `/nutrition/recipes/{id}` | Recipe details with ingredients |
| `GET` | `/nutrition/pantry` | List pantry items |
| `POST` | `/nutrition/pantry` | Add/update pantry item |
| `DELETE` | `/nutrition/pantry/{id}` | Delete pantry item |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/to-google` | Sync Garmin sleep + activities to Google Calendar |

Uses an extensible SyncProvider pattern — each provider implements `collect()` and `push()`.

### Groceries

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/groceries/?name=Milk` | Add item |
| `GET` | `/groceries/` | List pending items |
| `PATCH` | `/groceries/{id}/done` | Mark purchased |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google` | Start OAuth flow → redirects to Google |
| `GET` | `/auth/google/callback` | OAuth callback → returns refresh token |
| `GET` | `/auth/google/status` | Check if Google Calendar is configured |

### Meta

```
GET /health      → {"status": "ok", ...}
GET /docs        → Interactive API docs (Swagger UI)
```

## Google Calendar Integration

Mind Palace can sync Garmin sleep and activity data to Google Calendar automatically.

### Prerequisites

1. A **Google Cloud project** with Calendar API enabled
2. An **OAuth client ID** with web application type
3. A **Google Calendar** (can be your primary or a dedicated one)

### Step 1: Get OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Search for **"Google Calendar API"** → Enable it
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. If prompted, configure OAuth consent screen:
   - User Type: **External**
   - App name: "Mind Palace"
   - Add yourself as a test user
6. Back to **Credentials**:
   - Application type: **Web application**
   - Add **Authorized redirect URI**: `http://localhost:8000/auth/google/callback` (or your deployed URL)
   - Copy **Client ID** and **Client Secret**

### Step 2: Create or Use a Google Calendar

1. Open [Google Calendar](https://calendar.google.com/)
2. Create a new calendar (optional, or use your primary)
3. Copy the **Calendar ID** from Settings → Integrate calendar

### Step 3: Configure Environment Variables

Add to your `.env` file:

```env
# Required
GOOGLE_CLIENT_ID=your_client_id_from_google_cloud
GOOGLE_CLIENT_SECRET=your_client_secret_from_google_cloud
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
APP_URL=http://localhost:8000

# You will get this after authorizing (see Step 4)
# GOOGLE_REFRESH_TOKEN=will_be_added_later
```

### Step 4: Authorize

Restart your app, then visit:

```bash
# In browser or curl:
curl -L http://localhost:8000/auth/google
```

This redirects to Google. After you authorize, you'll receive a **refresh token** in the response.

Add the refresh token to your `.env`:

```env
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
```

Restart the app.

### Step 5: Sync

**Manual sync:**
```bash
curl -X POST http://localhost:8000/sync/to-google
```

**Sync without sleep data:**
```bash
curl -X POST "http://localhost:8000/sync/to-google?include_sleep=false"
```

**Auto-sync with cron:**
```bash
# Sync every hour
echo "0 * * * * curl -X POST http://localhost:8000/sync/to-google" | crontab -
```

### How It Works

- **Sleep**: Garmin sleep data is synced as "Sleep" events with start/end times and quality score
- **Activities**: Garmin activities are synced with activity name, duration, distance, calories, and average HR
- Sleep events are linked by date via `extendedProperties`
- Activities are linked by Garmin activity ID via `extendedProperties`
- Updates are one-way: Garmin → Google Calendar
- The sync uses an extensible SyncProvider pattern — add new providers in `services/sync_providers/`

### Check Auth Status

```bash
curl http://localhost:8000/auth/google/status
```

Shows which OAuth credentials are configured.

## Fitness Module

### Workout Scheduling

The scheduler generates weekly workout schedules based on:
- `LIFTS_PER_WEEK` environment variable (default: 3)
- Available workout templates in the database
- Automatic rotation through templates (Full Body A → B → C → ...)

**Endpoints:**
- `GET /fitness/schedule/this-week` - Generate/retrieve current week's schedule (Mon-Sun)
- Click on any day in the week overview widget to see exercises

### Exercise Overrides

Per-day exercise flexibility via `ScheduledExerciseOverride`:
- **override**: Change prescribed sets/reps for an exercise on a specific day
- **skip**: Skip an exercise from the template for that day
- **add**: Add an ad-hoc exercise not in the template

### Progression System

After completing a workout, the progression engine evaluates each exercise based on completion percentage (`total_reps_completed / (prescribed_sets * prescribed_reps)`):

- **PASS** (>=95% completion): Weight increases by exercise's increment
- **CLOSE** (>=80% but <95%): Weight stays same; 2 consecutive CLOSEs auto-promote to PASS
- **FAIL** (<80%): Weight stays same; 3 consecutive FAILs trigger DELOAD (10% weight reduction)

### Garmin Sync

APScheduler runs Garmin sync every 30 minutes. The sync:
1. Fetches the last 2 days of activities from Garmin
2. Upserts them into the database
3. Auto-matches to scheduled workout days
4. For strength workouts: parses exercise sets and runs progression evaluation
5. Updates daily calorie stats

**Note:** The `garth` library may have issues with Python 3.14+. Set `GARMIN_ENABLED=false` in `.env` to disable.

### Setup

1. Configure Garmin (optional):
```bash
python -c "import garth; garth.login(); garth.save('~/.garth')"
```

## Nutrition Module

### Meal Planning

The meal planner generates weekly meal plans using a deterministic algorithm:
- Alternates between breakfast, lunch, dinner slots
- Prioritizes batch cook recipes to reduce cooking frequency
- Avoids repeating same meals within the week
- Targets configured calorie and macro goals (via `health_calc.py`)

### Cook Events

Meals use a cook-then-eat model:
- **CookEvent**: Records when a recipe is cooked and how many servings it produces
- **PlannedMeal**: A meal slot that optionally references a CookEvent
- Tracking is soft — remaining servings are advisory, not enforced
- Meals can be swapped, replaced, moved to different dates/slots, or deleted

### Grocery Lists

Automatically generates grocery lists from meal plans:
- Aggregates ingredients across all meals
- Combines quantities for common ingredients
- Marks items as purchased as you shop

### Recipes & Pantry

- Browse and view recipe details with ingredients and nutrition info
- Manage pantry items (add, update, delete)
- Pantry items are considered when generating grocery lists

## iPhone Shortcut

1. Add a **Get Contents of URL** action
2. URL: `http://pi-3b.local:8000/todos/`
3. Method: `POST`
4. Request Body: `JSON` → `{"title": "[Ask for Input]"}`
