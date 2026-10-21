"""Unit tests for the CP-SAT worker.

Run from the repo root:

    uv run --project workers/cp-sat python -m unittest discover -s workers/cp-sat/tests -v

The worker is a pure function, so these tests build payloads directly (no DB, no server).
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scheduler as S  # noqa: E402

# Explicit bounds: the worker has no built-in "nice weather", so tests must supply them.
NICE_WEATHER = {
    "minTemperatureF": 50,
    "maxTemperatureF": 80,
    "maxPrecipitationProbability": 20,
    "maxWindMph": 15,
    "requireDaytime": True,
}


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


def payload(tasks, rules=None, config=None, time_blocks=None, horizon_days=7, weather=None, solver="cp-sat"):
    """A worker payload. These tests cover the CP-SAT model, so `solver` defaults to it even
    though the worker's production default is the greedy scheduler (`test_greedy.py`)."""
    return {
        "modelVersion": S.MODEL_VERSION,
        "now": NOW.isoformat(),
        "horizonDays": horizon_days,
        "config": {"solver": solver, **(config or {})},
        "tasks": tasks,
        "timeBlocks": time_blocks or [],
        "weather": weather or [],
        "rules": rules or [],
    }


def weather_hours(nice_hours=()):
    """Hourly forecast over the horizon; hours (UTC) in `nice_hours` are comfortable and dry."""
    weather = []
    cursor = NOW.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for offset in range(7 * 24):
        at = cursor + timedelta(hours=offset)
        nice = at.hour in nice_hours
        weather.append({
            "forecastAt": at.isoformat().replace("+00:00", "Z"),
            "temperatureF": 70 if nice else 30,
            "precipitationProbability": 0,
            "windMph": 5,
            "isDaytime": True,
        })
    return weather


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
        self.assertEqual(len(slots), 7 * 48)
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

    def test_day_matches(self):
        self.assertTrue(S.day_matches(None, 3))
        self.assertTrue(S.day_matches({}, 3))
        self.assertTrue(S.day_matches({"dayOfWeek": [1, 3]}, 3))
        self.assertFalse(S.day_matches({"dayOfWeek": [1, 3]}, 4))

    def test_decision_weights_strict_dominance(self):
        tasks = [task(1, priority=2), task(2, priority=1), task(3, priority=1), task(4, priority=0)]
        weights = S.decision_weights(tasks, "weighted")
        # A task at each level outweighs every task at every less-important (higher) level combined.
        for level in (0, 1):
            less_important_total = sum(weights[t["priority"]] for t in tasks if t["priority"] > level)
            self.assertGreater(weights[level], less_important_total)


class SolveTest(unittest.TestCase):
    def test_horizon_comes_from_payload(self):
        result = S.solve(payload([task(1)]))
        self.assertEqual(result["modelVersion"], S.MODEL_VERSION)
        self.assertEqual(result["horizonStart"], "2026-03-02T12:00:00Z")

    def test_weighted_priority_prefers_lower_number(self):
        # Only one slot is available; the higher-priority P0 task must beat P5.
        tasks = [task(1, priority=5), task(2, priority=0)]
        result = S.solve(payload(tasks, time_blocks=busy_except(1)))
        self.assertEqual(result["unscheduledTaskIds"], [1])
        self.assertEqual(sorted({a["taskId"] for a in result["assignments"]}), [2])

    def test_priority_beats_many_less_important_tasks(self):
        # One P0 task vs five P5 tasks competing for a single slot.
        tasks = [task(1, priority=0)] + [task(2 + i, priority=5) for i in range(5)]
        result = S.solve(payload(tasks, time_blocks=busy_except(1)))
        self.assertEqual(result["unscheduledTaskIds"], [2, 3, 4, 5, 6])

    def test_accepted_block_is_immovable(self):
        # The task already holds an accepted 60 min at the horizon start; the remaining 60 min must
        # land elsewhere. The accepted window is busy — it is never reused and never moved.
        slots = slots_for()
        accepted_start, accepted_end = slots[0]["start"], slots[2]["start"]
        accepted = {"status": "accepted", "startAt": accepted_start.isoformat(), "endAt": accepted_end.isoformat()}
        result = S.solve(payload([task(1, durationMinutesRemaining=60, splittable=False)], time_blocks=[accepted]))
        self.assertEqual(result["unscheduledTaskIds"], [])
        self.assertEqual(len(result["assignments"]), 1)
        start, end = S.parse_datetime(result["assignments"][0]["startAt"]), S.parse_datetime(result["assignments"][0]["endAt"])
        self.assertTrue(end <= accepted_start or start >= accepted_end, "assignment overlaps the accepted block")
        self.assertEqual((end - start).total_seconds() / 60, 60)

    def test_manual_proposed_block_is_busy(self):
        # A human-placed (manual) proposal reserves its slot even while still `proposed`; only
        # solver proposals are ephemeral. The task must land after the manual window.
        slots = slots_for()
        manual = {"status": "proposed", "source": "manual",
                  "startAt": slots[0]["start"].isoformat(), "endAt": slots[1]["start"].isoformat()}
        result = S.solve(payload([task(1)], time_blocks=[manual]))
        self.assertEqual(result["unscheduledTaskIds"], [])
        self.assertGreaterEqual(S.parse_datetime(result["assignments"][0]["startAt"]), slots[1]["start"])

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
        # The horizon begins mid-Monday (07:00 local), so that Monday holds 17h; three 8h tasks
        # cannot all fit and one must spill rather than making the model infeasible.
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


class WindowAndGapTest(unittest.TestCase):
    def test_cross_midnight_run(self):
        rules = [rule("sleep", {"type": "timeWindow", "start": "22:00", "end": "07:00"},
                      {"kind": "hard"}, applies={"taskHasTag": "sleep"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=480, tagIds=["sleep"])], rules=rules))
        start = S.parse_datetime(result["assignments"][0]["startAt"]).astimezone(LOCAL)
        end = S.parse_datetime(result["assignments"][0]["endAt"]).astimezone(LOCAL)
        self.assertNotEqual(start.date(), end.date())
        self.assertEqual((end - start).total_seconds(), 480 * 60)

    def test_within_after_caps_the_gap(self):
        rules = [rule("gap", {"type": "withinAfter", "maxMinutes": 30}, {"kind": "hard"},
                      applies={"taskHasTag": "walk"})]
        tasks = [task(1, tagIds=["wake"]), task(2, tagIds=["walk"], dependsOnTaskIds=[1])]
        result = S.solve(payload(tasks, rules=rules))
        starts = {a["taskId"]: S.parse_datetime(a["startAt"]) for a in result["assignments"]}
        self.assertLessEqual((starts[2] - starts[1]).total_seconds(), 60 * 60)

    def test_within_after_survives_compaction(self):
        # The prerequisite has no window and would be pulled to the horizon start; the dependent
        # has a preferred window. The hard max-gap must survive the greedy compaction pass.
        rules = [
            rule("gap", {"type": "withinAfter", "maxMinutes": 30}, {"kind": "hard"}, applies={"taskHasTag": "walk"}),
            rule("morning", {"type": "preferTimeOfDay", "start": "06:00", "end": "07:00"},
                 {"kind": "soft", "weight": 20}, applies={"taskHasTag": "walk"}),
        ]
        tasks = [task(1, tagIds=["wake"]), task(2, tagIds=["walk"], dependsOnTaskIds=[1])]
        result = S.solve(payload(tasks, rules=rules))
        starts = {a["taskId"]: S.parse_datetime(a["startAt"]) for a in result["assignments"]}
        gap_minutes = (starts[2] - starts[1]).total_seconds() / 60
        self.assertGreaterEqual(gap_minutes, 0)
        self.assertLessEqual(gap_minutes, 60)

    def test_daily_budget_spreads_tasks_across_days(self):
        rules = [rule("budget", {"type": "dailyBudget", "softMaxPerDay": 1},
                      {"kind": "soft", "weight": 20}, applies={"taskHasTag": "outing"})]
        tasks = [task(i, tagIds=["outing"]) for i in (1, 2, 3)]
        result = S.solve(payload(tasks, rules=rules))
        days = {assignment["startAt"][:10] for assignment in result["assignments"]}
        self.assertEqual(len(days), 3)

    def test_spread_min_distinct_days_avoids_consecutive(self):
        rules = [rule("sp", {"type": "spread", "maxPerDayMinutes": 600, "minDistinctDays": 3,
                             "avoidConsecutive": True},
                      {"kind": "soft", "weight": 10}, applies={"taskHasTag": "workout"})]
        tasks = [task(i, tagIds=["workout"]) for i in (1, 2, 3)]
        result = S.solve(payload(tasks, rules=rules))
        days = sorted({S.parse_datetime(a["startAt"]).date() for a in result["assignments"]})
        self.assertEqual(len(days), 3)
        self.assertTrue(all((days[index + 1] - days[index]).days > 1 for index in range(len(days) - 1)))

    def test_when_day_of_week_scopes_a_window(self):
        rules = [rule("mon", {"type": "preferTimeOfDay", "start": "17:00", "end": "18:00",
                              "when": {"dayOfWeek": [0]}}, {"kind": "soft", "weight": 50})]
        result = S.solve(payload([task(1)], rules=rules))
        start = S.parse_datetime(result["assignments"][0]["startAt"]).astimezone(LOCAL)
        self.assertEqual(start.weekday(), 0)
        self.assertEqual(start.hour, 17)

    def test_weather_gate_soft_prefers_nice_hours(self):
        rules = [rule("nice", {"type": "weatherGate", **NICE_WEATHER}, {"kind": "soft", "weight": 30},
                      applies={"taskHasTag": "grocery"})]
        result = S.solve(payload([task(1, tagIds=["grocery"])], rules=rules, weather=weather_hours({17})))
        start = S.parse_datetime(result["assignments"][0]["startAt"]).astimezone(timezone.utc)
        self.assertEqual(start.hour, 17)

    def test_weather_gate_when_scopes_the_bonus(self):
        # The bonus is scoped to Wednesday (Python weekday 2), so even though every day has a nice
        # hour, the solver must choose Wednesday's.
        rules = [rule("nice", {"type": "weatherGate", **NICE_WEATHER, "when": {"dayOfWeek": [2]}},
                      {"kind": "soft", "weight": 30}, applies={"taskHasTag": "grocery"})]
        result = S.solve(payload([task(1, tagIds=["grocery"])], rules=rules, weather=weather_hours({17})))
        start = S.parse_datetime(result["assignments"][0]["startAt"])
        self.assertEqual(start.astimezone(LOCAL).weekday(), 2)
        self.assertEqual(start.astimezone(timezone.utc).hour, 17)

    def test_daily_budget_when_counts_only_matching_days_in_style(self):
        # Each task is pinned to a day by a hard rule; the budget only counts Saturday, so one
        # active matching day and no excess -> +10. (The reported style must match the objective.)
        rules = [
            rule("d-sat", {"type": "assignDays", "days": [5]}, {"kind": "hard"}, applies={"taskHasTag": "sat"}),
            rule("d-mon", {"type": "assignDays", "days": [0]}, {"kind": "hard"}, applies={"taskHasTag": "mon"}),
            rule("d-tue", {"type": "assignDays", "days": [1]}, {"kind": "hard"}, applies={"taskHasTag": "tue"}),
            rule("budget", {"type": "dailyBudget", "softMaxPerDay": 1, "when": {"dayOfWeek": [5]}},
                 {"kind": "soft", "weight": 10}, applies={"taskHasTag": "outing"}),
        ]
        tasks = [task(1, tagIds=["outing", "sat"]), task(2, tagIds=["outing", "mon"]), task(3, tagIds=["outing", "tue"])]
        result = S.solve(payload(tasks, rules=rules))
        self.assertEqual(result["scores"]["style"], 10)

    def test_weather_gate_hard_restricts_eligible_slots(self):
        rules = [rule("nice", {"type": "weatherGate", **NICE_WEATHER}, {"kind": "hard"}, applies={"taskHasTag": "grocery"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=60, tagIds=["grocery"])],
                                 rules=rules, weather=weather_hours({17})))
        start = S.parse_datetime(result["assignments"][0]["startAt"]).astimezone(timezone.utc)
        self.assertEqual(start.hour, 17)

    def test_weather_gate_hard_reports_when_unschedulable(self):
        # A 4h task cannot fit inside isolated single nice hours.
        rules = [rule("nice", {"type": "weatherGate", **NICE_WEATHER}, {"kind": "hard"}, applies={"taskHasTag": "grocery"})]
        result = S.solve(payload([task(1, durationMinutesRemaining=240, tagIds=["grocery"])],
                                 rules=rules, weather=weather_hours({17})))
        self.assertEqual(result["unscheduledTaskIds"], [1])

    def test_weather_gate_bounds_are_user_defined(self):
        entry = {"temperatureF": 70, "precipitationProbability": 0, "windMph": 5, "isDaytime": True}
        # No bounds at all: unknown, never a silent default.
        self.assertIsNone(S.weather_is_nice(entry, {"type": "weatherGate"}))
        # Only the dimensions a rule sets are evaluated.
        self.assertTrue(S.weather_is_nice(entry, {"type": "weatherGate", "maxWindMph": 10}))
        self.assertFalse(S.weather_is_nice(entry, {"type": "weatherGate", "minTemperatureF": 80}))


if __name__ == "__main__":
    unittest.main()
