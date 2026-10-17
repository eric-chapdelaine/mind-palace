"""Forecast indexing and the rule-defined weather gate.

The worker has no built-in definition of "nice weather": every threshold comes from the rule, so
these helpers only compare a forecast hour against the bounds a rule actually sets.
"""

from datetime import timezone

from .timegrid import parse_datetime


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


def weather_is_nice(entry, effect):
    """True/False, or None when the forecast lacks the fields the rule actually checks.

    Every threshold is optional and comes from the rule, so the worker has no built-in definition
    of "nice weather". A dimension with no bound is not evaluated; a rule that sets no bounds at
    all yields None (unknown), never a silent default.
    """
    if not entry:
        return None
    checks = (
        ("temperatureF", "minTemperatureF", lambda value, bound: value < bound),
        ("temperatureF", "maxTemperatureF", lambda value, bound: value > bound),
        ("precipitationProbability", "maxPrecipitationProbability", lambda value, bound: value > bound),
        ("windMph", "maxWindMph", lambda value, bound: value > bound),
    )
    checked = False
    for field, key, violates in checks:
        bound = effect.get(key)
        if bound is None:
            continue
        value = entry.get(field)
        if value is None:
            return None
        checked = True
        if violates(value, bound):
            return False
    if effect.get("requireDaytime"):
        daytime = entry.get("isDaytime")
        if daytime is None:
            return None
        checked = True
        if daytime is False:
            return False
    return True if checked else None
