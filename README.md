# Mind Palace

Central hub running on a Raspberry Pi that connects open-source life-management tools and exposes a unified API for iPhone Shortcuts, IoT devices, and future automations.

## Project Structure

```
mind-palace/
├── main.py                    # App entry point, router registration, scheduler
├── core/
│   ├── config.py              # All settings via env vars
│   └── database.py            # SQLite engine + session dep, seeding
├── models/
│   ├── items.py               # SQLModel tables: TodoItem, GroceryItem, etc.
│   ├── fitness.py             # Fitness tables: Exercise, WorkoutTemplate, ScheduledDay, etc.
│   └── nutrition.py           # Nutrition tables: Recipe, MealPlan, GroceryList, etc.
├── services/
│   ├── progression.py         # Lift progression logic (PASS/CLOSE/FAIL/DELOAD)
│   ├── scheduler.py           # Weekly workout schedule generator
│   ├── meal_planner.py        # Deterministic meal planning algorithm
│   └── garmin_sync.py        # Garmin Connect sync service
├── integrations/
│   ├── vikunja.py             # Vikunja API client
│   ├── google_calendar.py     # Google Calendar API client
│   └── garmin_fitness.py     # Garmin Connect API (optional - requires Python <3.14)
├── api/routers/
│   ├── todos.py               # Full todo CRUD + Vikunja sync
│   ├── groceries.py          # Grocery list
│   ├── fitness.py             # Workout tracking, scheduling, Garmin sync
│   ├── nutrition.py           # Meal planning, grocery generation
│   ├── auth.py                # OAuth authentication
│   └── sync.py                # Sync between integrations
└── ui/
    ├── templates/
    │   └── dashboard.html     # Main dashboard template
    └── static/
        ├── core.js            # Data fetching, widget system, modal system
        ├── widgets.js         # Widget definitions & rendering
        └── fitness_widgets.js # Fitness/nutrition dashboard widgets
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
cp .env.example .env   # fill in VIKUNJA_TOKEN, etc.
python main.py
```

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

### Fitness

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/fitness/widgets/today-workout` | Today's scheduled workout with exercises |
| `GET` | `/fitness/widgets/week-overview` | This week's schedule (Mon-Sun) |
| `GET` | `/fitness/schedule/this-week` | Generate/retrieve current week's schedule |
| `GET` | `/fitness/schedule/{date}` | Get workout details for a specific date |
| `POST` | `/fitness/sync/garmin` | Sync Garmin activities with scheduled workouts |
| `PATCH` | `/fitness/scheduled-days/{day_id}/skip` | Skip a scheduled workout |
| `GET` | `/fitness/exercises/{exercise_id}/history` | Get exercise progress history |

**Scheduler Configuration** (environment variables):
- `LIFTS_PER_WEEK` - Number of strength workouts per week (default: 3)

### Nutrition

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/nutrition/widgets/today` | Today's nutrition summary (calories, macros) |
| `GET` | `/nutrition/widgets/meal-plan` | This week's meal plan |
| `POST` | `/nutrition/meal-plans/generate` | Generate meal plan for the week |
| `PATCH` | `/nutrition/planned-meals/{id}/override?recipe_id=X` | Replace meal with specific recipe |
| `DELETE` | `/nutrition/planned-meals/{id}` | Delete a planned meal |
| `POST` | `/nutrition/meal-plans/{plan_id}/meals` | Add a meal to plan |
| `GET` | `/nutrition/grocery-lists/latest` | Get latest grocery list |
| `POST` | `/nutrition/grocery-lists/generate` | Generate grocery list from meal plan |
| `GET` | `/nutrition/recipes` | List all recipes |
| `GET` | `/nutrition/recipes/{id}` | Get recipe details with ingredients |
| `POST` | `/nutrition/pantry/` | Add item to pantry |
| `PATCH` | `/nutrition/pantry/{id}` | Update pantry item |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/to-google` | Sync Vikunja tasks + Garmin sleep + activities to Google Calendar |

Options:
- `?project_id=2` - Filter Vikunja tasks by project
- `?include_sleep=false` - Skip Garmin sleep data
- `?include_activities=false` - Skip Garmin activities

### Groceries (Legacy)

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

### Authentication (Google Calendar)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google` | Start OAuth flow → redirects to Google |
| `GET` | `/auth/google/callback` | OAuth callback → returns refresh token |
| `GET` | `/auth/google/status` | Check if Google Calendar is configured |

## Google Calendar Integration

Mind Palace can sync your Vikunja tasks with due dates and Garmin sleep data to Google Calendar automatically.

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

- **Tasks**: Only tasks with **due dates** are synced
- **Sleep**: Garmin sleep data is synced as "Sleep" events with start/end times and quality score
- **Activities**: Garmin activities are synced with activity name, duration, distance, calories, and average HR
- Tasks are linked via `extendedProperties` (Vikunja task ID stored in Google event)
- Sleep events are linked by date
- Activities are linked by Garmin activity ID
- Updates are one-way: Vikunja/Garmin → Google Calendar
- Completing a task in Vikunja marks it completed in Google Calendar

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

### Progression System

After completing a workout, the system evaluates each exercise:

- **PASS** (all sets completed at prescribed weight): Weight increases by exercise's increment
- **CLOSE** (within 1 rep of target): Weight stays same
- **FAIL** (missed 2+ reps): Weight decreases by 10%
- **DELOAD** (3+ consecutive fails): Reduce weight by 20%, reset fail streak

### Garmin Sync

The system matches Garmin workout activities to scheduled workouts by:
1. Looking for activities on scheduled workout days
2. Matching by session type (lift, run, cycle)
3. Marking matched days as "completed" with Garmin data (duration, calories)

**Note:** Garmin integration requires Python <3.14 due to library compatibility. Set `GARMIN_ENABLED=false` in `.env` to disable.

### Setup

1. Configure Garmin (optional - set `GARMIN_ENABLED=false` if on Python 3.14+):
```bash
python -c "import garth; garth.login(); garth.save('~/.garth')"
```

## Nutrition Module

### Meal Planning

The meal planner generates weekly meal plans using a deterministic algorithm:
- Alternates between breakfast, lunch, dinner slots
- Prioritizes batch cook recipes to reduce cooking frequency
- Avoids repeating same meals within the week
- Targets configured calorie and macro goals

**Endpoints:**
- `POST /nutrition/meal-plans/generate` - Generate meal plan for current week
- `GET /nutrition/widgets/meal-plan` - View this week's meal plan

### Managing Meals

In the meal plan UI:
- Click on any dinner to view recipe details (description, ingredients, nutrition)
- Use "Replace" to swap a meal with a different recipe
- Use "Delete" to remove a meal from the plan
- Empty slots show "+ Add" to add a new meal

### Grocery Lists

Automatically generates grocery lists from meal plans:
- Aggregates ingredients across all meals
- Combines quantities for common ingredients
- Marks items as purchased as you shop

**Endpoints:**
- `POST /nutrition/grocery-lists/generate` - Generate from current meal plan
- `GET /nutrition/grocery-lists/latest` - View current grocery list

### Recipes & Pantry

- `GET /nutrition/recipes` - Browse all recipes
- `GET /nutrition/recipes/{id}` - View recipe details with ingredients
- `POST /nutrition/pantry/` - Add items to pantry (what you have on hand)
- Pantry items are considered when generating grocery lists

## iPhone Shortcut

1. Add a **Get Contents of URL** action
2. URL: `http://pi-3b.local:8000/todo`
3. Method: `POST`
4. Request Body: `JSON` → `{"text": "[Ask for Input]", "category": "task"}`

## Offline Resilience

If Vikunja is unreachable, todos are saved locally with `synced=false`. Call `POST /todos/sync` when connectivity is restored to flush the queue.
