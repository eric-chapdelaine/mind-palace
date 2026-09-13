# Server Services

Services own process and provider boundaries; repositories own SQLite writes.

- `schedule-service.ts` sends a versioned JSON problem to the Python CP-SAT worker and persists proposed blocks.
- `weather-service.ts` caches Boston hourly National Weather Service forecasts for eight hours.
- `integration-service.ts` normalizes Google Calendar events into `calendar_event` tasks and Garmin imports into permanent health observations.
- `recurrence-service.ts` materializes routine templates as independently completable child tasks through a requested date.

Google Calendar and Garmin endpoints accept normalized imports in v0. OAuth and provider-specific polling can be added inside adapters without changing task or health-observation persistence.