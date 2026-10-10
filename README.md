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
- Thirty-minute CP-SAT scheduling through a separate Python worker.
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
     +-- Python CP-SAT process
     +-- Python Garmin sync process
     +-- NWS weather adapter
     +-- normalized calendar imports
```

Only the TypeScript control plane writes SQLite. The CP-SAT worker accepts JSON through standard input and returns JSON through standard output.

## Packages

- `apps/server`: HTTP API and service boundaries. See `apps/server/README.md` and `apps/server/src/services/README.md`.
- `apps/web`: React kanban, task detail, and schedule UI. See `apps/web/README.md`.
- `packages/database`: migrations and repositories. See `packages/database/README.md`.
- `packages/shared`: shared TypeScript API contracts.
- `workers/cp-sat`: Python OR-Tools worker. See `workers/cp-sat/README.md`.
- `workers/garmin`: Python Garmin Connect sync worker (sleep + activities).

## Integration State

Weather fetching and CP-SAT scheduling are operational. Google Calendar uses a normalized import endpoint in v0, allowing provider-specific OAuth and polling to be added without changing the domain model. Garmin Connect syncs sleep and recorded activities through the Python worker and stores only normalized rows in `sleep_sessions` / `health_activities`; raw provider payloads are not retained.

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

Jobs must be idempotent and cheap when there is nothing to do, because a restart can fire
`runOnStart` and an interval tick can land at any moment. Current jobs:

- `weather-refresh` — hourly cache-aware check; hits NWS only once the eight-hour cache expires.
- `garmin-sync` — daily; no-ops until a Garmin token store exists.

The nightly database backup is deliberately *not* here: it runs on the dev machine and needs
`Persistent=true`, so it stays a systemd user timer (see `docs/running-on-rpi.md` §8).

## Configuration

`DATABASE_PATH` controls the SQLite location and `HOST` can expose the control plane on a Tailscale interface; set them in the environment as needed. `GARMINTOKENSTORE` overrides the Garmin token-store path (useful under a service manager with a different `HOME`). Do not expose this unauthenticated v0 server to the public internet.

## Data Retention

- Tasks, blocks, sleep sessions, health activities, and schedule runs: indefinite.
- Raw calendar payloads: not stored.
- Weather: eight-hour cache.
- Solver snapshots: intended 90-day retention; automated cleanup is deferred until enough data exists to validate the policy.