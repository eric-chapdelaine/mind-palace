"""Quota and day-preference behaviour: the two use cases the rework exists for.

1. "Once this week, ideally Sunday": one interchangeable occurrence per period, a soft day
   preference that fades with distance, and no hard pin. Monday beats Tuesday when Sunday is the
   period's first day; a fully booked Monday moves the card instead of dropping it.
2. "Three times this week on three different days": a hard per-day cap over the routine's tag.
3. The exception: a fixed meeting stays possible with hard `assignDays` + hard `timeWindow`.

Both solvers must agree, so most cases run through both. Run from the repo root:

    uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v
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

# A Canadian-style Sunday-to-Saturday period, anchored the day before the horizon starts. The
# preferred Sunday is the period's first day, so Monday is one day away and Saturday is six.
PERIOD_START = "2026-03-01T00:00:00-05:00"
PERIOD_END = "2026-03-07T23:59:00-05:00"

# Real rules carry priorities/ranks; keep the fixtures boring so the rule is the only influence.
WEIGHT = 35


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


def period_task(task_id, **overrides):
    """A quota occurrence: its window is the whole period, so its day is not decided yet."""
    return task(task_id, earliestStart=PERIOD_START, deadlineAt=PERIOD_END, **overrides)


def payload(tasks, rules=None, solver="greedy", time_blocks=None, horizon_days=7):
    return {
        "now": NOW.isoformat(),
        "horizonDays": horizon_days,
        "config": {"solver": solver},
        "tasks": tasks,
        "timeBlocks": time_blocks or [],
        "weather": [],
        "rules": rules or [],
    }


def rule(rule_id, effect, strength, applies=None, reason=None):
    return {
        "id": rule_id,
        "title": rule_id,
        "enabled": True,
        "applies": applies or {"always": True},
        "effect": effect,
        "strength": strength,
        "reason": reason or rule_id,
    }


def by_tag(public_id):
    return {"taskHasTag": public_id}


def soft_day_rule(days, weight=WEIGHT, tag=None):
    return rule(
        f"prefer-{days}",
        {"type": "assignDays", "days": days},
        {"kind": "soft", "weight": weight},
        applies=by_tag(tag) if tag else None,
        reason="prefer these days",
    )


def per_day_cap(tag, max_per_day=1):
    return rule(
        f"cap-{tag}",
        {"type": "perDayLimit", "maxPerDay": max_per_day},
        {"kind": "hard"},
        applies=by_tag(tag),
        reason=f"at most {max_per_day} {tag} per day",
    )


def assignments(result):
    return [(item["taskId"], S.parse_datetime(item["startAt"]).astimezone(LOCAL),
             S.parse_datetime(item["endAt"]).astimezone(LOCAL)) for item in result["assignments"]]


def day_keys(result):
    return {start.date().isoformat() for _task_id, start, _end in assignments(result)}


class DayPreferenceTest(unittest.TestCase):
    """Soft `assignDays` is a ramp, never a pin."""

    def test_prefers_the_nearer_day_after_the_ideal_day(self):
        # The ideal Sunday is the period's first day. Monday is one day from it, Saturday six, so
        # the card belongs on Monday — the exact "Monday beats Tuesday" case.
        tasks = [period_task(1, tagIds=["grocery"])]
        for solver in ("greedy", "cp-sat"):
            result = S.solve(payload(tasks, [soft_day_rule([6], tag="grocery")], solver=solver))
            self.assertEqual(len(result["assignments"]), 1, solver)
            placed = assignments(result)[0][1]
            self.assertEqual(placed.weekday(), 0, f"{solver}: expected Monday, got {placed}")

    def test_preference_moves_instead_of_dropping_when_the_day_is_full(self):
        # Monday 00:00-23:59 is a commitment, so the card takes the next-best day (Tuesday).
        monday_busy = [{
            "id": 99, "taskId": 0, "startAt": "2026-03-02T00:00:00-05:00",
            "endAt": "2026-03-02T23:59:00-05:00", "status": "accepted", "source": "calendar",
        }]
        tasks = [period_task(1, tagIds=["grocery"])]
        for solver in ("greedy", "cp-sat"):
            result = S.solve(payload(
                tasks, [soft_day_rule([6], tag="grocery")], solver=solver, time_blocks=monday_busy,
            ))
            self.assertEqual(len(result["assignments"]), 1, solver)
            placed = assignments(result)[0][1]
            self.assertEqual(placed.weekday(), 1, f"{solver}: expected Tuesday, got {placed}")

    def test_preference_survives_the_compaction_pass(self):
        # Wednesday is preferred; compaction must not pull the card back to an earlier, worse day.
        tasks = [period_task(1, tagIds=["grocery"])]
        for solver in ("greedy", "cp-sat"):
            result = S.solve(payload(tasks, [soft_day_rule([2], tag="grocery")], solver=solver))
            placed = assignments(result)[0][1]
            self.assertEqual(placed.weekday(), 2, f"{solver}: expected Wednesday, got {placed}")

    def test_nearer_of_two_hard_days_wins(self):
        # A hard day rule limits the task to Tuesday and Wednesday. Tuesday is nearer the period's
        # Sunday, so the graded preference picks it (distance 2 versus 3).
        rules = [
            soft_day_rule([6], tag="grocery"),
            rule("tue-wed", {"type": "assignDays", "days": [1, 2]},
                 {"kind": "hard"}, applies=by_tag("grocery")),
        ]
        tasks = [period_task(1, tagIds=["grocery"])]
        result = S.solve(payload(tasks, rules, solver="greedy"))
        placed = assignments(result)[0][1]
        self.assertEqual(placed.weekday(), 1)  # Tuesday


class FixedMeetingTest(unittest.TestCase):
    """The exception: hard day + hard time rules still produce an appointment."""

    def test_hard_day_and_time_pin_a_weekly_occurrence(self):
        rules = [
            rule("monday", {"type": "assignDays", "days": [0]}, {"kind": "hard"},
                 applies=by_tag("standup")),
            rule("two-pm", {"type": "timeWindow", "start": "14:00", "end": "14:30"},
                 {"kind": "hard"}, applies=by_tag("standup")),
        ]
        tasks = [period_task(1, tagIds=["standup"])]
        for solver in ("greedy", "cp-sat"):
            result = S.solve(payload(tasks, rules, solver=solver))
            self.assertEqual(len(result["assignments"]), 1, solver)
            placed = assignments(result)[0][1]
            self.assertEqual(placed.weekday(), 0, solver)
            self.assertEqual((placed.hour, placed.minute), (14, 0), solver)


class PerDayCapTest(unittest.TestCase):
    """`perDayLimit` counts occurrences, so a quota can use distinct days."""

    def test_three_workouts_land_on_three_distinct_days(self):
        tasks = [task(index, tagIds=["gym"]) for index in (1, 2, 3)]
        for solver in ("greedy", "cp-sat"):
            result = S.solve(payload(tasks, [per_day_cap("gym", 1)], solver=solver))
            self.assertEqual(len(result["assignments"]), 3, solver)
            self.assertEqual(len(day_keys(result)), 3, f"{solver}: {day_keys(result)}")

    def test_cap_leaves_the_extra_occurrence_unplaced_with_a_reason(self):
        rules = [
            per_day_cap("gym", 1),
            rule("monday-only", {"type": "assignDays", "days": [0]}, {"kind": "hard"},
                 applies=by_tag("gym")),
        ]
        # Both occurrences belong to the same period, so only one Monday is in play.
        tasks = [period_task(1, tagIds=["gym"]), period_task(2, tagIds=["gym"])]
        result = S.solve(payload(tasks, rules, solver="greedy"))
        self.assertEqual(len(result["assignments"]), 1)
        self.assertEqual(len(result["unscheduled"]), 1)
        reasons = [entry["detail"] for entry in result["unscheduled"][0]["reasons"]]
        self.assertIn("at most 1 gym per day", reasons)

    def test_cap_can_be_two(self):
        tasks = [task(index, tagIds=["errand"]) for index in (1, 2, 3)]
        result = S.solve(payload(tasks, [per_day_cap("errand", 2)], solver="greedy"))
        self.assertEqual(len(result["assignments"]), 3)
        self.assertLessEqual(len(day_keys(result)), 2)


class DailyBudgetTest(unittest.TestCase):
    """`dailyBudget` is a count, not a number of half-hours."""

    def test_a_long_outing_is_one_occurrence(self):
        rules = [rule("budget", {"type": "dailyBudget", "softMaxPerDay": 1},
                      {"kind": "soft", "weight": 20}, applies=by_tag("outing"), reason="one outing")]
        short = S.solve(payload([task(1, tagIds=["outing"])], rules))
        long = S.solve(payload([task(1, durationMinutesRemaining=90, tagIds=["outing"])], rules))
        # One active day earns +20 and no excess penalty, whatever the block's length.
        self.assertEqual(short["scores"]["style"], 20)
        self.assertEqual(long["scores"]["style"], 20)

    def test_two_outings_on_one_day_are_penalised(self):
        rules = [rule("budget", {"type": "dailyBudget", "softMaxPerDay": 1},
                      {"kind": "soft", "weight": 20}, applies=by_tag("outing"))]
        # A hard window leaves both outings only Monday, so the cap cannot spread them and the
        # excess penalty must show up in the reported style value.
        rules.append(rule("monday", {"type": "assignDays", "days": [0]}, {"kind": "hard"},
                          applies=by_tag("outing")))
        tasks = [period_task(1, tagIds=["outing"]), period_task(2, tagIds=["outing"])]
        result = S.solve(payload(tasks, rules))
        # One active day (+20) and one excess occurrence (-20).
        self.assertEqual(result["scores"]["style"], 0)


class DailyRoutineTest(unittest.TestCase):
    """A dated daily card is already one per day; no cap is needed for "wake up"."""

    def test_a_dated_card_stays_on_its_day(self):
        tasks = [
            task(1, title="wake", tagIds=["wake"], earliestStart="2026-03-02T00:00:00-05:00",
                 deadlineAt="2026-03-02T23:59:00-05:00"),
            task(2, title="wake", tagIds=["wake"], earliestStart="2026-03-03T00:00:00-05:00",
                 deadlineAt="2026-03-03T23:59:00-05:00"),
        ]
        rules = [rule("morning", {"type": "timeWindow", "start": "06:00", "end": "10:00"},
                      {"kind": "hard"}, applies=by_tag("wake"))]
        result = S.solve(payload(tasks, rules))
        self.assertEqual({start.date().isoformat() for _t, start, _e in assignments(result)},
                         {"2026-03-02", "2026-03-03"})
        for _task_id, start, _end in assignments(result):
            self.assertGreaterEqual(start.hour, 6)
            self.assertLessEqual(start.hour, 10)


if __name__ == "__main__":
    unittest.main()
