"""The 30-minute slot grid and time parsing helpers.

Everything here is a pure function of its arguments: `now` comes from the payload, never from the
clock, so a run is reproducible.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


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


def overlaps(slot, block, timezone):
    """Does a slot overlap an existing block? Both sides are compared in `timezone`."""
    return slot["start"] < parse_datetime(block["endAt"]).astimezone(timezone) and \
        slot["end"] > parse_datetime(block["startAt"]).astimezone(timezone)


def next_day(date_string):
    return (datetime.fromisoformat(date_string) + timedelta(days=1)).date().isoformat()
