"""Request in, schedule out: prepares the problem, dispatches to a solver, shapes the result.

The worker is a pure function: `now` and `horizonDays` come from the payload, so the same payload
always yields the same schedule — with either solver.

`_prepare` parses the payload once: slot grid, day indexes, per-task hard eligibility, and the
priority weights. Both solvers receive that same context, so they cannot disagree about what is
placeable or how work is prioritized.

The solvers live next to this file and share one signature, `solve(ctx) -> (placement, status,
objective)`:

  * `cp_sat.py` — the integer program (optional, `config["solver"] == "cp-sat"`).
  * `greedy.py` — greedy + local search, the default.

Output shaping is shared, so the control plane and the UI do not care which solver ran.
"""

import math
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import cp_sat, greedy
from .config import DEFAULT_CONFIG, GREEDY_MODEL_VERSION, MODEL_VERSION
from .objective import decision_weights, soft_totals
from .rules import eligible_slots
from .timegrid import build_slots, overlaps, parse_datetime
from .weather import weather_by_hour


def _prepare(payload):
    """Parse the payload into the shared problem both solvers consume."""
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

    eligible_by_task = {}
    required_by_task = {}
    hard_reasons_by_task = {}
    for task in tasks:
        task_id = task["id"]
        required_by_task[task_id] = math.ceil(task["durationMinutesRemaining"] / slot_minutes)
        eligible, applied_hard = eligible_slots(task, slots, busy_indices, rules, weather_hours)
        eligible_by_task[task_id] = eligible
        hard_reasons_by_task[task_id] = applied_hard

    return {
        "config": config,
        "tz": tz,
        "slot_minutes": slot_minutes,
        "slots": slots,
        "slot_count": slot_count,
        "horizon_start": horizon_start,
        "horizon_end": horizon_end,
        "tasks": tasks,
        "task_by_id": {task["id"]: task for task in tasks},
        "rules": rules,
        "busy_indices": busy_indices,
        "weather_hours": weather_hours,
        "dates": dates,
        "day_of": day_of,
        "day_count": day_count,
        "day_weekday": day_weekday,
        "eligible_by_task": eligible_by_task,
        "required_by_task": required_by_task,
        "hard_reasons_by_task": hard_reasons_by_task,
        "weights": decision_weights(tasks, config["priorityMode"]),
    }


def solve(payload):
    started = time.perf_counter()
    ctx = _prepare(payload)
    config = ctx["config"]
    solver_name = (config.get("solver") or "greedy").lower()

    if solver_name == "cp-sat":
        placement, solver_status, objective_value = cp_sat.solve(ctx)
        model_version = MODEL_VERSION
    else:
        placement, solver_status, objective_value = greedy.solve(ctx)
        model_version = GREEDY_MODEL_VERSION
    if config.get("debugTiming"):
        print(f"[timing] solver={solver_name} total={time.perf_counter() - started:.2f}s", file=sys.stderr)

    slots = ctx["slots"]
    tasks = ctx["tasks"]
    eligible_by_task = ctx["eligible_by_task"]
    required_by_task = ctx["required_by_task"]

    # ---- Output -----------------------------------------------------------------------
    assignments = []
    unscheduled = []
    by_priority = {}
    for task in tasks:
        task_id = task["id"]
        if task_id not in placement:
            reasons = []
            if not eligible_by_task[task_id]:
                reasons.append({"type": "no_eligible_slots", "detail": "No eligible slots in the horizon."})
            elif required_by_task[task_id] > len(eligible_by_task[task_id]):
                reasons.append({"type": "no_eligible_slots", "detail": "Not enough eligible slots to fit the estimate."})
            else:
                reasons.append({"type": "capacity", "detail": "Did not fit the week."})
            for reason in ctx["hard_reasons_by_task"][task_id]:
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
        "style": soft_totals(placement, tasks, ctx["rules"], slots, ctx["slot_minutes"], ctx["weather_hours"]),
    }
    return {
        "modelVersion": model_version,
        "horizonStart": ctx["horizon_start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "horizonEnd": ctx["horizon_end"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "assignments": assignments,
        "unscheduled": unscheduled,
        "unscheduledTaskIds": [entry["taskId"] for entry in unscheduled],
        "scores": scores,
        "solverStatus": solver_status,
        "objectiveValue": int(objective_value),
    }
