# CP-SAT Worker

This worker is the optimization boundary for Mind Palace. It reads one JSON scheduling problem from standard input and writes one JSON solution to standard output. It never opens SQLite; the TypeScript control plane remains the only database writer.

The worker is a **pure function**: `now` and `horizonDays` arrive in the payload, so the same payload always yields the same schedule. (`num_search_workers = 1` and a fixed `random_seed` make even tied optima deterministic.)

## Model (cp-sat-v5)

- **Slots**: 30-minute grid over `config.dayStart`–`config.dayEnd` (default 07:00–23:00) in `config.timeZone` (default `America/New_York`), for `horizonDays` (default 7). Accepted/completed time blocks are busy.
- **Rules are data.** Each enabled rule has `applies` (a condition over a task's effective tags), `effect` (one of the catalog types), and `strength`:
  - `{"kind":"hard"}` → a feasibility constraint (`assignDays`, hard `timeWindow`).
  - `{"kind":"soft","tier":"style|fragmentation|placement","weight":N}` → an objective term.
- **Objective tiers** are solved **lexicographically**, highest precedence first. The engine owns the order; rules only choose a tier. No hand-tuned constants keep tiers apart — each tier's optimum is locked with an equality constraint before the next is solved.
  1. `decision` — which tasks get placed. In `strict` mode (default) this is one sub-tier per priority level, so a higher priority is never traded for a lower one; within a level, count dominates rank. `weighted` and `fair` modes are also supported via `config.priorityMode`.
  2. `style` — soft per-slot preferences (`timeWindow`, `preferTimeOfDay`, `assignDays`) and `spread`.
  3. `fragmentation` — `minimizeChunks`.
  4. `placement` — `preferEarlier`.
- **Chunking**: `maxChunkMinutes` caps each contiguous run of a splittable task; `minChunkMinutes` bounds the number of runs. A non-splittable task is a single run.
- **Day pins** (`assignDays`) restrict eligibility but do not force the task to be scheduled, so an over-committed day spills gracefully (the task is reported unscheduled) instead of making the whole model infeasible.

## Output

`{ modelVersion, horizonStart, horizonEnd, assignments, unscheduled, unscheduledTaskIds, tierScores, solverStatus, objectiveValue }`

`unscheduled` carries classified reasons (`capacity`, `no_eligible_slots`, `rule`). `tierScores` reports the locked optimum per tier for the fidelity harness.

## Tests

```sh
pnpm test:worker
# or: uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v
```

The pure helpers (`build_slots`, `condition_matches`, `rule_strength`, `window_slot_indices`, `decision_tiers`) are unit-tested directly, and `solve` is exercised end-to-end against constructed payloads.

Run it by hand with:

```sh
uv run --project workers/cp-sat python workers/cp-sat/scheduler.py < problem.json
```
