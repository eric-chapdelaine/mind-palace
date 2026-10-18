"""A greedy-construction + local-search scheduler scored against the exact same objective.

This is the honest competitor to CP-SAT: it re-uses the worker's `eligible_slots` (so hard rules
and weather gates are identical), and it optimises the same soft rule semantics as `soft_totals`
(a per-slot window/weather gain, plus per-day spread/daily-budget contributions). Construction is
priority-ordered; local search relocates blocks for style and can evict strictly-less-important
tasks to place a higher-priority one.
"""

from __future__ import annotations

import math
import random
import time

from instance import Problem
from schedulerlib.rules import (
    day_matches,
    rule_applies,
    rule_strength,
    when_matches,
    window_slot_indices,
)
from schedulerlib.timegrid import next_day
from schedulerlib.weather import slot_weather, weather_is_nice


class SoftModel:
    """Incremental view of the soft objective: per-slot gain + per-day group counts."""

    def __init__(self, problem: Problem):
        self.p = problem
        self.slot_gain = {task["id"]: [0] * problem.slot_count for task in problem.tasks}
        self.group_specs = []
        self.counts = {}
        self._build()

    def _build(self):
        p = self.p
        slots = p.slots
        for rule in p.rules:
            kind, weight = rule_strength(rule)
            if kind != "soft":
                continue
            effect = rule.get("effect") or {}
            etype = effect.get("type")
            value = int(round(weight))
            when = effect.get("when")
            applies = [task for task in p.tasks if rule_applies(rule, task)]
            if etype == "assignDays":
                inside = {
                    s["index"]
                    for s in slots
                    if s["weekday"] in set(effect.get("days") or []) and when_matches(when, s)
                }
                for task in applies:
                    gains = self.slot_gain[task["id"]]
                    for index in inside:
                        gains[index] += value
            elif etype in ("preferTimeOfDay", "timeWindow"):
                inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
                for task in applies:
                    gains = self.slot_gain[task["id"]]
                    for index in inside:
                        gains[index] += value
            elif etype == "weatherGate":
                for s in slots:
                    if when_matches(when, s) and weather_is_nice(slot_weather(s, p.weather_hours), effect) is True:
                        for task in applies:
                            self.slot_gain[task["id"]][s["index"]] += value
            elif etype in ("spread", "dailyBudget"):
                key = (etype, rule["id"])
                self.counts[key] = [0] * p.day_count
                days = {d for d in range(p.day_count) if day_matches(when, p.day_weekday[d])}
                spec = {
                    "kind": etype,
                    "key": key,
                    "value": value,
                    "task_ids": {task["id"] for task in applies},
                    "days": days,
                }
                if etype == "spread":
                    spec["max_slots"] = max(1, int(effect.get("maxPerDayMinutes", 120)) // p.slot_minutes)
                    spec["min_distinct"] = bool(effect.get("minDistinctDays"))
                    spec["avoid_consecutive"] = bool(effect.get("avoidConsecutive"))
                else:
                    spec["soft_max"] = max(1, int(effect.get("softMaxPerDay", 1)))
                self.group_specs.append(spec)

    def contribution(self, spec) -> int:
        counts = self.counts[spec["key"]]
        if spec["kind"] == "spread":
            if len(spec["task_ids"]) < 2:
                return 0
            total = -spec["value"] * sum(max(0, counts[d] - spec["max_slots"]) for d in spec["days"])
            if spec["min_distinct"]:
                active = [d for d in range(self.p.day_count) if counts[d] > 0]
                total += spec["value"] * len(active)
                if spec["avoid_consecutive"]:
                    total -= spec["value"] * sum(
                        1 for i in range(len(active) - 1)
                        if next_day(self.p.dates[active[i]]) == self.p.dates[active[i + 1]]
                    )
            return total
        if not spec["task_ids"]:
            return 0
        total = 0
        for d in spec["days"]:
            if counts[d] > 0:
                total += spec["value"]
            total -= spec["value"] * max(0, counts[d] - spec["soft_max"])
        return total

    def slot_gains(self, task_id: int, starts) -> int:
        gains = self.slot_gain[task_id]
        return sum(gains[s] for s in starts)

    def delta(self, task_id: int, starts, sign: int) -> int:
        """Score change from adding (sign=+1) / removing (sign=-1) a task's units. No mutation."""
        total = sign * self.slot_gains(task_id, starts)
        if not self.group_specs:
            return total
        days = [self.p.day_of[s] for s in starts]
        for spec in self.group_specs:
            if task_id not in spec["task_ids"]:
                continue
            before = self.contribution(spec)
            counts = self.counts[spec["key"]]
            for d in days:
                counts[d] += sign
            after = self.contribution(spec)
            for d in days:
                counts[d] -= sign
            total += after - before
        return total

    def apply(self, task_id: int, runs, sign: int) -> None:
        if not self.group_specs:
            return
        for spec in self.group_specs:
            if task_id not in spec["task_ids"]:
                continue
            counts = self.counts[spec["key"]]
            for start, _size in runs:
                counts[self.p.day_of[start]] += sign


class GreedyScheduler:
    def __init__(self, problem: Problem, order_variant: int = 0, jitter_seed: int = 0, max_iters: int = 25):
        self.p = problem
        self.max_iters = max_iters
        self.order_variant = order_variant
        self.rng = random.Random(jitter_seed)
        # Diversification noise: 0 for the canonical run, a small amount for restarts so the
        # packings differ without abandoning the soft objective.
        self.explore = 0.0 if order_variant == 0 else 3.0
        self.jitter = {task["id"]: self.rng.random() for task in problem.tasks}
        self.task_by_id = {task["id"]: task for task in problem.tasks}
        self.task_ids = set(self.task_by_id)
        self.deps = {
            task["id"]: [d for d in (task.get("dependsOnTaskIds") or []) if d in self.task_ids]
            for task in problem.tasks
        }
        self.within_after = {}
        for rule in problem.rules:
            kind, _weight = rule_strength(rule)
            if kind != "hard" or (rule.get("effect") or {}).get("type") != "withinAfter":
                continue
            gap = max(0, math.ceil(int((rule.get("effect") or {}).get("maxMinutes", 30)) / problem.slot_minutes))
            for task in problem.tasks:
                if rule_applies(rule, task):
                    current = self.within_after.get(task["id"])
                    self.within_after[task["id"]] = gap if current is None else min(current, gap)
        self.placement: dict = {}
        self.occupied: set = set()
        self.soft = SoftModel(problem)
        self.eligible_set = {tid: set(slots) for tid, slots in problem.eligible_by_task.items()}
        self.running_style = 0

    # ---- state helpers ---------------------------------------------------------------
    def commit(self, task, runs):
        runs = [tuple(run) for run in runs]
        self.running_style += self.soft.delta(task["id"], [s for s, _size in runs], +1)
        self.placement[task["id"]] = runs
        for start, size in runs:
            self.occupied.update(range(start, start + size))
        self.soft.apply(task["id"], runs, +1)

    def uncommit(self, task_id):
        runs = self.placement.pop(task_id)
        self.running_style += self.soft.delta(task_id, [s for s, _size in runs], -1)
        for start, size in runs:
            for slot in range(start, start + size):
                self.occupied.discard(slot)
        self.soft.apply(task_id, runs, -1)
        return runs

    def order_key(self, task):
        p = self.p
        eligible = len(p.eligible_by_task.get(task["id"], []))
        duration = -task["durationMinutesRemaining"]
        rank = -task["rank"]
        by_variant = {
            0: (eligible, duration, rank),
            1: (duration, eligible, rank),
            2: (rank, eligible, duration),
            3: (eligible, rank, duration),
        }
        fields = by_variant.get(self.order_variant, by_variant[0])
        return (-p.weights[task["priority"]], *fields, self.jitter[task["id"]])

    def _dep_bounds(self, task):
        lower = 0
        upper = None
        gap = self.within_after.get(task["id"])
        for dep in self.deps.get(task["id"], []):
            runs = self.placement.get(dep)
            if not runs:
                return None
            max_end = max(s + size for s, size in runs)
            min_end = min(s + size for s, size in runs)
            lower = max(lower, max_end)
            if gap is not None:
                bound = min_end + gap
                upper = bound if upper is None else min(upper, bound)
        return lower, upper

    def placement_score(self, task_id, runs) -> int:
        starts = [s for s, _size in runs]
        return self.soft.delta(task_id, starts, +1)

    def best_placement(self, task):
        p = self.p
        requirement = p.required_by_task[task["id"]]
        bounds = self._dep_bounds(task)
        if bounds is None:
            return None
        lower, upper = bounds
        eligible = p.eligible_by_task.get(task["id"], [])
        gains = self.soft.slot_gain[task["id"]]
        occupied = self.occupied
        if task.get("splittable", False):
            candidates = [
                s for s in eligible
                if s >= lower and (upper is None or s <= upper) and s not in occupied
            ]
            if len(candidates) < requirement:
                return None
            candidates.sort(key=lambda s: (-gains[s], s))
            chosen = sorted(candidates[:requirement])
            return [(s, 1) for s in chosen]
        best = None
        best_score = None
        eligible_set = self.eligible_set[task["id"]]
        for start in eligible:
            if start < lower:
                continue
            if upper is not None and start > upper:
                continue
            end = start + requirement
            if end > p.slot_count:
                break
            blocked = False
            for slot in range(start, end):
                if slot not in eligible_set or slot in occupied:
                    blocked = True
                    break
            if blocked:
                continue
            score = sum(gains[start:end])
            score += self.soft.delta(task["id"], range(start, end), +1)
            if self.explore:
                score += self.rng.random() * self.explore
            if best_score is None or score > best_score or (score == best_score and start < best[0]):
                best_score = score
                best = [start]
        if best is None:
            return None
        return [(best[0], requirement)]

    def feasible(self) -> bool:
        for task in self.p.tasks:
            deps = self.deps.get(task["id"], [])
            placed = self.placement.get(task["id"])
            if placed is None:
                # An unplaced task is fine unless a placed task depends on it? deps point from
                # task to prerequisite, so only placed tasks need their deps placed.
                continue
            minimal_placed = all(self.placement.get(dep) for dep in deps)
            if not minimal_placed:
                return False
            starts = [s for s, _size in placed]
            min_start = min(starts)
            max_start = max(starts)
            gap = self.within_after.get(task["id"])
            for dep in deps:
                dep_runs = self.placement[dep]
                dep_max_end = max(s + size for s, size in dep_runs)
                dep_min_end = min(s + size for s, size in dep_runs)
                if min_start < dep_max_end:
                    return False
                if gap is not None and max_start > dep_min_end + gap:
                    return False
        return True

    # ---- construction ----------------------------------------------------------------
    def construct(self):
        decided = set()
        remaining = set(self.task_ids)
        while remaining:
            ready = [tid for tid in remaining if all(dep in decided for dep in self.deps.get(tid, []))]
            if not ready:
                ready = list(remaining)
            tid = min(ready, key=lambda value: self.order_key(self.task_by_id[value]))
            task = self.task_by_id[tid]
            runs = self.best_placement(task)
            if runs:
                self.commit(task, runs)
            decided.add(tid)
            remaining.discard(tid)

    # ---- local search -----------------------------------------------------------------
    def _relocate(self) -> bool:
        order = sorted(
            (self.task_by_id[tid] for tid in self.placement),
            key=lambda task: (-self.p.weights[task["priority"]], -task["durationMinutesRemaining"]),
        )
        changed = False
        for task in order:
            if task["id"] not in self.placement:
                continue
            current = self.uncommit(task["id"])
            current_score = self.placement_score(task["id"], current)
            candidate = self.best_placement(task)
            if candidate is not None:
                candidate_score = self.placement_score(task["id"], candidate)
                if candidate_score > current_score or (candidate_score == current_score and candidate < current):
                    self.commit(task, candidate)
                    if self.feasible():
                        changed = True
                        continue
                    self.uncommit(task["id"])
            self.commit(task, current)
        return changed

    def _insert(self) -> bool:
        unscheduled = sorted(
            (task for task in self.p.tasks if task["id"] not in self.placement),
            key=lambda task: (-self.p.weights[task["priority"]], -task["durationMinutesRemaining"]),
        )
        changed = False
        for task in unscheduled:
            candidate = self.best_placement(task)
            if candidate is not None:
                self.commit(task, candidate)
                changed = True
        return changed

    def _swap_pass(self, pair_budget: int = 4000) -> bool:
        """2-opt: uncommit a pair, re-place both, keep the move only if style improves.

        This is what lets greedy place a same-priority task that a single relocate cannot (the
        schedule is nearly full, so no one-at-a-time move opens a slot). Bounded by `pair_budget`
        so large instances stay fast.
        """
        unscheduled = [task for task in self.p.tasks if task["id"] not in self.placement]
        if not unscheduled:
            return False
        target_priorities = {task["priority"] for task in unscheduled}
        order = sorted(self.placement, key=lambda tid: self.task_by_id[tid]["durationMinutesRemaining"])
        explored = 0
        changed = False
        for index, a_id in enumerate(order):
            a = self.task_by_id[a_id]
            for b_id in order[index + 1:]:
                explored += 1
                if explored > pair_budget:
                    return changed
                b = self.task_by_id[b_id]
                if a["priority"] not in target_priorities and b["priority"] not in target_priorities:
                    continue
                before = self.running_style
                a_runs, b_runs = self.uncommit(a_id), self.uncommit(b_id)
                ra = self.best_placement(a)
                if ra is not None:
                    self.commit(a, ra)
                    rb = self.best_placement(b)
                    if rb is not None:
                        self.commit(b, rb)
                        if self.running_style > before and self.feasible():
                            return True
                        self.uncommit(b_id)
                    self.uncommit(a_id)
                self.commit(a, a_runs)
                self.commit(b, b_runs)
        return changed

    def _evict_insert(self) -> bool:
        unscheduled = sorted(
            (task for task in self.p.tasks if task["id"] not in self.placement),
            key=lambda task: (-self.p.weights[task["priority"]], -task["durationMinutesRemaining"]),
        )
        changed = False
        for task in unscheduled:
            if task["id"] in self.placement:
                continue
            weight = self.p.weights[task["priority"]]
            evictable = [
                tid for tid in list(self.placement)
                if self.p.weights[self.task_by_id[tid]["priority"]] < weight
            ]
            if not evictable:
                continue
            saved = [(tid, self.uncommit(tid)) for tid in evictable]
            candidate = self.best_placement(task)
            if candidate is None:
                for tid, runs in saved:
                    self.commit(self.task_by_id[tid], runs)
                continue
            self.commit(task, candidate)
            for tid, runs in saved:
                other = self.task_by_id[tid]
                reinsert = self.best_placement(other)
                if reinsert is not None:
                    self.commit(other, reinsert)
            changed = True
        return changed

    def local_search(self, deadline: float):
        iterations = 0
        while time.perf_counter() < deadline and iterations < self.max_iters:
            iterations += 1
            changed = self._relocate()
            changed = self._insert() or changed
            if not changed:
                changed = self._swap_pass()
            if not changed:
                changed = self._evict_insert()
            if not changed:
                break
        return iterations

    # ---- entry point -----------------------------------------------------------------
    def run(self, deadline: float, local_search: bool = True):
        started = time.perf_counter()
        self.construct()
        construct_time = time.perf_counter() - started
        iterations = 0
        if local_search:
            iterations = self.local_search(deadline)
        return {
            "placement": self.placement,
            "constructSeconds": construct_time,
            "totalSeconds": time.perf_counter() - started,
            "iterations": iterations,
        }


def solve_greedy(problem: Problem, time_budget_seconds: float = 5.0, restarts: int = 12, max_iters: int = 25):
    """Multi-restart greedy construction, then local search on the best packing.

    The first `restarts` constructions are diversified (order + a little noise); they are cheap,
    so we spend up to half the budget on them and the rest refining the best one. Decision is
    compared lexicographically before style, because the production objective makes priority
    strictly dominate soft preference.
    """
    started = time.perf_counter()
    deadline = started + time_budget_seconds
    construct_deadline = started + time_budget_seconds * 0.5

    best_scheduler = None
    best_score = None
    completed_restarts = 0
    construct_seconds = 0.0
    for restart in range(restarts):
        if restart > 0 and time.perf_counter() >= construct_deadline:
            break
        scheduler = GreedyScheduler(problem, order_variant=restart % 4, jitter_seed=restart + 1, max_iters=max_iters)
        started_construct = time.perf_counter()
        scheduler.construct()
        construct_seconds += time.perf_counter() - started_construct
        score = (problem.decision_score(scheduler.placement), problem.style(scheduler.placement))
        if best_score is None or score > best_score:
            best_score = score
            best_scheduler = scheduler
        completed_restarts += 1

    best_scheduler.explore = 0.0
    iterations = best_scheduler.local_search(deadline)
    total = time.perf_counter() - started
    return {
        "placement": best_scheduler.placement,
        "constructSeconds": construct_seconds,
        "totalSeconds": total,
        "iterations": iterations,
        "restarts": completed_restarts,
        "hitBudget": total >= time_budget_seconds * 0.95,
        "feasible": best_scheduler.feasible(),
    }
