"""Objective helpers and the greedy compaction post-pass.

`decision_weights` and the per-day group counts feed the single weighted objective in `solve.py`.
`compact` runs after the solve to realize `preferEarlier` without making it an objective term.
"""

from .rules import (
    day_group_ids,
    rule_applies,
    rule_strength,
    style_windows,
    when_matches,
    window_slot_indices,
    within_after_bounds,
)
from .timegrid import next_day
from .weather import slot_weather, weather_is_nice


def decision_weights(tasks, mode):
    """Per-priority weights for the decision term.

    "weighted" self-scales so each level outweighs the total of every lower level (priority is
    never traded for count). "fair" ignores priority.
    """
    levels = sorted({task["priority"] for task in tasks})
    if mode == "fair":
        return {level: 1 for level in levels}
    weights = {}
    lower_total = 0
    for level in levels:
        weights[level] = lower_total + 1
        lower_total += weights[level] * sum(1 for task in tasks if task["priority"] == level)
    return weights


def run_capacity(eligible, slot_count):
    """For each eligible slot, how long a run may be before it leaves eligibility.

    A run may cross midnight (a sleep block does); it stops only where eligibility stops.
    """
    eligible_set = set(eligible)
    capacity = {}
    for start in eligible:
        cursor, length = start, 0
        while cursor < slot_count and cursor in eligible_set:
            length += 1
            cursor += 1
        capacity[start] = length
    return capacity


def group_day_counts(model, prefix, group, task_runs, day_of, day_count):
    """Per-day occupied slots for a tag group, as a list of int vars (one per day).

    Shared by `spread` (minutes/day) and `dailyBudget` (count/day). `span` is an upper bound on
    the group's total slots, used as the big-M and the soft-term bound.
    """
    span = max(1, sum(run["size"] for task in group for run in task_runs.get(task["id"], [])))
    per_task = [[model.new_int_var(0, span, f"{prefix}_dt_{task['id']}_{day}") for day in range(day_count)]
                for task in group]
    for task_index, task in enumerate(group):
        for index, run in enumerate(task_runs.get(task["id"], [])):
            day_var = model.new_int_var(0, day_count - 1, f"{prefix}_day_{task['id']}_{index}")
            model.add_element(run["start"], day_of, day_var)
            for day in range(day_count):
                on_day = model.new_bool_var(f"{prefix}_on_{task['id']}_{index}_{day}")
                model.add_allowed_assignments([day_var, on_day], [[d, int(d == day)] for d in range(day_count)])
                contribution = per_task[task_index][day]
                model.add(contribution == run["size"]).only_enforce_if(on_day)
                model.add(contribution == 0).only_enforce_if(on_day.Not())
    totals = []
    for day in range(day_count):
        total = model.new_int_var(0, span, f"{prefix}_total_{day}")
        model.add(total == sum(per_task[index][day] for index in range(len(group))))
        totals.append(total)
    return totals, span


def topological_order(tasks):
    """Tasks with a dependency before the tasks that depend on them (cycles ignored)."""
    by_id = {task["id"]: task for task in tasks}
    visited, order = set(), []

    def visit(task_id, stack):
        if task_id in visited or task_id not in by_id or task_id in stack:
            return
        stack.add(task_id)
        for dep in by_id[task_id].get("dependsOnTaskIds") or []:
            visit(dep, stack)
        stack.discard(task_id)
        visited.add(task_id)
        order.append(by_id[task_id])

    for task in tasks:
        visit(task["id"], set())
    return order


def compact(placement, tasks, slots, day_of, eligible_by_task, rules, weather_by_hour, slot_minutes):
    """Greedy post-pass: pull each block to the earliest slot that keeps every soft choice.

    A move is only accepted when the block stays hard-eligible, keeps the same soft time-window
    membership, stays on the same day for spread groups, and does not start before its
    dependencies end. This realizes `preferEarlier` without making it part of the objective.
    """
    slot_count = len(slots)
    eligible_sets = {task_id: set(slots_) for task_id, slots_ in eligible_by_task.items()}
    windows = style_windows(tasks, rules, slots, weather_by_hour)
    spread_groups = day_group_ids(tasks, rules)
    within_after = within_after_bounds(tasks, rules, slot_minutes)
    occupied = set()
    for runs in placement.values():
        for start, size in runs:
            occupied.update(range(start, start + size))
    task_end = {task_id: max((start + size for start, size in runs), default=0)
                for task_id, runs in placement.items()}

    for task in topological_order(tasks):
        task_id = task["id"]
        if not placement.get(task_id):
            continue
        lower = 0
        for dep in task.get("dependsOnTaskIds") or []:
            lower = max(lower, task_end.get(dep, 0))
        # Keep withinAfter: moving this prerequisite earlier must not open the gap past the limit.
        task_size = max((size for _start, size in placement[task_id]), default=0)
        for dependent_id, gap_slots in within_after.get(task_id, []):
            if placement.get(dependent_id):
                dependent_start = min(start for start, _size in placement[dependent_id])
                lower = max(lower, dependent_start - gap_slots - task_size)
        kept = []
        for start, size in sorted(placement[task_id], key=lambda run: run[0]):
            for slot in range(start, start + size):
                occupied.discard(slot)
            membership = tuple(start in window for window in windows.get(task_id, []))
            day = day_of[start]
            group = spread_groups.get(task_id)
            chosen = start
            for candidate in eligible_by_task.get(task_id, []):
                if candidate < lower:
                    continue
                if candidate + size > slot_count:
                    break
                if any(slot not in eligible_sets[task_id] or day_of[slot] != day_of[candidate] or slot in occupied
                       for slot in range(candidate, candidate + size)):
                    continue
                if tuple(candidate in window for window in windows.get(task_id, [])) != membership:
                    continue
                if group is not None and day_of[candidate] != day:
                    continue
                chosen = candidate
                break
            kept.append((chosen, size))
            for slot in range(chosen, chosen + size):
                occupied.add(slot)
        placement[task_id] = kept
        task_end[task_id] = max((start + size for start, size in kept), default=0)
    return placement


def soft_totals(placement, tasks, rules, slots, slot_minutes, weather_by_hour):
    """Final style value (window/weather bonuses minus spread/budget penalties) for reporting."""
    total = 0
    for rule in rules:
        kind, weight = rule_strength(rule)
        if kind != "soft":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        when = effect.get("when")
        value = int(round(weight))
        if effect_type == "assignDays":
            inside = {s["index"] for s in slots
                      if s["weekday"] in set(effect.get("days") or []) and when_matches(when, s)}
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], []) if start in inside)
        elif effect_type in ("preferTimeOfDay", "timeWindow"):
            inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], []) if start in inside)
        elif effect_type == "weatherGate":
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], [])
                                 if weather_is_nice(slot_weather(slots[start], weather_by_hour), effect) is True)
        elif effect_type == "spread":
            group = [task for task in tasks if rule_applies(rule, task)]
            if len(group) < 2:
                continue
            totals = {}
            for task in group:
                for start, size in placement.get(task["id"], []):
                    totals[slots[start]["date"]] = totals.get(slots[start]["date"], 0) + size
            max_slots = max(1, int(effect.get("maxPerDayMinutes", 120)) // slot_minutes)
            total -= value * sum(max(0, count - max_slots) for count in totals.values())
            if effect.get("minDistinctDays"):
                active = sorted(date for date, count in totals.items() if count > 0)
                total += value * len(active)
                if effect.get("avoidConsecutive"):
                    total -= value * sum(1 for index in range(len(active) - 1)
                                         if next_day(active[index]) == active[index + 1])
        elif effect_type == "dailyBudget":
            group = [task for task in tasks if rule_applies(rule, task)]
            if not group:
                continue
            totals = {}
            for task in group:
                for start, size in placement.get(task["id"], []):
                    totals[slots[start]["date"]] = totals.get(slots[start]["date"], 0) + size
            soft_max = max(1, int(effect.get("softMaxPerDay", 1)))
            total += value * sum(1 for count in totals.values() if count > 0)
            total -= value * sum(max(0, count - soft_max) for count in totals.values())
    return total
