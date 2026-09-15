# CP-SAT Worker

This worker is the optimization boundary for Mind Palace. It reads one JSON scheduling problem from standard input and writes one JSON solution to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer.

The v1 model uses 30-minute slots from 07:00 through 23:00 in `America/New_York`, through the end of the current week. Accepted and completed blocks are immutable busy periods. Calendar-event tasks with fixed intervals are also busy periods. Task priority is the primary objective, rank breaks priority ties, and splitting incurs a context-switch penalty.

Week eligibility is tag-driven: the TypeScript layer only passes tasks that carry `mind-palace:this-week` (directly or via an ancestor tag). Each task may also arrive with `preferredDay` (a Python `date.weekday()` index, 0 = Monday .. 6 = Sunday) derived from its `mind-palace:<weekday>` tag. A task with a `preferredDay` must be scheduled, and only in that day's slots; if that day has already passed within the horizon it is left unscheduled rather than making the model infeasible.

Run it directly with:

```sh
uv run --project workers/cp-sat python workers/cp-sat/scheduler.py < problem.json
```

Dependencies are isolated by `uv` using `pyproject.toml`.
