# AGENTS.md

Operating guide for AI coding agents working in this repo. Read this before changing code. The goal: add features quickly by **extending the existing patterns** instead of inventing new ones. This repo is intentionally small; every abstraction layer you add is context a future agent has to hold in its head. Keep it that way.

## Repo layout (5-minute tour)

pnpm monorepo. Packages import each other as **TypeScript source** (`"exports": "./src/index.ts"`), so there is no package build step — changes take effect in dev immediately. `tsx` (server) and Vite (web) compile them.

| Path | Responsibility |
|---|---|
| `apps/server/src/index.ts` | Composition root: creates `Database` → `TaskRepository` → services → Hono app. New services get wired here. |
| `apps/server/src/http/app.ts` | All HTTP routes. Body validation/coercion + response shaping only. No business logic. |
| `apps/server/src/services/*.ts` | Process & provider boundaries (scheduler subprocess, NWS fetch, provider normalization, recurrence materialization). |
| `packages/database/src/` | `database.ts` (SQLite connection), `migrations/` (numbered schema history), `repositories/` (all SQL), `rows.ts` (row-coercion helpers). |
| `packages/shared/src/index.ts` | Single source of truth for API contracts: `TaskSummary`, `TaskDetail`, `CreateTaskInput`, `UpdateTaskInput`, status enums, etc. |
| `apps/web/src/api.ts` | The **only** place in the frontend that calls `fetch`. One typed method per endpoint. |
| `apps/web/src/*Page.tsx` | Route-level pages. Own data fetching, polling, and error display. |
| `apps/web/src/components/` | Presentational components. Receive data + callbacks via props; never fetch. |
| `workers/cp-sat/scheduler.py` | Python scheduling worker (greedy default, CP-SAT optional). JSON in on stdin, JSON out on stdout. Never touches SQLite. |

Commands:

```sh
pnpm install              # first time
uv sync --project workers/cp-sat   # first time (Python worker)
pnpm db:migrate           # create/migrate the SQLite DB (data/ is gitignored)
pnpm dev                  # server :4310 + web :4311 (Vite proxies /api)
pnpm typecheck            # tsc --noEmit across every package — run before finishing
pnpm build && pnpm start  # production; server also hosts apps/web/dist
```

## Core architecture rules (these are why the repo stays simple)

1. **One data flow.** React UI → Hono API → services → repositories → SQLite (WAL mode). Nothing else writes the database — not the web UI, not the Python worker.
2. **One work-item model.** Everything schedulable is a `task`. There are no separate models for calendar items, routines, or health observations (one documented exception: `recurrence_templates` — see below) — behavior is added with **tags** (reserved tags `mind-palace:calendar-event`, `mind-palace:routine`) and child tasks, not new tables that duplicate task.
3. **Types live once.** Both ends import contracts from `@mind-palace/shared`. Never redefine an API shape in `apps/web` or `apps/server`.
4. **Layers are thin and concrete.** Route validates → service orchestrates → repository persists. No interfaces, no DI containers, no repository base classes. Plain classes and functions. If you catch yourself adding a layer, stop and look for the existing one that already does that job.

## Data model (what the tables mean)

- `tasks` — the unified work item: kanban column (`kanban_status`), lifecycle (`lifecycle_status`), priority + rank (rank is the drag-order tiebreaker), `duration_minutes_remaining` (time not yet represented by a time block; `NULL`/0-remaining tasks are never auto-scheduled), earliest/deadline windows, `auto_archive_at` (the instant the task decays out of the board; `NULL` = never), `origin` (manual / calendar_import / recurrence). There is no parent-task column — parent/child relationships between tasks are expressed by shared tags (a parent task is mapped by a tag it and its children both carry; see `setTaskTags`).
- `tags`, `tag_parents`, `task_tags` — multi-parent acyclic tag graph ("derived" tags = ancestors) and direct task assignments. `tags.public_id` starting with `mind-palace:` marks **reserved** tags: seeded by a migration (shipped defaults). Tags are selectors; behavior lives in scheduler rules, not in the tag.
- `scheduler_rules` — the rule set the scheduling worker compiles into hard constraints and weighted soft terms (one objective, no tiers). A rule references any tag (seeded or user-created) through its `applies` condition; effects are `assignDays`, `timeWindow`, `preferTimeOfDay`, `spread`, `dailyBudget`, `perDayLimit`, `weatherGate`, and `withinAfter`. There are no seeded day pins: a day/time anchor is a rule on a class tag (usually a routine's own tag), so it is re-evaluated against the current week instead of being stamped onto a task. A soft `assignDays` is graded by distance (nearer days score higher); a hard one is an exact-day constraint. A soft `weatherGate` is graded the same way: `effect.metrics` maps each measured forecast field (`temperatureF`, `precipitationProbability`, `windMph`, `daytime`) to an `{ ideal, min?, max?, weight? }`, the slot scores 1 at each ideal and 0 at each limit, and the rule's weight is multiplied by the metrics' weighted average — so a dry Sunday outscores a merely acceptable Saturday. A hard `weatherGate` only enforces the limits. `perDayLimit` is a hard occurrence cap over a day.
- `time_blocks`, `schedule_runs` — schedule results. Blocks carry a `type` (`work` default, `calendar_event` for fixed commitment windows) and `source` (manual / solver / calendar / recurrence); an accepted block's **status** is immutable (repo enforces: accepted → only completed/missed), but its window is not — accepting commits the hours to the plan, not the clock face, so `PATCH /api/time-blocks/:id` moves an accepted block too and the task's remaining estimate rebalances. Creating a block subtracts its minutes from the task's `duration_minutes_remaining`; deleting or superseding gives them back. **Manual** (human-placed) blocks are commitments: they are not superseded by regeneration and reserve their slot in the worker. The worker emits one assignment per 30-minute slot; `ScheduleService` merges adjacent slots for the same task into a single contiguous block before persisting, so a 10:00-11:00 block is stored as one row, not two half-hour rows. Schedule runs store the exact solver input/output JSON for reproducibility.
- `recurrence_templates`, `recurrence_template_tags`, `recurrence_occurrences` — recurrence rules and the tasks they generate. A **template is not a task**: it is a rule that says tasks should exist, so it lives in its own table with the values each occurrence is born with (title, duration, priority, tags, `auto_archive_hour`, the rule's anchor date). It is the one deliberate exception to the one-work-item model, because modelling it as a `tasks` row forced an exclusion in the scheduler query, the decay sweep, the briefing and every tag/kanban list — each one existing only to undo the fact that it was a task. A template defines a **period** (`daily` = `interval_count` days, `weekly` = that many weeks) and `times_per_period`: how many interchangeable occurrences the period gets. A daily period gets one dated card (its window is that day); a weekly period gets N cards whose window is the whole period, so rules decide the day. One occurrence per period is a **cadence** (it stays inside its own window); several are a **quota** (interchangeable, so they can all land on the period's best days). The rate can match while the freedom differs: `2 weeks ×1` keeps one card in each 14-day window, `4 weeks ×2` lets both land in the same week. `recurrence_occurrences` is the ledger `(template_id, period_start, sequence) → child_task_id`; the child reference is nullable and not unique. A daily slot counts as done only while its child is alive (a deleted card comes back); a quota slot counts as done once it has ever been filled, so completing this week's grocery trip does not mint a second one. `auto_archive_hour` is the template's decay policy: the local hour on the occurrence's last day (its only day for a daily card) at which its child decays (`NULL` = end of that day), which is what makes "wake up" gone by 10am while an ordinary task lingers a month. Occurrences carry the template's own tags plus the reserved `routine` tag. A routine is **not** given an auto-created tag: placement rules target whichever tag you attach, and a routine's history is read from the ledger (`GET /api/recurrence-templates/:id/tasks`), so it needs no tag of its own. `routine_tag_id` is legacy — it still holds the tag an older routine was given, and occurrences keep carrying it so existing rules and tag pages keep working.
- `integration_accounts`, `external_task_mappings` — provider identity; mappings make calendar/garmin imports idempotent. Raw provider payloads are never stored.
- `sleep_sessions`, `health_activities` — normalized Garmin Connect facts (one table per health domain: a night's sleep and a recorded activity). Populated only by the Garmin sync service (`GarminService` + `workers/garmin/`); shown as read-only context in the schedule and on `/health_observation/:id` / `/health_activity/:id`, never schedulable tasks. Garmin-owned columns (including `health_activities.provider_title`) are refreshed on every sync, while `health_activities.title` and both tables' `notes` are owner-owned and never overwritten by a sync. `health_observations` (migration 001) is the earlier generic table and is no longer written.
- `weather_forecasts` — hourly Boston forecast cache, including temperature, precipitation probability, wind, and daylight.

## Background jobs and decay

Background work is the `ScheduledJob[]` in `apps/server/src/jobs.ts` (weather refresh, Garmin sync, and the two below). Jobs must be idempotent; add new recurring work there, never in a crontab.

- **`recurrence-materialize`** (00:15 local, `runOnStart`) creates each active recurrence's occurrences for the next `scheduleHorizonDays` so the board is populated before the day starts. That constant is shared with `ScheduleService` on purpose: the scheduler lays out exactly the window recurrence fills, so the board never holds work the scheduler cannot place. It generates every period that starts before the window ends, so a weekly template can have two live periods when the next one begins inside the horizon and the scheduler can plan next Sunday while it plans this one; a period starting on the horizon's last day waits for the next pass. It never backfills — the window starts at today — so a Pi that was off does not manufacture a week of dead rows. Authoring a rule materializes immediately through the same call, so the UI shows the result without waiting for the job. Rows already created are never rewritten: editing a template changes future occurrences only, which is why re-estimating a recurrence does not rewrite history. Deleting a recurrence stops it; the occurrences it already produced stay on the board.
- **`task-auto-archive`** (23:30 local, `runOnStart`) archives every task whose `auto_archive_at` has passed. Ordinary tasks default to a month; recurrence occurrences use their template's `auto_archive_hour`; completed/cancelled/calendar-event rows are `NULL`. Templates have no `auto_archive_at` at all, so a live recurrence can never be archived out from under its children. A task with time booked for it is exempt — a manual block (even still `proposed`) or an accepted/completed one — because hiding the task while its hour stayed reserved would leave the calendar holding work the board does not show. Unarchiving (`POST /api/tasks/:id/unarchive`) sets a live instant to `max(now + 2 weeks, original)` so rescuing a task does not drop it straight back in, and leaves `NULL` alone: never-decay is a choice.

Scheduler eligibility is one rule, and the repository query is authoritative (`SchedulePage`'s `schedulabilityReason` mirrors it so a card can explain itself): `kanban_status IN ('ready','in_progress')`, an estimate, minutes remaining, and not archived. There is no tag gate — what belongs in the week is the scheduler's answer (priority, rules, weather), not a tag a person has to remember to add.

Timezone math for local dates/instants lives in `apps/server/src/services/clock.ts` (`HOME_TIME_ZONE`, `localDate`, `localInstant`, `startOfLocalDay`, `addDays`, `daysBetween`, `weekdayIndex`). Use it instead of `-04:00` offsets or ad-hoc `Intl` formatting; DST has bitten this codebase before.

## Backend conventions

### Routes (`apps/server/src/http/app.ts`)

- Route handlers: read body → validate/coerce (helpers `requiredString`, `numberParam`) → call a service or repository method → return shaped JSON.
- Throw plain `Error` with a **user-facing message** — it is returned in the JSON body and rendered in the UI error banner. `onError` maps errors to 400; missing-row errors (message starts `Expected database row`) become 404.
- Keep validation in the route, business rules in services/repositories. Don't put domain logic next to `context.json(...)`.
- `exactOptionalPropertyTypes` is on: optional fields are either present or absent — build them with conditional spreads, e.g. `...(typeof body.x === "string" ? { x: body.x } : {})` (see the existing handlers).

### Services (`apps/server/src/services/`)

- Own anything that is a **process or provider boundary**: spawning the scheduler worker, fetching NWS weather, normalizing Garmin/calendar payloads, materializing recurrences.
- Services call repository methods and return domain objects. They never write SQL and never import `Database`.
- New behavior that just reads/writes rows usually needs **no service at all** — call the repository directly from the route (e.g. `GET /api/tasks`).

### Repositories (`packages/database/src/repositories/`)

- All SQL lives here. `TaskRepository` currently covers tasks, tags, time blocks, recurrence, schedule runs, weather, integrations, health observations. Add methods to it (or a new repository file exported from `src/index.ts`) rather than scattering SQL elsewhere.
- Map **every** row through the `rows.ts` coercers (`text`, `integer`, `boolean`, `nullableText`, `json`, `row`). SQLite returns loosely-typed values.
- SQLite JSON functions (`json_group_array`, `json_object`, recursive CTEs for ancestry) are already used in `taskSummarySql`/`listSchedulableTasks` — reuse that approach for new aggregate reads.
- Repositories enforce hard invariants (accepted-block immutability, tag/task cycle prevention, `end_at > start_at`).
- Timestamps are ISO strings via `now()` in the repository (`new Date().toISOString()`).

### Migrations (`packages/database/src/migrations/`)

- Add `NNN-short-name.ts` exporting `{ version, name, sql }` and register it in `migrations/index.ts`. Versions must increase and never change once applied to a real DB — **append, don't edit**.
- Migrations run inside `BEGIN IMMEDIATE` and are recorded in `schema_migrations`. Reserve-tag seed data goes in the migration, not in app code.
- Use `CHECK` constraints defensively (the schema already does for enums and cross-field rules).

## Shared contracts (`packages/shared/src/index.ts`)

- Enums are `as const` arrays + derived types (`kanbanStatuses` / `KanbanStatus`, etc.). Add new statuses in both the array and the DB `CHECK` constraint.
- When you touch a shared type, grep the repo for existing consumers before changing shapes (`task.name` `exactOptionalPropertyTypes` etc. — the typechecker across all 3 TS packages is your safety net).

## Frontend conventions (`apps/web`)

### Data fetching

- `api.ts` is the only fetch layer; it adds one method per endpoint, typed with shared contracts. The fallback `request()` helper already handles errors (`{ error }` body → thrown `Error` with the server message).
- Pages follow the polling pattern (v0 has no realtime transport; the single-owner instance polls its local API):

```tsx
async function load() {
  try {
    const [a, b] = await Promise.all([api.a(), api.b()]);
    setA(a); setB(b); setError(null);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
}
useEffect(() => {
  void load();
  const interval = window.setInterval(() => void load(), 5000); // choose the cadence per page
  return () => window.clearInterval(interval);
}, [deps]);
```

- Errors render in `<div className="error-banner">`. Actions that can fail should set the same error state instead of swallowing the rejection (see `TaskPage`'s `action()` helper).

### Pages vs components

- Pages own state, fetching, and navigation; components are presentational and receive props. `TaskPage.tsx` is the reference for readable page structure: small local components (`PlanningSection`, `TimeBlockSection`, `SubTaskLinks`) in the same file for pieces used once, shared `components/` files (`TaskCard`, `TagPicker`, `TagRow`) for pieces used by multiple pages.
- **Rule of thumb:** extract into a file only when a piece is used by 2+ places or genuinely large. A local component in the same file keeps context cheap.
- Keep JSX readable: format across multiple lines; never pile a whole tree onto one line. Dense single-line JSX was the #1 readability problem in this codebase.

### Styling

- Plain CSS in `apps/web/src/styles.css` only. System fonts, neutral borders, native-HTML feel. No CSS framework, no Tailwind, no CSS-in-JS. Add utility-ish classes there as the design needs them; the existing naming (`detail-`, `calendar-`, `task-card-`) is the convention.

## Scheduling worker (`workers/cp-sat/scheduler.py`)

- **Two solvers, one protocol.** `config.solver` selects them and `modelVersion` records the choice
  on every stored run. `greedy` (`greedy-v1`, in `schedulerlib/greedy.py`) is the **production
  default**: priority-ordered construction + relocate/insert/2-opt-swap/eject local search. It is
  deterministic (bounded by restarts/iterations, not wall clock), sub-second, and models a
  splittable task as k **independent** units so partially-finished work still gets scheduled.
  `cp-sat` (`cp-sat-v8`, in `schedulerlib/cp_sat.py`) is optional. `schedulerlib/solve.py` only
  parses the payload (`_prepare`), dispatches on `config.solver`, and shapes the output; both
  solvers expose `solve(ctx) -> (placement, status, objective)`. A third scheduler is one module
  plus one branch there — do not merge solver code back into `solve.py`.
  `benchmark/REPORT.md` has the measured trade-off: greedy is ~46x faster and never returns an
  empty week; CP-SAT scores 30-120 more style points on a typical week, median +65 (it packs
  preferences like "outings at 5pm" better). Don't rewrite one to imitate the other without
  re-running that harness.

- Protocol (both solvers): `ScheduleService.generate()` sends `{ now, horizonDays, config, tasks, timeBlocks, weather, rules }` as JSON on stdin; worker prints one JSON object on stdout. The worker is a **pure function** (it uses the payload's `now`, never its own clock) and reports its own `modelVersion` (`greedy-v1` / `cp-sat-v8`); `createScheduleRun` stores that value — **bump it when the problem/solution shape changes**.
- CP-SAT model: 30-minute slots over `config.dayStart`–`dayEnd` (00:00–24:00 default, full day) in `config.timeZone`, for `horizonDays`; runs may cross midnight. Accepted/completed blocks are busy, as are human-placed (`manual`) blocks even while still `proposed` (a manual block is a commitment; a solver proposal is ephemeral). Work is placed as **optional intervals**, not one boolean per slot: a non-splittable task is a single interval, a splittable task is that many 30-minute unit intervals (splitting is free — `min/maxChunkMinutes` are ignored), and one `NoOverlap` keeps every interval and fixed commitment apart. Rules compile into eligible start domains (hard) and a single weighted objective (soft) whose decision term is scaled above the soft total so a preference never drops a task; effects also cover per-day occurrence budgets (`dailyBudget`), hard per-day occurrence caps (`perDayLimit`), graded day preferences (`assignDays` soft), graded weather (`weatherGate`, per placement against `weather[]`, coefficients in hundredths because the score is fractional), distinct-day spreading (`spread`), and prerequisite max-gaps (`withinAfter`). Effects may carry a placement-scoped `when.dayOfWeek`. `preferEarlier` is not an objective term: after solving, a greedy compaction pass pulls blocks earlier while preserving hard eligibility, soft windows, graded weather and day scores, spread/budget days, dependencies, and `withinAfter`. `minimizeChunks` is dropped. `cp_model_presolve = False` because the domain encoding makes CP-SAT presolve slow and can burn the budget before the first incumbent (see `workers/cp-sat/README.md`).
- Errors: print `{"error": "..."}` and `exit 1`; `ScheduleService` converts that to a thrown `Error`.
- Never import SQLite or the TS packages in the worker.

## Hard guardrails — do not

- **Do not** add ORMs, query builders, state-management libraries, or react-query. Raw `node:sqlite` + `rows.ts` and fetch + polling are deliberate choices for a small single-owner app.
- **Do not** draft new abstraction layers, generic base classes, or "service interfaces" to make this "more scalable". Scale = extending these exact patterns. (If you genuinely need a second work-item model or a realtime transport, that is a product-level decision — flag it, don't silently build around it.)
- **Do not** write SQL outside repositories, or spawn processes / fetch external providers inside repositories.
- **Do not** let the web app or Python worker write SQLite.
- **Do not** store raw provider payloads.
- **Do not** break accepted-block status immutability (moving its window is allowed), tag/task cycle checks, or idempotent external mappings.
- **Do not** duplicate shared types in apps — import from `@mind-palace/shared`.
- **Do not** migrate an existing installed DB by editing an applied migration — append a new one.
- **Do not** add authentication or expose the server beyond localhost/Tailscale; v0 is single-owner by design.

## Common feature blueprints

**New API endpoint** (front to back):
1. Add / extend the input & response types in `packages/shared/src/index.ts`.
2. Add the SQL + method to the right repository (or new repository file exported from `src/index.ts`).
3. Add a service method only if it orchestrates a process/provider; otherwise call the repository directly.
4. Add the route with validation in `apps/server/src/http/app.ts`.
5. Add the typed method in `apps/web/src/api.ts`.
6. Call it from a page/component; render errors in the banner.
7. `pnpm typecheck`, then `pnpm dev` and exercise it end-to-end.

**New table or column**:
1. Append `NNN-*.ts` migration (checklists, seed rows, `CHECK` constraints) and register it in `migrations/index.ts`.
2. Update row mapping (rows.ts coercers) + repository methods.
3. Expose via shared types if the API returns it.
4. Run `pnpm db:migrate` against a **fresh** DB to prove the migration chain works.

**New tag-driven behavior** (this is how features are added without new models):
1. Add a stable `mind-palace:<name>` public ID to `reservedTagIds` in the task repository and insert the tag row in a migration.
2. Implement the behavior in a service (or route+repository for simple reads).
3. Surface it in the UI (tag row already renders on cards; add actions where needed).

**New integration** (calendar/garmin pattern):
1. Normalize the provider payload into the existing import shapes in `calendar-import-service.ts`.
2. Use `ensureIntegrationAccount` + `findMappedTask`/`mapExternalTask` for idempotency.
3. Persist only normalized data; keep provider-specific OAuth/polling outside the domain model.
4. **Enablement is authentication, not a config flag.** A provider is `connected` once its credential/token store exists on disk (checked cheaply in the service, e.g. `GarminService.tokenStorePath`); register it in the composition-root `integrationRegistry` so `GET /api/integrations` reports it and the UI can gate on `connected`. Do not add env toggles or a config table for on/off. (The calendar import path has no credential store, so it is intentionally not a registered provider.)

**New frontend page**:
1. Page component in `apps/web/src/` following the `TaskPage.tsx` structure (state → load/poll → sections).
2. Add the route to `App.tsx`; add any new `api.ts` methods.
3. Add classes to `styles.css`; keep the native-HTML aesthetic.

## Verification checklist (before you finish)

```sh
pnpm typecheck          # all 3 TS packages must pass
pnpm --filter @mind-palace/web build   # production UI build
pnpm db:migrate         # against a fresh DB if you touched migrations
pnpm dev                # manual smoke test of the changed flows
```

There is no test harness yet — that is deliberate for v0. To keep future tests possible, put complex logic in small pure functions (`TagPicker.fuzzyScore`, the date helpers in `SchedulePage`, the time-window math in services) instead of burying it inside JSX or SQL.