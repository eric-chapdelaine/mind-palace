"""Run CP-SAT and greedy on the same generated instances and report time + optimality.

Usage:
    uv run --project workers/cp-sat python workers/cp-sat/benchmark/compare.py
    ... --scenarios baseline,typical --seeds 1,2 --cp-budget 5 --greedy-budget 3
    ... --quick
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

from greedy import solve_greedy
from instance import (
    Problem,
    check_eligibility,
    check_no_overlap,
    expand_splittable,
    placement_from_assignments,
)
from usecase import SCENARIOS, build_payload

from schedulerlib.solve import solve as cp_sat_solve

TIMING_RE = re.compile(
    r"\[timing\] build=(?P<build>[0-9.]+)s solve=(?P<solve>[0-9.]+)s total=(?P<total>[0-9.]+)s"
)


def run_cp_sat(payload: dict, budget_seconds: float):
    payload = dict(expand_splittable(payload))
    payload["config"] = {
        **(payload.get("config") or {}),
        "solver": "cp-sat",  # the worker defaults to greedy; pin the baseline here
        "timeBudgetSeconds": budget_seconds,
        "debugTiming": True,
    }
    buffer = io.StringIO()
    started = time.perf_counter()
    with contextlib.redirect_stderr(buffer):
        result = cp_sat_solve(payload)
    wall = time.perf_counter() - started
    match = TIMING_RE.search(buffer.getvalue())
    timing = (
        {"buildSeconds": float(match["build"]), "solveSeconds": float(match["solve"]), "modelSeconds": float(match["total"])}
        if match
        else {"buildSeconds": None, "solveSeconds": None, "modelSeconds": None}
    )
    timing["wallSeconds"] = wall
    return result, timing


def compare_one(name: str, seed: int, kwargs: dict, cp_budget: float, greedy_budget: float):
    payload = build_payload(seed=seed, **kwargs)
    problem = Problem.from_payload(payload)

    cp_result, cp_timing = run_cp_sat(payload, cp_budget)
    cp_placement = placement_from_assignments(problem, cp_result["assignments"])
    cp_eval = problem.evaluate(cp_placement)

    greedy_result = solve_greedy(problem, time_budget_seconds=greedy_budget)
    greedy_placement = greedy_result["placement"]
    greedy_eval = problem.evaluate(greedy_placement)

    return {
        "scenario": name,
        "seed": seed,
        "tasks": len(problem.tasks),
        "slots": problem.slot_count,
        "cp": {
            **cp_eval,
            **cp_timing,
            "solverStatus": cp_result["solverStatus"],
            "reportedObjective": cp_result["objectiveValue"],
            "reportedStyle": cp_result["scores"]["style"],
            "noOverlap": check_no_overlap(cp_placement),
            "eligibilityViolations": len(check_eligibility(problem, cp_placement)),
        },
        "greedy": {
            **greedy_eval,
            "constructSeconds": greedy_result["constructSeconds"],
            "totalSeconds": greedy_result["totalSeconds"],
            "iterations": greedy_result["iterations"],
            "restarts": greedy_result["restarts"],
            "hitBudget": greedy_result["hitBudget"],
            "feasible": greedy_result["feasible"],
            "noOverlap": check_no_overlap(greedy_placement),
            "eligibilityViolations": len(check_eligibility(problem, greedy_placement)),
        },
    }


def _fmt(value, digits=2):
    if value is None:
        return "-"
    return f"{value:.{digits}f}"


def print_table(rows):
    header = (
        f"{'scenario':<12} {'seed':>4} {'tasks':>5} {'cp_placed':>9} {'gr_placed':>9} "
        f"{'cp_style':>8} {'gr_style':>8} {'cp_s':>7} {'gr_s':>7} {'speedup':>7} {'gap?':>5}"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        cp, gr = row["cp"], row["greedy"]
        speedup = (cp["wallSeconds"] / gr["totalSeconds"]) if gr["totalSeconds"] else float("inf")
        gap = "yes" if (gr["weightedDecision"] < cp["weightedDecision"] or gr["style"] < cp["style"]) else ""
        print(
            f"{row['scenario']:<12} {row['seed']:>4} {row['tasks']:>5} "
            f"{cp['placed']:>9} {gr['placed']:>9} {cp['style']:>8} {gr['style']:>8} "
            f"{_fmt(cp['wallSeconds']):>7} {_fmt(gr['totalSeconds']):>7} {_fmt(speedup, 1):>7} {gap:>5}"
        )


def summarize(rows):
    print("\n=== aggregate (per scenario) ===")
    header = (
        f"{'scenario':<12} {'runs':>4} {'cp_placed':>9} {'gr_placed':>9} "
        f"{'cp_style':>8} {'gr_style':>8} {'cp_s_med':>9} {'gr_s_med':>9}"
    )
    print(header)
    print("-" * len(header))
    by_scenario: dict = {}
    for row in rows:
        by_scenario.setdefault(row["scenario"], []).append(row)
    for name, group in by_scenario.items():
        cp_placed = statistics.mean(row["cp"]["placed"] for row in group)
        gr_placed = statistics.mean(row["greedy"]["placed"] for row in group)
        cp_style = statistics.mean(row["cp"]["style"] for row in group)
        gr_style = statistics.mean(row["greedy"]["style"] for row in group)
        cp_time = statistics.median(row["cp"]["wallSeconds"] for row in group)
        gr_time = statistics.median(row["greedy"]["totalSeconds"] for row in group)
        print(
            f"{name:<12} {len(group):>4} {cp_placed:>9.1f} {gr_placed:>9.1f} "
            f"{cp_style:>8.1f} {gr_style:>8.1f} {cp_time:>9.3f} {gr_time:>9.3f}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", default=",".join(SCENARIOS))
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--cp-budget", type=float, default=30.0)
    parser.add_argument("--greedy-budget", type=float, default=5.0)
    parser.add_argument("--quick", action="store_true", help="one seed, small budgets")
    parser.add_argument("--out", default="workers/cp-sat/benchmark/results.json")
    args = parser.parse_args()

    if args.quick:
        args.seeds = "1"
        args.cp_budget = 5.0
        args.greedy_budget = 2.0

    scenarios = [name for name in args.scenarios.split(",") if name]
    seeds = [int(seed) for seed in args.seeds.split(",") if seed]

    rows = []
    for name in scenarios:
        kwargs = SCENARIOS[name]
        for seed in seeds:
            started = time.perf_counter()
            row = compare_one(name, seed, kwargs, args.cp_budget, args.greedy_budget)
            rows.append(row)
            cp, gr = row["cp"], row["greedy"]
            flag = "" if (cp["noOverlap"] and gr["noOverlap"] and not cp["eligibilityViolations"] and not gr["eligibilityViolations"] and gr["feasible"]) else "  !! INVALID"
            print(
                f"  {name}/{seed}: tasks={row['tasks']} cp={cp['placed']}(d{cp['weightedDecision']},s{cp['style']}) "
                f"{_fmt(cp['wallSeconds'], 2)}s greedy={gr['placed']}(d{gr['weightedDecision']},s{gr['style']}) "
                f"{_fmt(gr['totalSeconds'], 2)}s{flag}"
            )

    print()
    print_table(rows)
    summarize(rows)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "cpBudgetSeconds": args.cp_budget,
        "greedyBudgetSeconds": args.greedy_budget,
        "rows": rows,
    }, indent=2))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
