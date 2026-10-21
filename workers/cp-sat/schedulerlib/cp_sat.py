"""The CP-SAT scheduler: one integer program per payload.

A non-splittable task is a single optional interval; a splittable task is `remaining / slot`
unit intervals gated by one all-or-nothing `scheduled` literal (so a task is either scheduled in
full or not at all). One `NoOverlap` keeps every interval and fixed commitment apart. Hard rules
shrink each task's allowed starts; soft rules become weighted terms in a single objective whose
decision term is scaled above the soft total, so a preference can never drop a task.

`solve(ctx)` consumes the shared context built by `solve._prepare`, so both schedulers agree on
what is placeable and how work is prioritized. Returns `(placement, status_name, objective)`.
"""

from __future__ import annotations

import math
import sys
import time

from ortools.sat.python import cp_model

from .objective import compact, group_day_counts, run_capacity
from .rules import day_matches, rule_applies, rule_strength, when_matches, window_slot_indices
from .weather import slot_weather, weather_is_nice


def solve(ctx):
    """Build and solve the CP-SAT model.

    Returns `(placement, solver_status_name, objective_value)`.
    """
    started = time.perf_counter()
    config = ctx["config"]
    slot_minutes = ctx["slot_minutes"]
    slots = ctx["slots"]
    slot_count = ctx["slot_count"]
    tasks = ctx["tasks"]
    rules = ctx["rules"]
    weather_hours = ctx["weather_hours"]
    day_of = ctx["day_of"]
    day_count = ctx["day_count"]
    day_weekday = ctx["day_weekday"]
    eligible_by_task = ctx["eligible_by_task"]
    required_by_task = ctx["required_by_task"]

    model = cp_model.CpModel()
    scheduled = {}
    task_runs = {}

    for task in tasks:
        task_id = task["id"]
        required = required_by_task[task_id]
        eligible = eligible_by_task[task_id]
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
    weights = ctx["weights"]
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
                        [[slot, int(when_matches(when, slots[slot])
                                    and weather_is_nice(slot_weather(slots[slot], weather_hours), effect) is True)]
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
                if day_matches(when, day_weekday[day]):
                    model.add(excess >= totals[day] - max_slots)
                else:
                    model.add(excess == 0)
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
                if not day_matches(when, day_weekday[day]):
                    continue
                is_active = model.new_bool_var(f"dbact_{rule['id']}_{day}")
                model.add(totals[day] >= 1).only_enforce_if(is_active)
                model.add(totals[day] == 0).only_enforce_if(is_active.Not())
                add_soft(value * is_active, value)
                excess = model.new_int_var(0, span, f"dbex_{rule['id']}_{day}")
                model.add(excess >= totals[day] - soft_max)
                add_soft(-value * excess, value * span)

    model.maximize((2 * soft_bound + 1) * sum(decision_terms) + sum(soft_terms))
    built_at = time.perf_counter()

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
    solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    if config.get("debugTiming"):
        print(f"[timing] build={built_at - started:.2f}s solve={time.perf_counter() - built_at:.2f}s "
              f"total={time.perf_counter() - started:.2f}s", file=sys.stderr)

    placement = {}
    if solved:
        for task_id, runs in task_runs.items():
            if runs and solver.value(scheduled[task_id]):
                placement[task_id] = [(solver.value(run["start"]), run["size"]) for run in runs]
        if config.get("compact", True):
            placement = compact(placement, tasks, slots, day_of, eligible_by_task, rules, weather_hours, slot_minutes)
    return placement, solver.status_name(status), (int(solver.objective_value) if solved else 0)
