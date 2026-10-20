"""Unit tests for the default (greedy) solver path.

The CP-SAT model keeps its own coverage in `test_scheduler.py`; these tests exercise the worker's
production default — construction + local search — through the same `solve(payload)` protocol.

Run from the repo root:

    uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
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


def payload(tasks, rules=None, config=None, horizon_days=2):
    """No `solver` key: the worker's default must be the greedy scheduler."""
    return {
        "now": NOW.isoformat(),
        "horizonDays": horizon_days,
        "config": config or {},
        "tasks": tasks,
        "timeBlocks": [],
        "weather": [],
        "rules": rules or [],
    }


def window(start, end):
    return {
        "id": f"window-{start}-{end}",
        "title": f"window {start}-{end}",
        "enabled": True,
        "applies": {"always": True},
        "effect": {"type": "timeWindow", "start": start, "end": end},
        "strength": {"kind": "hard"},
        "reason": f"window {start}-{end}",
    }


def intervals(result):
    """(taskId, start, end) for every emitted assignment."""
    return [
        (assignment["taskId"], S.parse_datetime(assignment["startAt"]), S.parse_datetime(assignment["endAt"]))
        for assignment in result["assignments"]
    ]


class DefaultSolverTest(unittest.TestCase):
    def test_default_config_uses_the_greedy_solver(self):
        result = S.solve(payload([task(1)]))
        self.assertEqual(S.DEFAULT_CONFIG["solver"], "greedy")
        self.assertEqual(result["modelVersion"], S.GREEDY_MODEL_VERSION)

    def test_cp_sat_is_still_selectable(self):
        result = S.solve(payload([task(1)], config={"solver": "cp-sat"}))
        self.assertEqual(result["modelVersion"], S.MODEL_VERSION)

    def test_same_payload_yields_the_same_schedule(self):
        tasks = [task(index, rank=index, durationMinutesRemaining=60 + 30 * (index % 3)) for index in range(1, 9)]
        first = S.solve(payload(tasks))
        second = S.solve(payload(tasks))
        self.assertEqual(first["assignments"], second["assignments"])
        self.assertEqual(first["scores"], second["scores"])

    def test_assignments_never_overlap(self):
        tasks = [task(index, rank=index, durationMinutesRemaining=90) for index in range(1, 12)]
        spans = intervals(S.solve(payload(tasks)))
        self.assertTrue(spans)
        for index, (task_id, start, end) in enumerate(spans):
            self.assertLess(start, end)
            for other_id, other_start, other_end in spans[index + 1:]:
                overlaps = start < other_end and other_start < end
                self.assertFalse(overlaps, f"{task_id} overlaps {other_id}")

    def test_hard_window_is_respected(self):
        rules = [window("09:00", "11:00")]
        result = S.solve(payload([task(1, durationMinutesRemaining=60)], rules=rules))
        self.assertTrue(result["assignments"])
        for _task_id, start, end in intervals(result):
            self.assertGreaterEqual(start.astimezone(LOCAL).hour, 9)
            self.assertLessEqual(end.astimezone(LOCAL).hour, 11)

    def test_dependency_order_and_within_after(self):
        rules = [
            window("07:00", "09:00"),
            {
                "id": "gap",
                "title": "within 30m",
                "enabled": True,
                "applies": {"taskHasTag": "outside"},
                "effect": {"type": "withinAfter", "maxMinutes": 30},
                "strength": {"kind": "hard"},
                "reason": "within 30m",
            },
        ]
        tasks = [
            task(1, durationMinutesRemaining=30, tagIds=["wake"]),
            task(2, durationMinutesRemaining=30, tagIds=["outside"], dependsOnTaskIds=[1]),
        ]
        spans = {task_id: (start, end) for task_id, start, end in intervals(S.solve(payload(tasks, rules=rules)))}
        self.assertIn(1, spans)
        self.assertIn(2, spans)
        self.assertGreaterEqual(spans[2][0], spans[1][1])
        self.assertLessEqual(spans[2][0] - spans[1][1], timedelta(minutes=30))

    def test_unplaceable_task_reports_a_reason(self):
        # 08:00-09:00 is the only allowed hour, so a 120-minute task cannot fit.
        rules = [window("08:00", "09:00")]
        result = S.solve(payload([task(1, durationMinutesRemaining=120)], rules=rules))
        self.assertIn(1, result["unscheduledTaskIds"])
        reasons = result["unscheduled"][0]["reasons"]
        self.assertTrue(reasons)
        self.assertIn(reasons[0]["type"], ("no_eligible_slots", "capacity"))


class SplittableTest(unittest.TestCase):
    def test_splittable_work_is_split_into_independent_units(self):
        # One day, one 60-minute window: a 120-minute splittable task cannot fit whole, but two of
        # its four units fit, and it still counts as scheduled (k independent units).
        rules = [window("09:00", "10:00")]
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=True)], rules=rules, horizon_days=1))
        self.assertEqual(result["scores"]["decision"]["placed"], 1)
        minutes = sum((end - start).total_seconds() / 60 for _task_id, start, end in intervals(result))
        self.assertEqual(minutes, 60)

    def test_non_splittable_work_is_all_or_nothing(self):
        rules = [window("09:00", "10:00")]
        result = S.solve(payload([task(1, durationMinutesRemaining=120, splittable=False)], rules=rules, horizon_days=1))
        self.assertEqual(result["assignments"], [])
        self.assertEqual(result["scores"]["decision"]["placed"], 0)


class RankingTest(unittest.TestCase):
    def test_higher_priority_work_wins_a_contested_slot(self):
        # One day, one 60-minute window, two 60-minute tasks: only one can be placed.
        rules = [window("09:00", "10:00")]
        tasks = [
            task(1, priority=0, durationMinutesRemaining=60),
            task(2, priority=3, durationMinutesRemaining=60),
        ]
        result = S.solve(payload(tasks, rules=rules, horizon_days=1))
        self.assertEqual([task_id for task_id, _start, _end in intervals(result)], [1])


if __name__ == "__main__":
    unittest.main()
