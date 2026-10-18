"""Scaling study: how CP-SAT and greedy behave as the task count grows.

    uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/scaling.py --cp-budget 30
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from compare import run_cp_sat
from greedy import solve_greedy
from instance import Problem, placement_from_assignments
from usecase import build_payload

SIZES = [
    ("s04", 4, 0),
    ("s08", 8, 0),
    ("s12", 12, 0),
    ("s16", 16, 0),
    ("s24", 24, 0),
    ("s32", 32, 0),
    ("s48", 48, 8),
    ("s64", 64, 16),
    ("s96", 96, 24),
    ("s128", 128, 40),
    ("s192", 192, 60),
    ("s256", 256, 80),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cp-budget", type=float, default=30.0)
    parser.add_argument("--greedy-budget", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out", default="workers/cp-sat/benchmark/scaling.json")
    args = parser.parse_args()

    rows = []
    print(f"{'label':<6}{'tasks':>6}  {'cpStatus':<9}{'cpPl':>5}{'cpDec':>9}{'cpStyle':>9}{'cpS':>7}  "
          f"{'grPl':>5}{'grDec':>9}{'grStyle':>9}{'grS':>7}  {'grRestarts':>10}")
    for label, errands, focus in SIZES:
        payload = build_payload(seed=args.seed, errand_count=errands, work_backlog_minutes=2400,
                                extra_focus_tasks=focus, niceness=0.5)
        problem = Problem.from_payload(payload)
        cp_result, cp_timing = run_cp_sat(payload, args.cp_budget)
        cp_placement = placement_from_assignments(problem, cp_result["assignments"])
        cp_eval = problem.evaluate(cp_placement)
        greedy_result = solve_greedy(problem, time_budget_seconds=args.greedy_budget)
        gr_eval = problem.evaluate(greedy_result["placement"])
        row = {
            "label": label,
            "tasks": len(problem.tasks),
            "cp": {**cp_eval, **cp_timing, "solverStatus": cp_result["solverStatus"]},
            "greedy": {**gr_eval, "totalSeconds": greedy_result["totalSeconds"],
                       "restarts": greedy_result["restarts"], "hitBudget": greedy_result["hitBudget"]},
        }
        rows.append(row)
        print(f"{label:<6}{row['tasks']:>6}  {cp_result['solverStatus']:<9}{cp_eval['placed']:>5}"
              f"{cp_eval['weightedDecision']:>9}{cp_eval['style']:>9}{cp_timing['wallSeconds']:>7.2f}  "
              f"{gr_eval['placed']:>5}{gr_eval['weightedDecision']:>9}{gr_eval['style']:>9}"
              f"{greedy_result['totalSeconds']:>7.3f}  {greedy_result['restarts']:>10}")

    out_path = Path(args.out)
    out_path.write_text(json.dumps({"cpBudget": args.cp_budget, "rows": rows}, indent=2))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
