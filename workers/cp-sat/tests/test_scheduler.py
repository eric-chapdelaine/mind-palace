"""Unit tests for the CP-SAT worker.

Run from the repo root:

    uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v

The worker is a pure function, so these tests build payloads directly (no DB, no server).
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scheduler as S  # noqa: E402


# Monday 2026-03-02, 12:00 UTC == 07:00 America/New_York (EST). The first slot is 07:00 local.
NOW = datetime(2026, 3, 2, 12, 0, tzinfo=timezone.utc)
LOCAL = S.ZoneInfo("America/New_York")


def task(task_id, **overrides):
    base = {
        "id": task_id,
        "title": f"task {task_id}",
        "priority": 0,
        "rank": task_id,
        "durationMinutesRemaining": 30,
        "splittable": False,
        "minChunkMinutes": 30,
        "maxChunkMinutes": 180,
        "earliestStart": None,
        "deadlineAt": None,
        "tagIds": [],
        "dependsOnTaskIds": [],
    }
    base.update(overrides)
    return base


def payload(tasks, rules=None, config=None, time_blocks=None, horizon_days=7):
    return {
        "modelVersion": S.MODEL_VERSION,
        "now": NOW.isoformat(),
        "horizonDays": horizon_days,
        "config": config or {},
        "tasks": tasks,
        "timeBlocks": time_blocks or [],
        "rules": rules or [],
    }


def slots_for(config=None):
    return S.build_slots(NOW, 7, {**S.DEFAULT_CONFIG, **(config or {})})[2]


def slot_index(start_at):
    for slot in slots_for():
        if slot["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == start_at:
            return slot["index"]
    raise AssertionError(f"{start_at} is not a slot start")


def busy_except(keep_count):
    """Accepted blocks that leave only the first `keep_count` slots available."""
    slots = slots_for()
    keep = slots[:keep_count]
    blocks = []
    if keep[-1]["end"] < slots[-1]["end"]:
        blocks.append({"status": "accepted", "startAt": keep[-1]["end"].isoformat(),
                       "endAt": slots[-1]["end"].isoformat()})
    return blocks


def rule(rule_id, effect, strength, applies=None, reason="test rule"):
    return {"id": rule_id, "enabled": True, "applies": applies or {"always": True},
            "effect": effect, "strength": strength, "reason": reason}


def no_overlaps(test, assignments):
    spans = sorted((S.parse_datetime(a["startAt"]), S.parse_datetime(a["endAt"])) for a in assignments)
    for (start_a, end_a), (start_b, _end_b) in zip(spans, spans[1:]):
        test.assertLessEqual(end_a, start_b, "assignments overlap")


class PureHelpersTest(unittest.TestCase):
    def test_build_slots_grid(self):
        horizon_start, horizon_end, slots = S.build_slots(NOW, 7, S.DEFAULT_CONFIG)
        self.assertEqual(horizon_start.isoformat(), "2026-03-02T07:00:00-05:00")
        self.assertEqual(horizon_end.isoformat(), "2026-03-09T07:00:00-04:00")  # DST transition
        self.assertEqual(len(slots), 7 * 32)
        self.assertEqual(slots[0]["weekday"], 0)  # Monday
        self.assertEqual(slots[0]["minuteOfDay"], 7 * 60)
        self.assertEqual(slots[31]["minuteOfDay"], 22 * 60 + 30)

    def test_build_slots_rounds_up_to_boundary(self):
        _, _, slots = S.build_slots(datetime(2026, 3, 2, 12, 17, tzinfo=timezone.utc), 7, S.DEFAULT_CONFIG)
        self.assertEqual(slots[0]["minuteOfDay"], 7 * 60 + 30)

    def test_condition_matches(self):
        t = task(1, tagIds=["mind-palace:morning", "fitness"])
        self.assertTrue(S.condition_matches({"taskHasTag": "fitness"}, t))
        self.assertFalse(S.condition_matches({"taskHasTag": "nope"}, t))
        self.assertTrue(S.condition_matches({"taskHasAnyTag": ["nope", "fitness"]}, t))
        self.assertTrue(S.condition_matches({"all": [{"taskHasTag": "fitness"}, {"taskHasTag": "mind-palace:morning"}]}, t))
        self.assertTrue(S.condition_matches({"not": {"taskHasTag": "nope"}}, t))
        self.assertTrue(S.condition_matches(None, t))
        self.assertFalse(S.condition_matches({"unknown": True}, t))

    def test_rule_strength(self):
        self.assertEqual(S.rule_strength({"strength": "hard"}), ("hard", None))
        self.assertEqual(S.rule_strength({"strength": {"kind": "hard"}}), ("hard", None))
        self.assertEqual(S.rule_strength({"strength": {"kind": "soft", "weight": 5}}), ("soft", 5.0))

    def test_window_slot_indices(self):
        slots = slots_for()
        morning = S.window_slot_indices(slots, "07:00", "11:00")
        self.assertEqual(len(morning), 7 * 8)
        self.assertIn(slots[0]["index"], morning)
        self.assertNotIn(slots[8]["index"], morning)  # 11:00
        overnight = S.window_slot_indices(slots, "22:00", "08:00")
        self.assertIn(slots[30]["index"], overnight)  # 22:00
        self.assertIn(slots[1]["index"], overnight)   # 07:30

    def test_decision_weights_strict_dominance(self):
        tasks = [task(1, priority=2), task(2, priority=1), task(3, priority=1), task(4, priority=0)]
        weights = S.decision_weights(tasks, "weighted")
        # A task at each level outweighs every task at every lower level combined.
        for level in (1, 2):
            lower_total = sum(weights[t["priority"]] for t in tasks if t["priority"] < level)
            self.assertGreater(weights[level], lower_total)


class SolveTest(unittest.TestCase):
    def test_horizon_comes_from_payload(self):
        result = S.solve(payload([task(1)]))
        self.assertEqual(result["modelVersion"], S.MODEL_VERSION)
        self.assertEqual(result["horizonStart"], "2026-03-02T12:00:00Z")

    def test_weighted_priority_prefers_higher(self):
        # Only one slot is available; the higher-priority task must win.
        tasks = [task(1, priority=5), task(2, priority=0)]
        result = S.solve(payload(tasks, time_blocks=busy_except(1)))
        self.assertEqual(result["unscheduledTaskIds"], [2])
        self.assertEqual(sorted({a["taskId"] for a in result["assignments"]}), [1])

    def test_priority_beats_many_lower_tasks(self):
        # One P10 task vs five P0 tasks competing for a single slot.
        tasks = [task(1, priority=10)] + [task(2 + i, priority=0) for i in range(5)]
        result = S.solve(payload(tasks, time_blocks=busy_except(1)))
        self.assertEqual(result["unscheduledTaskIds"], [2, 3, 4, 5, 6])

    def test_non_splittable_is_one_block(self):
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=False)]))
        assigned = [a for a in result["assignments"] if a["taskId"] == 1]
        self.assertEqual(len(assigned), 1)
        minutes = (S.parse_datetime(assigned[0]["endAt"]) - S.parse_datetime(assigned[0]["startAt"])).total_seconds() / 60
        self.assertEqual(minutes, 120)

    def test_splittable_is_unit_intervals(self):
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=True)]))
        assigned = [a for a in result["assignments"] if a["taskId"] == 1]
        self.assertEqual(len(assigned), 4)
        total = sum((S.parse_datetime(a["endAt"]) - S.parse_datetime(a["startAt"])).total_seconds() / 60
                    for a in assigned)
        self.assertEqual(total, 120)
        for a in assigned:
            minutes = (S.parse_datetime(a["endAt"]) - S.parse_datetime(a["startAt"])).total_seconds() / 60
            self.assertEqual(minutes, 30)

    def test_no_overlap(self):
        tasks = [task(i, durationMinutesRemaining=120) for i in range(1, 8)]
        result = S.solve(payload(tasks))
        no_overlaps(self, result["assignments"])
        self.assertEqual(len(result["unscheduled"]), 0)

    def test_hard_assign_days_restricts_to_weekday(self):
        # days are Python weekday indices: 2 == Wednesday.
        rules = [rule("wed", {"type": "assignDays", "days": [2]}, {"kind": "hard"},
                      applies={"taskHasTag": "wed"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=60, tagIds=["wed"])], rules=rules))
        for assignment in result["assignments"]:
            self.assertEqual(slots_for()[slot_index(assignment["startAt"])]["weekday"], 2)

    def test_hard_time_window_restricts(self):
        rules = [rule("morning", {"type": "timeWindow", "start": "07:00", "end": "09:00"}, {"kind": "hard"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=120)], rules=rules))
        for assignment in result["assignments"]:
            hour = S.parse_datetime(assignment["startAt"]).astimezone(LOCAL).hour
            self.assertGreaterEqual(hour, 7)
            self.assertLess(hour, 9)

    def test_soft_prefer_time_of_day_not_undone_by_compaction(self):
        # The preferred window is later than the earliest free slot; the soft bonus should win and
        # the greedy "move earlier" pass must not drag it out of the window.
        rules = [rule("evening", {"type": "preferTimeOfDay", "start": "17:00", "end": "21:00"},
                      {"kind": "soft", "weight": 5})]
        result = S.solve(payload([task(1)], rules=rules))
        hour = S.parse_datetime(result["assignments"][0]["startAt"]).astimezone(LOCAL).hour
        self.assertGreaterEqual(hour, 17)
        self.assertLess(hour, 21)

    def test_spread_distributes_across_days(self):
        rules = [rule("spread", {"type": "spread", "maxPerDayMinutes": 30},
                      {"kind": "soft", "weight": 10}, applies={"taskHasTag": "focus"})]
        tasks = [task(1, tagIds=["focus"]), task(2, tagIds=["focus"])]
        result = S.solve(payload(tasks, rules=rules))
        days = {assignment["startAt"][:10] for assignment in result["assignments"]}
        self.assertEqual(len(days), 2)

    def test_dependency_and_compaction(self):
        tasks = [task(1), task(2, dependsOnTaskIds=[1])]
        result = S.solve(payload(tasks))
        starts = {assignment["taskId"]: assignment["startAt"] for assignment in result["assignments"]}
        # Compaction pulls the prerequisite to the very first slot and the dependent right after.
        self.assertEqual(starts[1], slots_for()[0]["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"))
        self.assertLess(S.parse_datetime(starts[1]), S.parse_datetime(starts[2]))

    def test_compaction_pulls_single_task_to_first_slot(self):
        result = S.solve(payload([task(1)]))
        first = slots_for()[0]["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        self.assertEqual(result["assignments"][0]["startAt"], first)

    def test_unscheduled_reasons(self):
        rules = [rule("mon", {"type": "assignDays", "days": [0]}, {"kind": "hard"},
                      applies={"taskHasTag": "mon"}, reason="Pinned to Monday")]
        monday = [slot for slot in slots_for() if slot["weekday"] == 0]
        blocks = [{"status": "accepted", "startAt": monday[0]["start"].isoformat(),
                   "endAt": monday[-1]["end"].isoformat()}]
        result = S.solve(payload([task(1, tagIds=["mon"])], rules=rules, time_blocks=blocks))
        self.assertEqual(result["unscheduledTaskIds"], [1])
        entry = result["unscheduled"][0]
        self.assertEqual(entry["reasons"][0]["type"], "no_eligible_slots")
        self.assertTrue(any(r["type"] == "rule" and r["detail"] == "Pinned to Monday" for r in entry["reasons"]))

    def test_day_pin_overflow_spills_without_failing(self):
        # Three 8h tasks pinned to Monday; 07:00-23:00 Monday holds 16h, so one must spill.
        rules = [rule("mon", {"type": "assignDays", "days": [0]}, {"kind": "hard"}, applies={"taskHasTag": "mon"})]
        tasks = [task(i, durationMinutesRemaining=480, tagIds=["mon"]) for i in (1, 2, 3)]
        result = S.solve(payload(tasks, rules=rules))
        self.assertEqual(len(result["unscheduled"]), 1)
        self.assertEqual(result["unscheduled"][0]["reasons"][0]["type"], "capacity")

    def test_tiny_budget_still_returns_a_valid_schedule(self):
        tasks = [task(i, durationMinutesRemaining=60) for i in range(1, 30)]
        result = S.solve(payload(tasks, config={"timeBudgetSeconds": 0.5}))
        self.assertIn(result["solverStatus"], ("OPTIMAL", "FEASIBLE", "UNKNOWN"))
        no_overlaps(self, result["assignments"])

    def test_reproducible(self):
        tasks = [task(1, priority=1, durationMinutesRemaining=90, splittable=True),
                 task(2, priority=0, durationMinutesRemaining=60)]
        first = S.solve(payload(tasks))
        second = S.solve(payload(tasks))
        self.assertEqual(first["assignments"], second["assignments"])
        self.assertEqual(first["scores"], second["scores"])

    def test_scores_reported(self):
        result = S.solve(payload([task(1, priority=2)]))
        self.assertEqual(result["scores"]["decision"]["placed"], 1)
        self.assertEqual(result["scores"]["decision"]["of"], 1)
        # Direct call: Python dict keys stay ints (JSON serialization stringifies them).
        self.assertEqual(result["scores"]["decision"]["byPriority"], {2: 1})


if __name__ == "__main__":
    unittest.main()
