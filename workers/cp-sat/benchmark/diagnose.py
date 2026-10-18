"""Explain one instance: CP-SAT vs greedy objective and per-rule style breakdown.

    uv run --project workers/cp-sat python workers/cp-sat/benchmark/diagnose.py \
        --scenario baseline --seed 1
"""

from __future__ import annotations

import argparse

from compare import run_cp_sat
from greedy import solve_greedy
from instance import Problem, placement_from_assignments
from usecase import SCENARIOS, build_payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default="baseline")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--cp-budget", type=float, default=30.0)
    parser.add_argument("--greedy-budget", type=float, default=10.0)
    args = parser.parse_args()

    payload = build_payload(seed=args.seed, **SCENARIOS[args.scenario])
    problem = Problem.from_payload(payload)
    cp_result, cp_timing = run_cp_sat(payload, args.cp_budget)
    cp_placement = placement_from_assignments(problem, cp_result["assignments"])
    greedy_result = solve_greedy(problem, time_budget_seconds=args.greedy_budget)
    greedy_placement = greedy_result["placement"]

    print(f"scenario={args.scenario} seed={args.seed} tasks={len(problem.tasks)} slots={problem.slot_count}")
    print(f"CP-SAT : status={cp_result['solverStatus']} build={cp_timing['buildSeconds']:.2f}s "
          f"solve={cp_timing['solveSeconds']:.2f}s placed={problem.evaluate(cp_placement)['placed']} "
          f"decision={problem.decision_score(cp_placement)} style={problem.style(cp_placement)}")
    print(f"greedy : restarts={greedy_result['restarts']} iter={greedy_result['iterations']} "
          f"placed={problem.evaluate(greedy_placement)['placed']} "
          f"decision={problem.decision_score(greedy_placement)} style={problem.style(greedy_placement)} "
          f"time={greedy_result['totalSeconds']:.3f}s feasible={greedy_result['feasible']}")

    cp_breakdown = {entry["title"]: entry["value"] for entry in problem.style_breakdown(cp_placement)}
    gr_breakdown = {entry["title"]: entry["value"] for entry in problem.style_breakdown(greedy_placement)}
    print("\nper-rule style (positive = bonus, negative = penalty):")
    print(f"  {'rule':<32} {'cp':>8} {'greedy':>8} {'delta':>8}")
    for title in cp_breakdown:
        cp_value, gr_value = cp_breakdown[title], gr_breakdown.get(title, 0)
        print(f"  {title:<32} {cp_value:>8} {gr_value:>8} {gr_value - cp_value:>8}")

    print("\nplaced by priority:")
    print(f"  CP    : {problem.evaluate(cp_placement)['byPriority']}")
    print(f"  greedy: {problem.evaluate(greedy_placement)['byPriority']}")


if __name__ == "__main__":
    main()
