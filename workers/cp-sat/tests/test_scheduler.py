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


def busy_except(keep_count, config=None):
    """Accepted blocks that leave only the first `keep_count` slots available."""
    slots = slots_for(config)
    keep = slots[:keep_count]
    blocks = []
    if keep and slots[0]["start"] < keep[0]["start"]:
        blocks.append({"status": "accepted", "startAt": slots[0]["start"].isoformat(), "endAt": keep[0]["start"].isoformat()})
    if keep and keep[-1]["end"] < slots[-1]["end"]:
        blocks.append({"status": "accepted", "startAt": keep[-1]["end"].isoformat(), "endAt": slots[-1]["end"].isoformat()})
    return blocks


def rule(rule_id, effect, strength, applies=None, reason="test rule"):
    return {"id": rule_id, "enabled": True, "applies": applies or {"always": True},
            "effect": effect, "strength": strength, "reason": reason}


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
        self.assertEqual(S.rule_strength({"strength": "hard"}), ("hard", None, None))
        self.assertEqual(S.rule_strength({"strength": {"kind": "hard"}}), ("hard", None, None))
        self.assertEqual(S.rule_strength({"strength": {"kind": "soft", "tier": "style", "weight": 5}}), ("soft", "style", 5.0))
        with self.assertRaises(ValueError):
            S.rule_strength({"id": "x", "strength": {"kind": "soft", "tier": "decision"}})

    def test_window_slot_indices(self):
        slots = slots_for()
        morning = S.window_slot_indices(slots, "07:00", "11:00")
        self.assertEqual(len(morning), 7 * 8)
        self.assertIn(slots[0]["index"], morning)
        self.assertNotIn(slots[8]["index"], morning)  # 11:00
        overnight = S.window_slot_indices(slots, "22:00", "08:00")
        self.assertIn(slots[30]["index"], overnight)  # 22:00
        self.assertIn(slots[1]["index"], overnight)   # 07:30

    def test_decision_tiers_strict_is_per_level(self):
        scheduled = {1: "s1", 2: "s2", 3: "s3"}
        tiers = S.decision_tiers([task(1, priority=2), task(2, priority=1), task(3, priority=1)],
                                 scheduled, "strict", 3)
        self.assertEqual([name for name, _ in tiers], ["decision.p2", "decision.p1"])
        self.assertEqual(len(tiers[0][1]), 1)
        self.assertEqual(len(tiers[1][1]), 2)

    def test_decision_tiers_fair_is_single(self):
        tiers = S.decision_tiers([task(1), task(2)], {1: "a", 2: "b"}, "fair", 3)
        self.assertEqual(len(tiers), 1)


class SolveTest(unittest.TestCase):
    def test_horizon_comes_from_payload(self):
        result = S.solve(payload([task(1)]))
        self.assertEqual(result["modelVersion"], S.MODEL_VERSION)
        self.assertEqual(result["horizonStart"], "2026-03-02T12:00:00Z")

    def test_priority_dominates_strict(self):
        # The old scalar objective dropped the P10 task for five P0 tasks; strict tiers keep it.
        tasks = [task(1, priority=10, durationMinutesRemaining=150)]
        tasks += [task(2 + i, priority=0, durationMinutesRemaining=30) for i in range(5)]
        result = S.solve(payload(tasks, time_blocks=busy_except(5)))
        self.assertEqual(result["unscheduledTaskIds"], [2, 3, 4, 5, 6])
        self.assertEqual(sorted({a["taskId"] for a in result["assignments"]}), [1])

    def test_hard_assign_days_restricts_to_weekday(self):
        # days are Python weekday indices: 2 == Wednesday.
        rules = [rule("wed", {"type": "assignDays", "days": [2]}, {"kind": "hard"},
                      applies={"taskHasTag": "wed"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=60, tagIds=["wed"])], rules=rules))
        slot_by_utc = {s["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"): s for s in slots_for()}
        for assignment in result["assignments"]:
            self.assertEqual(slot_by_utc[assignment["startAt"]]["weekday"], 2)

    def test_hard_time_window_restricts(self):
        rules = [rule("morning", {"type": "timeWindow", "start": "07:00", "end": "09:00"}, {"kind": "hard"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=120)], rules=rules))
        for assignment in result["assignments"]:
            hour = datetime.fromisoformat(assignment["startAt"].replace("Z", "+00:00")).astimezone(S.ZoneInfo("America/New_York")).hour
            self.assertGreaterEqual(hour, 7)
            self.assertLess(hour, 9)

    def test_soft_prefer_time_of_day(self):
        rules = [rule("morning", {"type": "preferTimeOfDay", "start": "07:00", "end": "11:00"},
                      {"kind": "soft", "tier": "style", "weight": 5})]
        result = S.solve(payload([task(1, durationMinutesRemaining=30)], rules=rules))
        start = datetime.fromisoformat(result["assignments"][0]["startAt"].replace("Z", "+00:00"))
        self.assertLess(start.astimezone(S.ZoneInfo("America/New_York")).hour, 11)

    def test_max_chunk_splits_splittable(self):
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=True, minChunkMinutes=30, maxChunkMinutes=30)]))
        by_utc = {s["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"): s for s in slots_for()}
        chosen = sorted((by_utc[a["startAt"]] for a in result["assignments"]), key=lambda slot: slot["start"])
        self.assertEqual(len(chosen), 4)
        # Each 30-minute chunk is isolated: no two selected slots are temporally adjacent.
        for left, right in zip(chosen, chosen[1:]):
            self.assertNotEqual(left["end"], right["start"])

    def test_min_chunk_keeps_one_run(self):
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=True, minChunkMinutes=120, maxChunkMinutes=180)]))
        indices = sorted(next(s["index"] for s in slots_for()
                              if s["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == a["startAt"])
                         for a in result["assignments"])
        self.assertEqual(indices, list(range(indices[0], indices[0] + 4)))

    def test_non_splittable_is_one_run(self):
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=False)]))
        indices = sorted(next(s["index"] for s in slots_for()
                              if s["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == a["startAt"])
                         for a in result["assignments"])
        self.assertEqual(indices, list(range(indices[0], indices[0] + 4)))

    def test_unscheduled_reasons(self):
        # Monday (weekday 0) fully blocked -> the pinned task cannot be placed.
        rules = [rule("mon", {"type": "assignDays", "days": [0]}, {"kind": "hard"},
                      applies={"taskHasTag": "mon"}, reason="Pinned to Monday")]
        # Block every Monday slot.
        monday = [s for s in slots_for() if s["weekday"] == 0]
        blocks = [{"status": "accepted", "startAt": monday[0]["start"].isoformat(), "endAt": monday[-1]["end"].isoformat()}]
        result = S.solve(payload([task(1, tagIds=["mon"])], rules=rules, time_blocks=blocks))
        self.assertEqual(result["unscheduledTaskIds"], [1])
        entry = result["unscheduled"][0]
        self.assertEqual(entry["reasons"][0]["type"], "no_eligible_slots")
        self.assertTrue(any(r["type"] == "rule" and r["detail"] == "Pinned to Monday" for r in entry["reasons"]))

    def test_day_pin_overflow_spills_without_failing(self):
        # Three 8h tasks pinned to Monday; a 07:00-23:00 Monday holds 16h, so one must spill.
        rules = [rule("mon", {"type": "assignDays", "days": [0]}, {"kind": "hard"}, applies={"taskHasTag": "mon"})]
        tasks = [task(i, durationMinutesRemaining=480, tagIds=["mon"]) for i in (1, 2, 3)]
        result = S.solve(payload(tasks, rules=rules))
        self.assertEqual(len(result["unscheduled"]), 1)
        self.assertEqual(result["unscheduled"][0]["reasons"][0]["type"], "capacity")

    def test_minimize_chunks_keeps_contiguous(self):
        rules = [rule("contig", {"type": "minimizeChunks"}, {"kind": "soft", "tier": "fragmentation", "weight": 10})]
        result = S.solve(payload([task(1, durationMinutesRemaining=60, splittable=True, maxChunkMinutes=60)], rules=rules))
        indices = sorted(next(s["index"] for s in slots_for()
                              if s["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == a["startAt"])
                         for a in result["assignments"])
        self.assertEqual(indices, list(range(indices[0], indices[0] + 2)))

    def test_overnight_gap_breaks_runs(self):
        # Leave only the last slot of day 1 (22:30) and the first of day 2 (07:00). They are not
        # temporally adjacent, so a 60-minute task may use both as two separate chunks.
        slots = slots_for()
        blocks = [
            {"status": "accepted", "startAt": slots[0]["start"].isoformat(), "endAt": slots[31]["start"].isoformat()},
            {"status": "accepted", "startAt": slots[32]["end"].isoformat(), "endAt": slots[-1]["end"].isoformat()},
        ]
        result = S.solve(payload([task(1, durationMinutesRemaining=60, splittable=True, minChunkMinutes=30, maxChunkMinutes=30)],
                                 time_blocks=blocks))
        self.assertEqual(len(result["assignments"]), 2)

    def test_global_rule_with_unplaceable_task(self):
        # A task with no eligible slots must not break global objective rules.
        rules = [rule("contig", {"type": "minimizeChunks"}, {"kind": "soft", "tier": "fragmentation", "weight": 1})]
        blocked = [{"status": "accepted", "startAt": slots_for()[0]["start"].isoformat(), "endAt": slots_for()[-1]["end"].isoformat()}]
        result = S.solve(payload([task(1), task(2)], rules=rules, time_blocks=blocked))
        self.assertEqual(sorted(result["unscheduledTaskIds"]), [1, 2])

    def test_spread_distributes_across_days(self):
        rules = [rule("spread", {"type": "spread", "maxPerDayMinutes": 30},
                      {"kind": "soft", "tier": "style", "weight": 10}, applies={"taskHasTag": "focus"})]
        tasks = [task(1, tagIds=["focus"]), task(2, tagIds=["focus"])]
        result = S.solve(payload(tasks, rules=rules))
        days = {assignment["startAt"][:10] for assignment in result["assignments"]}
        self.assertEqual(len(days), 2)

    def test_tiny_budget_still_returns_a_valid_schedule(self):
        # A tier that hits the time cap must not fail the run; the incumbent is kept, and the
        # returned blocks never overlap.
        tasks = [task(i, durationMinutesRemaining=60, splittable=True) for i in range(1, 25)]
        result = S.solve(payload(tasks, config={"timeBudgetSeconds": 0.5, "stageTimeSeconds": 0.5}))
        self.assertIn(result["solverStatus"], ("OPTIMAL", "FEASIBLE", "UNKNOWN"))
        occupied = set()
        for assignment in result["assignments"]:
            for slot in slots_for():
                if slot["start"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == assignment["startAt"]:
                    self.assertNotIn(slot["index"], occupied, "a slot was assigned twice")
                    occupied.add(slot["index"])
                    break
            else:
                self.fail(f"assignment start {assignment['startAt']} is not a slot")
        self.assertEqual(len(result["assignments"]), len(occupied))

    def test_reproducible(self):
        tasks = [task(1, priority=1, durationMinutesRemaining=90, splittable=True)]
        first = S.solve(payload(tasks))
        second = S.solve(payload(tasks))
        self.assertEqual(first["assignments"], second["assignments"])
        self.assertEqual(first["tierScores"], second["tierScores"])

    def test_tier_scores_reported(self):
        result = S.solve(payload([task(1, priority=2)]))
        self.assertEqual(result["tierScores"]["decision"]["placed"], 1)
        self.assertEqual(result["tierScores"]["decision"]["of"], 1)
        # Direct call: Python dict keys stay ints (JSON serialization stringifies them).
        self.assertEqual(result["tierScores"]["decision"]["byPriority"], {2: 1})


if __name__ == "__main__":
    unittest.main()
