# Mind Palace

Mind Palace is a single-owner task manager and weekly scheduler. Everything schedulable is a task: actionable work, calendar commitments, recurring routines, and sleep. Stable tags add behavior without creating parallel work-item models.

## V0 Capabilities

- Simple system-font kanban with card hover feedback, cross-column movement, and within-column rank ordering.
- Fuzzy tag selection, inline tag creation, and a collapsible multi-parent hierarchy view.
- Optional time estimates; tasks without estimates stay out of automatic scheduling until estimated.
- Editable task details with Markdown descriptions.
- Seven-day calendar grid with date navigation, fixed and planned blocks, and muted elapsed time.
- Numeric priority with drag rank as the tie-breaker.
- Multi-parent tag DAG with cycle prevention.
- Reserved modular tags: `calendar_event` and `routine`.
- Thirty-minute scheduling through a separate Python worker (greedy by default; a CP-SAT solver is available).
- Per-task schedule acceptance; accepted blocks are immutable.
- Routine templates and independently completable child occurrences.
- Google Calendar normalization into tagged tasks through an import endpoint.
- Garmin Connect sleep and activity sync into dedicated health tables, shown as context on the calendar.
- Boston hourly weather cached for eight hours from the National Weather Service.

V0 has no application accounts or login. Each owner runs an independent instance. Bind the server only to localhost or a controlled Tailscale interface.

## Requirements

- Node.js 24+
- pnpm 10+
- Python 3.11+
- `uv`

## Start

```sh
pnpm install
uv sync --project workers/cp-sat
uv sync --project workers/garmin
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:4311` in development. Vite proxies API calls to the server on port `4310`.

For the production build:

```sh
pnpm build
pnpm start
```

## Architecture

```text
React web UI
     |
TypeScript/Hono control plane
     |
SQLite in WAL mode
     |
     +-- Python scheduler process
     +-- Python Garmin sync process
     +-- NWS weather adapter
     +-- normalized calendar imports
```

Only the TypeScript control plane writes SQLite. The scheduling worker accepts JSON through standard input and returns JSON through standard output.

## Packages

- `apps/server`: HTTP API and service boundaries. See `apps/server/README.md` and `apps/server/src/services/README.md`.
- `apps/web`: React kanban, task detail, and schedule UI. See `apps/web/README.md`.
- `packages/database`: migrations and repositories. See `packages/database/README.md`.
- `packages/shared`: shared TypeScript API contracts.
- `workers/cp-sat`: Python OR-Tools worker. See `workers/cp-sat/README.md`.
- `workers/garmin`: Python Garmin Connect sync worker (sleep + activities).

## Integration State

Weather fetching and scheduling are operational. Google Calendar syncs two-way: `calendar_event` tasks mirror to events in a connected Google calendar and events created or edited there mirror back as `calendar_event` tasks. Garmin Connect syncs sleep and recorded activities through the Python worker and stores only normalized rows in `sleep_sessions` / `health_activities`; raw provider payloads are not retained.

## Google Calendar

OAuth is the switch: nothing runs until a token store exists, so a fresh install behaves exactly as
before Google Calendar support. Create one by visiting the Schedule page and clicking
**Connect Google Calendar** — the server opens Google's consent screen and writes the refresh token
to `$GOOGLE_CALENDAR_TOKEN_STORE` (default `~/.config/mind-palace/google-calendar.json`, never
committed).
Both `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` must be set, and the OAuth
client's redirect URI must be `<server>/api/integrations/google-calendar/callback`.

Once connected, a task whose time block is type `calendar_event` is pushed to Google within about a
second of being created, renamed, moved, or cancelled. Events in Google's sync window (1 day back,
30 days forward by default) are pulled in on the same schedule; all-day events are skipped by
default (`importAllDay` in the integration's `config_json`). A 5-minute interval tick is the safety
net for dropped pushes and edits made while the server was down, and
`POST /api/integrations/google-calendar/sync` forces a pass on demand. Design and the
direction-of-truth table live in `docs/google-calendar-sync.md`; the reconcile loop's smoke harness
is `apps/server/scripts/google-calendar-smoke.ts` (no network, stubbed client):

```sh
pnpm --filter @mind-palace/server exec tsx scripts/google-calendar-smoke.ts
```

## Garmin Connect

Authentication is the switch: Garmin is considered enabled only once a token store exists, so a
fresh install behaves exactly as it did before Garmin support (no sync button, no calendar
overlay, no health requests) and the server never handles a password. Create a store with:

```sh
python -c "import garth; garth.login(); garth.save('~/.garminconnect')"
```

The server looks for `$GARMINTOKENSTORE`, then `~/.garminconnect`, then `~/.garth`, and passes
the resolved path to the worker. `POST /api/integrations/garmin/sync` is incremental: it asks
the database for the newest stored sleep and activity dates and fetches only from there forward.
Once authenticated, the Schedule page shows a **Sync Garmin** button and the calendar health
overlays. The server also syncs once a day through its [background job registry](#scheduled-jobs);
there is no crontab to install.

## Scheduled jobs

Recurring background work is declared in `apps/server/src/jobs.ts` and run in-process by the
server, so the schedule is versioned with the repo instead of living in a machine's crontab. Add
an entry to that array to schedule new work; `GET /api/jobs` reports each job's last run and error.

Jobs must be idempotent and cheap when there is nothing to do, because a pinned time or interval
tick can land at any moment and `runOnStart` can fire on a restart. Current jobs:

- `weather-refresh` — pinned at 00:00, 08:00, 16:00 `America/New_York` (matches the eight-hour cache).
- `garmin-sync` — pinned at 11:00 `America/New_York`; no-ops until a Garmin token store exists.
- `google-calendar-sync` — every 5 minutes; no-ops until Google Calendar is connected, and
  incremental reads make an unchanged pull a single request.

The nightly database backup is deliberately *not* here: it runs on the dev machine and needs
`Persistent=true`, so it stays a systemd user timer (see `docs/running-on-rpi.md` §8).

## Configuration

`DATABASE_PATH` controls the SQLite location and `HOST` can expose the control plane on a Tailscale interface; set them in the environment as needed. `GARMINTOKENSTORE` overrides the Garmin token-store path (useful under a service manager with a different `HOME`). Do not expose this unauthenticated v0 server to the public internet.

## Data Retention

- Tasks, blocks, sleep sessions, health activities, and schedule runs: indefinite.
- Raw calendar payloads: not stored.
- Weather: eight-hour cache.
- Solver snapshots: intended 90-day retention; automated cleanup is deferred until enough data exists to validate the policy.