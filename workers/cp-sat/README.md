# CP-SAT Worker

This worker is the optimization boundary for Mind Palace. It reads one JSON scheduling problem from standard input and writes one JSON solution to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer.

The worker is a **pure function**: `now` and `horizonDays` arrive in the payload, so the same payload always yields the same schedule. (`num_search_workers = 1` and a fixed `random_seed` make even tied optima deterministic.)

## Model (cp-sat-v6)

- **Slots**: 30-minute grid over `config.dayStart`–`config.dayEnd` (default 07:00–23:00) in `config.timeZone` (default `America/New_York`), for `horizonDays` (default 7). Accepted/completed time blocks are busy.
- **Intervals, not a boolean per slot.** A non-splittable task is one optional interval of its remaining duration; a splittable task is that many optional 30-minute unit intervals (splitting is free — `minChunkMinutes`/`maxChunkMinutes` are ignored). A single `NoOverlap` keeps every interval and every fixed commitment apart.
- **Rules are data.** Each enabled rule has `applies` (a condition over a task's effective tags), `effect` (one of `assignDays`, `timeWindow`, `preferTimeOfDay`, `spread`), and `strength`:
  - `{"kind":"hard"}` → restricts the task's eligible start domain (`assignDays`, hard `timeWindow`).
  - `{"kind":"soft","weight":N}` → a weighted objective term (`preferTimeOfDay`, soft `timeWindow`, soft `assignDays`, `spread`).
- **Objective**: a single weighted expression. The decision term (priority-weighted placement, self-scaling so each level outweighs every lower level combined) is multiplied above the total possible soft contribution, so a preference can never drop a task.
- **Dependencies**: a dependent's interval starts at or after its prerequisite's interval end (`start_B ≥ start_A + size_A`).
- **preferEarlier** is not an objective term. After solving, a greedy **compaction pass** pulls each block to the earliest slot that keeps its hard eligibility, soft time-window membership, spread day, and dependencies. It is a heuristic applied to the solver's chosen set of tasks, not part of the optimum.
- **Day pins / windows / busy blocks** restrict eligibility but do not force a task to be scheduled, so an over-committed day spills gracefully (the task is reported unscheduled) instead of making the whole model infeasible.
- **Solver settings**: `num_search_workers = 1` and `random_seed = 0` for reproducibility. `cp_model_presolve = False` — the allowed-domain encoding makes CP-SAT presolve expensive (seconds) and can consume the whole budget before the first incumbent; turning it off makes the solve both faster and more robust.

## Output

`{ modelVersion, horizonStart, horizonEnd, assignments, unscheduled, unscheduledTaskIds, scores, solverStatus, objectiveValue }`

`assignments` is one entry per interval (a splittable task yields one per 30-minute unit); `ScheduleService` merges adjacent entries for the same task into single time blocks before persisting. `unscheduled` carries classified reasons (`capacity`, `no_eligible_slots`, `rule`). `scores` reports `decision` (placed counts by priority) and the total `style` value for display.

## Tests

```sh
pnpm test:worker
# or: uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v
```

The pure helpers (`build_slots`, `condition_matches`, `rule_strength`, `window_slot_indices`, `decision_weights`) are unit-tested directly, and `solve` is exercised end-to-end against constructed payloads.

Run it by hand with:

```sh
uv run --project workers/cp-sat python workers/cp-sat/scheduler.py < problem.json
```
