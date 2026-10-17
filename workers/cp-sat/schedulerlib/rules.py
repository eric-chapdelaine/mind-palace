"""Rule evaluation: which tasks a rule governs, and how it shapes placement.

Rules are data. `applies` selects tasks; `effect` either restricts eligible slots (hard) or is
compiled into the objective (soft). This module owns the task/effect side; the objective helpers
in `objective.py` consume the placement sets produced here.
"""

import math

from .timegrid import minutes_of_day, parse_datetime
from .weather import slot_weather, weather_is_nice


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


def day_matches(when, weekday):
    """Does a Python weekday (0=Mon .. 6=Sun) pass a rule's `when` day filter?"""
    if not when:
        return True
    days = when.get("dayOfWeek")
    return days is None or weekday in set(days)


def when_matches(when, slot):
    """Placement-scoped gate: does this slot match the rule's `when` condition?

    `applies` selects *which tasks* a rule governs; `when` decides whether the term applies to a
    particular placement (used by "outings at 5pm on weekdays"-style rules).
    """
    return day_matches(when, slot["weekday"])


def window_slot_indices(slots, start_clock, end_clock, when=None):
    """Slot indices whose local start is in [start, end) and matches `when`. start > end wraps."""
    start = minutes_of_day(start_clock)
    end = minutes_of_day(end_clock)
    inside = set()
    for slot in slots:
        if not when_matches(when, slot):
            continue
        minute = slot["minuteOfDay"]
        if start <= end:
            matches = start <= minute < end
        else:
            matches = minute >= start or minute < end
        if matches:
            inside.add(slot["index"])
    return inside


def eligible_slots(task, slots, busy_indices, rules, weather_by_hour):
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
                        if slots[index]["weekday"] in allowed and when_matches(when, slots[index])]
            applied_hard.append(rule.get("reason") or rule.get("id"))
        elif effect_type == "timeWindow":
            window = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
            eligible = [index for index in eligible if index in window]
            applied_hard.append(rule.get("reason") or rule.get("id"))
        elif effect_type == "weatherGate":
            eligible = [index for index in eligible
                        if when_matches(when, slots[index])
                        and weather_is_nice(slot_weather(slots[index], weather_by_hour), effect) is not False]
            applied_hard.append(rule.get("reason") or rule.get("id"))

    if task.get("earliestStart"):
        boundary = parse_datetime(task["earliestStart"])
        eligible = [index for index in eligible if slots[index]["start"] >= boundary]
    if task.get("deadlineAt"):
        boundary = parse_datetime(task["deadlineAt"])
        eligible = [index for index in eligible if slots[index]["end"] <= boundary]
    return eligible, applied_hard


def style_windows(tasks, rules, slots, weather_by_hour):
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
                      if s["weekday"] in set(effect.get("days") or []) and when_matches(when, s)}
        elif effect_type in ("preferTimeOfDay", "timeWindow"):
            inside = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
        elif effect_type == "weatherGate":
            inside = {s["index"] for s in slots
                      if when_matches(when, s) and weather_is_nice(slot_weather(s, weather_by_hour), effect) is True}
        else:
            continue
        for task in tasks:
            if rule_applies(rule, task):
                windows.setdefault(task["id"], []).append(inside)
    return windows


def day_group_ids(tasks, rules):
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


def within_after_bounds(tasks, rules, slot_minutes):
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
