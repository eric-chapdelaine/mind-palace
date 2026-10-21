"""Run both schedulers on the same generated weeks and report time + quality.

Usage:
    uv run --project workers/cp-sat python -u workers/cp-sat/benchmark/compare.py
    ... --scenarios typical,overloaded --seeds 1,2 --cp-budget 30
    ... --quick

Each solver is invoked through its production entry point (`schedulerlib.solve` for CP-SAT,
`schedulerlib.greedy` for the default) on a payload expanded into independent unit tasks, so
nothing here re-implements either algorithm.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import re
import statistics
import time

from instance import (
    Problem,
    check_dependency_order,
    check_eligibility,
    check_no_overlap,
    expand_splittable,
    placement_from_assignments,
)
from usecase import SCENARIOS, build_payload

import schedulerlib.greedy as greedy
from schedulerlib.solve import solve as worker_solve

TIMING_RE = re.compile(
    r"\[timing\] build=(?P<build>[0-9.]+)s solve=(?P<solve>[0-9.]+)s total=(?P<total>[0-9.]+)s"
)


def run_cp_sat(payload: dict, budget_seconds: float):
    """Solve with the optional CP-SAT model. Returns `(result, timing)`."""
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
        result = worker_solve(payload)
    wall = time.perf_counter() - started
    match = TIMING_RE.search(buffer.getvalue())
    timing = {
        "wallSeconds": wall,
        "modelSeconds": float(match["total"]) if match else None,
    }
    return result, timing


def run_greedy(problem: Problem):
    """Solve with the production greedy scheduler. Returns `(placement, seconds)`."""
    started = time.perf_counter()
    placement, _status, _objective = greedy.solve(problem.context())
    return placement, time.perf_counter() - started


def _violations(problem: Problem, placement: dict) -> list:
    """Every hard-constraint breach the schedulers must never produce."""
    found = []
    if not check_no_overlap(placement):
        found.append("overlapping blocks")
    found.extend(check_eligibility(problem, placement))
    found.extend(check_dependency_order(problem, placement))
    return found


def compare_one(name: str, seed: int, kwargs: dict, cp_budget: float):
    payload = build_payload(seed=seed, **kwargs)
    problem = Problem.from_payload(payload)

    cp_result, cp_timing = run_cp_sat(payload, cp_budget)
    cp_placement = placement_from_assignments(problem, cp_result["assignments"])
    greedy_placement, greedy_seconds = run_greedy(problem)

    return {
        "scenario": name,
        "seed": seed,
        "units": len(problem.tasks),
        "cp": {
            **problem.evaluate(cp_placement),
            **cp_timing,
            "solverStatus": cp_result["solverStatus"],
            "violations": _violations(problem, cp_placement),
        },
        "greedy": {
            **problem.evaluate(greedy_placement),
            "wallSeconds": greedy_seconds,
            "violations": _violations(problem, greedy_placement),
        },
    }


def winner(row) -> str:
    """Placements compare lexicographically: weighted decision first, then style."""
    cp, gr = row["cp"], row["greedy"]
    cp_key = (cp["weightedDecision"], cp["style"])
    gr_key = (gr["weightedDecision"], gr["style"])
    return "greedy" if gr_key > cp_key else ("cp-sat" if gr_key < cp_key else "tie")


def print_table(rows):
    header = (
        f"{'scenario':<12}{'seed':>5}{'units':>7}{'cpPl':>7}{'grPl':>7}"
        f"{'cpWD':>10}{'grWD':>10}{'cpStyle':>9}{'grStyle':>9}{'cpS':>8}{'grS':>7}{'x':>7}  winner"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        cp, gr = row["cp"], row["greedy"]
        print(
            f"{row['scenario']:<12}{row['seed']:>5}{row['units']:>7}{cp['placed']:>7}{gr['placed']:>7}"
            f"{cp['weightedDecision']:>10}{gr['weightedDecision']:>10}"
            f"{cp['style']:>9}{gr['style']:>9}{cp['wallSeconds']:>8.2f}{gr['wallSeconds']:>7.3f}"
            f"{cp['wallSeconds'] / gr['wallSeconds']:>7.1f}  {winner(row)}"
        )


def summarize(rows):
    print("\n=== aggregate per scenario ===")
    header = (
        f"{'scenario':<12}{'runs':>5}{'cpPl':>7}{'grPl':>7}{'cpWD':>10}{'grWD':>10}"
        f"{'cpStyle':>9}{'grStyle':>9}{'cpS_med':>8}{'grS_med':>8}  wins g/c"
    )
    print(header)
    print("-" * len(header))
    by_scenario: dict = {}
    for row in rows:
        by_scenario.setdefault(row["scenario"], []).append(row)
    total = {"greedy": 0, "cp-sat": 0, "tie": 0}
    for name, group in by_scenario.items():
        counts = {"greedy": 0, "cp-sat": 0, "tie": 0}
        for row in group:
            counts[winner(row)] += 1
        for key in total:
            total[key] += counts[key]
        cp_rows = [row["cp"] for row in group]
        gr_rows = [row["greedy"] for row in group]
        print(
            f"{name:<12}{len(group):>5}"
            f"{statistics.mean(r['placed'] for r in cp_rows):>7.1f}"
            f"{statistics.mean(r['placed'] for r in gr_rows):>7.1f}"
            f"{statistics.mean(r['weightedDecision'] for r in cp_rows):>10.0f}"
            f"{statistics.mean(r['weightedDecision'] for r in gr_rows):>10.0f}"
            f"{statistics.mean(r['style'] for r in cp_rows):>9.1f}"
            f"{statistics.mean(r['style'] for r in gr_rows):>9.1f}"
            f"{statistics.median(r['wallSeconds'] for r in cp_rows):>8.2f}"
            f"{statistics.median(r['wallSeconds'] for r in gr_rows):>8.3f}"
            f"   {counts['greedy']}/{counts['cp-sat']}"
        )
    print(f"\noverall: greedy={total['greedy']} cp-sat={total['cp-sat']} tie={total['tie']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", default=",".join(SCENARIOS))
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--cp-budget", type=float, default=30.0)
    parser.add_argument("--quick", action="store_true", help="one seed, short CP-SAT budget")
    args = parser.parse_args()

    if args.quick:
        args.seeds = "1"
        args.cp_budget = 5.0

    scenarios = [name for name in args.scenarios.split(",") if name]
    seeds = [int(seed) for seed in args.seeds.split(",") if seed]

    rows = []
    for name in scenarios:
        kwargs = SCENARIOS[name]
        for seed in seeds:
            row = compare_one(name, seed, kwargs, args.cp_budget)
            rows.append(row)
            cp, gr = row["cp"], row["greedy"]
            flag = f"  !! {cp['violations'] or gr['violations']}" if (cp["violations"] or gr["violations"]) else ""
            print(
                f"  {name}/{seed}: units={row['units']} cp={cp['placed']}(d{cp['weightedDecision']},s{cp['style']}) "
                f"{cp['wallSeconds']:.2f}s greedy={gr['placed']}(d{gr['weightedDecision']},s{gr['style']}) "
                f"{gr['wallSeconds']:.2f}s  {winner(row)}{flag}"
            )

    print()
    print_table(rows)
    summarize(rows)


if __name__ == "__main__":
    main()
