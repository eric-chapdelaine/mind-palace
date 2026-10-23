# Server

The Hono server is the single-owner control plane and sole SQLite writer. It hosts the built React application, invokes the scheduling worker, and normalizes integration data.

## Main API

- `GET/POST /api/tasks`, `PATCH /api/tasks/:id`: task capture and editing.
- `GET/POST /api/tags`, `POST /api/tags/:id/parents`: tag DAG management.
- `GET /api/schedule`, `POST /api/schedule/generate`: inspect or optimize the week.
- `POST /api/tasks/:id/accept-schedule`: accept every proposed block for one task.
- `POST /api/time-blocks`, `POST /api/time-blocks/:id/status`: manual block lifecycle.
- `POST /api/tasks/:id/recurrence`, `POST /api/recurrences/materialize`: recurring template support.
- `GET /api/weather`, `POST /api/weather/refresh`: cached Boston forecast.
- `GET /api/jobs`: background job scheduler status.
- `POST /api/integrations/calendar/import`: normalized Google Calendar event import (manual/legacy push endpoint; the live integration is the two-way sync below).
- `GET /api/integrations/google-calendar/status`, `POST .../auth-url`, `POST .../sync`, `POST .../disconnect`, `GET .../callback`: Google Calendar OAuth + reconcile.
- `POST /api/integrations/garmin/import`, `GET /api/health-observations`: plan-versus-actual health data.
- `POST /api/tasks/:id/lifecycle`: lifecycle transitions such as `archived`.

## Provider Import Shapes

Calendar import:

```json
{
  "accountId": "primary",
  "events": [{
    "id": "provider-event-id",
    "title": "Doctor appointment",
    "startAt": "2026-09-11T14:00:00Z",
    "endAt": "2026-09-11T15:00:00Z",
    "updatedAt": "2026-09-10T12:00:00Z"
  }]
}
```

Garmin import:

```json
{
  "observations": [{
    "kind": "activity",
    "startAt": "2026-09-10T11:00:00Z",
    "endAt": "2026-09-10T12:00:00Z",
    "externalId": "garmin-activity-id",
    "details": { "activityType": "strength_training" }
  }]
}
```

Provider-specific clients should produce these normalized shapes. Do not pass raw provider payloads into repositories.

## Google Calendar sync

`services/google-calendar-service.ts` owns the reconcile loop; `services/google-calendar-client.ts` owns
the Google HTTP/OAuth boundary and the token store. One `calendar_event` task ⇄ one event.

- **Pull first, then push.** Google is authoritative for commitments that originated there; the
  push is computed from SQLite on every pass, so a dropped push self-heals on the next tick.
- **Echo suppression.** A pull skips an event whose `updated` is not newer than the mapping's
  `last_pushed_at`; a push skips an event whose local edit is not newer than `local_synced_at`.
  Both watermarks are written after each successful write.
- **Tombstones.** A cancelled event cancels the mapped task and keeps the mapping so the event is
  never re-imported. Cancelling a task deletes its event and clears the mapping.
- **Adoption.** An unmapped event carrying `extendedProperties.private.mindPalaceTaskId` is adopted
  instead of duplicated, so losing a mapping row cannot fork a commitment.
- **All-day events are skipped** by default (`importAllDay: false`); set it in the integration's
  `config_json` to import them as 24h commitments.

The offline smoke harness drives the whole loop against a stubbed client:
`pnpm --filter @mind-palace/server exec tsx scripts/google-calendar-smoke.ts`.

## Security

There is no end-user authentication in v0. Keep `HOST=127.0.0.1` unless access is protected by Tailscale ACLs.