# Server Services

Services own process and provider boundaries; repositories own SQLite writes.

- `schedule-service.ts` sends a versioned JSON problem to the Python scheduling worker and persists proposed blocks.
- `weather-service.ts` caches Boston hourly National Weather Service forecasts for eight hours.
- `calendar-import-service.ts` normalizes Google Calendar events into `calendar_event` tasks (shared by the manual import route and the sync pull).
- `google-calendar-service.ts` reconciles `calendar_event` tasks with one Google calendar: pull first (Google wins for commitments), then push local edits; `sync()` is idempotent so a missed tick self-heals.
- `google-calendar-client.ts` is the Google HTTP/OAuth boundary and the refresh-token store (`GOOGLE_CALENDAR_TOKEN_STORE`, default `~/.config/mind-palace/google-calendar.json`); it never touches SQLite.
- `garmin-service.ts` syncs Garmin Connect sleep and activities through the `workers/garmin` Python worker; a token store on disk is what marks it `connected`.
- `recurrence-service.ts` materializes routine templates as independently completable child tasks through a requested date.
- `worker.ts` is the shared runner for the Python workers (spawn, timeout, JSON-in/JSON-out, `{"error"}` handling).
- `job-scheduler.ts` runs the recurring jobs declared in `src/jobs.ts` on in-process intervals; `GET /api/jobs` reports their status.

Google Calendar accepts normalized imports in v0. Garmin Connect is registered in the composition root's `integrationRegistry`, so `GET /api/integrations` reports its connection state and the UI gates on it. OAuth and provider-specific polling can be added inside these services without changing task or health persistence.
