import json
import math
import sys
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model


SLOT_MINUTES = 30
TIME_ZONE = ZoneInfo("America/New_York")

# preferredDay is sent as a Python date.weekday() index: 0 = Monday .. 6 = Sunday.
WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


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

    available_slots = [
        index for index, (start, end) in enumerate(slots)
        if not any(overlaps(start, end, block) for block in existing_blocks)
    ]
    candidates = payload["tasks"]
    model = cp_model.CpModel()
    selected = {}
    scheduled = {}
    starts = []

    required_day_tasks: dict[int, list[dict]] = {}
    for task in candidates:
        task_id = task["id"]
        required = math.ceil(task["durationMinutesRemaining"] / SLOT_MINUTES)
        preferred_day = task.get("preferredDay")
        scheduled[task_id] = model.new_bool_var(f"scheduled_{task_id}")
        selected[task_id] = {}
        eligible = []
        for slot_index in available_slots:
            start, end = slots[slot_index]
            # A task pinned to a weekday may only use that weekday's slots.
            if preferred_day is not None and start.weekday() != preferred_day:
                continue
            if task.get("earliestStart") and start < parse(task["earliestStart"]).astimezone(TIME_ZONE):
                continue
            if task.get("deadlineAt") and end > parse(task["deadlineAt"]).astimezone(TIME_ZONE):
                continue
            selected[task_id][slot_index] = model.new_bool_var(f"task_{task_id}_slot_{slot_index}")
            eligible.append(slot_index)
        model.add(sum(selected[task_id].values()) == required * scheduled[task_id])

        # Day-pinned tasks are commitments: they must be scheduled, and only on that day.
        # When the pinned day has already passed (no eligible slots in the horizon) the
        # task is left unscheduled instead of making the whole model infeasible.
        if preferred_day is not None and eligible:
            model.add(scheduled[task_id] == 1)
            required_day_tasks.setdefault(preferred_day, []).append(task)

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

    # Ordering weights are relative only: tasks sort by (priority, rank), the
    # absolute values do not matter. The decision tier spaces tasks PRIORITY_STEP
    # apart per step of that ordering. The position tier rewards earlier slots,
    # weighted by the same ordering, but is bounded far below PRIORITY_STEP so it
    # only breaks ties between placements (it can never change which tasks get
    # scheduled): earliness per slot <= 256 * 16 and there are at most len(slots)
    # <= 224 occupied slots, so total position influence <= 917,504, plus the
    # <= 22,400 contiguity penalty, stays under the 1,000,000 decision step.
    ordered_keys = sorted({(task["priority"], task["rank"]) for task in candidates}, reverse=True)
    num_keys = len(ordered_keys)
    order_weight = {key: min(num_keys - index, 256) for index, key in enumerate(ordered_keys)}
    PRIORITY_STEP = 1_000_000
    num_slots = len(slots)

    objective = []
    for task in candidates:
        objective.append(order_weight[(task["priority"], task["rank"])] * PRIORITY_STEP * scheduled[task["id"]])
    objective.extend(-100 * start for start in starts)
    for task in candidates:
        for slot_index, variable in selected[task["id"]].items():
            earliness = (num_slots - 1 - slot_index) * 16 // max(1, num_slots - 1)
            objective.append(order_weight[(task["priority"], task["rank"])] * earliness * variable)
    model.maximize(sum(objective))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if status == cp_model.INFEASIBLE and required_day_tasks:
            commitments = []
            for day_number in sorted(required_day_tasks):
                total = sum(task["durationMinutesRemaining"] for task in required_day_tasks[day_number])
                commitments.append(f"{WEEKDAY_NAMES[day_number]}: {total} min committed")
            raise RuntimeError(
                "Committed day tasks do not fit their day (days hold 07:00-23:00 in 30-minute "
                "slots). " + ", ".join(commitments) + ". Move or remove some day tasks."
            )
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
