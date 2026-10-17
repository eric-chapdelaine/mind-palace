"""Model construction, solving, and output shaping.

The worker is a pure function: `now` and `horizonDays` come from the payload, so the same payload
always yields the same schedule. Work is placed as optional intervals (a non-splittable task is
one interval, a splittable task is `remaining / slot` unit intervals) and one `NoOverlap` keeps
everything apart. Accepted/completed blocks — and human-placed `manual` blocks — are busy.
"""

import math
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from .config import DEFAULT_CONFIG, MODEL_VERSION
from .objective import compact, decision_weights, group_day_counts, run_capacity, soft_totals
from .rules import eligible_slots, rule_applies, rule_strength, when_matches, window_slot_indices
from .timegrid import build_slots, overlaps, parse_datetime
from .weather import slot_weather, weather_by_hour, weather_is_nice


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
    # Busy slots: accepted/completed commitments, plus human-placed (manual) proposals, which
    # reserve their slot even before they are accepted. Solver proposals are ephemeral.
    busy = [block for block in (payload.get("timeBlocks") or [])
            if block.get("status") in ("accepted", "completed")
            or (block.get("status") == "proposed" and block.get("source") == "manual")]
    busy_indices = {
        slot["index"] for slot in slots
        if any(overlaps(slot, block, tz) for block in busy)
    }
    weather_hours = weather_by_hour(payload.get("weather"))

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
        eligible, applied_hard = eligible_slots(task, slots, busy_indices, rules, weather_hours)
        eligible_by_task[task_id] = eligible
        hard_reasons_by_task[task_id] = applied_hard
        scheduled[task_id] = model.new_bool_var(f"scheduled_{task_id}")
        capacity = run_capacity(eligible, slot_count)
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
                          if s["weekday"] in set(effect.get("days") or []) and when_matches(when, s)}
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
                        [[slot, int(weather_is_nice(slot_weather(slots[slot], weather_hours), effect) is True)]
                         for slot in range(slot_count)],
                    )
                    add_soft(value * in_nice, abs(value))
        elif effect_type == "spread":
            group = [task for task in tasks if rule_applies(rule, task) and task_runs.get(task["id"])]
            if len(group) < 2:
                continue
            totals, span = group_day_counts(model, f"sp_{rule['id']}", group, task_runs, day_of, day_count)
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
            totals, span = group_day_counts(model, f"db_{rule['id']}", group, task_runs, day_of, day_count)
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
        placement = compact(placement, tasks, slots, day_of, eligible_by_task, rules, weather_hours, slot_minutes)
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
        "style": soft_totals(placement, tasks, rules, slots, slot_minutes, weather_hours),
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
