# AGENTS.md

Operating guide for AI coding agents working in this repo. Read this before changing code. The goal: add features quickly by **extending the existing patterns** instead of inventing new ones. This repo is intentionally small; every abstraction layer you add is context a future agent has to hold in its head. Keep it that way.

## Repo layout (5-minute tour)

pnpm monorepo. Packages import each other as **TypeScript source** (`"exports": "./src/index.ts"`), so there is no package build step — changes take effect in dev immediately. `tsx` (server) and Vite (web) compile them.

| Path | Responsibility |
|---|---|
| `apps/server/src/index.ts` | Composition root: creates `Database` → `TaskRepository` → services → Hono app. New services get wired here. |
| `apps/server/src/http/app.ts` | All HTTP routes. Body validation/coercion + response shaping only. No business logic. |
| `apps/server/src/services/*.ts` | Process & provider boundaries (CP-SAT subprocess, NWS fetch, provider normalization, recurrence materialization). |
| `packages/database/src/` | `database.ts` (SQLite connection), `migrations/` (numbered schema history), `repositories/` (all SQL), `rows.ts` (row-coercion helpers). |
| `packages/shared/src/index.ts` | Single source of truth for API contracts: `TaskSummary`, `TaskDetail`, `CreateTaskInput`, `UpdateTaskInput`, status enums, etc. |
| `apps/web/src/api.ts` | The **only** place in the frontend that calls `fetch`. One typed method per endpoint. |
| `apps/web/src/*Page.tsx` | Route-level pages. Own data fetching, polling, and error display. |
| `apps/web/src/components/` | Presentational components. Receive data + callbacks via props; never fetch. |
| `workers/cp-sat/scheduler.py` | Python OR-Tools solver. JSON in on stdin, JSON out on stdout. Never touches SQLite. |

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
2. **One work-item model.** Everything schedulable is a `task`. There are no separate models for calendar items, routines, or health observations — behavior is added with **tags** (reserved tags `mind-palace:calendar-event`, `mind-palace:routine`) and child tasks, not new tables that duplicate task.
3. **Types live once.** Both ends import contracts from `@mind-palace/shared`. Never redefine an API shape in `apps/web` or `apps/server`.
4. **Layers are thin and concrete.** Route validates → service orchestrates → repository persists. No interfaces, no DI containers, no repository base classes. Plain classes and functions. If you catch yourself adding a layer, stop and look for the existing one that already does that job.

## Data model (what the tables mean)

- `tasks` — the unified work item: kanban column (`kanban_status`), lifecycle (`lifecycle_status`), priority + rank (rank is the drag-order tiebreaker), optional duration (a task with no estimate is never auto-scheduled), earliest/deadline/fixed windows, optional parent (hierarchy), `origin` (manual / calendar_import / recurrence).
- `tags`, `tag_parents`, `task_tags` — multi-parent acyclic tag graph ("derived" tags = ancestors) and direct task assignments. `tags.public_id` starting with `mind-palace:` marks **reserved** tags that carry behavior.
- `time_blocks`, `schedule_runs` — schedule results. Accepted blocks are **immutable** (repo enforces: accepted → only completed/missed). Schedule runs store the exact solver input/output JSON for reproducibility.
- `recurrence_rules`, `recurrence_occurrences` — routine templates and the child tasks they generated (one per date).
- `integration_accounts`, `external_task_mappings` — provider identity; mappings make calendar/garmin imports idempotent. Raw provider payloads are never stored.
- `health_observations` — normalized Garmin activity/sleep facts.
- `weather_forecasts` — 8-hour Boston forecast cache.

## Backend conventions

### Routes (`apps/server/src/http/app.ts`)

- Route handlers: read body → validate/coerce (helpers `requiredString`, `numberParam`) → call a service or repository method → return shaped JSON.
- Throw plain `Error` with a **user-facing message** — it is returned in the JSON body and rendered in the UI error banner. `onError` maps errors to 400; missing-row errors (message starts `Expected database row`) become 404.
- Keep validation in the route, business rules in services/repositories. Don't put domain logic next to `context.json(...)`.
- `exactOptionalPropertyTypes` is on: optional fields are either present or absent — build them with conditional spreads, e.g. `...(typeof body.x === "string" ? { x: body.x } : {})` (see the existing handlers).

### Services (`apps/server/src/services/`)

- Own anything that is a **process or provider boundary**: spawning the CP-SAT worker, fetching NWS weather, normalizing Garmin/calendar payloads, materializing recurrences.
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

## CP-SAT worker (`workers/cp-sat/scheduler.py`)

- Protocol: `ScheduleService.generate()` sends `{ tasks, timeBlocks, weather }` as JSON on stdin; worker prints one JSON object on stdout. Contract version tag: `model_version = 'cp-sat-v0'` in `createScheduleRun` — **bump it if you change the problem/solution shape**.
- Current model: 30-minute slots, 07:00–23:00, `America/New_York`, horizon = now → end of current week. Accepted/completed blocks and `calendar_event` fixed tasks are busy. Priority dominates the objective, rank breaks ties, splitting carries a context-switch penalty; `maxChunkMinutes` caps run length.
- Errors: print `{"error": "..."}` and `exit 1`; `ScheduleService` converts that to a thrown `Error`.
- Never import SQLite or the TS packages in the worker.

## Hard guardrails — do not

- **Do not** add ORMs, query builders, state-management libraries, or react-query. Raw `node:sqlite` + `rows.ts` and fetch + polling are deliberate choices for a small single-owner app.
- **Do not** draft new abstraction layers, generic base classes, or "service interfaces" to make this "more scalable". Scale = extending these exact patterns. (If you genuinely need a second work-item model or a realtime transport, that is a product-level decision — flag it, don't silently build around it.)
- **Do not** write SQL outside repositories, or spawn processes / fetch external providers inside repositories.
- **Do not** let the web app or Python worker write SQLite.
- **Do not** store raw provider payloads.
- **Do not** break accepted-block immutability, tag/task cycle checks, or idempotent external mappings.
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
1. Normalize the provider payload into the existing import shapes in `integration-service.ts`.
2. Use `ensureIntegrationAccount` + `findMappedTask`/`mapExternalTask` for idempotency.
3. Persist only normalized data; keep provider-specific OAuth/polling outside the domain model.

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