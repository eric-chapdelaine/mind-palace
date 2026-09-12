# Server

The Hono server is the single-owner control plane and sole SQLite writer. It hosts the built React application, runs durable OpenCode jobs, invokes CP-SAT, and normalizes integration data.

## Main API

- `GET/POST /api/tasks`, `PATCH /api/tasks/:id`: task capture and editing.
- `GET/POST /api/tags`, `POST /api/tags/:id/parents`: tag DAG management.
- `GET /api/schedule`, `POST /api/schedule/generate`: inspect or optimize the week.
- `POST /api/tasks/:id/accept-schedule`: accept every proposed block for one task.
- `POST /api/time-blocks`, `POST /api/time-blocks/:id/status`: manual block lifecycle.
- `POST /api/tasks/:id/recurrence`, `POST /api/recurrences/materialize`: recurring template support.
- `GET /api/weather`, `POST /api/weather/refresh`: cached Boston forecast.
- `POST /api/integrations/calendar/import`: normalized Google Calendar event import.
- `POST /api/integrations/garmin/import`, `GET /api/health-observations`: plan-versus-actual health data.
- `POST /api/tasks/:id/start-agent`: explicit agent dispatch for an `llm_eligible` task.

Existing workflow, approval, dependency, resource, and interaction endpoints remain available.

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

## Security

There is no end-user authentication in v0. Keep `HOST=127.0.0.1` unless access is protected by Tailscale ACLs. Future remote workers require machine credentials even though owner-operated workers are trusted.
