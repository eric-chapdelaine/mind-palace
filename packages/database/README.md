# Database

This package owns SQLite setup, ordered migrations, and persistence repositories. Connections use foreign keys, WAL mode, and a five-second busy timeout.

## Repository Boundaries

- `TaskRepository` owns task attributes, tags, time blocks, recurrence, schedule runs, weather, integration mappings, and health observations.

Keep provider calls and child processes out of repositories. Services normalize external data first, then call repository methods.

## Mind Palace Tables

- `tasks`: unified work item plus kanban, optional-estimate state, schedule, hierarchy, and completion time.
- `tags`, `tag_parents`, `task_tags`: multi-parent acyclic classification graph and direct task assignments.
- `recurrence_rules`, `recurrence_occurrences`: template configuration and generated-child identity.
- `time_blocks`, `schedule_runs`: proposed and accepted schedules plus immutable solver input/output.
- `integration_accounts`, `external_task_mappings`: provider synchronization identity without raw payload storage.
- `health_observations`: durable normalized Garmin activity and sleep facts.
- `weather_forecasts`: eight-hour Boston forecast cache.

Reserved tags are ordinary rows with stable public IDs. `TaskRepository.reservedTagIds` is the behavior registry boundary.

## Migrations

Add one ordered migration under `src/migrations` and register it in `src/migrations/index.ts`. Migrations run inside `BEGIN IMMEDIATE` and are recorded in `schema_migrations`.

Run migrations with:

```sh
pnpm db:migrate
```

## Invariants

- Tag-parent writes reject self-reference and cycles.
- Accepted time blocks cannot return to a proposal state.
- One direct association exists per task/tag pair.
- External provider identities map idempotently to one task.
- Tasks without a time estimate are not candidates for automatic scheduling.