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
- Garmin activity and sleep normalization into permanent health observations.
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
     +-- NWS weather adapter
     +-- normalized calendar/Garmin imports
```

Only the TypeScript control plane writes SQLite. The CP-SAT worker accepts JSON through standard input and returns JSON through standard output.

## Packages

- `apps/server`: HTTP API and service boundaries. See `apps/server/README.md` and `apps/server/src/services/README.md`.
- `apps/web`: React kanban, task detail, and schedule UI. See `apps/web/README.md`.
- `packages/database`: migrations and repositories. See `packages/database/README.md`.
- `packages/shared`: shared TypeScript API contracts.
- `workers/cp-sat`: Python OR-Tools worker. See `workers/cp-sat/README.md`.

## Integration State

Weather fetching and CP-SAT scheduling are operational. Google Calendar and Garmin use normalized import endpoints in v0, allowing provider-specific OAuth and polling to be added without changing the domain model. Raw provider payloads are not retained.

## Configuration

`DATABASE_PATH` controls the SQLite location and `HOST` can expose the control plane on a Tailscale interface; set them in the environment as needed. Do not expose this unauthenticated v0 server to the public internet.

## Data Retention

- Tasks, blocks, health observations, and schedule runs: indefinite.
- Raw calendar payloads: not stored.
- Weather: eight-hour cache.
- Solver snapshots: intended 90-day retention; automated cleanup is deferred until enough data exists to validate the policy.