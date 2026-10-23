# Two-way Google Calendar sync — design plan

Status: approved. Scope locked to **commitments only** (§1 D1 = option A): the set of events
mirrored is exactly the set of `calendar_event` tasks, and both sides can create, edit, and
delete.

## 0. What already exists (and what we extend, not replace)

| Piece | Where | Role in this feature |
|---|---|---|
| `integration_accounts` (`kind` already allows `google_calendar`) | `packages/database/src/migrations/001-initial.ts:119` | One row per provider: `status`, `sync_cursor` (Google `syncToken`), `last_synced_at`, `last_error`, `config_json` |
| `external_task_mappings` (`integration_account_id`, `external_id`, `task_id`, `external_updated_at`) | `001-initial.ts:133` | Idempotent task ↔ Google event id mapping. Already used by `findMappedTask` / `mapExternalTask` (`task-repository.ts:1205-1223`) |
| `CalendarImportService.importCalendar(accountId, events)` | `apps/server/src/services/calendar-import-service.ts:17` | Normalized-event → `calendar_event` task + accepted `calendar`-source block. **Reuse its shape; make it Google-aware.** |
| `TaskRepository.upsertCalendarTimeBlock(taskId, startAt, endAt)` | `task-repository.ts:720` | One `calendar`-source block per task, updated in place. The task's `duration_minutes_remaining` stays 0 (`adjustRemainingMinutes` early-returns for `calendar_event` tasks, `task-repository.ts:700`). |
| `TimeBlock` with `type: "calendar_event"` + `source` enum (`manual`/`solver`/`calendar`/`recurrence`) | `packages/shared/src/index.ts:121` | `source: "calendar"` already means "owned by an external calendar" — that is our push-safety marker |
| `IntegrationRegistration` + `GET /api/integrations` | `apps/server/src/http/app.ts:41-46, 262` | Add `google-calendar` here; the UI already gates on `connected` (see `SchedulePage.tsx:307-346`) |
| `JobScheduler` + `apps/server/src/jobs.ts` | `apps/server/src/services/job-scheduler.ts`, `apps/server/src/jobs.ts` | The sync cadence goes here — no crontab, no config table |
| `runPythonWorker` | `apps/server/src/services/worker.ts` | Not needed: Google Calendar is plain HTTPS; keep it in TypeScript like `weather-service.ts` |
| `GarminService.tokenStorePath()` | `apps/server/src/services/garmin-service.ts:56` | The "enabled by authentication" pattern we copy verbatim |

Hard constraints from `AGENTS.md` that this design obeys:
- No new work-item model. An imported event **is** a `calendar_event` task with one `calendar`-source block.
- No config table / env toggle for on/off — a token file existing on disk is the switch.
- No new dependencies (OAuth is two `fetch` calls: refresh-token grant + Calendar REST).
- Raw provider payloads (event JSON) are never stored; only normalized fields + `etag`/`updated`.
- Accepted blocks stay immutable (`accepted → completed|missed`). Moving a synced calendar window is a **repository-level** upsert path, same as today's `upsertCalendarTimeBlock`.

## 1. Decisions to confirm before coding

**D1 — write-back scope: RESOLVED = option A, commitments only.**

Owner said (m00070): "i want to be able to see mind palace 'calendar_event' Tasks in Google
Calendar, be able to edit the calendar events in either place and have the other place reflect
the changes (so this includes creating a new event on google calendar and having it reflect
inside mind palace)."

So the mirrored set is **exactly the `calendar_event` tasks** — one Google event per
`calendar_event` task, and every event in the configured Google calendar is a `calendar_event`
task. No accepted work blocks are pushed (that was option B; explicitly out of scope, and the
data model keeps it cheap to add later via an `external_block_mappings` table).

Direction-by-direction, concrete:

| Change | Where | Result |
|---|---|---|
| New event in Google | Google | New `calendar_event` task + accepted `calendar` block |
| Edit title/time/description in Google | Google | Task title/description + block window updated |
| Delete event in Google | Google | Mapped task `cancelled` (task kept so the id is never re-imported) |
| New `calendar_event` task in MP | MP (Quick capture) | Event created in Google |
| Edit title/description/time in MP | MP (task editor / calendar drag) | Event patched in Google |
| Delete/cancel a `calendar_event` task in MP | MP | Event deleted in Google |

**D2 — pull window.** `now - 1 day` … `now + 30 days` (`config_json.windowDays`), plus
`singleEvents=true` so recurring events arrive as instances. Re-import on window rollover is
idempotent because the mapping is keyed on event id.

**D3 — all-day events.** Default: **skip** (`config_json.importAllDay: false`). Birthdays and
holidays are not commitments worth blocking a day for. Config is read at sync time, so this can
be flipped without a code change.

**D4 — deletes.** Google delete → cancel the mapped task (see D1 table). MP delete → delete the
Google event. Because a `calendar_event` task's only block is its commitment, cancelling the
task (`kanban_status = 'cancelled'`) is the MP-side delete; the UI labels it "cancels the Google
Calendar event".

**D5 — conflicts.** Last-writer-wins on Google `updated` vs the mapping's `last_pushed_at`, no
conflict UI in v0. Rule: on pull, apply the Google event unless it is *older* than the last local
push (`event.updated <= mapping.last_pushed_at`), which is exactly the self-echo case. On push,
rewrite whenever Google's side differs from the local task, which self-heals any dropped push.

## 2. High-level architecture

```
                    ┌──────────────────────────── apps/server ────────────────────────────┐
 Google Calendar    │                                                                     │
 REST v3  ──────────┤ GoogleCalendarService  (auth, incremental pull, diff, push)         │
 (fetch)            │        │                          │                                  │
                    │        │ normalized events        │ desired-vs-actual diff           │
                    │        ▼                          ▼                                  │
                    │ CalendarImportService  ─────►  TaskRepository  ─────► SQLite         │
                    │ (event → calendar_event task)   (all SQL: mappings, blocks)          │
                    │        ▲                          │                                  │
                    │        │ hooks from routes         │ GET /api/integrations            │
                    └────────┼──────────────────────────┼──────────────────────────────────┘
                             │                          ▼
                 Hono routes (accept/move/delete   apps/web (connect button,
                 a block) call CalendarSyncService  sync status; calendar already
                 .queuePush(blockId) after commit   renders calendar_event blocks)
```

Three moving pieces:

0. **The mirrored set is `calendar_event` tasks.** One task ⇄ one Google event, keyed by
   `external_task_mappings`. A task with the reserved tag but no block is skipped (nothing to
   mirror until it has a window).

1. **Pull (Google is authoritative, read every reconcile).**
   `events.list` with the stored `syncToken` (first run: `timeMin/timeMax`) → for each event:
   - mapped and not `cancelled` → update title/description/window if `event.updated` is newer than `external_updated_at`
   - mapped and `cancelled` → cancel the task (D4)
   - unmapped (and `status === "confirmed"`, not all-day per D3) → create `calendar_event` task + accepted `calendar` block + mapping
   - store the returned `nextSyncToken`; on `410 Gone` clear the cursor and do a full window walk.

2. **Push (MP edits of a commitment go back).** Reconciliation, not event streaming — that is
   what makes a failed push self-heal. Desired set = the `calendar_event` tasks in the window,
   each with its block window. For each:
   - mapped → `events.patch` when title, description, or window differ
   - **unmapped** → `events.insert` (this is how a task created in MP appears in Google)
   - mapped but the task is `cancelled`/`archived` or the block is gone → `events.delete`
     (ignore `410`/`404` — already gone)
   - Events we insert carry `extendedProperties.private.mindPalaceTaskId` for debuggability and
     so the pull can recognise its own write even if a mapping row is lost.
   - Every push writes the mapping's `external_updated_at` **and** `last_pushed_at`, which is what
     suppresses the pull bouncing our own change back.

3. **Nothing new writes SQL.** `GoogleCalendarService` calls `TaskRepository` methods; the only
   new SQL is a handful of repository methods (§4).

Loop-safety rule: pull applies a Google event only when it is newer than our last push for that
mapping. Combined with reconciliation-on-push, a dropped or failed push is repaired on the next
tick instead of being lost.

## 3. Enablement & auth

Mirror the Garmin pattern exactly: *connected iff a credential file exists*. No env flag, no DB
row needed to enable — deleting the token file disconnects and the app behaves as if the
integration did not exist.

- **Credential store:** `~/.config/mind-palace/google-calendar.json` (override
  `GOOGLE_CALENDAR_TOKEN_STORE`) containing
  `{ refreshToken, accessToken?, expiresAt?, calendarId, calendarSummary?, accountEmail? }`.
  Client id/secret come from `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET`, or a
  sibling `google-oauth-client.json` (`{ installed: { client_id, client_secret } }`, the file
  Google's console hands you) for the one-time consent.
- **One-time connect flow** (installed-app loopback redirect):
  - `POST /api/integrations/google-calendar/auth-url` → consent URL with
    `redirect_uri=http://127.0.0.1:4310/api/integrations/google-calendar/callback`,
    `access_type=offline`, `prompt=consent`, scope `.../auth/calendar.events` (read/write events
    only — not full calendar management).
  - `GET …/callback` exchanges the code, resolves the primary calendar via `calendarList`
    (`primary: true`), writes the token file (mode 0600), then 302s to
    `/schedule?calendar=connected`.
- `GoogleCalendarService.isConnected()` = token file exists (a cheap `existsSync`, no network) —
  same contract as `GarminService.tokenStorePath()` (`garmin-service.ts:56`).
- Access tokens are refreshed in memory; a `401` clears `accessToken` and retries once through the
  refresh-token grant. A revoked/expired refresh token marks the account `error` with a
  "reconnect" message instead of throwing on every tick.
- `integrationRegistry` gains `{ key: "google-calendar", label: "Google Calendar", status: () =>
  calendarSync.status() }` so `GET /api/integrations` and the existing UI gate (`connected`) work
  unchanged.

**Which calendar is mirrored:** exactly one — `config_json.calendarId`, defaulting to the
account's primary calendar. The events that exist there are the commitment calendar; we do not
create a second "Mind Palace" calendar (that was option B, out of scope). Because the integration
is single-owner and the mirrored set is `calendar_event` tasks, an event landing in that calendar
by any means (phone, web, another app) becomes a commitment task on the next pull — which is what
"creating a new event on Google Calendar reflects inside Mind Palace" requires.

## 4. Data model changes (migration `014-google-calendar-sync.ts`)

Append-only, per the guardrails. Commitments-only means **no new table** — the existing
`external_task_mappings` row *is* the one-to-one link between a `calendar_event` task and its
Google event.

```sql
-- When we last wrote this mapping to Google. Distinguishes "we changed it" (suppress the pull)
-- from "Google changed it" (apply it). Null = never pushed by us, e.g. an imported event.
ALTER TABLE external_task_mappings ADD COLUMN last_pushed_at TEXT;

-- The Google event's own `updated` timestamp as last observed, so the push can skip a patch
-- when nothing moved on either side.
ALTER TABLE external_task_mappings ADD COLUMN external_etag TEXT;
```

`integration_accounts.config_json` holds `{ calendarId, calendarSummary, timeZone, importAllDay,
windowDays }`, and the existing `sync_cursor` column holds Google's `nextSyncToken`. Both columns
already exist, so settings cost no schema.

New repository methods (`packages/database/src/repositories/task-repository.ts`, all rows mapped
through `rows.ts`):

```ts
// integration_accounts / cursor
ensureCalendarAccount(): number                       // kind 'google_calendar', external_account_id 'default'
getCalendarStatus(): IntegrationStatus & { syncCursor: string | null; config: JsonObject }
markCalendarSynced(error: string | null): void
saveCalendarSyncCursor(cursor: string | null, config?: JsonObject): void

// mappings (task ⇄ event)
findTaskMapping(accountId: number, externalId: string): TaskMapping | null   // taskId + timestamps
findMappingForTask(accountId: number, taskId: number): TaskMapping | null
touchMappingPushed(accountId: number, externalId: string, externalUpdatedAt: string | null): void
deleteTaskMapping(accountId: number, externalId: string): void

// the mirrored set: every calendar_event task with its single calendar block + mapping
listCalendarEventTasks(): CalendarEventTask[]
// → { id, title, description, kanbanStatus, lifecycleStatus, blockId, startAt, endAt,
//     externalId, externalUpdatedAt, lastPushedAt }

// sync-owned writes
upsertCalendarTimeBlock(taskId, startAt, endAt)            // exists; reuse
updateCalendarEventTask(taskId, { title?, description? })  // does NOT bump updated_at-driven sync
setTaskLifecycle / updateTask(kanbanStatus: 'cancelled')   // exists; reuse
```

`updateCalendarEventTask` exists because `updateTask` is the *user* path and must not be the
thing the sync calls (it would be indistinguishable from a local edit). It writes title and
description only.

The `calendar_event` task's block is found the same way `upsertCalendarTimeBlock` finds it
(`source = 'calendar'`), preserving the existing one-block-per-commitment invariant and the
accepted-block immutability rule (`task-repository.ts:746-751` is untouched).

## 5. Service shape

`apps/server/src/services/google-calendar-service.ts` (two classes, one file, no interfaces):

```ts
/** Provider transport: token store, refresh, and the three REST calls we need. */
class GoogleCalendarClient {
  constructor(private readonly accountId: number, private readonly tasks: TaskRepository) {}
  isConnected(): boolean
  status(): IntegrationConnection
  authUrl(): string
  async completeAuth(code: string): Promise<void>
  async listEvents(from: string, to: string, syncToken: string | null): Promise<{ events: NormalizedEvent[]; nextSyncToken: string }>
  async insertEvent(input: DesiredEvent): Promise<{ id: string; updated: string }>
  async patchEvent(id: string, input: DesiredEvent): Promise<{ updated: string }>
  async deleteEvent(id: string): Promise<void>
}

/** Orchestration: pull → import, then diff → push. */
export class GoogleCalendarService {
  constructor(private readonly tasks: TaskRepository, private readonly calendar: CalendarImportService) {}
  inFlight: Promise<CalendarSyncResult> | null   // de-dupe like WeatherService.ensureFresh
  status(): IntegrationConnection
  async sync(): Promise<CalendarSyncResult>      // pull then reconcilePush
}
```

`apps/server/src/services/calendar-import-service.ts` becomes the **normalizer**, extended with:

```ts
export interface CalendarImportEvent {
  id: string; title: string; description?: string;
  startAt: string; endAt: string;
  updatedAt?: string; etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  allDay?: boolean;
}
```
plus `importCalendarEvent(accountId, event)` (single-event upsert; `status: cancelled` → cancel
the mapped task) and an exported `desiredEvent(task, block)` helper used by the push side.
`importCalendar(accountId, events[])` stays as the thin loop it is today.

`CalendarSyncResult` (shared): `{ pulled: number; pushed: number; deleted: number; skipped:
number; syncedAt: string }`.

Hooks (inside existing routes, one line each, after the DB write commits) — each calls
`calendarSync.queuePush()` (a debounced fire-and-forget `sync()`), **not** an outbox table, since
reconciliation recomputes desired state from SQLite and repairs a dropped push on the next tick:
- `POST/PATCH/DELETE /api/time-blocks/*` when the task is a `calendar_event` task (move/delete)
- `PATCH /api/tasks/:id` when a `calendar_event` task's title/description/kanban changes
- `POST /api/tasks` when the new task carries the `calendar_event` tag

## 6. Routes (`apps/server/src/http/app.ts`)

```
GET    /api/integrations/google-calendar/status      -> IntegrationConnection & { syncCursor }
POST   /api/integrations/google-calendar/auth-url    -> { url }
GET    /api/integrations/google-calendar/callback    -> 302 to /schedule?calendar=connected
POST   /api/integrations/google-calendar/sync        -> CalendarSyncResult
POST   /api/integrations/google-calendar/disconnect  -> deletes the token file (keeps tasks)
```

`GET /api/integrations` picks the provider up through the registry — no route change there.

## 7. Job + UI

- `apps/server/src/jobs.ts`: `{ name: "google-calendar-sync", schedule: { kind: "interval",
  everyMs: 5 * 60_000 }, runOnStart: true, run: async () => { if (calendarSync.status().connected)
  await calendarSync.sync(); } }`. Five minutes is cheap: an incremental `events.list` with an
  unchanged `syncToken` is one request returning zero items.
- `apps/web/src/api.ts`: `googleCalendarStatus / googleCalendarAuthUrl / googleCalendarSync /
  googleCalendarDisconnect`.
- `apps/web/src/SchedulePage.tsx`: extend the existing integration gate (`SchedulePage.tsx:307-346`)
  — a **Connect Google Calendar** button when disconnected (opens `authUrl`), a **Sync** chip +
  `Synced …` / error text when connected (mirrors the Garmin chip at `SchedulePage.tsx:647-656`).
- `apps/web/src/TimeBlockPage.tsx` / `TaskPage.tsx`: for a `calendar`-source block show "managed
  by Google Calendar"; on a cancelled `calendar_event` task say "cancelled the Google Calendar
  event too" so D4's MP-side delete is not a surprise.
- **Moving a commitment in MP**: imported blocks currently render `fixed` and undraggable
  (`SchedulePage.tsx:831`). When the integration is connected, allow dragging them; the PATCH
  path pushes the new window and `last_pushed_at` stops the pull fighting it. When disconnected,
  they stay fixed as they are today.

## 8. Step-by-step implementation

**Status: steps 1–6 are implemented** (see §10 for the as-built map). The steps are kept here as
the rationale and as the checklist for extending the integration to a second calendar or provider.

Each step ends green (`pnpm typecheck`) and is independently shippable.

**Step 1 — schema + repository accessors.**
`014-google-calendar-sync.ts` (the two `external_task_mappings` columns) + register in
`migrations/index.ts`; the §4 repository methods; both mapping methods mapped through `rows.ts`.
Success: `DATABASE_PATH=/tmp/mp-test.db pnpm db:migrate` applies cleanly on a fresh DB and on a
copy of the real one; no behavior change elsewhere.

**Step 2 — client + auth, no sync.**
`GoogleCalendarClient` (token store, refresh grant, `calendarList` lookup, `listEvents`), the
three auth routes, `integrationRegistry` entry, connect button. Success: after consent,
`GET /api/integrations` reports `google-calendar` `connected: true`, and a `curl` of `listEvents`
returns events.

**Step 3 — pull only (read-only mirror).**
`sync()` = pull → `importCalendarEvent` per event; cursor persistence; `410 Gone` clears the
cursor and re-walks the window; `extendedProperties.private.mindPalaceTaskId` short-circuits to
the mapped task. Success: create / rename / move / delete an event in Google, hit
`POST …/sync`, see the `calendar_event` task and its block track it; deleting the event cancels
the task. No pushes yet, so nothing can bounce.

**Step 4 — push (MP → Google), the other half of 2-way.**
`desiredEvent(task, block)` + `reconcilePush` over `listCalendarEventTasks()`; insert for
unmapped `calendar_event` tasks, patch on title/description/window drift, delete for cancelled
tasks or lost blocks (tolerate 404/410). Write `last_pushed_at` + `external_updated_at` on every
push. Success: create a `calendar_event` task in Quick capture → event appears in Google within
one tick; rename/move it in MP → patched; cancel it → deleted. Then round-trip: rename in Google,
sync, rename in MP, sync again — no flicker over two consecutive syncs.

**Step 5 — post-write hooks + scheduling + UI.**
`jobs.ts` interval entry with `runOnStart`; debounced `queuePush()` on the task/time-block routes;
the `SchedulePage` connect/sync chip; "managed by Google Calendar" notes; drag-enable connected
commitments. Success: an MP edit lands in Google in ~1s without waiting for the tick, and the
5-minute tick alone also converges.

**Step 6 — docs + verification.**
`README.md`, `apps/server/README.md`, `apps/server/src/services/README.md`,
`docs/running-on-rpi.md` (auth steps, token-store location, how to disconnect). Then
`pnpm typecheck`, `pnpm --filter @mind-palace/web build`, fresh-DB migrate, and the manual matrix:
create / rename / move / delete in each direction, all-day (skipped), recurring instance, `410`
resync, expired access token, revoked refresh token, token file deleted mid-flight.

## 9. Risks and their mitigations

| Risk | Mitigation |
|---|---|
| Push/pull echo loop | `last_pushed_at` suppresses the pull for our own writes; `extendedProperties.private.mindPalaceTaskId` identifies our events even if a mapping row is lost |
| Two-sided edit the same minute | D5: newest Google `updated` vs newest local write wins; no conflict UI in v0 |
| Rate limits (403 `rateLimitExceeded`) | 5-minute interval + `syncToken` incremental reads (no-op read = one request); one retry with backoff; failures land in `integration_accounts.last_error`, visible in the UI chip |
| `syncToken` invalidation (`410 Gone`) | Clear the cursor, full `windowDays` walk, remap by event id (idempotent via `external_task_mappings`) |
| Accepted-block immutability | The sync reuses `upsertCalendarTimeBlock` (the existing sync-owned accessor) instead of loosening `setTimeBlockStatus` (`task-repository.ts:746-751`) |
| `timeMin` + `syncToken` rejected by the API | Never send them together: cursor path sends only `syncToken` + `singleEvents` |
| Google returns a huge recurring series | `singleEvents=true` + `timeMin/timeMax` window; each instance is its own task, matching the existing model |
| An all-day birthday blocks a whole day | D3: `importAllDay: false` by default |
| Deleting a commitment in MP surprises the user | D4: the UI labels the action explicitly ("cancels the Google Calendar event") |

## 10. As-built map

What landed, file by file. `pnpm typecheck` passes across all five packages, the web bundle builds,
and `scripts/google-calendar-smoke.ts` passes 24 assertions against a fresh DB with a stubbed client.

| Concern | File |
|---|---|
| Schema: `time_blocks` type existed already; `external_task_mappings` gained `last_pushed_at`, `external_etag`, `local_synced_at`, `external_deleted_at` | `packages/database/src/migrations/014-google-calendar-sync.ts` |
| Contracts: `CalendarSyncConfig`, `CalendarSyncResult`, `GoogleCalendarStatus`, `CalendarEventTask`, sync result fields | `packages/shared/src/index.ts` |
| Accessors: `calendarAccountId`, `ensureCalendarAccount`, `get/saveCalendarStatus`, `findTaskMapping`, `findMappingForTask`, `mapExternalTask`, `clearExternalMapping`, `listCalendarEventTasks`, `upsertCalendarTimeBlock`, `touchMappingSync` | `packages/database/src/repositories/task-repository.ts` |
| Normalizer (pure, no network) | `apps/server/src/services/calendar-import-service.ts` |
| Reconcile loop + `queuePush()` debounce | `apps/server/src/services/google-calendar-service.ts` |
| OAuth, token store, `listEvents`/`insertEvent`/`patchEvent`/`deleteEvent`, `410` cursor reset | `apps/server/src/services/google-calendar-client.ts` |
| Routes: status, auth-url, sync, disconnect, callback | `apps/server/src/http/app.ts` |
| Composition + integration registry entry | `apps/server/src/index.ts` |
| 5-minute safety-net tick | `apps/server/src/jobs.ts` |
| Debounced push after local writes (task create/update, block create/update/status/move) | `apps/server/src/http/app.ts` |
| Connect/sync/disconnect chip, OAuth return handling, drag-enable for connected commitments | `apps/web/src/SchedulePage.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css` |
| "Mirrored to Google Calendar" note on the block page | `apps/web/src/TimeBlockPage.tsx` |
| Offline smoke harness (24 assertions) | `apps/server/scripts/google-calendar-smoke.ts` |

### Behaviors verified by the harness

1. A new Google event becomes one `calendar_event` task with the reserved tag and a mirrored block.
2. Re-running with no remote change is a no-op (echo suppressed, zero pushes).
3. A newer remote event (title + window) updates the existing task and block in place.
4. A locally created commitment is inserted into Google and mapped.
5. A local rename is patched, not re-inserted.
6. Steady state makes no Google writes at all.
7. Cancelling a task deletes its event, clears the mapping, and stays quiet afterwards.
8. A remotely cancelled event cancels the mapped task and keeps the mapping (no re-import).
9. All-day events are skipped while `importAllDay` is false.

### Deliberate limits in v0

- One calendar (`primary`); a second calendar is another integration account + a `config_json`
  `calendarId`, and the mapping table already scopes by `integration_account_id`.
- No conflict UI: the newest `updated` wins per §1 D5.
- No recurring-event editing: each expanded instance is its own commitment (matching the task model).
- Attendance/`responseStatus`, attendees, and reminders are not mirrored.
- Title, description, and window sync; attendees, reminders, recurrence editing, and calendar
  colour do not.
- A `calendar_event` task that loses its block causes its event to be deleted by the orphan sweep
  (`google-calendar-service.ts` `listCalendarMappings` loop), so removing a block is the same
  destructive action as cancelling the commitment.
