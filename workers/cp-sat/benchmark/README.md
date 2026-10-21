# Scheduler comparison benchmark

A self-contained harness that runs the worker's two solvers on the same generated instances and
measures wall-clock time and solution quality against the **exact same objective**.

The two competitors are the real implementations, not re-writes:

- **`cp-sat`** — `schedulerlib.solve` with `config.solver = "cp-sat"` (the harness pins it; the
  worker's default is greedy).
- **`greedy`** — `schedulerlib/greedy.py`, the production scheduler, called with the context
  `Problem.context()` builds.

Nothing here is imported by the app. It lives next to the worker so both competitors re-use the
worker's own helpers (`eligible_slots`, `soft_totals`, `decision_weights`, `weather_is_nice`, the
rule/when matchers) and therefore cannot drift from the real model.

## Files

| File | Purpose |
|---|---|
| `usecase.py` | Seeded demo-data generator for the "make the day decisive" use case (sleep, wake+outside, workouts, meals, grocery, outings, work backlog, weather). |
| `instance.py` | Parses a payload into a `Problem`: slots, eligibility, required chunks, the soft objective scorecard, placement validation (`check_no_overlap` / `check_eligibility` / `check_dependency_order`), a per-rule style breakdown, and `context()` for the greedy scheduler. Also expands splittable tasks into independent unit tasks (`expand_splittable`). |
| `compare.py` | Runs both schedulers on every scenario/seed and prints per-run + aggregate tables (quality, time, winner). One runner per solver, both production entry points. |
| `scaling.py` | Sweeps the unit count to find where CP-SAT degrades. |
| `budgets.py` | Sweeps the CP-SAT time budget on a small and a large instance. |

## Running

```sh
# full sweep: every scenario, 3 seeds, 30s CP-SAT budget
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/compare.py \
    --seeds 1,2,3 --cp-budget 30

uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/scaling.py --cp-budget 30
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/budgets.py
```

`--quick` runs one seed with short budgets for a smoke test.

## Why the comparison is fair

* **Same hard constraints.** Greedy calls the worker's `eligible_slots` for every task and
  re-checks dependencies/`withinAfter` itself; every produced placement is validated for overlap,
  eligibility, and dependency feasibility before it is scored.
* **Same objective.** Scores come from the worker's own `decision_weights` and `soft_totals`, so
  the "style" number is exactly what CP-SAT reports. Decision strictly dominates style by
  construction, so placements are compared lexicographically `(weightedDecision, style)`.
* **Greedy's internal scorer is exact.** `SoftModel` counts window/weather/assignDays gains once
  per run (at its start) and accumulates `spread`/`dailyBudget` day counts in slot units, matching
  `soft_totals`. On every scenario `running_style == soft_totals` (difference 0), so the search is
  optimising exactly the metric it is judged on.
* **Same model, including splittable tasks.** `instance.expand_splittable` replaces every
  splittable task with `ceil(minutes / slot)` independent 30-minute unit tasks (same tags,
  priority, rank and mapped dependencies), and is applied to *both* schedulers. So a splittable
  task is scheduled as k independent tasks and partial progress is allowed — it is no longer
  CP-SAT's all-or-nothing `scheduled` boolean. This is a deliberate deviation from the production
  worker's semantics; `fragmented` opts out with `work_splittable=False`.
* **Greedy gets a real budget.** 12 restarts and up to 25 local-search passes; it converges in
  0.2–3.1s, so it is never artificially starved.

## The greedy algorithm

1. **Construction** in strict priority order (dependencies first), choosing the feasible placement
   with the best incremental style (per-slot window/weather gain + per-day spread/budget delta).
2. **Local search**: relocate each block to its best feasible slot; insert unscheduled tasks;
   2-opt swap same-priority pairs (bounded); ejection-insert (evict strictly-lower-priority tasks
   to place a higher-priority one, which is always decision-improving). Multi-restart with
   different ordering tie-breaks and a little noise, then refine the best packing.
