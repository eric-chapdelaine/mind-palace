# Mind Palace

An all-in-one task manager that does everything from a regular kanban board to automatically
scheduling when each task should get done.

Quick start:

```sh
pnpm install && uv sync --project workers/cp-sat
pnpm db:migrate && pnpm dev                     # → http://127.0.0.1:4311
```

## The idea

Four decisions shape everything else.

**Everything is a Task.** A chore, a project step, a dentist appointment, one morning's
"wake up". There is no calendar model, no routine model, no habit model to keep in sync.
Behaviour is added with tags and rules, not with new tables.

Recurrence is the single deliberate exception: a recurring routine is a *rule that tasks
should exist*, so it is stored as a template and its occurrences are ordinary tasks.

**Tags select; rules decide.** A tag is a label and nothing more. What a tag *means to the
calendar* lives in the rule set, which is editable data: "anything tagged `outing` needs a
warm, dry afternoon", "anything tagged `deep-work` prefers mornings". Adding a behaviour means
adding a rule, not just a tag.

**A plan is advice until you accept it.** Generated blocks are proposals: regenerating throws
them away and lays out a fresh week. The moment you accept a block, the solver has to plan
around it. A block you place by hand is a commitment too, even before you accept anything.

**Work decays.** A task still open a month after you wrote it leaves the board on its own, to
prevent buildup on a task list you will never get to — that distracts you from what you
actually need to do. Rescuing something from the archive buys it another two weeks. Decay is
per task, so a routine occurrence can vanish by 10am if you decide that's when it's obsolete.

## What using it looks like

1. **Capture.** Type a title on the dashboard. Add tags. Add an estimate (an unestimated task
   is never auto-scheduled).
2. **Generate.** On the schedule page, *Generate schedule* places every Ready or In-progress
   task that has time left into open half-hours over the next seven days.
3. **Correct.** Drag a proposal to a better hour. Drag a task from the sidebar into the grid to
   pin it there by hand. Or fix the thing that made the answer wrong: the estimate, the
   deadline, or a rule.
4. **Accept.** Accepted blocks survive the next generation. Unaccepted ones become next week's
   proposal.
5. **Work.** Get a briefing PDF of a given day or use the web app. Complete tasks as you go.
   Let the rest decay.

## How it is put together

```
React web app ─┐
Ink TUI ───────┴─→ Hono API ─→ services ─→ repositories ─→ SQLite (WAL)
                       │            │
                       │            ├─→ Python: scheduler · Garmin sync · print renderer
                       │            └─→ NWS + Open-Meteo: hourly Boston forecast
                       └─→ static build of the web app in production
```

Three rules hold the shape:

- **One writer.** The TypeScript server is the only thing that touches SQLite. Neither the
  browser nor the Python workers ever open the database; a worker gets JSON on stdin and
  answers on stdout, or it fails with `{"error": ...}`.
- **Thin layers.** A route validates and shapes; a service owns a process or provider
  boundary; a repository owns SQL. Nothing else.
- **Pure workers.** The scheduler is a function of its payload — it never reads the clock, so
  the same board plus the same `now` gives the same week. Every run stores the exact problem
  and solution it saw.

`packages/shared` holds the API contracts so the server, web app and TUI cannot drift apart.
Source is imported directly (no build step between packages), so an edit is live in dev.

### The scheduling model

- **Slots.** Half hours, 00:00–24:00 `America/New_York`, over the same seven-day horizon
  recurrence fills. A day can run past midnight.
- **Priority.** P0–P5, with a rank tiebreaker from the drag order. One weighted objective, no
  tiers: a soft preference can never drop a task, and a P0 is never traded for any number of
  P1s.
- **Splitting.** A splittable task is broken into independent half-hour units, so partial
  progress still gets real time on the calendar. A non-splittable one stays whole.
- **Rules.** Tags plus an `applies` condition select tasks; effects become either hard
  eligibility (`assignDays`, `timeWindow`, `weatherGate`, `withinAfter`) or weighted
  preferences (`preferTimeOfDay`, `spread`, `dailyBudget`). Seven weekday pins ship seeded,
  and all of them are ordinary editable rows.
- **Two solvers.** The default is a deterministic greedy constructor with relocate/insert/swap
  local search: sub-second, never returns an empty week, ~46× faster than the alternative. An
  OR-Tools CP-SAT model scores a little better on soft preferences when you switch
  `solver: "cp-sat"` in `SCHEDULER_CONFIG`. `workers/cp-sat/benchmark/REPORT.md` has the
  measured trade-off.

### Time blocks, decay, and the rest of the data model

- A **time block** is the unit of plan: `work` for time set aside, `calendar_event` for a fixed
  commitment. Its `source` (manual / solver / calendar / recurrence) and status (proposed /
  accepted / completed / missed / superseded) decide what regeneration may touch. Creating a
  block subtracts its minutes from the task's remaining estimate; deleting or superseding it
  hands them back.
- **`auto_archive_at`** is the decay instant — a month out by default, the recurrence's chosen
  hour for routine occurrences, `NULL` for never. A 23:30 sweep archives everything past it,
  except a task with time booked for it: hiding a task while its hour stayed reserved would
  leave the calendar holding work the board no longer shows.
- **Tags** are a multi-parent DAG with cycle prevention. "Goals" are tags of type `goal`; a
  task can be converted into one, and its subtasks become everything carrying that tag,
  directly or through a child tag.
- **Dependencies** are explicit prerequisite edges, not a parent column, and the scheduler
  honours them: a dependent cannot be placed before the thing that blocks it.
- **Recurrence** materialises occurrences across the scheduler's horizon, and never
  backfills. A Pi that was off for a week comes back to today's routine, not seven days of
  dead rows.
- **Health** rows (a night's sleep, a recorded activity) are normalised Garmin facts shown as
  context beside the schedule. Garmin refreshes the columns it owns; your title and notes are
  never overwritten.

### Background work

Recurring work lives in `apps/server/src/jobs.ts`, not in a crontab, so the schedule is
versioned with the repository. `GET /api/jobs` shows each job's next run and last result.

| Job | Local time | Does |
|---|---|---|
| `weather-refresh` | 00:00, 08:00, 16:00 | Refetch the Boston hourly forecast (NWS, plus UV from Open-Meteo) |
| `garmin-sync` | 11:00 | Pull new sleep and activities; no-ops until authenticated |
| `recurrence-materialize` | 00:15 | Create routine occurrences out to the scheduler's horizon |
| `task-auto-archive` | 23:30 | Archive tasks whose decay instant has passed |

Jobs must be idempotent and cheap when there is nothing to do, because a restart can fire them
(`runOnStart`) and a late tick must not skip the next one.

## The surfaces

**Dashboard** (`/`) is the kanban: Inbox / Ready / In progress / Waiting, drag to reorder or
move between columns, fuzzy tag filters (include is a whitelist, exclude wins — remembered in
a cookie), quick capture, the tag hierarchy, drawers for completed and archived work, and
multi-select "what is blocking this?" for dependencies.

**Schedule** (`/schedule`) is the week: seven days of half-hours, each header showing that
day's high and peak rain chance, with sleep and workout overlays when Garmin is connected.
*Generate schedule* fills it and *Accept all* commits the whole week at once; blocks can be
dragged to a new hour whether they are still proposals or already accepted (an accepted block
keeps its status, it just moves); tasks can be dragged in from the sidebar to place them by
hand; the tasks that did not fit are listed with the solver's reason, and a running
`Placed n/m · style s` line says how much of the week the solver could use.

**Task** (`/tasks/:id`) is one task in full: priority, remaining estimate and whether it can
split, earliest start, deadline, decay date, Markdown description, tags, dependencies, blocks,
and *Accept schedule*.

**Tags** (`/tags`) is the tag graph — nest, rename, describe in Markdown, archive — and a tag
page lists every task that carries it, including through a child tag.

**Recurrence** (`/recurrence`) authors routines as rules: daily or every N days/weeks, chosen
weekdays, and the duration, priority, tags and decay hour each occurrence inherits.

**Rules** (`/rules`) edits the scheduling rules: add, retune the weight, toggle off.

**Print** (`/api/briefing`) is one page: today's weather graph, today's schedule, the tasks
worth doing today, the week ahead. Use `?format=html` to look at it and `?date=` for another
day; the payload behind it is at `/api/briefing/payload`.

**Health** (`/health_observation/:id`, `/health_activity/:id`) shows one night or one workout,
read-only, with your own notes — and a title of your own for an activity.

**TUI** (`pnpm tui`) is the same board in a tmux pane: move, complete, reorder, filter, edit a
description in `$EDITOR`. It speaks the same HTTP API and nothing else.

The printed page is not a screenshot of the app. It is a list of sections in the payload, and
leaving out two of them (the board snapshot, and a needs-attention list that folds into the
week column) is what keeps it to a single sheet. A second medium later — receipt, e-ink — is a
different list, not a second renderer.

## Repository layout

| Path | Responsibility |
|---|---|
| `apps/server` | Hono API, composition root, services, background jobs |
| `apps/web` | React app: every page except print and the TUI |
| `apps/tui` | Ink terminal dashboard |
| `packages/database` | SQLite connection, numbered migrations, all SQL |
| `packages/shared` | API contracts every TypeScript package imports |
| `workers/cp-sat` | Scheduler (greedy + optional CP-SAT), tests, benchmark |
| `workers/garmin` | Garmin Connect sync (sleep + activities) |
| `workers/briefing` | Print/PDF renderer (WeasyPrint) |

Each directory has its own README with the detail. `AGENTS.md` holds the architectural rules
these directories are held to; read it before changing code.

## Getting set up

Needs Node 24+ (the server uses `node:sqlite`), pnpm 10 (pinned to 10.15.1), Python 3.11+ and
[`uv`](https://docs.astral.sh/uv/).

```sh
pnpm install
uv sync --project workers/cp-sat       # the scheduler: required
pnpm db:migrate                        # creates data/mind-palace.db
pnpm dev                               # API :4310, web :4311
```

Optional, depending on which surfaces you want:

```sh
uv sync --project workers/garmin       # Garmin sleep/activity sync
uv sync --project workers/briefing     # print/PDF (also needs pango + harfbuzz)
pnpm tui                               # terminal dashboard, with the server running
```

Garmin has no enable flag: the token store *is* the switch. Authenticate once, and
`GET /api/integrations` starts reporting it connected, which is what makes the UI show the
sync button and the health overlays.

```sh
uv run --project workers/garmin python -c \
  "import garth; garth.login(); garth.save('$HOME/.garminconnect')"
```

Delete that file to turn the integration off again.

## Configuration

Everything comes from the environment. There is no dotenv and no config file for the server.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `data/mind-palace.db` | SQLite file; migrations run on boot |
| `HOST` | `127.0.0.1` | Bind address; a Tailscale interface works well |
| `PORT` | `4310` | API port, and the production UI |
| `GARMINTOKENSTORE` | `~/.garminconnect`, then `~/.garth` | Garmin credential store |
| `MP_API_URL` | `http://127.0.0.1:4310` | TUI only: which server to talk to |
| `MP_TUI_CONFIG` | `~/.config/mind-palace/tui.json` | TUI only: local filter and tag order |

There is no login, deliberately. This is a single-owner instance: bind it to localhost or a
private network, never to the open internet.

## Working on it

```sh
pnpm typecheck                          # every TypeScript package
pnpm --filter @mind-palace/web build    # production UI build
pnpm test:worker                        # scheduler tests (Python)
pnpm db:migrate                         # against a fresh DB after a migration
pnpm dev                                # then click through the flow you changed
```

Application code has no test harness — a deliberate trade for something this size. Isolated
logic is kept in small pure functions instead (fuzzy tag matching, date math, rule
compilation), and the scheduler, where a wrong answer is silently wrong, keeps a real suite.

## Running it for real

`pnpm build && pnpm start` serves the built frontend from the same process on `:4310`.

The full deployment guide is `docs/running-on-rpi.md`: systemd unit, building the bundle on a
dev machine and rsyncing it to the Pi, daily backups, the day-two update flow, Garmin under
systemd, and a troubleshooting section. Read it before putting this on a machine you care
about.

## Known limits

- **One person, one machine.** No accounts, no permissions, no sync. Sharing means exposing
  one server on a LAN or tailnet, and everyone sees the same board.
- **Polling, not push.** The pages that refresh themselves do it on a 2–30s interval; the
  schedule page only reloads when something changes it. There is no websocket, so two open
  views converge on their next poll rather than immediately.
- **One place, one clock.** `America/New_York` and Boston weather are compiled in
  (`apps/server/src/services/clock.ts`). Travel does not move the calendar.
- **The calendar is import-only.** You POST normalised events; nothing polls Google, and edits
  made there do not come back.
- **Solver runs are kept forever.** The intended 90-day prune is still a TODO, so the database
  grows by one full problem/solution pair per generation.
