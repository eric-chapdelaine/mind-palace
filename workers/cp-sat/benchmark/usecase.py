"""Demo-data generator for "make the day decisive" use case.

Goal being modelled:
  * sleep 22:30-06:30 (target wake 06:45, slot grid rounds to 06:30 at 30 min),
  * get outside within 30 min of waking (WFH walk / in-office commute),
  * strength train 3x/week on distinct, non-consecutive days,
  * cook + eat dinner every day inside 17:30-21:00,
  * eat breakfast every day,
  * grocery every 7 days on a WFH or weekend day, nice weather only,
  * >= 1 outing/day, minimize outings/day, outings favour 17:00 on weekdays and nice weather.

The generator is seeded and parameterised so we can sweep workload, weather, and task counts.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

# Local dates: Monday 2026-03-02 00:00 America/New_York == 05:00 UTC.
NOW = datetime(2026, 3, 2, 5, 0, tzinfo=timezone.utc)

# Python weekday order (0=Mon .. 6=Sun), matching the worker's `when.dayOfWeek`.
WEEKDAYS = [0, 1, 2, 3, 4]
WFH_DAYS = [1, 3]  # Tue + Thu
WEEKEND = [5, 6]
GROCERY_DAYS = WFH_DAYS + WEEKEND

NICE = {
    "minTemperatureF": 50,
    "maxTemperatureF": 80,
    "maxPrecipitationProbability": 20,
    "maxWindMph": 15,
    "requireDaytime": True,
}

T = {
    "thisWeek": "mind-palace:this-week",
    "sleep": "mind-palace:sleep",
    "wake": "mind-palace:wake",
    "outside": "mind-palace:outside",
    "workout": "mind-palace:workout",
    "cook": "mind-palace:cook",
    "dinner": "mind-palace:dinner",
    "breakfast": "mind-palace:breakfast",
    "grocery": "mind-palace:grocery",
    "outing": "mind-palace:outing",
    "errand": "mind-palace:errand",
    "work": "mind-palace:work",
    "focus": "mind-palace:focus",
    "niceOnly": "mind-palace:nice-weather-only",
}


def _rule(rule_id, effect, strength, applies, reason):
    return {
        "id": rule_id,
        "title": reason,
        "enabled": True,
        "applies": applies,
        "effect": effect,
        "strength": strength,
        "reason": reason,
    }


def tag(tag_id):
    return {"taskHasTag": tag_id}


def build_rules():
    """The use-case rule set. Same shape the repository hands the worker."""
    r = []
    n = 0

    def add(effect, strength, applies, reason):
        nonlocal n
        n += 1
        r.append(_rule(n, effect, strength, applies, reason))

    # Work only 09:00-17:00 Mon-Fri.
    add({"type": "assignDays", "days": WEEKDAYS}, {"kind": "hard"}, tag(T["work"]), "Work on weekdays")
    add({"type": "timeWindow", "start": "09:00", "end": "17:00"}, {"kind": "hard"}, tag(T["work"]), "Working hours 9-5")
    # Everything that is not sleep stays inside reasonable awake hours.
    awake = {"not": tag(T["sleep"])}
    add({"type": "timeWindow", "start": "06:30", "end": "23:00"}, {"kind": "hard"}, awake, "Awake hours")

    # Sleep + morning.
    add({"type": "timeWindow", "start": "22:30", "end": "06:30"}, {"kind": "hard"}, tag(T["sleep"]), "Sleep window 22:30-06:30")
    add({"type": "timeWindow", "start": "06:30", "end": "10:00"}, {"kind": "hard"}, tag(T["wake"]), "Wake window")
    add({"type": "preferTimeOfDay", "start": "06:30", "end": "07:00"}, {"kind": "soft", "weight": 40}, tag(T["wake"]), "Wake near 06:45")
    add({"type": "preferTimeOfDay", "start": "06:30", "end": "08:00"}, {"kind": "soft", "weight": 25}, tag(T["outside"]), "Get outside early")
    add({"type": "preferTimeOfDay", "start": "06:45", "end": "09:00"}, {"kind": "soft", "weight": 10}, tag(T["breakfast"]), "Breakfast in the morning")
    # Get outside within 30 min of waking.
    add({"type": "withinAfter", "maxMinutes": 30}, {"kind": "hard"}, tag(T["outside"]), "Outside within 30m of waking")

    # Dinner.
    add({"type": "timeWindow", "start": "17:30", "end": "21:00"}, {"kind": "hard"}, tag(T["dinner"]), "Dinner 17:30-21:00")
    add({"type": "preferTimeOfDay", "start": "16:00", "end": "18:00"}, {"kind": "soft", "weight": 15}, tag(T["cook"]), "Cook before dinner")

    # Strength training: 3 distinct, non-consecutive days.
    add(
        {"type": "spread", "maxPerDayMinutes": 90, "minDistinctDays": 3, "avoidConsecutive": True},
        {"kind": "soft", "weight": 40},
        tag(T["workout"]),
        "Strength 3x/week, not back-to-back",
    )
    add({"type": "preferTimeOfDay", "start": "17:00", "end": "19:00"}, {"kind": "soft", "weight": 10}, tag(T["workout"]), "Train after work")

    # Outings: at least one a day, minimise the number, favour 17:00 weekdays + nice weather.
    add({"type": "dailyBudget", "softMaxPerDay": 1}, {"kind": "soft", "weight": 30}, tag(T["outing"]), "Outing every day, minimise count")
    add({"type": "preferTimeOfDay", "start": "17:00", "end": "18:00", "when": {"dayOfWeek": WEEKDAYS}},
        {"kind": "soft", "weight": 25}, tag(T["outing"]), "Outings at 5pm on weekdays")
    add({"type": "weatherGate", **NICE}, {"kind": "soft", "weight": 20}, tag(T["outing"]), "Outings prefer nice weather")

    # Grocery: WFH/weekend, nice weather only.
    add({"type": "assignDays", "days": GROCERY_DAYS}, {"kind": "hard"}, tag(T["grocery"]), "Grocery on a WFH/weekend day")
    add({"type": "weatherGate", **NICE}, {"kind": "hard"}, tag(T["grocery"]), "Grocery needs nice weather")
    return r


def _task(tid, title, priority, rank, minutes, tags, *, splittable=False, deps=None, earliest=None, deadline=None):
    return {
        "id": tid,
        "title": title,
        "priority": priority,
        "rank": rank,
        "durationMinutesRemaining": minutes,
        "splittable": splittable,
        "minChunkMinutes": 30,
        "maxChunkMinutes": 240,
        "earliestStart": earliest,
        "deadlineAt": deadline,
        "tagIds": [T["thisWeek"], *tags],
        "dependsOnTaskIds": list(deps or []),
    }


def build_tasks(
    rng: random.Random,
    horizon_days: int,
    *,
    errand_count: int,
    work_backlog_minutes: int,
    work_splittable: bool,
    extra_focus_tasks: int,
    workout_count: int = 3,
):
    tasks = []
    tid = 0

    def next_id():
        nonlocal tid
        tid += 1
        return tid

    # --- recurrence tasks ---
    # Sleep for each full night that fits before the horizon ends (last evening is cut off).
    for day in range(horizon_days - 1):
        tasks.append(_task(next_id(), "Sleep", 0, 1000 - day, 480, [T["sleep"]]))

    for day in range(horizon_days):
        wake_id = next_id()
        tasks.append(_task(wake_id, "Wake up", 0, 900 - day, 30, [T["wake"]]))
        tasks.append(_task(next_id(), "Get outside", 0, 890 - day, 30, [T["outside"]], deps=[wake_id]))
        tasks.append(_task(next_id(), "Breakfast", 0, 880 - day, 30, [T["breakfast"]]))
        cook_id = next_id()
        tasks.append(_task(cook_id, "Cook dinner", 0, 870 - day, 45, [T["cook"]]))
        tasks.append(_task(next_id(), "Eat dinner", 0, 860 - day, 45, [T["dinner"]], deps=[cook_id]))

    # Strength sessions. One per target day, each its own task, spread handles distinctness.
    for index in range(workout_count):
        tasks.append(_task(next_id(), f"Strength {index + 1}", 1, 700 - index, 60, [T["workout"]]))

    # Grocery: once in the horizon.
    tasks.append(_task(next_id(), "Grocery shop", 1, 650, 60, [T["grocery"], T["outing"]]))

    # --- work backlog: pinned 9-5 M-F, splittable, competes for 40h/week ---
    remaining = work_backlog_minutes
    while remaining > 0:
        minutes = min(remaining, rng.choice([60, 90, 120, 120, 180, 240]))
        remaining -= minutes
        tasks.append(_task(next_id(), "Work block", 1, 600 - tid % 50, minutes, [T["work"]],
                           splittable=work_splittable))

    # --- one-off errands: outings, nice-weather friendly ---
    for index in range(errand_count):
        minutes = rng.choice([30, 30, 45, 60, 90])
        tasks.append(_task(next_id(), f"Errand {index + 1}", 2, 400 - index, minutes,
                           [T["errand"], T["outing"]]))

    # --- generic focus work (flexible, splittable) ---
    for index in range(extra_focus_tasks):
        minutes = rng.choice([60, 120, 180])
        tasks.append(_task(next_id(), f"Focus block {index + 1}", 2, 300 - index, minutes,
                           [T["focus"]], splittable=True))

    return tasks


def build_weather(rng: random.Random, horizon_days: int, niceness: float, now: datetime = NOW):
    """Hourly forecast; whole days are nice or not, driven by `niceness` (fraction of nice days)."""
    start = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    day_nice = [rng.random() < niceness for _ in range(horizon_days + 1)]
    weather = []
    for offset in range((horizon_days + 1) * 24):
        at = start + timedelta(hours=offset)
        local_hour = (at.hour - 5) % 24  # EST/EDT roughly; close enough for a daytime flag
        daytime = 7 <= local_hour <= 19
        nice = day_nice[min(offset // 24, len(day_nice) - 1)] and daytime
        if nice:
            temperature = rng.randint(55, 75)
            precip = 0
            wind = rng.randint(3, 10)
        else:
            cold = rng.random() < 0.5
            temperature = rng.randint(28, 45) if cold else rng.randint(82, 95)
            precip = rng.randint(30, 80)
            wind = rng.randint(12, 28)
        weather.append({
            "forecastAt": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "temperatureF": temperature,
            "precipitationProbability": precip,
            "windMph": wind,
            "isDaytime": daytime,
            "shortForecast": "sunny" if nice else "cloudy",
        })
    return weather


def build_payload(
    *,
    seed: int,
    horizon_days: int = 7,
    errand_count: int = 6,
    work_backlog_minutes: int = 1800,
    work_splittable: bool = True,
    extra_focus_tasks: int = 0,
    workout_count: int = 3,
    niceness: float = 0.5,
):
    rng = random.Random(seed)
    return {
        "now": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizonDays": horizon_days,
        "config": {"priorityMode": "weighted", "timeBudgetSeconds": 30},
        "tasks": build_tasks(
            rng,
            horizon_days,
            errand_count=errand_count,
            work_backlog_minutes=work_backlog_minutes,
            work_splittable=work_splittable,
            extra_focus_tasks=extra_focus_tasks,
            workout_count=workout_count,
        ),
        "timeBlocks": [],
        "weather": build_weather(rng, horizon_days, niceness),
        "rules": build_rules(),
    }


SCENARIOS = {
    "baseline": dict(errand_count=3, work_backlog_minutes=1800, niceness=0.6),
    "typical": dict(errand_count=8, work_backlog_minutes=2400, niceness=0.5),
    "busy_week": dict(errand_count=16, work_backlog_minutes=3000, niceness=0.4),
    "bad_weather": dict(errand_count=10, work_backlog_minutes=2400, niceness=0.1),
    "nice_weather": dict(errand_count=10, work_backlog_minutes=2400, niceness=0.9),
    "overloaded": dict(errand_count=24, work_backlog_minutes=3600, niceness=0.5),
    "fragmented": dict(errand_count=30, work_backlog_minutes=2400, work_splittable=False, niceness=0.5),
    "many_small": dict(errand_count=60, work_backlog_minutes=2400, niceness=0.5),
    "huge": dict(errand_count=120, work_backlog_minutes=3000, extra_focus_tasks=40, niceness=0.5),
    "mega": dict(errand_count=240, work_backlog_minutes=3600, extra_focus_tasks=80, niceness=0.5),
}
