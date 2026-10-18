# Scheduler comparison benchmark

A self-contained harness that runs the production CP-SAT worker and a hand-written
greedy + local-search scheduler on the same generated instances, and measures wall-clock time and
solution quality against the **exact same objective**.

Nothing here is imported by the app. It lives next to the worker so both competitors can re-use
the worker's pure helpers (`eligible_slots`, `soft_totals`, `decision_weights`, `weather_is_nice`,
the rule/when matchers) and therefore cannot drift from the real model.

## Files

| File | Purpose |
|---|---|
| `usecase.py` | Seeded demo-data generator for the "make the day decisive" use case (sleep, wake+outside, workouts, meals, grocery, outings, work backlog, weather). |
| `instance.py` | Parses a payload into a `Problem`: slots, eligibility, required chunks, the soft objective scorecard, placement validation, and a per-rule style breakdown. |
| `greedy.py` | Greedy construction + local search. Optimises the same objective (priority-weighted decision, then soft style). Multi-restart, relocate, swap (2-opt), and ejection-insert neighbourhoods. |
| `compare.py` | Runs both on every scenario/seed; writes `results.json`; prints tables. |
| `scaling.py` | Sweeps task count to find where CP-SAT degrades; writes `scaling.json`. |
| `budgets.py` | Sweeps the CP-SAT time budget on a small and a large instance. |
| `config_experiment.py` | Tests whether CP-SAT's large-instance failure is a tuning artifact (`presolve`, `num_search_workers`). |
| `diagnose.py` | One instance, with the per-rule style breakdown and placement-by-priority. |
| `analyze.py` | Pretty-prints `results.json` / `scaling.json` and the aggregate stats. |

## Running

```sh
# full sweep (production 30s CP budget, 10s greedy cap)
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/compare.py \
    --seeds 1,2,3 --cp-budget 30 --greedy-budget 10

uv run --project workers/cp-sat python workers/cp-sat/benchmark/analyze.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/scaling.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/budgets.py
uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/config_experiment.py
uv run --project workers/cp-sat python workers/cp-sat/benchmark/diagnose.py --scenario typical --seed 1
```

`--quick` runs one seed with short budgets for a smoke test.

## Why the comparison is fair

* **Same hard constraints.** Greedy calls the worker's `eligible_slots` for every task and
  re-checks dependencies/`withinAfter` itself; every produced placement is validated for overlap,
  eligibility, and dependency feasibility before it is scored.
* **Same objective.** Scores come from the worker's own `decision_weights` and `soft_totals`, so
  the "style" number is exactly what CP-SAT reports. Decision strictly dominates style by
  construction, so placements are compared lexicographically `(weightedDecision, style)`.
* **Greedy gets a real budget.** 10s and 12 restarts; it converges in 0.1–1.4s, so it is never
  artificially starved.

## The greedy algorithm

1. **Construction** in strict priority order (dependencies first), choosing the feasible placement
   with the best incremental style (per-slot window/weather gain + per-day spread/budget delta).
2. **Local search**: relocate each block to its best feasible slot; insert unscheduled tasks;
   2-opt swap same-priority pairs (bounded); ejection-insert (evict strictly-lower-priority tasks
   to place a higher-priority one, which is always decision-improving). Multi-restart with
   different ordering tie-breaks and a little noise, then refine the best packing.
