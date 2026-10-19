"""Is the large-instance CP-SAT failure a tuning artifact?

The production worker hardcodes `cp_model_presolve = False` and `num_search_workers = 1`. This
subclasses `CpSolver` and re-applies those parameters right before `solve()`, so we can measure
what presolve / parallel workers would do *without* editing production code.

    uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/config_experiment.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `schedulerlib` importable before it is used (instance.py does this too, but this module
# imports schedulerlib directly).
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from ortools.sat.python import cp_model  # noqa: E402

import importlib  # noqa: E402

# `schedulerlib.solve` is shadowed by the re-exported function, so resolve the module explicitly.
S = importlib.import_module("schedulerlib.solve")

from greedy import solve_greedy  # noqa: E402
from instance import Problem, expand_splittable, placement_from_assignments  # noqa: E402
from usecase import build_payload  # noqa: E402

Case = {
    "typical": dict(seed=1, errand_count=8, work_backlog_minutes=2400, niceness=0.5),
    "s128": dict(seed=7, errand_count=128, work_backlog_minutes=2400, extra_focus_tasks=40, niceness=0.5),
}
Configs = [
    ("presolve=off workers=1 (prod)", False, 1),
    ("presolve=on  workers=1", True, 1),
    ("presolve=off workers=8", False, 8),
    ("presolve=on  workers=8", True, 8),
]


class TunableSolver(cp_model.CpSolver):
    force_presolve = False
    force_workers = 1

    def solve(self, model):
        self.parameters.cp_model_presolve = self.force_presolve
        self.parameters.num_search_workers = self.force_workers
        return super().solve(model)


def run(payload, presolve, workers, budget):
    original = cp_model.CpSolver

    class Configured(TunableSolver):
        force_presolve = presolve
        force_workers = workers

    cp_model.CpSolver = Configured
    S.cp_model.CpSolver = Configured
    try:
        payload = expand_splittable(payload)
        payload = {**payload, "config": {**payload.get("config", {}), "timeBudgetSeconds": budget}}
        return S.solve(payload)
    finally:
        cp_model.CpSolver = original
        S.cp_model.CpSolver = original


def main():
    for label, kwargs in Case.items():
        payload = build_payload(**kwargs)
        problem = Problem.from_payload(payload)
        greedy = solve_greedy(problem, time_budget_seconds=5.0)
        gr = problem.evaluate(greedy["placement"])
        print(f"\n=== {label}: {len(problem.tasks)} tasks | greedy decision={gr['weightedDecision']} "
              f"placed={gr['placed']} style={gr['style']} in {greedy['totalSeconds']:.2f}s ===")
        for name, presolve, workers in Configs:
            result = run(payload, presolve, workers, 30.0)
            ev = problem.evaluate(placement_from_assignments(problem, result["assignments"]))
            print(f"  {name:<28} status={result['solverStatus']:<9} placed={ev['placed']:>4} "
                  f"decision={ev['weightedDecision']:>8} style={ev['style']:>7}")


if __name__ == "__main__":
    main()
