"""Shared plumbing for the CP-SAT-vs-greedy benchmark.

Nothing here changes the production worker. It re-uses the worker's own pure helpers so both
competitors are judged against the exact same hard-eligibility rules, soft-rule semantics, and
objective. `Problem` is the parsed scheduling instance; `evaluate` is the common scorecard.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from schedulerlib.config import DEFAULT_CONFIG  # noqa: E402
from schedulerlib.objective import decision_weights, soft_totals  # noqa: E402
from schedulerlib.rules import (  # noqa: E402
    day_matches,
    eligible_slots,
    rule_applies,
    rule_strength,
    when_matches,
    window_slot_indices,
)
from schedulerlib.timegrid import build_slots  # noqa: E402
from schedulerlib.weather import slot_weather, weather_by_hour, weather_is_nice  # noqa: E402


def expand_splittable(payload: dict) -> dict:
    """Model each splittable task as `ceil(minutes / slot)` independent unit tasks.

    Production models a splittable task as a single all-or-nothing `scheduled` boolean spanning
    several 1-slot intervals. Here we deliberately relax that: every 30-minute unit becomes its
    own task that inherits the parent's tags, priority, rank and dependencies, so units are
    scheduled — and may be left unplaced — independently ("k independent tasks", not
    all-or-nothing). `Problem.from_payload` and the CP-SAT runners both call this, so both
    schedulers are scored against the same model. Idempotent (unit tasks are never splittable).
    """
    config = {**DEFAULT_CONFIG, **(payload.get("config") or {})}
    slot_minutes = int(config["slotMinutes"])
    tasks = list(payload.get("tasks") or [])

    units: dict = {}
    for task in tasks:
        minutes = int(task.get("durationMinutesRemaining") or 0)
        required = math.ceil(minutes / slot_minutes) if minutes > 0 else 0
        if task.get("splittable") and required > 1:
            units[task["id"]] = [f"{task['id']}::u{index + 1}" for index in range(required)]
        else:
            units[task["id"]] = [task["id"]]

    def mapped_deps(task) -> list:
        deps = []
        for dependency in task.get("dependsOnTaskIds") or []:
            for unit in units.get(dependency, [dependency]):
                if unit not in deps:
                    deps.append(unit)
        return deps

    expanded = []
    for task in tasks:
        unit_ids = units[task["id"]]
        if len(unit_ids) == 1 and unit_ids[0] == task["id"]:
            expanded.append({**task, "splittable": False, "dependsOnTaskIds": mapped_deps(task)})
            continue
        for index, unit_id in enumerate(unit_ids):
            expanded.append({
                **task,
                "id": unit_id,
                "title": f"{task.get('title', task['id'])} ({index + 1}/{len(unit_ids)})",
                "durationMinutesRemaining": slot_minutes,
                "splittable": False,
                "dependsOnTaskIds": mapped_deps(task),
            })
    return {**payload, "tasks": expanded}


@dataclass
class Problem:
    """A parsed scheduling payload, mirroring what `solve.py` builds before the model."""

    # `from_payload` expands splittable tasks (see `expand_splittable`), so every task seen here
    # is a non-splittable unit that can be left unplaced independently.

    payload: dict
    config: dict
    tasks: list
    rules: list
    slots: list
    slot_count: int
    slot_minutes: int
    day_of: list
    day_count: int
    day_weekday: list
    dates: list
    weather_hours: dict
    eligible_by_task: dict
    required_by_task: dict
    weights: dict
    busy_indices: set

    # ---- construction ----------------------------------------------------------------
    @classmethod
    def from_payload(cls, payload: dict) -> "Problem":
        payload = expand_splittable(payload)
        config = {**DEFAULT_CONFIG, **(payload.get("config") or {})}
        tz_name = config["timeZone"]
        slot_minutes = int(config["slotMinutes"])
        now = _parse(payload["now"])
        horizon_days = int(payload.get("horizonDays", 7))
        _horizon_start, _horizon_end, slots = build_slots(now, horizon_days, config)
        slot_count = len(slots)

        tasks = list(payload.get("tasks") or [])
        rules = [rule for rule in (payload.get("rules") or []) if rule.get("enabled", True)]
        busy = [
            block
            for block in (payload.get("timeBlocks") or [])
            if block.get("status") in ("accepted", "completed")
            or (block.get("status") == "proposed" and block.get("source") == "manual")
        ]
        from schedulerlib.timegrid import overlaps  # local import keeps the header list short

        busy_indices = {
            slot["index"]
            for slot in slots
            if any(overlaps(slot, block, _tz(tz_name)) for block in busy)
        }
        weather_hours = weather_by_hour(payload.get("weather"))

        dates = sorted({slot["date"] for slot in slots})
        date_index = {date: index for index, date in enumerate(dates)}
        day_of = [date_index[slot["date"]] for slot in slots]
        day_count = len(dates)
        day_weekday = [0] * day_count
        for slot in slots:
            day_weekday[day_of[slot["index"]]] = slot["weekday"]

        eligible_by_task = {}
        required_by_task = {}
        for task in tasks:
            eligible, _reasons = eligible_slots(task, slots, busy_indices, rules, weather_hours)
            eligible_by_task[task["id"]] = eligible
            required_by_task[task["id"]] = math.ceil(task["durationMinutesRemaining"] / slot_minutes)

        return cls(
            payload=payload,
            config=config,
            tasks=tasks,
            rules=rules,
            slots=slots,
            slot_count=slot_count,
            slot_minutes=slot_minutes,
            day_of=day_of,
            day_count=day_count,
            day_weekday=day_weekday,
            dates=dates,
            weather_hours=weather_hours,
            eligible_by_task=eligible_by_task,
            required_by_task=required_by_task,
            weights=decision_weights(tasks, config.get("priorityMode", "weighted")),
            busy_indices=busy_indices,
        )

    def context(self) -> dict:
        """The context `schedulerlib.greedy.solve` consumes (what `solve._prepare` builds)."""
        return {
            "tasks": self.tasks,
            "task_by_id": {task["id"]: task for task in self.tasks},
            "rules": self.rules,
            "slots": self.slots,
            "slot_count": self.slot_count,
            "slot_minutes": self.slot_minutes,
            "eligible_by_task": self.eligible_by_task,
            "required_by_task": self.required_by_task,
            "weather_hours": self.weather_hours,
            "day_of": self.day_of,
            "day_count": self.day_count,
            "day_weekday": self.day_weekday,
            "dates": self.dates,
            "weights": self.weights,
        }

    # ---- scorecard -------------------------------------------------------------------
    def decision_score(self, placement: dict) -> int:
        return sum(self.weights[task["priority"]] for task in self.tasks if placement.get(task["id"]))

    def style(self, placement: dict) -> int:
        return soft_totals(placement, self.tasks, self.rules, self.slots, self.slot_minutes, self.weather_hours)

    def style_breakdown(self, placement: dict) -> list:
        """Per-soft-rule style contribution, mirroring `soft_totals` term by term."""
        out = []
        for rule in self.rules:
            kind, weight = rule_strength(rule)
            if kind != "soft":
                continue
            effect = rule.get("effect") or {}
            etype = effect.get("type")
            value = int(round(weight))
            when = effect.get("when")
            applies = [task for task in self.tasks if rule_applies(rule, task)]
            if etype == "assignDays":
                inside = {
                    s["index"]
                    for s in self.slots
                    if s["weekday"] in set(effect.get("days") or []) and when_matches(when, s)
                }
                total = value * sum(
                    1 for task in applies for start, _size in placement.get(task["id"], []) if start in inside
                )
            elif etype in ("preferTimeOfDay", "timeWindow"):
                inside = window_slot_indices(self.slots, effect.get("start", "00:00"), effect.get("end", "23:59"), when)
                total = value * sum(
                    1 for task in applies for start, _size in placement.get(task["id"], []) if start in inside
                )
            elif etype == "weatherGate":
                inside = {
                    s["index"]
                    for s in self.slots
                    if when_matches(when, s)
                    and weather_is_nice(slot_weather(s, self.weather_hours), effect) is True
                }
                total = value * sum(
                    1 for task in applies for start, _size in placement.get(task["id"], []) if start in inside
                )
            elif etype in ("spread", "dailyBudget"):
                counts = {}
                for task in applies:
                    for start, size in placement.get(task["id"], []):
                        date = self.slots[start]["date"]
                        counts[date] = counts.get(date, 0) + size
                total = 0
                if etype == "spread":
                    if len(applies) >= 2:
                        max_slots = max(1, int(effect.get("maxPerDayMinutes", 120)) // self.slot_minutes)
                        total -= value * sum(
                            max(0, count - max_slots)
                            for date, count in counts.items()
                            if day_matches(when, _weekday_of(self.slots, date))
                        )
                        if effect.get("minDistinctDays"):
                            active = sorted(counts)
                            total += value * len(active)
                            if effect.get("avoidConsecutive"):
                                from schedulerlib.timegrid import next_day

                                total -= value * sum(
                                    1 for i in range(len(active) - 1) if next_day(active[i]) == active[i + 1]
                                )
                else:
                    if applies:
                        soft_max = max(1, int(effect.get("softMaxPerDay", 1)))
                        matching = [count for date, count in counts.items() if day_matches(when, _weekday_of(self.slots, date))]
                        total += value * sum(1 for count in matching if count > 0)
                        total -= value * sum(max(0, count - soft_max) for count in matching)
            else:
                continue
            out.append({"title": rule.get("title", rule.get("id")), "type": etype, "value": total})
        return out

    def evaluate(self, placement: dict) -> dict:
        by_priority = {}
        placed = 0
        for task in self.tasks:
            if placement.get(task["id"]):
                placed += 1
                by_priority[task["priority"]] = by_priority.get(task["priority"], 0) + 1
        return {
            "placed": placed,
            "of": len(self.tasks),
            "weightedDecision": self.decision_score(placement),
            "style": self.style(placement),
            "byPriority": by_priority,
        }


def _weekday_of(slots, date):
    for slot in slots:
        if slot["date"] == date:
            return slot["weekday"]
    raise KeyError(date)


def _parse(value: str):
    from schedulerlib.timegrid import parse_datetime

    return parse_datetime(value)


def _tz(name: str):
    from zoneinfo import ZoneInfo

    return ZoneInfo(name)


def placement_from_assignments(problem: Problem, assignments: list) -> dict:
    """Group CP-SAT's per-unit assignments back into the {task_id: [(start, size), ...]} shape."""
    from datetime import timezone

    start_index = {
        slot["start"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"): slot["index"]
        for slot in problem.slots
    }
    placement: dict = {}
    for assignment in assignments:
        index = start_index.get(_normalize(assignment["startAt"]))
        if index is None:
            raise ValueError(f"assignment start not on the slot grid: {assignment['startAt']}")
        size = int(
            (_parse(assignment["endAt"]).timestamp() - _parse(assignment["startAt"]).timestamp())
            // (problem.slot_minutes * 60)
        )
        placement.setdefault(assignment["taskId"], []).append((index, size))
    for runs in placement.values():
        runs.sort()
    return placement


def _normalize(iso: str) -> str:
    from datetime import timezone

    return _parse(iso).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def occupied_slots(placement: dict) -> set:
    occupied = set()
    for runs in placement.values():
        for start, size in runs:
            occupied.update(range(start, start + size))
    return occupied


def check_no_overlap(placement: dict) -> bool:
    seen = set()
    for runs in placement.values():
        for start, size in runs:
            for slot in range(start, start + size):
                if slot in seen:
                    return False
                seen.add(slot)
    return True


def check_eligibility(problem: Problem, placement: dict) -> list:
    """Return a list of hard-constraint violations (empty == feasible)."""
    violations = []
    for task_id, runs in placement.items():
        eligible = set(problem.eligible_by_task.get(task_id, []))
        for start, size in runs:
            for slot in range(start, start + size):
                if slot not in eligible:
                    violations.append(f"task {task_id} uses ineligible slot {slot}")
    return violations


def check_dependency_order(problem: Problem, placement: dict) -> list:
    """Dependencies placed in order, and `withinAfter` maximum gaps respected."""
    violations = []
    task_by_id = {task["id"]: task for task in problem.tasks}
    for task_id, runs in placement.items():
        first_start = min(start for start, _size in runs)
        for dependency in task_by_id[task_id].get("dependsOnTaskIds") or []:
            dependency_runs = placement.get(dependency)
            if not dependency_runs:
                violations.append(f"task {task_id} placed before unplaced dependency {dependency}")
            elif first_start < max(start + size for start, size in dependency_runs):
                violations.append(f"task {task_id} starts before dependency {dependency} ends")
    for rule in problem.rules:
        effect = rule.get("effect") or {}
        if effect.get("type") != "withinAfter":
            continue
        gap = max(0, int(effect.get("maxMinutes", 30)) // problem.slot_minutes)
        for task in problem.tasks:
            runs = placement.get(task["id"])
            if not runs or not rule_applies(rule, task):
                continue
            last_start = max(start for start, _size in runs)
            for dependency in task.get("dependsOnTaskIds") or []:
                dependency_runs = placement.get(dependency)
                if not dependency_runs:
                    continue
                earliest_end = min(start + size for start, size in dependency_runs)
                if last_start > earliest_end + gap:
                    violations.append(f"task {task['id']} breaks withinAfter on {dependency}")
    return violations
