"""Benchmark adapter for the production greedy scheduler.

The scheduler itself lives in `schedulerlib/greedy.py` — this module only bridges the benchmark's
`Problem` (a parsed payload) to the context that `schedulerlib.greedy.solve` expects, and adds the
timing/feasibility fields `compare.py` reports.

Nothing here re-implements the algorithm: the benchmark measures exactly the code the app runs.
"""

from __future__ import annotations

import time

# `instance` puts `workers/cp-sat` on `sys.path`, so import it before `schedulerlib`.
from instance import Problem  # isort: skip

import schedulerlib.greedy as production_greedy  # noqa: E402
from schedulerlib.rules import rule_applies  # noqa: E402


def _context(problem: Problem) -> dict:
    return {
        "tasks": problem.tasks,
        "task_by_id": {task["id"]: task for task in problem.tasks},
        "rules": problem.rules,
        "slots": problem.slots,
        "slot_count": problem.slot_count,
        "slot_minutes": problem.slot_minutes,
        "eligible_by_task": problem.eligible_by_task,
        "required_by_task": problem.required_by_task,
        "weather_hours": problem.weather_hours,
        "day_of": problem.day_of,
        "day_count": problem.day_count,
        "day_weekday": problem.day_weekday,
        "dates": problem.dates,
        "weights": problem.weights,
    }


def _feasible(problem: Problem, placement: dict) -> bool:
    """Dependencies placed in order, and `withinAfter` maximum gaps respected."""
    task_by_id = {task["id"]: task for task in problem.tasks}
    for task_id, runs in placement.items():
        min_start = min(start for start, _size in runs)
        for dependency in task_by_id[task_id].get("dependsOnTaskIds") or []:
            dependency_runs = placement.get(dependency)
            if not dependency_runs:
                return False
            if min_start < max(start + size for start, size in dependency_runs):
                return False
    for rule in problem.rules:
        effect = rule.get("effect") or {}
        if effect.get("type") != "withinAfter":
            continue
        gap = max(0, int(effect.get("maxMinutes", 30)) // problem.slot_minutes)
        for task in problem.tasks:
            runs = placement.get(task["id"])
            if not runs or not rule_applies(rule, task):
                continue
            max_start = max(start for start, _size in runs)
            for dependency in task.get("dependsOnTaskIds") or []:
                dependency_runs = placement.get(dependency)
                if not dependency_runs:
                    continue
                min_end = min(start + size for start, size in dependency_runs)
                if max_start > min_end + gap:
                    return False
    return True


def solve_greedy(problem: Problem, time_budget_seconds: float = 5.0, restarts: int = 12, max_iters: int = 25):
    """Run the production greedy scheduler against a benchmark `Problem`."""
    started = time.perf_counter()
    result = production_greedy.solve(
        _context(problem),
        time_budget_seconds=time_budget_seconds,
        restarts=restarts,
        max_iters=max_iters,
    )
    total = time.perf_counter() - started
    placement = result["placement"]
    return {
        "placement": placement,
        "constructSeconds": total,  # construction is no longer measured separately
        "totalSeconds": total,
        "iterations": result["iterations"],
        "restarts": result["restarts"],
        "hitBudget": total >= time_budget_seconds * 0.95,
        "feasible": _feasible(problem, placement),
    }
