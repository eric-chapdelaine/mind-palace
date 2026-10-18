"""Does more CP-SAT time rescue the large instances? Sweep the time budget.

    uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/budgets.py
"""

from __future__ import annotations

import json
from pathlib import Path

from compare import run_cp_sat
from greedy import solve_greedy
from instance import Problem, placement_from_assignments
from usecase import build_payload

CASES = [
    ("typical", dict(seed=1, errand_count=8, work_backlog_minutes=2400, niceness=0.5), [30, 120]),
    ("s128", dict(seed=7, errand_count=128, work_backlog_minutes=2400, extra_focus_tasks=40, niceness=0.5), [30, 60, 120, 300]),
]


def main():
    out = []
    for label, kwargs, budgets in CASES:
        payload = build_payload(**kwargs)
        problem = Problem.from_payload(payload)
        greedy_result = solve_greedy(problem, time_budget_seconds=5.0)
        gr_eval = problem.evaluate(greedy_result["placement"])
        print(f"\n=== {label}: {len(problem.tasks)} tasks | greedy decision={gr_eval['weightedDecision']} "
              f"style={gr_eval['style']} placed={gr_eval['placed']} in {greedy_result['totalSeconds']:.2f}s ===")
        for budget in budgets:
            cp_result, cp_timing = run_cp_sat(payload, budget)
            cp_eval = problem.evaluate(placement_from_assignments(problem, cp_result["assignments"]))
            print(f"  cp budget={budget:>4}s status={cp_result['solverStatus']:<9} placed={cp_eval['placed']:>4} "
                  f"decision={cp_eval['weightedDecision']:>8} style={cp_eval['style']:>7} "
                  f"wall={cp_timing['wallSeconds']:.1f}s")
            out.append({"case": label, "tasks": len(problem.tasks), "budget": budget,
                        "status": cp_result["solverStatus"], **cp_eval})
    Path("workers/cp-sat/benchmark/budgets.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
