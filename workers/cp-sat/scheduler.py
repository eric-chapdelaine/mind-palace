import json
import math
import sys
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model


SLOT_MINUTES = 30
TIME_ZONE = ZoneInfo("America/New_York")


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def overlaps(start: datetime, end: datetime, block: dict) -> bool:
    return start < parse(block["endAt"]) and end > parse(block["startAt"])


def scheduling_horizon(now: datetime) -> tuple[datetime, datetime]:
    local = now.astimezone(TIME_ZONE)
    minute = 30 if local.minute < 30 else 0
    rounded = local.replace(minute=minute, second=0, microsecond=0)
    if local.minute >= 30:
        rounded += timedelta(hours=1)
    end_date = local.date() + timedelta(days=6 - local.weekday())
    return rounded, datetime.combine(end_date + timedelta(days=1), time.min, TIME_ZONE)


def solve(payload: dict) -> dict:
    horizon_start, horizon_end = scheduling_horizon(datetime.now(TIME_ZONE))
    slots = []
    cursor = horizon_start
    while cursor < horizon_end:
        next_cursor = cursor + timedelta(minutes=SLOT_MINUTES)
        if 7 <= cursor.hour < 23:
            slots.append((cursor, next_cursor))
        cursor = next_cursor

    existing_blocks = [block for block in payload["timeBlocks"] if block["status"] in ("accepted", "completed")]
    fixed_tasks = [task for task in payload["tasks"] if "mind-palace:calendar-event" in task["tagIds"]]
    for task in fixed_tasks:
        if task.get("fixedStart") and task.get("fixedEnd"):
            existing_blocks.append({"startAt": task["fixedStart"], "endAt": task["fixedEnd"], "status": "accepted"})

    available_slots = [
        index for index, (start, end) in enumerate(slots)
        if not any(overlaps(start, end, block) for block in existing_blocks)
    ]
    candidates = [task for task in payload["tasks"] if task not in fixed_tasks]
    model = cp_model.CpModel()
    selected = {}
    scheduled = {}
    starts = []

    for task in candidates:
        task_id = task["id"]
        required = math.ceil(task["durationMinutes"] / SLOT_MINUTES)
        scheduled[task_id] = model.new_bool_var(f"scheduled_{task_id}")
        selected[task_id] = {}
        eligible = []
        for slot_index in available_slots:
            start, end = slots[slot_index]
            if task.get("earliestStart") and start < parse(task["earliestStart"]).astimezone(TIME_ZONE):
                continue
            if task.get("deadlineAt") and end > parse(task["deadlineAt"]).astimezone(TIME_ZONE):
                continue
            selected[task_id][slot_index] = model.new_bool_var(f"task_{task_id}_slot_{slot_index}")
            eligible.append(slot_index)
        model.add(sum(selected[task_id].values()) == required * scheduled[task_id])

        if eligible:
            prior = None
            run_length = max(1, math.ceil(task["maxChunkMinutes"] / SLOT_MINUTES))
            for slot_index in eligible:
                current = selected[task_id][slot_index]
                start_var = model.new_bool_var(f"task_{task_id}_start_{slot_index}")
                if prior is None or slot_index - 1 not in selected[task_id]:
                    model.add(start_var == current)
                else:
                    model.add(start_var >= current - prior)
                    model.add(start_var <= current)
                    model.add(start_var <= 1 - prior)
                starts.append(start_var)
                prior = current
            if not task["splittable"]:
                model.add(sum(starts[-len(eligible):]) <= 1)
            else:
                for offset in range(len(eligible) - run_length):
                    window = eligible[offset:offset + run_length + 1]
                    if window[-1] - window[0] == run_length:
                        model.add(sum(selected[task_id][index] for index in window) <= run_length)

    for slot_index in available_slots:
        occupants = [variables[slot_index] for variables in selected.values() if slot_index in variables]
        if occupants:
            model.add(sum(occupants) <= 1)

    objective = []
    for task in candidates:
        priority_weight = max(0, task["priority"] + 1000) * 1_000_000
        rank_weight = int(task["rank"] * 1000)
        objective.append((priority_weight + rank_weight) * scheduled[task["id"]])
    objective.extend(-100 * start for start in starts)
    model.maximize(sum(objective))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"CP-SAT did not produce a feasible result: {solver.status_name(status)}")

    assignments = []
    unscheduled = []
    for task in candidates:
        task_id = task["id"]
        if not solver.value(scheduled[task_id]):
            unscheduled.append(task_id)
            continue
        for slot_index, variable in selected[task_id].items():
            if solver.value(variable):
                start, end = slots[slot_index]
                assignments.append({
                    "taskId": task_id,
                    "startAt": start.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
                    "endAt": end.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
                })

    return {
        "horizonStart": horizon_start.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "horizonEnd": horizon_end.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "assignments": assignments,
        "unscheduledTaskIds": unscheduled,
        "solverStatus": solver.status_name(status),
        "objectiveValue": solver.objective_value,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(solve(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
