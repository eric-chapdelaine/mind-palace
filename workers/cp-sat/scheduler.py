"""CP-SAT scheduling worker.

The worker is a pure function: one JSON problem on stdin, one JSON solution on stdout.
It never touches SQLite; the TypeScript control plane remains the only database writer.

Design (see ~/agent-context/projects/scheduler-design.md):
  * Rules are data. A rule is {applies, effect, strength}; strength is either a hard
    constraint or a soft term assigned to a named tier.
  * Tiers are an engine-owned precedence axis. The objective is solved tier by tier
    (lexicographically): decision -> style -> fragmentation -> placement. That ordering
    is structural, so no hand-tuned constants are needed to keep tiers from colliding.
  * `now` and `horizonDays` come from the payload, so a run is reproducible.
"""

import json
import math
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

MODEL_VERSION = "cp-sat-v5"

# Slot grid / horizon defaults. Overridable per run through the payload `config`.
DEFAULT_CONFIG = {
    "slotMinutes": 30,
    "dayStart": "07:00",
    "dayEnd": "23:00",
    "timeZone": "America/New_York",
    "priorityMode": "strict",  # "strict" | "weighted" | "fair"
    "priorityExchange": 3,     # only read when priorityMode == "weighted"
}

# Soft tiers in precedence order, highest first. The engine owns this order; rules only
# choose which tier they contribute to.
SOFT_TIERS = ("style", "fragmentation", "placement")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


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
    """Return ("hard", None, None) or ("soft", tier, weight)."""
    strength = rule.get("strength")
    if strength == "hard" or (isinstance(strength, dict) and strength.get("kind") == "hard"):
        return "hard", None, None
    if isinstance(strength, dict) and strength.get("kind") == "soft":
        tier = strength.get("tier", "style")
        if tier not in SOFT_TIERS:
            raise ValueError(f"Rule {rule.get('id')!r} targets unknown tier {tier!r}")
        return "soft", tier, float(strength.get("weight", 1))
    return "hard", None, None


def rule_applies(rule, task):
    return rule.get("enabled", True) and condition_matches(rule.get("applies"), task)


def window_slot_indices(slots, start_clock, end_clock):
    """Slot indices whose local start falls in [start, end). A start > end wraps overnight."""
    start = minutes_of_day(start_clock)
    end = minutes_of_day(end_clock)
    inside = set()
    for slot in slots:
        minute = slot["minuteOfDay"]
        if start <= end:
            matches = start <= minute < end
        else:
            matches = minute >= start or minute < end
        if matches:
            inside.add(slot["index"])
    return inside


def decision_tiers(tasks, scheduled, mode, exchange):
    """The decision tier: which tasks get placed.

    strict   - one sub-tier per priority level (highest first); count dominates rank within
               a level, so a higher priority is never traded for a lower one.
    weighted - a single expression with self-scaling level weights (no magic constants).
    fair     - place as many tasks as possible; priority is ignored.
    """
    by_priority = {}
    for task in tasks:
        by_priority.setdefault(task["priority"], []).append(task)
    levels = sorted(by_priority, reverse=True)

    if mode == "fair":
        return [("decision", [scheduled[task["id"]] for task in tasks])]

    if mode == "weighted":
        scale = {}
        lower_total = 0
        for level in sorted(levels):
            scale[level] = lower_total + 1
            lower_total += scale[level] * len(by_priority[level])
        terms = [scale[task["priority"]] * scheduled[task["id"]] for task in tasks]
        return [("decision", terms)]

    tiers = []
    for level in levels:
        ordered = sorted(by_priority[level], key=lambda task: task["rank"], reverse=True)
        count = len(ordered)
        # `big` keeps count dominant over rank inside a level: one extra task outweighs any
        # rearrangement of rank weights.
        big = count * count + 1
        terms = [(big + (count - position)) * scheduled[task["id"]] for position, task in enumerate(ordered)]
        tiers.append((f"decision.p{level}", terms))
    return tiers


# --------------------------------------------------------------------------------------
# Model construction
# --------------------------------------------------------------------------------------


def _overlaps(slot, block, timezone):
    return slot["start"] < parse_datetime(block["endAt"]).astimezone(timezone) and \
        slot["end"] > parse_datetime(block["startAt"]).astimezone(timezone)


def _eligible_slots(task, slots, busy_indices, rules):
    """Slots a task may use after hard rules and its own windows are applied."""
    eligible = [slot["index"] for slot in slots if slot["index"] not in busy_indices]
    applied_hard = []
    for rule in rules:
        if not rule_applies(rule, task):
            continue
        kind, _tier, _weight = rule_strength(rule)
        if kind != "hard":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        if effect_type == "assignDays":
            allowed = set(effect.get("days") or [])
            eligible = [index for index in eligible if slots[index]["weekday"] in allowed]
            applied_hard.append(rule.get("reason") or rule.get("id"))
        elif effect_type == "timeWindow":
            window = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"))
            eligible = [index for index in eligible if index in window]
            applied_hard.append(rule.get("reason") or rule.get("id"))

    if task.get("earliestStart"):
        boundary = parse_datetime(task["earliestStart"])
        eligible = [index for index in eligible if slots[index]["start"] >= boundary]
    if task.get("deadlineAt"):
        boundary = parse_datetime(task["deadlineAt"])
        eligible = [index for index in eligible if slots[index]["end"] <= boundary]
    return eligible, applied_hard


def solve(payload):
    config = {**DEFAULT_CONFIG, **(payload.get("config") or {})}
    timezone = ZoneInfo(config["timeZone"])
    slot_minutes = int(config["slotMinutes"])
    now = parse_datetime(payload["now"]) if payload.get("now") else datetime.now(timezone)
    horizon_days = int(payload.get("horizonDays", 7))
    horizon_start, horizon_end, slots = build_slots(now, horizon_days, config)

    tasks = list(payload.get("tasks") or [])
    rules = [rule for rule in (payload.get("rules") or []) if rule.get("enabled", True)]

    busy = [block for block in (payload.get("timeBlocks") or [])
            if block.get("status") in ("accepted", "completed")]
    busy_indices = {
        slot["index"] for slot in slots
        if any(_overlaps(slot, block, timezone) for block in busy)
    }

    model = cp_model.CpModel()
    selected = {}
    scheduled = {}
    task_starts = {}
    eligible_by_task = {}
    hard_reasons_by_task = {}
    required_by_task = {}

    for task in tasks:
        task_id = task["id"]
        required = math.ceil(task["durationMinutesRemaining"] / slot_minutes)
        required_by_task[task_id] = required
        eligible, applied_hard = _eligible_slots(task, slots, busy_indices, rules)
        eligible_by_task[task_id] = eligible
        hard_reasons_by_task[task_id] = applied_hard
        scheduled[task_id] = model.new_bool_var(f"scheduled_{task_id}")
        selected[task_id] = {}

        if not eligible or required > len(eligible):
            model.add(scheduled[task_id] == 0)
            continue

        for slot_index in eligible:
            selected[task_id][slot_index] = model.new_bool_var(f"task_{task_id}_slot_{slot_index}")
        model.add(sum(selected[task_id].values()) == required * scheduled[task_id])

        run_length = max(1, math.ceil(task["maxChunkMinutes"] / slot_minutes))
        min_run = max(1, math.ceil(task["minChunkMinutes"] / slot_minutes))
        starts = []
        prior = None
        prior_index = None
        for slot_index in eligible:
            current = selected[task_id][slot_index]
            start_var = model.new_bool_var(f"task_{task_id}_start_{slot_index}")
            # Adjacency is temporal, not index-based: the overnight gap between dayEnd and the
            # next dayStart is not a continuation of a run.
            if prior is None or slots[prior_index]["end"] != slots[slot_index]["start"]:
                model.add(start_var == current)
            else:
                model.add(start_var >= current - prior)
                model.add(start_var <= current)
                model.add(start_var <= 1 - prior)
            starts.append(start_var)
            prior = current
            prior_index = slot_index
        task_starts[task_id] = starts

        if not task.get("splittable", False):
            model.add(sum(starts) <= 1)
        else:
            # Cap each contiguous run at maxChunkMinutes.
            for offset in range(len(eligible) - run_length):
                window = eligible[offset:offset + run_length + 1]
                span = slots[window[-1]]["start"] - slots[window[0]]["start"]
                if span == timedelta(minutes=run_length * slot_minutes):
                    model.add(sum(selected[task_id][index] for index in window) <= run_length)
            # Approximate minChunkMinutes as a bound on the number of runs, so a task
            # cannot be shredded into chunks shorter than the owner's floor.
            max_chunks = max(1, math.ceil(required / min_run))
            model.add(sum(starts) <= max_chunks)

    # One task per slot.
    for slot in slots:
        occupants = [selected[task_id][slot["index"]] for task_id in selected if slot["index"] in selected[task_id]]
        if occupants:
            model.add(sum(occupants) <= 1)

    # Dependencies: a prerequisite's slots all sit at-or-before the dependent's slots.
    task_by_id = {task["id"]: task for task in tasks}
    for task in tasks:
        task_id = task["id"]
        for dependency_id in task.get("dependsOnTaskIds") or []:
            prerequisite = task_by_id.get(dependency_id)
            if prerequisite is None or dependency_id not in selected:
                continue
            prerequisite_required = required_by_task[dependency_id]
            prerequisite_slots = eligible_by_task[dependency_id]
            for slot_index in eligible_by_task[task_id]:
                prefix = sum(
                    selected[dependency_id][prerequisite_index]
                    for prerequisite_index in prerequisite_slots
                    if prerequisite_index <= slot_index
                )
                model.add(prefix >= prerequisite_required * (selected[task_id][slot_index] + scheduled[dependency_id] - 1))

    # ---- Soft tiers -------------------------------------------------------------------

    style_terms = []
    fragmentation_terms = []
    placement_terms = []

    # Per-slot preferences (time windows, preferred days) become style-tier bonuses.
    for rule in rules:
        kind, tier, weight = rule_strength(rule)
        if kind != "soft" or tier != "style":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        if effect_type not in ("timeWindow", "preferTimeOfDay", "assignDays"):
            continue
        if effect_type == "assignDays":
            allowed = set(effect.get("days") or [])
            in_window = {slot["index"] for slot in slots if slot["weekday"] in allowed}
        else:
            in_window = window_slot_indices(slots, effect.get("start", "00:00"), effect.get("end", "23:59"))
        for task in tasks:
            if not rule_applies(rule, task):
                continue
            for slot_index in eligible_by_task[task["id"]]:
                if slot_index in in_window:
                    style_terms.append(int(round(weight)) * selected[task["id"]][slot_index])

    # Spread: penalize concentrating a group's work on one day.
    for rule in rules:
        kind, tier, weight = rule_strength(rule)
        if kind != "soft" or tier != "style":
            continue
        effect = rule.get("effect") or {}
        if effect.get("type") != "spread":
            continue
        group = [task for task in tasks if rule_applies(rule, task)]
        if len(group) < 2:
            continue
        max_slots = max(1, int(effect.get("maxPerDayMinutes", 120)) // slot_minutes)
        for date in sorted({slot["date"] for slot in slots}):
            day_slots = [slot["index"] for slot in slots if slot["date"] == date]
            occupancy = [
                selected[task["id"]][slot_index]
                for task in group for slot_index in day_slots
                if slot_index in selected[task["id"]]
            ]
            if not occupancy:
                continue
            excess = model.new_int_var(0, len(occupancy), f"spread_{rule['id']}_{date}")
            model.add(excess >= sum(occupancy) - max_slots)
            style_terms.append(-int(round(weight)) * excess)

    for rule in rules:
        kind, tier, weight = rule_strength(rule)
        if kind != "soft":
            continue
        effect = rule.get("effect") or {}
        effect_type = effect.get("type")
        if effect_type == "minimizeChunks":
            for task in tasks:
                # A task with no eligible slots never gets start variables; skip it.
                fragmentation_terms.extend(-int(round(weight)) * start for start in task_starts.get(task["id"], []))
        elif effect_type == "preferEarlier":
            for task in tasks:
                for slot_index in eligible_by_task[task["id"]]:
                    earliness = len(slots) - slot_index
                    placement_terms.append(int(round(weight)) * earliness * selected[task["id"]][slot_index])

    tiers = list(decision_tiers(tasks, scheduled, config["priorityMode"], config["priorityExchange"]))
    if style_terms:
        tiers.append(("style", style_terms))
    if fragmentation_terms:
        tiers.append(("fragmentation", fragmentation_terms))
    if placement_terms:
        tiers.append(("placement", placement_terms))

    solver = cp_model.CpSolver()
    # Reproducibility: a deterministic payload must yield a deterministic schedule. CP-SAT is
    # otherwise free to return any of several tied optima (and to parallelize the search).
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0

    all_variables = list(scheduled.values())
    for task_id in selected:
        all_variables.extend(selected[task_id].values())
    for task_id in task_starts:
        all_variables.extend(task_starts[task_id])

    def snapshot():
        return {variable.Index(): solver.value(variable) for variable in all_variables}

    # Staged solves share one wall-clock budget and one per-stage cap. A stage that cannot be
    # solved to optimality within its cap is accepted as FEASIBLE; if it finds nothing at all
    # (UNKNOWN), staging stops and the incumbent from earlier stages is kept. This keeps the run
    # well inside the control plane's child-process timeout and never discards a good schedule.
    budget = float(config.get("timeBudgetSeconds", 15))
    per_stage = float(config.get("stageTimeSeconds", 2))
    deadline = time.monotonic() + budget
    tier_values = {}
    incumbent = {}
    status = cp_model.OPTIMAL
    solved_once = False
    for name, terms in tiers:
        if not terms:
            continue
        remaining = deadline - time.monotonic()
        if solved_once and remaining <= 0.25:
            break
        solver.parameters.max_time_in_seconds = max(0.5, min(per_stage, remaining))
        expression = sum(terms)
        model.maximize(expression)
        status = solver.solve(model)
        if config.get("debugStages"):
            print(f"[stage] {name}: {solver.status_name(status)} ({solver.wall_time:.2f}s)", file=sys.stderr)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        solved_once = True
        incumbent = snapshot()
        tier_values[name] = solver.objective_value
        model.add(expression == int(round(solver.objective_value)))

    if not solved_once:
        # No tier produced a solution within the budget (pathologically large problem): try once
        # more for feasibility only. If even that fails, return an empty schedule rather than
        # reading undefined solver values (which would produce overlapping assignments).
        solver.parameters.max_time_in_seconds = max(0.5, min(per_stage, budget))
        status = solver.solve(model)
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            incumbent = snapshot()

    def value(variable):
        return incumbent.get(variable.Index(), 0)

    # ---- Output -----------------------------------------------------------------------

    assignments = []
    unscheduled = []
    by_priority = {}
    for task in tasks:
        task_id = task["id"]
        if not value(scheduled[task_id]):
            reasons = []
            eligible = eligible_by_task[task_id]
            if not eligible:
                reasons.append({"type": "no_eligible_slots", "detail": "No eligible slots in the horizon."})
            elif required_by_task[task_id] > len(eligible):
                reasons.append({"type": "no_eligible_slots", "detail": "Not enough eligible slots to fit the estimate."})
            else:
                reasons.append({"type": "capacity", "detail": "Did not fit the week at the decision tier."})
            for reason in hard_reasons_by_task[task_id]:
                reasons.append({"type": "rule", "detail": reason})
            unscheduled.append({"taskId": task_id, "reasons": reasons})
            continue
        by_priority[task["priority"]] = by_priority.get(task["priority"], 0) + 1
        for slot_index, variable in selected[task_id].items():
            if value(variable):
                slot = slots[slot_index]
                assignments.append({
                    "taskId": task_id,
                    "startAt": slot["start"].astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
                    "endAt": slot["end"].astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
                })

    placed = len(tasks) - len(unscheduled)
    tier_scores = {
        "decision": {"placed": placed, "of": len(tasks), "byPriority": by_priority},
        "style": tier_values.get("style", 0),
        "fragmentation": tier_values.get("fragmentation", 0),
        "placement": tier_values.get("placement", 0),
    }

    return {
        "modelVersion": MODEL_VERSION,
        "horizonStart": horizon_start.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "horizonEnd": horizon_end.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
        "assignments": assignments,
        "unscheduled": unscheduled,
        "unscheduledTaskIds": [entry["taskId"] for entry in unscheduled],
        "tierScores": tier_scores,
        "solverStatus": solver.status_name(status),
        "objectiveValue": solver.objective_value,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(solve(json.load(sys.stdin))))
    except Exception as error:  # noqa: BLE001 - protocol requires a JSON error on stdout
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
