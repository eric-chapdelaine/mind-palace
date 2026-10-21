"""Greedy + local-search scheduler.

The default scheduler. A deterministic alternative to the CP-SAT model in `cp_sat.py`; `solve.py`
dispatches between them and both return `(placement, status_name, objective)`. It optimises the
*same* objective: the worker's `decision_weights` (priority-weighted amount of work placed)
dominates, and `soft_totals`' rule semantics (per-run window/weather gains, per-day
spread/daily-budget counts) break ties.

Two properties are deliberate:

  * **Pure and deterministic.** No `now`, no wall clock in the default path, no unseeded
    randomness — the same payload always yields the same schedule. The optional time budget exists
    for benchmarking; production calls it with `time_budget_seconds=None`.
  * **Splittable tasks are k independent unit tasks.** A splittable task is scheduled as
    `ceil(minutes / slot)` independent slots that may be placed (or left unplaced) separately, so
    partial progress is allowed instead of all-or-nothing. Every unit reports back to its parent
    task id, so the emitted placement shape is unchanged.

The search is construction + first-improvement local search:

  1. `_construct` places units in strict priority order, honoring dependencies as a readiness
     filter, each at the feasible start with the best incremental soft score.
  2. `_local_search` alternates four neighbourhoods until a full pass changes nothing:
     relocate (style), insert unscheduled (decision), 2-opt swap of placed pairs (style), and
     ejection-insert (evict strictly-lower-priority work — the only decision-improving move).
  3. `solve` runs several diversified constructions and refines the best one, ranked
     lexicographically `(weighted decision, style)`.

Known limitation (accepted for v1): first-improvement pairwise moves cannot cross plateaus that
need a coordinated multi-task rearrangement, e.g. "one outing per day, starting at 17:00" where
the outing must trade days with another outing at the same time as two blocks shift 30 minutes.
CP-SAT finds those; greedy does not. See `benchmark/REPORT.md`.
"""

from __future__ import annotations

import math
import random
import time

from .objective import soft_totals
from .rules import day_matches, rule_applies, rule_strength, when_matches, window_slot_indices
from .timegrid import next_day
from .weather import slot_weather, weather_is_nice

# Canonical priority order, then a per-restart tie-break permutation. `duration` and `rank` are
# negated so an ascending sort means longest-first / highest-rank-first.
_ORDER_VARIANTS = {
    0: lambda eligible, duration, rank: (eligible, duration, rank),
    1: lambda eligible, duration, rank: (duration, eligible, rank),
    2: lambda eligible, duration, rank: (rank, eligible, duration),
    3: lambda eligible, duration, rank: (eligible, rank, duration),
}


def _expand_units(tasks, required_by_task, slot_minutes):
    """Split splittable tasks into independent units, keyed by the parent task id.

    Splittable work becomes `required` one-slot units; everything else is a single unit of
    `required` slots. Units inherit the parent's tags, priority, rank and dependencies so rule
    matching and priority ordering are unchanged.
    """
    units = []
    by_parent = {}
    for task in tasks:
        task_id = task["id"]
        required = required_by_task.get(task_id, 0)
        if required <= 0:
            by_parent[task_id] = []
            continue
        splittable = bool(task.get("splittable")) and required > 1
        count = required if splittable else 1
        size = 1 if splittable else required
        group = []
        for index in range(count):
            unit = {
                "id": (task_id, index),
                "parent": task_id,
                "size": size,
                "priority": task["priority"],
                "rank": task["rank"],
                "durationMinutesRemaining": size * slot_minutes,
                "tagIds": list(task.get("tagIds") or []),
                "dependsOnTaskIds": [],
            }
            units.append(unit)
            group.append(unit["id"])
        by_parent[task_id] = group
    return units, by_parent


class _SoftModel:
    """Incremental view of the soft objective: per-slot gain + per-day group counts.

    Mirrors `objective.soft_totals`: window/weather/assignDays gains count once per run (at its
    start) and `spread`/`dailyBudget` accumulate run *minutes* per day.
    """

    def __init__(self, ctx, units):
        self.ctx = ctx
        self.slot_gain = {unit["id"]: [0] * ctx["slot_count"] for unit in units}
        self.group_specs = []
        self.counts = {}
        self._build(units)

    def _build(self, units):
        ctx = self.ctx
        slots = ctx["slots"]
        for rule in ctx["rules"]:
            kind, weight = rule_strength(rule)
            if kind != "soft":
                continue
            effect = rule.get("effect") or {}
            etype = effect.get("type")
            value = int(round(weight))
            when = effect.get("when")
            applies = [unit for unit in units if rule_applies(rule, unit)]

            if etype in ("assignDays", "preferTimeOfDay", "timeWindow"):
                if etype == "assignDays":
                    inside = {
                        slot["index"]
                        for slot in slots
                        if slot["weekday"] in set(effect.get("days") or []) and when_matches(when, slot)
                    }
                else:
                    inside = window_slot_indices(
                        slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when
                    )
                for unit in applies:
                    gains = self.slot_gain[unit["id"]]
                    for index in inside:
                        gains[index] += value
            elif etype == "weatherGate":
                for slot in slots:
                    if when_matches(when, slot) and weather_is_nice(slot_weather(slot, ctx["weather_hours"]), effect) is True:
                        for unit in applies:
                            self.slot_gain[unit["id"]][slot["index"]] += value
            elif etype in ("spread", "dailyBudget"):
                key = (etype, rule["id"])
                self.counts[key] = [0] * ctx["day_count"]
                spec = {
                    "kind": etype,
                    "key": key,
                    "value": value,
                    "task_ids": {unit["id"] for unit in applies},
                    "days": {d for d in range(ctx["day_count"]) if day_matches(when, ctx["day_weekday"][d])},
                }
                if etype == "spread":
                    spec["max_slots"] = max(1, int(effect.get("maxPerDayMinutes", 120)) // ctx["slot_minutes"])
                    spec["min_distinct"] = bool(effect.get("minDistinctDays"))
                    spec["avoid_consecutive"] = bool(effect.get("avoidConsecutive"))
                else:
                    spec["soft_max"] = max(1, int(effect.get("softMaxPerDay", 1)))
                self.group_specs.append(spec)

    def contribution(self, spec) -> int:
        counts = self.counts[spec["key"]]
        value = spec["value"]
        if spec["kind"] == "spread":
            if len(spec["task_ids"]) < 2:
                return 0
            total = -value * sum(max(0, counts[d] - spec["max_slots"]) for d in spec["days"])
            if spec["min_distinct"]:
                active = [d for d in range(self.ctx["day_count"]) if counts[d] > 0]
                total += value * len(active)
                if spec["avoid_consecutive"]:
                    total -= value * sum(
                        1 for i in range(len(active) - 1)
                        if next_day(self.ctx["dates"][active[i]]) == self.ctx["dates"][active[i + 1]]
                    )
            return total
        if not spec["task_ids"]:
            return 0
        total = 0
        for day in spec["days"]:
            if counts[day] > 0:
                total += value
            total -= value * max(0, counts[day] - spec["soft_max"])
        return total

    def delta(self, unit_id, runs, sign: int) -> int:
        """Score change from adding (sign=+1) / removing (sign=-1) a unit's runs. No mutation."""
        total = sign * sum(self.slot_gain[unit_id][start] for start, _size in runs)
        if not self.group_specs:
            return total
        day_units = [(self.ctx["day_of"][start], size) for start, size in runs]
        for spec in self.group_specs:
            if unit_id not in spec["task_ids"]:
                continue
            counts = self.counts[spec["key"]]
            before = self.contribution(spec)
            for day, size in day_units:
                counts[day] += sign * size
            after = self.contribution(spec)
            for day, size in day_units:
                counts[day] -= sign * size
            total += after - before
        return total

    def apply(self, unit_id, runs, sign: int) -> None:
        if not self.group_specs:
            return
        for spec in self.group_specs:
            if unit_id not in spec["task_ids"]:
                continue
            counts = self.counts[spec["key"]]
            for start, size in runs:
                counts[self.ctx["day_of"][start]] += sign * size


class _Scheduler:
    def __init__(self, ctx, units, by_parent, order_variant=0, jitter_seed=0, max_iters=25):
        self.ctx = ctx
        self.max_iters = max_iters
        self.order_variant = order_variant
        self.rng = random.Random(jitter_seed)
        # Diversification noise: 0 for the canonical run, small for restarts so packings differ
        # without abandoning the soft objective.
        self.explore = 0.0 if order_variant == 0 else 3.0
        self.jitter = {unit["id"]: self.rng.random() for unit in units}
        self.unit_by_id = {unit["id"]: unit for unit in units}
        self.unit_ids = set(self.unit_by_id)
        self.deps = {
            unit["id"]: [
                dep_unit
                for dependency in self._parent(unit).get("dependsOnTaskIds") or []
                for dep_unit in by_parent.get(dependency, [])
            ]
            for unit in units
        }
        self.within_after = {}
        slot_minutes = ctx["slot_minutes"]
        for rule in ctx["rules"]:
            kind, _weight = rule_strength(rule)
            if kind != "hard" or (rule.get("effect") or {}).get("type") != "withinAfter":
                continue
            gap = max(0, math.ceil(int((rule.get("effect") or {}).get("maxMinutes", 30)) / slot_minutes))
            for unit in units:
                if rule_applies(rule, unit):
                    current = self.within_after.get(unit["id"])
                    self.within_after[unit["id"]] = gap if current is None else min(current, gap)
        self.placement = {}
        self.occupied = set()
        self.soft = _SoftModel(ctx, units)
        self.eligible_set = {
            unit["id"]: set(ctx["eligible_by_task"].get(unit["parent"], [])) for unit in units
        }
        self.running_style = 0

    def _parent(self, unit):
        return self.ctx["task_by_id"][unit["parent"]]

    # ---- state -----------------------------------------------------------------------------
    def _commit(self, unit, runs):
        runs = [tuple(run) for run in runs]
        self.running_style += self.soft.delta(unit["id"], runs, +1)
        self.placement[unit["id"]] = runs
        for start, size in runs:
            self.occupied.update(range(start, start + size))
        self.soft.apply(unit["id"], runs, +1)

    def _uncommit(self, unit_id):
        runs = self.placement.pop(unit_id)
        self.running_style += self.soft.delta(unit_id, runs, -1)
        for start, size in runs:
            for slot in range(start, start + size):
                self.occupied.discard(slot)
        self.soft.apply(unit_id, runs, -1)
        return runs

    def _priority_order(self, units):
        weights = self.ctx["weights"]
        return sorted(units, key=lambda unit: (-weights[unit["priority"]], -unit["durationMinutesRemaining"]))

    def _unscheduled(self):
        return (unit for unit in self.unit_by_id.values() if unit["id"] not in self.placement)

    def _order_key(self, unit):
        ctx = self.ctx
        variant = _ORDER_VARIANTS.get(self.order_variant, _ORDER_VARIANTS[0])
        fields = variant(
            len(ctx["eligible_by_task"].get(unit["parent"], [])),
            -unit["durationMinutesRemaining"],
            -unit["rank"],
        )
        return (-ctx["weights"][unit["priority"]], *fields, self.jitter[unit["id"]])

    def _dep_bounds(self, unit):
        """Earliest start (max prerequisite end) and optional latest start, or None if a
        prerequisite is unplaced. `withinAfter` caps how late a dependent may start."""
        lower = 0
        upper = None
        gap = self.within_after.get(unit["id"])
        for dep in self.deps.get(unit["id"], []):
            runs = self.placement.get(dep)
            if not runs:
                return None
            lower = max(lower, max(start + size for start, size in runs))
            if gap is not None:
                bound = min(start + size for start, size in runs) + gap
                upper = bound if upper is None else min(upper, bound)
        return lower, upper

    def _best_placement(self, unit):
        ctx = self.ctx
        size = unit["size"]
        bounds = self._dep_bounds(unit)
        if bounds is None:
            return None
        lower, upper = bounds
        eligible_set = self.eligible_set[unit["id"]]
        best_start = None
        best_score = None
        for start in ctx["eligible_by_task"].get(unit["parent"], []):
            if start < lower or (upper is not None and start > upper):
                continue
            if start + size > ctx["slot_count"]:
                break
            if any(slot not in eligible_set or slot in self.occupied for slot in range(start, start + size)):
                continue
            score = self.soft.delta(unit["id"], [(start, size)], +1)
            if self.explore:
                score += self.rng.random() * self.explore
            if best_score is None or score > best_score or (score == best_score and start < best_start):
                best_score = score
                best_start = start
        return [(best_start, size)] if best_start is not None else None

    def _feasible(self) -> bool:
        for unit_id, placed in self.placement.items():
            deps = self.deps.get(unit_id, [])
            if not all(self.placement.get(dep) for dep in deps):
                return False
            min_start = min(start for start, _size in placed)
            max_start = max(start for start, _size in placed)
            gap = self.within_after.get(unit_id)
            for dep in deps:
                dep_runs = self.placement[dep]
                if min_start < max(start + size for start, size in dep_runs):
                    return False
                if gap is not None and max_start > min(start + size for start, size in dep_runs) + gap:
                    return False
        return True

    # ---- construction ----------------------------------------------------------------------
    def construct(self):
        decided = set()
        remaining = set(self.unit_ids)
        while remaining:
            ready = [
                unit_id for unit_id in remaining
                if all(dep in decided for dep in self.deps.get(unit_id, []))
            ] or list(remaining)
            unit_id = min(ready, key=lambda value: self._order_key(self.unit_by_id[value]))
            runs = self._best_placement(self.unit_by_id[unit_id])
            if runs:
                self._commit(self.unit_by_id[unit_id], runs)
            decided.add(unit_id)
            remaining.discard(unit_id)

    # ---- local search ----------------------------------------------------------------------
    def _relocate(self) -> bool:
        changed = False
        for unit in self._priority_order([self.unit_by_id[unit_id] for unit_id in self.placement]):
            unit_id = unit["id"]
            current = self._uncommit(unit_id)
            candidate = self._best_placement(unit)
            if candidate is not None:
                if candidate != current:
                    self._commit(unit, candidate)
                    if self._feasible():
                        changed = True
                        continue
                    self._uncommit(unit_id)
            self._commit(unit, current)
        return changed

    def _insert(self) -> bool:
        changed = False
        for unit in self._priority_order(list(self._unscheduled())):
            candidate = self._best_placement(unit)
            if candidate is not None:
                self._commit(unit, candidate)
                changed = True
        return changed

    def _swap_pass(self, pair_budget: int = 4000) -> bool:
        """2-opt: uncommit a pair, re-place both, keep the move only if style strictly improves.

        Pairs are bounded by `pair_budget`, and at least one member must share a priority with an
        unscheduled unit, so large instances stay fast.
        """
        unscheduled = [unit for unit in self.unit_by_id.values() if unit["id"] not in self.placement]
        if not unscheduled:
            return False
        target_priorities = {unit["priority"] for unit in unscheduled}
        order = sorted(self.placement, key=lambda unit_id: self.unit_by_id[unit_id]["durationMinutesRemaining"])
        explored = 0
        for index, a_id in enumerate(order):
            a = self.unit_by_id[a_id]
            for b_id in order[index + 1:]:
                explored += 1
                if explored > pair_budget:
                    return False
                b = self.unit_by_id[b_id]
                if a["priority"] not in target_priorities and b["priority"] not in target_priorities:
                    continue
                before = self.running_style
                a_runs, b_runs = self._uncommit(a_id), self._uncommit(b_id)
                a_new = self._best_placement(a)
                if a_new is not None:
                    self._commit(a, a_new)
                    b_new = self._best_placement(b)
                    if b_new is not None:
                        self._commit(b, b_new)
                        if self.running_style > before and self._feasible():
                            return True
                        self._uncommit(b_id)
                    self._uncommit(a_id)
                self._commit(a, a_runs)
                self._commit(b, b_runs)
        return False

    def _evict_insert(self) -> bool:
        """Place an unscheduled unit by evicting strictly-lower-priority work.

        Priority weights are self-scaling, so trading a lower priority for a higher one always
        raises the objective; this is the only decision-improving neighbourhood.
        """
        weights = self.ctx["weights"]
        changed = False
        for unit in self._priority_order(list(self._unscheduled())):
            weight = weights[unit["priority"]]
            evictable = [
                unit_id for unit_id in self.placement
                if weights[self.unit_by_id[unit_id]["priority"]] < weight
            ]
            if not evictable:
                continue
            saved = [(unit_id, self._uncommit(unit_id)) for unit_id in evictable]
            candidate = self._best_placement(unit)
            if candidate is None:
                for unit_id, runs in saved:
                    self._commit(self.unit_by_id[unit_id], runs)
                continue
            self._commit(unit, candidate)
            for unit_id, runs in saved:
                reinsert = self._best_placement(self.unit_by_id[unit_id])
                if reinsert is not None:
                    self._commit(self.unit_by_id[unit_id], reinsert)
            changed = True
        return changed

    def local_search(self, deadline=None):
        iterations = 0
        while iterations < self.max_iters:
            if deadline is not None and time.perf_counter() >= deadline:
                break
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


def solve(ctx, time_budget_seconds=None, restarts=12, max_iters=25):
    """Multi-restart greedy construction, then local search on the best packing.

    Returns `(placement, "FEASIBLE", objective)` — the same shape `cp_sat.solve` returns, where the
    objective is the dominant (priority-weighted) term the worker reports.

    By default this is a pure function of `ctx` (no wall clock), so the same payload always yields
    the same schedule. `time_budget_seconds` is only for benchmarking.
    """
    started = time.perf_counter()
    deadline = None if time_budget_seconds is None else started + time_budget_seconds
    construct_deadline = None if deadline is None else started + time_budget_seconds * 0.5

    units, by_parent = _expand_units(ctx["tasks"], ctx["required_by_task"], ctx["slot_minutes"])

    def score(scheduler):
        # Decision counts *parent tasks* with at least one unit placed, which is exactly what the
        # worker reports; style is the worker's own `soft_totals` over the unit list.
        placed_parents = {scheduler.unit_by_id[unit_id]["parent"] for unit_id in scheduler.placement}
        decision = sum(ctx["weights"][ctx["task_by_id"][parent]["priority"]] for parent in placed_parents)
        unit_style = soft_totals(
            scheduler.placement, units, ctx["rules"], ctx["slots"], ctx["slot_minutes"], ctx["weather_hours"]
        )
        return decision, unit_style

    best = None
    best_score = None
    for restart in range(restarts):
        if construct_deadline is not None and restart > 0 and time.perf_counter() >= construct_deadline:
            break
        scheduler = _Scheduler(
            ctx, units, by_parent,
            order_variant=restart % 4, jitter_seed=restart + 1, max_iters=max_iters,
        )
        scheduler.construct()
        if not scheduler._feasible():
            continue
        candidate_score = score(scheduler)
        if best_score is None or candidate_score > best_score:
            best_score = candidate_score
            best = scheduler

    placement = {}
    if best is not None:
        best.explore = 0.0
        best.local_search(deadline)
        placement = _collapse(best.placement, best.unit_by_id)

    objective = sum(
        ctx["weights"][ctx["task_by_id"][task_id]["priority"]] for task_id in placement
    )
    return placement, "FEASIBLE", objective


def _collapse(placement, unit_by_id):
    """Fold unit runs back onto the parent task id (the shape `solve.py` emits)."""
    collapsed = {}
    for unit_id, runs in placement.items():
        collapsed.setdefault(unit_by_id[unit_id]["parent"], []).extend(runs)
    for runs in collapsed.values():
        runs.sort()
    return collapsed
