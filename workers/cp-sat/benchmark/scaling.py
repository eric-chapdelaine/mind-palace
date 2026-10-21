"""Scaling study: how both schedulers behave as the number of units grows.

    uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/scaling.py --cp-budget 30
"""

from __future__ import annotations

import argparse

from compare import run_cp_sat, run_greedy, winner
from instance import Problem, placement_from_assignments
from usecase import build_payload

# (label, errand count, extra focus tasks) — raising errands/focus grows the backlog.
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
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    header = (
        f"{'label':<6}{'units':>6}  {'cpStatus':<9}{'cpPl':>5}{'cpWD':>9}{'cpStyle':>9}{'cpS':>7}  "
        f"{'grPl':>5}{'grWD':>9}{'grStyle':>9}{'grS':>7}  winner"
    )
    print(header)
    print("-" * len(header))
    for label, errands, focus in SIZES:
        payload = build_payload(seed=args.seed, errand_count=errands, work_backlog_minutes=2400,
                                extra_focus_tasks=focus, niceness=0.5)
        problem = Problem.from_payload(payload)
        cp_result, cp_timing = run_cp_sat(payload, args.cp_budget)
        cp_eval = problem.evaluate(placement_from_assignments(problem, cp_result["assignments"]))
        greedy_placement, greedy_seconds = run_greedy(problem)
        gr_eval = problem.evaluate(greedy_placement)
        row = {"cp": {**cp_eval, **cp_timing}, "greedy": {**gr_eval, "wallSeconds": greedy_seconds}}
        print(
            f"{label:<6}{len(problem.tasks):>6}  {cp_result['solverStatus']:<9}{cp_eval['placed']:>5}"
            f"{cp_eval['weightedDecision']:>9}{cp_eval['style']:>9}{cp_timing['wallSeconds']:>7.2f}  "
            f"{gr_eval['placed']:>5}{gr_eval['weightedDecision']:>9}{gr_eval['style']:>9}"
            f"{greedy_seconds:>7.3f}  {winner(row)}"
        )


if __name__ == "__main__":
    main()
