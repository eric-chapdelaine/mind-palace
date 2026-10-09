# Garmin Worker

This worker is the Garmin Connect boundary for Mind Palace. It reads one JSON request from standard input and writes one JSON object to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer. Only normalized fields are returned — raw provider payloads are discarded in-process.

Request shape:

```json
{ "sleepFrom": "YYYY-MM-DD", "activitiesFrom": "YYYY-MM-DD", "today": "YYYY-MM-DD" }
```

`GarminService` picks the date ranges from the newest rows already stored, so the worker only asks Garmin for what is missing. The response contains `sleep` and `activities` arrays shaped like the `sleep_sessions` / `health_activities` tables (minus database ids).

Authentication reuses an existing Garmin token store: `$GARMINTOKENSTORE` if set, then `~/.garminconnect`, then `~/.garth`. Create one with:

```sh
python -c "import garth; garth.login(); garth.save('~/.garminconnect')"
```

Run it directly with:

```sh
echo '{"sleepFrom":"2026-10-01","activitiesFrom":"2026-10-01","today":"2026-10-08"}' \
  | uv run --project workers/garmin python workers/garmin/sync.py
```

Dependencies are isolated by `uv` using `pyproject.toml`.
