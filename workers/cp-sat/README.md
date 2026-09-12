# CP-SAT Worker

This worker is the optimization boundary for Mind Palace. It reads one JSON scheduling problem from standard input and writes one JSON solution to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer.

The v0 model uses 30-minute slots from 07:00 through 23:00 in `America/New_York`, through the end of the current week. Accepted and completed blocks are immutable busy periods. Calendar-event tasks with fixed intervals are also busy periods. Task priority is the primary objective, rank breaks priority ties, and splitting incurs a context-switch penalty.

Run it directly with:

```sh
uv run --project workers/cp-sat python workers/cp-sat/scheduler.py < problem.json
```

Dependencies are isolated by `uv` using `pyproject.toml`.
