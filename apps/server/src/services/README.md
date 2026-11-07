# Server Services

Services own process and provider boundaries; repositories own SQLite writes.

- `schedule-service.ts` sends a versioned JSON problem to the Python scheduling worker and persists proposed blocks.
- `weather-service.ts` caches Boston hourly National Weather Service forecasts for eight hours.
- `calendar-import-service.ts` normalizes Google Calendar events into `calendar_event` tasks.
- `garmin-service.ts` syncs Garmin Connect sleep and activities through the `workers/garmin` Python worker; a token store on disk is what marks it `connected`.
- `recurrence-service.ts` materializes recurrence templates as independently completable tasks through a requested date. A template defines a period and `timesPerPeriod`: a daily period gets one dated card, a weekly period gets N interchangeable cards whose window is the whole period (one occurrence is a cadence; several are a quota, so the window is what differs). A daily slot counts as done only while its child is alive (a deleted card comes back); a quota slot counts as done once filled, so completing this week's trip does not mint another. It never backfills, and it stamps each child with the template's tags, the reserved `routine` tag, and (for a routine old enough to have one) its own legacy tag, plus its decay instant — never a weekday tag. Returns `MaterializeResult` (`created`, `alreadyPresent`, `idleTemplates`) so a pass that creates nothing can say why.
- `clock.ts` is the one place household-local wall clock meets UTC (`localDate`, `localInstant`, `startOfLocalDay`, `addDays`, `daysBetween`, `weekdayIndex`, `zoneOffsetMs`, `DAY_MS`). Services import it rather than deriving their own offset math.
- `worker.ts` is the shared runner for the Python workers (spawn, timeout, JSON-in/JSON-out, `{"error"}` handling).
- `job-scheduler.ts` runs the recurring jobs declared in `src/jobs.ts` on in-process intervals; `GET /api/jobs` reports their status.

Google Calendar accepts normalized imports in v0. Garmin Connect is registered in the composition root's `integrationRegistry`, so `GET /api/integrations` reports its connection state and the UI gates on it. OAuth and provider-specific polling can be added inside these services without changing task or health persistence.
