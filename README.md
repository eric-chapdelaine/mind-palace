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
│   ├── vikunja.py             # Vikunja API client
│   ├── google_calendar.py     # Google Calendar API client
│   └── garmin.py              # Garmin Connect API client
└── api/
    └── routers/
        ├── capture.py          # Simple intake (Shortcuts/IoT)
        ├── todos.py            # Full todo CRUD + Vikunja sync
        ├── groceries.py        # Grocery list
        ├── auth.py             # OAuth authentication
        └── sync.py             # Sync between integrations
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

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/to-google` | Sync Vikunja tasks + Garmin sleep + activities to Google Calendar |

Options:
- `?project_id=2` - Filter Vikunja tasks by project
- `?include_sleep=false` - Skip Garmin sleep data
- `?include_activities=false` - Skip Garmin activities

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

### Authentication (Google Calendar)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google` | Start OAuth flow → redirects to Google |
| `GET` | `/auth/google/callback` | OAuth callback → returns refresh token |
| `GET` | `/auth/google/status` | Check if Google Calendar is configured |

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in VIKUNJA_TOKEN
python main.py
```

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

## Garmin Integration

Mind Palace can fetch your sleep data from Garmin Connect and sync it to Google Calendar.

### Setup

1. Install garth library (included in requirements.txt)
2. Authenticate with Garmin Connect:

```bash
python -c "import garth; garth.login(); garth.save('~/.garth')"
```

This opens a browser for OAuth login. Tokens last ~1 year.

### Usage

Sleep data is automatically included when syncing to Google Calendar. Each night's sleep appears as a "Sleep" event with:
- Start time (when you went to bed)
- End time (when you woke up)
- Quality score
- Sleep stage breakdown (deep, light, REM, awake)

## iPhone Shortcut

1. Add a **Get Contents of URL** action
2. URL: `http://pi-3b.local:8000/todo`
3. Method: `POST`
4. Request Body: `JSON` → `{"text": "[Ask for Input]", "category": "task"}`

## Offline Resilience

If Vikunja is unreachable, todos are saved locally with `synced=false`. Call `POST /todos/sync` when connectivity is restored to flush the queue.
