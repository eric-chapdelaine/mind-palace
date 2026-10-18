# CP-SAT Worker

This worker is the optimization boundary for Mind Palace. It reads one JSON scheduling problem from standard input and writes one JSON solution to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer.

The worker is a **pure function**: `now` and `horizonDays` arrive in the payload, so the same payload always yields the same schedule. (`num_search_workers = 1` and a fixed `random_seed` make even tied optima deterministic.)

## Layout

`workers/cp-sat/scheduler.py` is the stdin/stdout entry point and re-exports the tested helpers.
The model lives in the `schedulerlib` package, one responsibility per module:

- `config.py` — model version and default configuration.
- `timegrid.py` — slot-grid construction and time parsing.
- `weather.py` — forecast indexing and the rule-defined weather gate.
- `rules.py` — which tasks a rule governs and how it shapes eligibility.
- `objective.py` — objective helpers and the greedy compaction post-pass.
- `solve.py` — model construction, solving, and output shaping.
- `main.py` — the stdin/stdout protocol.

## Model (cp-sat-v8)

- **Slots**: 30-minute grid over `config.dayStart`–`config.dayEnd` (default `00:00`–`24:00`, i.e. the full day) in `config.timeZone` (default `America/New_York`), for `horizonDays` (default 7). A run may cross midnight (a sleep block does). Accepted/completed blocks are busy, and so are human-placed (manual) blocks even while still `proposed` — a manual block is a commitment that reserves its slot, whereas a solver proposal is ephemeral.
- **Intervals, not a boolean per slot.** A non-splittable task is one optional interval of its remaining duration; a splittable task is that many optional 30-minute unit intervals (splitting is free — `minChunkMinutes`/`maxChunkMinutes` are ignored). A single `NoOverlap` keeps every interval and every fixed commitment apart.
- **Rules are data.** Each enabled rule has `applies` (selects tasks), `effect`, and `strength`. The catalog:
  - `assignDays`, `timeWindow` — hard or soft weekday / clock-window constraints or preferences.
  - `preferTimeOfDay` — soft clock-window bonus.
  - `spread` — soft per-day minutes cap, plus `minDistinctDays` ("3 workouts on 3 distinct days") and `avoidConsecutive`.
  - `dailyBudget` — soft per-day **count** budget for a tag group (`softMaxPerDay`); rewards covering days and penalizes extras ("an outing every day, minimize the count").
  - `weatherGate` — hard or soft weather filter/bonus. Every threshold (`minTemperatureF`, `maxTemperatureF`, `maxPrecipitationProbability`, `maxWindMph`, `requireDaytime`) is optional and comes from the rule: the worker evaluates only the dimensions the rule sets, and a rule with no bounds is treated as unknown (never a built-in "nice").
  - `withinAfter` — hard max gap from a prerequisite ("get outside within 30 minutes of waking").
  - Any effect may carry a placement-scoped `when: { dayOfWeek: [...] }` (Python weekday order): slot-scoped effects (`assignDays`, `timeWindow`, `preferTimeOfDay`, `weatherGate`) only apply on those days, and day-scoped effects (`spread`, `dailyBudget`) only apply their per-day term on those days.
- **Objective**: a single weighted expression. The decision term (priority-weighted placement; P0 dominates, self-scaling so each level outweighs every less-important level combined) is multiplied above the total possible soft contribution, so a preference can never drop a task.
- **Weather-aware rules**: the payload's `weather[]` hours are matched to slot starts, so a gate/bonus is evaluated per placement. A missing forecast is treated as unknown, so a hard gate is permissive rather than blocking.
- **Dependencies**: a dependent's interval starts at or after its prerequisite's interval end; `withinAfter` adds the upper bound.
- **preferEarlier** is not an objective term. After solving, a greedy **compaction pass** pulls each block to the earliest slot that keeps its hard eligibility, soft time-window/weather membership, spread/budget day, dependencies, and `withinAfter` gap. It is a heuristic applied to the solver's chosen set of tasks, not part of the optimum.
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
