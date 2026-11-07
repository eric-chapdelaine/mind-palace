"""Forecast indexing and the rule-defined weather score.

The worker has no built-in definition of "nice weather": every ideal, limit and weight comes from
the rule, so these helpers only compare a forecast hour against what a rule actually says.
"""

from datetime import timezone

from .timegrid import parse_datetime

# The metrics a rule can measure, keyed by the forecast field they read. `daytime` is handled
# separately because it is binary.
CONTINUOUS_METRICS = ("temperatureF", "precipitationProbability", "windMph")


def weather_by_hour(weather):
    """Index the hourly forecast by its UTC hour so a slot can find its covering hour."""
    by_hour = {}
    for entry in weather or []:
        forecast_at = entry.get("forecastAt")
        if not forecast_at:
            continue
        try:
            key = parse_datetime(forecast_at).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        except ValueError:
            continue
        by_hour[key] = entry
    return by_hour


def slot_weather(slot, weather_by_hour):
    key = slot["start"].astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return weather_by_hour.get(key)


def metric_satisfaction(value, metric):
    """1.0 at the metric's ideal, 0.0 at its limit, linear in between.

    None means the value is outside the limit — no credit, which is what makes the limit hard
    without making the slot ineligible. A side with no limit never deviates, so a one-sided bound
    whose ideal sits on the bound is a plateau rather than a slope.
    """
    ideal, low, high = metric.get("ideal"), metric.get("min"), metric.get("max")
    if low is not None and value < low:
        return None
    if high is not None and value > high:
        return None
    if value == ideal:
        return 1.0
    if value < ideal:
        if low is None:
            return 1.0
        span = ideal - low
    else:
        if high is None:
            return 1.0
        span = high - ideal
    if span <= 0:
        return 0.0
    return max(0.0, 1.0 - abs(value - ideal) / span)


def weather_comfort(entry, effect):
    """0..1 comfort for one forecast hour, or None when the rule measures nothing it can read.

    Each metric the rule sets scores 1 at its ideal and falls to 0 at its limit; the comfort is
    their weighted average, so 1.0 means every metric is exactly right. A metric outside its
    limit scores 0 for the whole slot. Weights are relative shares, so the rule's own weight stays
    "points per run" however many metrics it measures.
    """
    if not entry:
        return None
    metrics = effect.get("metrics") or {}
    weighted = 0.0
    total = 0.0
    for name, metric in metrics.items():
        if name == "daytime":
            daytime = entry.get("isDaytime")
            if daytime is None:
                return None
            satisfaction = 1.0 if bool(daytime) == bool(metric.get("ideal", True)) else None
        elif name in CONTINUOUS_METRICS:
            value = entry.get(name)
            if value is None:
                return None
            satisfaction = metric_satisfaction(value, metric)
        else:
            continue
        if satisfaction is None:
            return 0.0
        weight = float(metric.get("weight", 1))
        weighted += weight * satisfaction
        total += weight
    return weighted / total if total > 0 else None


def weather_within_limits(entry, effect):
    """True/False, or None when the forecast lacks a metric the rule measures.

    The hard reading of the same `metrics`: inside every metric's limits. Only a hard weather rule
    comes here — a soft one grades with `weather_comfort` instead.
    """
    if not entry:
        return None
    metrics = effect.get("metrics") or {}
    checked = False
    for name, metric in metrics.items():
        if name == "daytime":
            daytime = entry.get("isDaytime")
            if daytime is None:
                return None
            checked = True
            if bool(daytime) != bool(metric.get("ideal", True)):
                return False
        elif name in CONTINUOUS_METRICS:
            value = entry.get(name)
            if value is None:
                return None
            checked = True
            low, high = metric.get("min"), metric.get("max")
            if (low is not None and value < low) or (high is not None and value > high):
                return False
    return True if checked else None
