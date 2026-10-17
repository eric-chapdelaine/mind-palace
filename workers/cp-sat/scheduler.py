"""CP-SAT scheduling worker.

The worker is a pure function: one JSON problem on stdin, one JSON solution on stdout.
It never touches SQLite; the TypeScript control plane remains the only database writer.

Model (see ~/agent-context/projects/scheduler-design.md):
  * Work is placed directly as time intervals, not one boolean per (task, slot). A non-splittable
    task is a single optional interval; a splittable task is `remaining / slot` optional unit
    intervals (splitting is free). `NoOverlap` keeps intervals and fixed commitments apart.
  * Rules are data. `applies` selects tasks; `effect` shapes eligibility (hard) or the objective
    (soft). Tags are selectors, not behavior.
  * The objective is a single weighted expression. The decision term (which tasks get placed) is
    scaled above the total possible soft contribution, so preferences never drop a task.
    `preferEarlier` is not an objective term; it is applied afterwards by a greedy compaction pass.
  * `now` and `horizonDays` come from the payload, so a run is reproducible.
"""

import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

MODEL_VERSION = "cp-sat-v7"

# Slot grid / horizon defaults. Overridable per run through the payload `config`.
# The grid is the full day so sleep, wake, and meals can be real scheduled blocks; tasks may
# cross midnight (a sleep block spans two dates).
DEFAULT_CONFIG = {
    "slotMinutes": 30,
    "dayStart": "00:00",
    "dayEnd": "24:00",
    "timeZone": "America/New_York",
    "priorityMode": "weighted",  # "weighted" | "fair"
    "priorityExchange": 3,       # kept for payload compatibility
    "timeBudgetSeconds": 15,
    "compact": True,             # greedy post-pass that pulls blocks earlier (preferEarlier)
}


# --------------------------------------------------------------------------------------
# Pure helpers (unit-tested without the solver)
# --------------------------------------------------------------------------------------


def parse_datetime(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_clock(value):
    hour, minute = value.split(":")
    return int(hour), int(minute)


def minutes_of_day(value):
    hour, minute = parse_clock(value)
    return hour * 60 + minute


def build_slots(now, horizon_days, config):
    """Lay out the slot grid from `now`, rounded up to the next slot boundary.

    Returns (horizon_start, horizon_end, slots) where each slot carries its local
    start/end, ISO date, weekday (0=Mon), and minute-of-day.
    """
    timezone = ZoneInfo(config["timeZone"])
    slot_minutes = int(config["slotMinutes"])
    local = now.astimezone(timezone)
    remainder = local.minute % slot_minutes
    if remainder or local.second or local.microsecond:
        local = local.replace(second=0, microsecond=0) + timedelta(minutes=slot_minutes - remainder)
    else:
        local = local.replace(second=0, microsecond=0)
    horizon_end = local + timedelta(days=int(horizon_days))

    start_minutes = minutes_of_day(config["dayStart"])
    end_minutes = minutes_of_day(config["dayEnd"])

    slots = []
    cursor = local
    index = 0
    while cursor < horizon_end:
        next_cursor = cursor + timedelta(minutes=slot_minutes)
        minute_of_day = cursor.hour * 60 + cursor.minute
        if start_minutes <= minute_of_day < end_minutes:
            slots.append({
                "index": index,
                "start": cursor,
                "end": next_cursor,
                "date": cursor.date().isoformat(),
                "weekday": cursor.weekday(),
                "minuteOfDay": minute_of_day,
            })
            index += 1
        cursor = next_cursor
    return local, horizon_end, slots


def condition_matches(condition, task):
    """Evaluate a rule `applies` condition against one task. Unknown shapes do not match."""
    if condition is None:
        return True
    if condition.get("always"):
        return True
    if "taskHasTag" in condition:
        return condition["taskHasTag"] in set(task.get("tagIds") or [])
    if "taskHasAnyTag" in condition:
        return bool(set(task.get("tagIds") or []) & set(condition["taskHasAnyTag"]))
    if "all" in condition:
        return all(condition_matches(item, task) for item in condition["all"])
    if "any" in condition:
        return any(condition_matches(item, task) for item in condition["any"])
    if "not" in condition:
        return not condition_matches(condition["not"], task)
    return False


def rule_strength(rule):
    """Return ("hard", None) or ("soft", weight)."""
    strength = rule.get("strength")
    if strength == "hard" or (isinstance(strength, dict) and strength.get("kind") == "hard"):
        return "hard", None
    if isinstance(strength, dict) and strength.get("kind") == "soft":
        return "soft", float(strength.get("weight", 1))
    return "hard", None


def rule_applies(rule, task):
    return rule.get("enabled", True) and condition_matches(rule.get("applies"), task)


def _when_matches(when, slot):
    """Placement-scoped gate: does this slot match the rule's `when` condition?

    `applies` selects *which tasks* a rule governs; `when` decides whether the term applies to a
    particular placement (used by "outings at 5pm on weekdays"-style rules).
    """
    if not when:
        return True
    days = when.get("dayOfWeek")
    if days is not None and slot["weekday"] not in set(days):
        return False
    return True


def window_slot_indices(slots, start_clock, end_clock, when=None):
    """Slot indices whose local start is in [start, end) and matches `when`. start > end wraps."""
    start = minutes_of_day(start_clock)
    end = minutes_of_day(end_clock)
    inside = set()
    for slot in slots:
        if not _when_matches(when, slot):
            continue
        minute = slot["minuteOfDay"]
        if start <= end:
            matches = start <= minute < end
        else:
            matches = minute >= start or minute < end
        if matches:
            inside.add(slot["index"])
    return inside


def _overlaps(slot, block, timezone):
    return slot["start"] < parse_datetime(block["endAt"]).astimezone(timezone) and \
        slot["end"] > parse_datetime(block["startAt"]).astimezone(timezone)


def _weather_by_hour(weather):
    """Index the hourly forecast by its UTC hour so a slot can find its covering hour."""
    by_hour = {}
    for entry in weather or []:
        forecast_at = entry.get("forecastAt")
        if not forecast_at:
            continue
        try:
            key = parse_datetime(forecast_at).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        except ValueError:
            continue
        by_hour[key] = entry
    return by_hour


def _slot_weather(slot, weather_by_hour):
    key = slot["start"].astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return weather_by_hour.get(key)


def weather_is_nice(entry, effect):
    """True/False, or None when the forecast lacks the fields the rule actually checks.

    Every threshold is optional and comes from the rule, so the worker has no built-in definition
    of "nice weather". A dimension with no bound is not evaluated; a rule that sets no bounds at
    all yields None (unknown), never a silent default.
    """
    if not entry:
        return None
    checks = (
        ("temperatureF", "minTemperatureF", lambda value, bound: value < bound),
        ("temperatureF", "maxTemperatureF", lambda value, bound: value > bound),
        ("precipitationProbability", "maxPrecipitationProbability", lambda value, bound: value > bound),
        ("windMph", "maxWindMph", lambda value, bound: value > bound),
    )
    checked = False
    for field, key, violates in checks:
        bound = effect.get(key)
        if bound is None:
            continue
        value = entry.get(field)
        if value is None:
            return None
        checked = True
        if violates(value, bound):
            return False
    if effect.get("requireDaytime"):
        daytime = entry.get("isDaytime")
        if daytime is None:
            return None
        checked = True
        if daytime is False:
            return False
    return True if checked else None


def _eligible_slots(task, slots, busy_indices, rules, weather_by_hour):
    """Slots a task may use after hard rules and its own windows are applied."""
    eligible = [slot["index"] for slot in slots if slot["index"] not in busy_indices]
    applied_hard = []
    for rule in rules:
        if not rule_applies(rule, task):
            continue
        kind, _weight = rule_strength(rule)
        if kind != "hard":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        when = effect.get("when")
        if effect_type == "assignDays":
            allowed = set(effect.get("days") or [])
            eligible = [index for index in eligible
                        if slots[index]["weekday"] in allowed and _when_matches(when, slots[index])]
            applied_hard.append(rule.get("reason") or rule.get("id"))
        elif effect_type == "timeWindow":
            window = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
            eligible = [index for index in eligible if index in window]
            applied_hard.append(rule.get("reason") or rule.get("id"))
        elif effect_type == "weatherGate":
            eligible = [index for index in eligible
                        if weather_is_nice(_slot_weather(slots[index], weather_by_hour), effect) is not False]
            applied_hard.append(rule.get("reason") or rule.get("id"))

    if task.get("earliestStart"):
        boundary = parse_datetime(task["earliestStart"])
        eligible = [index for index in eligible if slots[index]["start"] >= boundary]
    if task.get("deadlineAt"):
        boundary = parse_datetime(task["deadlineAt"])
        eligible = [index for index in eligible if slots[index]["end"] <= boundary]
    return eligible, applied_hard


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


def _run_capacity(eligible, slot_count):
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


def _group_day_counts(model, prefix, group, task_runs, day_of, day_count):
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


def _topological_order(tasks):
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


def _style_windows(tasks, rules, slots, weather_by_hour):
    """Soft placement sets per task, used to keep the compaction pass from undoing style."""
    windows = {}
    for rule in rules:
        kind, _weight = rule_strength(rule)
        if kind != "soft":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        when = effect.get("when")
        if effect_type == "assignDays":
            inside = {s["index"] for s in slots
                      if s["weekday"] in set(effect.get("days") or []) and _when_matches(when, s)}
        elif effect_type in ("preferTimeOfDay", "timeWindow"):
            inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
        elif effect_type == "weatherGate":
            inside = {s["index"] for s in slots
                      if weather_is_nice(_slot_weather(s, weather_by_hour), effect) is True}
        else:
            continue
        for task in tasks:
            if rule_applies(rule, task):
                windows.setdefault(task["id"], []).append(inside)
    return windows


def _day_group_ids(tasks, rules):
    """Tasks whose placement day is fixed by a day-aware soft rule (spread / dailyBudget)."""
    group = {}
    for rule in rules:
        kind, _weight = rule_strength(rule)
        if kind != "soft":
            continue
        if (rule.get("effect") or {}).get("type") not in ("spread", "dailyBudget"):
            continue
        for task in tasks:
            if rule_applies(rule, task):
                group[task["id"]] = rule["id"]
    return group


def _within_after_bounds(tasks, rules, slot_minutes):
    """For hard `withinAfter` rules, map each prerequisite id to [(dependent_id, gap_slots)].

    The compaction pass uses this to avoid pulling a prerequisite so early that its dependent is
    left further behind than the rule allows.
    """
    bounds = {}
    for rule in rules:
        kind, _weight = rule_strength(rule)
        if kind != "hard" or (rule.get("effect") or {}).get("type") != "withinAfter":
            continue
        gap_slots = max(0, math.ceil(int((rule.get("effect") or {}).get("maxMinutes", 30)) / slot_minutes))
        for task in tasks:
            if not rule_applies(rule, task):
                continue
            for dependency_id in task.get("dependsOnTaskIds") or []:
                bounds.setdefault(dependency_id, []).append((task["id"], gap_slots))
    return bounds


def _compact(placement, tasks, slots, day_of, eligible_by_task, rules, weather_by_hour, slot_minutes):
    """Greedy post-pass: pull each block to the earliest slot that keeps every soft choice.

    A move is only accepted when the block stays hard-eligible, keeps the same soft time-window
    membership, stays on the same day for spread groups, and does not start before its
    dependencies end. This realizes `preferEarlier` without making it part of the objective.
    """
    slot_count = len(slots)
    eligible_sets = {task_id: set(slots_) for task_id, slots_ in eligible_by_task.items()}
    windows = _style_windows(tasks, rules, slots, weather_by_hour)
    spread_groups = _day_group_ids(tasks, rules)
    within_after = _within_after_bounds(tasks, rules, slot_minutes)
    occupied = set()
    for runs in placement.values():
        for start, size in runs:
            occupied.update(range(start, start + size))
    task_end = {task_id: max((start + size for start, size in runs), default=0)
                for task_id, runs in placement.items()}

    for task in _topological_order(tasks):
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


def _soft_totals(placement, tasks, rules, slots, slot_minutes, weather_by_hour):
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
                      if s["weekday"] in set(effect.get("days") or []) and _when_matches(when, s)}
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], []) if start in inside)
        elif effect_type in ("preferTimeOfDay", "timeWindow"):
            inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], []) if start in inside)
        elif effect_type == "weatherGate":
            total += value * sum(1 for task in tasks if rule_applies(rule, task)
                                 for start, _size in placement.get(task["id"], [])
                                 if weather_is_nice(_slot_weather(slots[start], weather_by_hour), effect) is True)
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
                                         if _next_day(active[index]) == active[index + 1])
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


def _next_day(date_string):
    return (datetime.fromisoformat(date_string) + timedelta(days=1)).date().isoformat()


# --------------------------------------------------------------------------------------
# Model construction + solve
# --------------------------------------------------------------------------------------


def solve(payload):
    config = {**DEFAULT_CONFIG, **(payload.get("config") or {})}
    tz = ZoneInfo(config["timeZone"])
    slot_minutes = int(config["slotMinutes"])
    now = parse_datetime(payload["now"]) if payload.get("now") else datetime.now(tz)
    horizon_days = int(payload.get("horizonDays", 7))
    horizon_start, horizon_end, slots = build_slots(now, horizon_days, config)
    slot_count = len(slots)

    tasks = list(payload.get("tasks") or [])
    rules = [rule for rule in (payload.get("rules") or []) if rule.get("enabled", True)]
    busy = [block for block in (payload.get("timeBlocks") or [])
            if block.get("status") in ("accepted", "completed")]
    busy_indices = {
        slot["index"] for slot in slots
        if any(_overlaps(slot, block, tz) for block in busy)
    }
    weather_by_hour = _weather_by_hour(payload.get("weather"))

    dates = sorted({slot["date"] for slot in slots})
    date_index = {date: index for index, date in enumerate(dates)}
    day_of = [date_index[slot["date"]] for slot in slots]
    day_count = len(dates)
    day_weekday = [0] * day_count
    for slot in slots:
        day_weekday[day_of[slot["index"]]] = slot["weekday"]

    model = cp_model.CpModel()
    build_started = time.perf_counter()
    scheduled = {}
    task_runs = {}
    eligible_by_task = {}
    required_by_task = {}
    hard_reasons_by_task = {}

    for task in tasks:
        task_id = task["id"]
        required = math.ceil(task["durationMinutesRemaining"] / slot_minutes)
        required_by_task[task_id] = required
        eligible, applied_hard = _eligible_slots(task, slots, busy_indices, rules, weather_by_hour)
        eligible_by_task[task_id] = eligible
        hard_reasons_by_task[task_id] = applied_hard
        scheduled[task_id] = model.new_bool_var(f"scheduled_{task_id}")
        capacity = _run_capacity(eligible, slot_count)
        starts_ok = [start for start in eligible if capacity[start] >= 1]
        if not eligible or required > max(capacity.values(), default=0):
            model.add(scheduled[task_id] == 0)
            task_runs[task_id] = []
            continue

        task_runs[task_id] = []
        if task.get("splittable", False):
            for index in range(required):
                start = model.new_int_var(0, slot_count - 1, f"start_{task_id}_{index}")
                model.add_allowed_assignments([start], [[value] for value in starts_ok])
                interval = model.new_optional_fixed_size_interval_var(start, 1, scheduled[task_id], f"iv_{task_id}_{index}")
                task_runs[task_id].append({"start": start, "size": 1, "present": scheduled[task_id], "interval": interval})
            for index in range(required - 1):
                left, right = task_runs[task_id][index], task_runs[task_id][index + 1]
                model.add(left["start"] <= right["start"]).only_enforce_if(scheduled[task_id])
        else:
            valid = [start for start in starts_ok if capacity[start] >= required]
            start = model.new_int_var(0, slot_count - 1, f"start_{task_id}")
            model.add_allowed_assignments([start], [[value] for value in valid])
            interval = model.new_optional_fixed_size_interval_var(start, required, scheduled[task_id], f"iv_{task_id}")
            task_runs[task_id].append({"start": start, "size": required, "present": scheduled[task_id], "interval": interval})

    intervals = [run["interval"] for runs in task_runs.values() for run in runs]
    if intervals:
        model.add_no_overlap(intervals)

    for task in tasks:
        task_id = task["id"]
        for dependency_id in task.get("dependsOnTaskIds") or []:
            if dependency_id not in scheduled or not task_runs.get(dependency_id):
                continue
            model.add(scheduled[task_id] <= scheduled[dependency_id])
            for prerequisite in task_runs[dependency_id]:
                for dependent in task_runs.get(task_id, []):
                    model.add(dependent["start"] >= prerequisite["start"] + prerequisite["size"]) \
                        .only_enforce_if([prerequisite["present"], dependent["present"]])

    # `withinAfter` tightens a dependency: the dependent must also start no more than N minutes
    # after its prerequisite ends ("get outside within 30 minutes of waking").
    for rule in rules:
        kind, _weight = rule_strength(rule)
        if kind != "hard" or (rule.get("effect") or {}).get("type") != "withinAfter":
            continue
        effect = rule["effect"]
        gap_slots = max(0, math.ceil(int(effect.get("maxMinutes", 30)) / slot_minutes))
        for task in tasks:
            if not rule_applies(rule, task):
                continue
            for dependency_id in task.get("dependsOnTaskIds") or []:
                if not task_runs.get(dependency_id):
                    continue
                for prerequisite in task_runs[dependency_id]:
                    for dependent in task_runs.get(task["id"], []):
                        model.add(dependent["start"] <= prerequisite["start"] + prerequisite["size"] + gap_slots) \
                            .only_enforce_if([prerequisite["present"], dependent["present"]])

    # ---- Objective: one weighted expression; decision scaled above all soft terms ----
    weights = decision_weights(tasks, config["priorityMode"])
    decision_terms = [weights[task["priority"]] * scheduled[task["id"]] for task in tasks]
    soft_terms = []
    soft_bound = 0

    def add_soft(term, bound):
        nonlocal soft_bound
        soft_terms.append(term)
        soft_bound += bound

    for rule in rules:
        kind, weight = rule_strength(rule)
        if kind != "soft":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        when = effect.get("when")
        value = int(round(weight))
        if effect_type in ("preferTimeOfDay", "timeWindow", "assignDays"):
            if effect_type == "assignDays":
                inside = {s["index"] for s in slots
                          if s["weekday"] in set(effect.get("days") or []) and _when_matches(when, s)}
            else:
                inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
            for task in tasks:
                if not rule_applies(rule, task):
                    continue
                for index, run in enumerate(task_runs.get(task["id"], [])):
                    in_window = model.new_bool_var(f"win_{rule['id']}_{task['id']}_{index}")
                    model.add_allowed_assignments([run["start"], in_window],
                                                  [[slot, int(slot in inside)] for slot in range(slot_count)])
                    add_soft(value * in_window, abs(value))
        elif effect_type == "weatherGate":
            for task in tasks:
                if not rule_applies(rule, task):
                    continue
                for index, run in enumerate(task_runs.get(task["id"], [])):
                    in_nice = model.new_bool_var(f"nice_{rule['id']}_{task['id']}_{index}")
                    model.add_allowed_assignments(
                        [run["start"], in_nice],
                        [[slot, int(weather_is_nice(_slot_weather(slots[slot], weather_by_hour), effect) is True)]
                         for slot in range(slot_count)],
                    )
                    add_soft(value * in_nice, abs(value))
        elif effect_type == "spread":
            group = [task for task in tasks if rule_applies(rule, task) and task_runs.get(task["id"])]
            if len(group) < 2:
                continue
            totals, span = _group_day_counts(model, f"sp_{rule['id']}", group, task_runs, day_of, day_count)
            max_slots = max(1, int(effect.get("maxPerDayMinutes", 120)) // slot_minutes)
            for day in range(day_count):
                excess = model.new_int_var(0, span, f"ex_{rule['id']}_{day}")
                model.add(excess >= totals[day] - max_slots)
                add_soft(-value * excess, value * span)
            if effect.get("minDistinctDays"):
                active = []
                for day in range(day_count):
                    is_active = model.new_bool_var(f"act_{rule['id']}_{day}")
                    model.add(totals[day] >= 1).only_enforce_if(is_active)
                    model.add(totals[day] == 0).only_enforce_if(is_active.Not())
                    active.append(is_active)
                    add_soft(value * is_active, value)
                if effect.get("avoidConsecutive"):
                    for day in range(day_count - 1):
                        both = model.new_bool_var(f"adj_{rule['id']}_{day}")
                        model.add(both >= active[day] + active[day + 1] - 1)
                        add_soft(-value * both, value)
        elif effect_type == "dailyBudget":
            group = [task for task in tasks if rule_applies(rule, task) and task_runs.get(task["id"])]
            if not group:
                continue
            totals, span = _group_day_counts(model, f"db_{rule['id']}", group, task_runs, day_of, day_count)
            soft_max = max(1, int(effect.get("softMaxPerDay", 1)))
            for day in range(day_count):
                if when and when.get("dayOfWeek") is not None and day_weekday[day] not in set(when["dayOfWeek"]):
                    continue
                is_active = model.new_bool_var(f"dbact_{rule['id']}_{day}")
                model.add(totals[day] >= 1).only_enforce_if(is_active)
                model.add(totals[day] == 0).only_enforce_if(is_active.Not())
                add_soft(value * is_active, value)
                excess = model.new_int_var(0, span, f"dbex_{rule['id']}_{day}")
                model.add(excess >= totals[day] - soft_max)
                add_soft(-value * excess, value * span)

    model.maximize((2 * soft_bound + 1) * sum(decision_terms) + sum(soft_terms))
    build_time = time.perf_counter() - build_started

    solver = cp_model.CpSolver()
    # Reproducibility: a deterministic payload must yield a deterministic schedule.
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    # The interval model is tiny, but its `allowed_assignments` domains make CP-SAT presolve
    # expensive (seconds of presolve before the first incumbent). Here presolve only slows the
    # solve and can burn the whole budget before finding anything, so it is turned off.
    solver.parameters.cp_model_presolve = False
    solver.parameters.max_time_in_seconds = float(config["timeBudgetSeconds"])
    status = solver.solve(model)
    solve_time = time.perf_counter() - build_started
    solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    placement = {}
    if solved:
        for task_id, runs in task_runs.items():
            if runs and solver.value(scheduled[task_id]):
                placement[task_id] = [(solver.value(run["start"]), run["size"]) for run in runs]
    if solved and config.get("compact", True):
        placement = _compact(placement, tasks, slots, day_of, eligible_by_task, rules, weather_by_hour, slot_minutes)
    if config.get("debugTiming"):
        print(f"[timing] build={build_time:.2f}s solve={solve_time - build_time:.2f}s "
              f"total={time.perf_counter() - build_started:.2f}s", file=sys.stderr)

    # ---- Output -----------------------------------------------------------------------
    assignments = []
    unscheduled = []
    by_priority = {}
    for task in tasks:
        task_id = task["id"]
        if task_id not in placement:
            reasons = []
            eligible = eligible_by_task[task_id]
            if not eligible:
                reasons.append({"type": "no_eligible_slots", "detail": "No eligible slots in the horizon."})
            elif required_by_task[task_id] > len(eligible):
                reasons.append({"type": "no_eligible_slots", "detail": "Not enough eligible slots to fit the estimate."})
            else:
                reasons.append({"type": "capacity", "detail": "Did not fit the week."})
            for reason in hard_reasons_by_task[task_id]:
                reasons.append({"type": "rule", "detail": reason})
            unscheduled.append({"taskId": task_id, "reasons": reasons})
            continue
        by_priority[task["priority"]] = by_priority.get(task["priority"], 0) + 1
        for start, size in placement[task_id]:
            assignments.append({
                "taskId": task_id,
                "startAt": slots[start]["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "endAt": slots[start + size - 1]["end"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            })
    assignments.sort(key=lambda item: (item["startAt"], item["taskId"]))

    placed = len(tasks) - len(unscheduled)
    scores = {
        "decision": {"placed": placed, "of": len(tasks), "byPriority": by_priority},
        "style": _soft_totals(placement, tasks, rules, slots, slot_minutes, weather_by_hour),
    }

    return {
        "modelVersion": MODEL_VERSION,
        "horizonStart": horizon_start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "horizonEnd": horizon_end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "assignments": assignments,
        "unscheduled": unscheduled,
        "unscheduledTaskIds": [entry["taskId"] for entry in unscheduled],
        "scores": scores,
        "solverStatus": solver.status_name(status),
        "objectiveValue": int(solver.objective_value) if solved else 0,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(solve(json.load(sys.stdin))))
    except Exception as error:  # noqa: BLE001 - the worker protocol returns {"error": ...}
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
