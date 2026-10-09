"""Garmin Connect sync worker.

Protocol (matches workers/cp-sat): a single JSON request on stdin, a single JSON object on
stdout. The TypeScript `GarminService` decides *which* dates are missing and sends them here;
this worker only talks to Garmin and normalizes the provider payloads into the shapes the
`sleep_sessions` / `health_activities` tables expect.

Input:  {"sleepFrom": "YYYY-MM-DD", "activitiesFrom": "YYYY-MM-DD", "today": "YYYY-MM-DD"}
Output: {"sleep": [...], "activities": [...]}

Authentication reuses the existing Garmin token stores (~/.garminconnect or ~/.garth), so this
process never touches a password. Only normalized fields are returned — never the raw payload.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

MAX_LOOKBACK_DAYS = 90
TOKEN_STORES = ("~/.garminconnect", "~/.garth")


def iso_from_ms(milliseconds: float | int | None) -> str | None:
    """Garmin timestamps are epoch milliseconds; emit an ISO UTC string JS can parse."""
    if milliseconds is None:
        return None
    return datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def iso_from_gmt(value: str | None) -> str | None:
    """Parse Garmin's `startTimeGMT`/`endTimeGMT` ("YYYY-MM-DD HH:MM:SS", UTC) to ISO."""
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def number_or_none(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def int_or_none(value: Any) -> int | None:
    result = number_or_none(value)
    return None if result is None else int(round(result))


def minutes(seconds: Any) -> int | None:
    result = number_or_none(seconds)
    return None if result is None else int(round(result / 60))


def connect_client() -> Any:
    """Load an authenticated Garmin client from the first working token store."""
    from garminconnect import Garmin

    candidates = [store for store in (os.getenv("GARMINTOKENSTORE"), *TOKEN_STORES) if store]
    errors: list[str] = []
    for store in candidates:
        path = Path(store).expanduser()
        if not path.exists():
            continue
        try:
            client = Garmin()
            client.login(str(path))
            return client
        except Exception as error:  # noqa: BLE001 - report whichever store failed and try the next
            errors.append(f"{store}: {error}")
    detail = "; ".join(errors) or "no token store found"
    raise RuntimeError(f"Could not authenticate with Garmin Connect ({detail})")


def normalize_sleep(client: Any, start_date: date, end_date: date) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    current = start_date
    while current <= end_date:
        key = current.isoformat()
        try:
            payload = client.get_sleep_data(key)
        except Exception as error:  # noqa: BLE001 - a single bad day must not abort the sync
            print(f"garmin sleep {key}: {error}", file=sys.stderr)
            payload = None
        current += timedelta(days=1)
        if not payload:
            continue

        dto = payload.get("dailySleepDTO") or {}
        start_at = iso_from_ms(dto.get("sleepStartTimestampGMT"))
        end_at = iso_from_ms(dto.get("sleepEndTimestampGMT"))
        if not start_at or not end_at:
            continue
        if end_at <= start_at:
            continue

        scores = dto.get("sleepScores") or {}
        overall = (scores.get("overall") or {}).get("value")
        details = {
            "sleepScoreQualifier": (scores.get("overall") or {}).get("qualifierKey"),
            "sleepNeedMinutes": (dto.get("sleepNeed") or {}).get("actual"),
            "awakeCount": dto.get("awakeCount"),
            "averageSpO2": dto.get("averageSpO2Value"),
            "lowestSpO2": dto.get("lowestSpO2Value"),
            "averageRespiration": dto.get("averageRespirationValue"),
            "breathingDisruptionSeverity": dto.get("breathingDisruptionSeverity"),
        }
        sessions.append({
            "externalId": str(dto.get("id") or f"sleep-{key}"),
            "calendarDate": str(dto.get("calendarDate") or key),
            "startAt": start_at,
            "endAt": end_at,
            "sleepScore": int_or_none(overall),
            "totalSleepMinutes": minutes(dto.get("sleepTimeSeconds")),
            "deepSleepMinutes": minutes(dto.get("deepSleepSeconds")),
            "lightSleepMinutes": minutes(dto.get("lightSleepSeconds")),
            "remSleepMinutes": minutes(dto.get("remSleepSeconds")),
            "awakeMinutes": minutes(dto.get("awakeSleepSeconds")),
            "avgHeartRate": int_or_none(dto.get("avgHeartRate")),
            "avgStress": number_or_none(dto.get("avgSleepStress")),
            "details": {name: value for name, value in details.items() if value is not None},
        })
    return sessions


def activity_window(activity: dict[str, Any]) -> tuple[str, str] | None:
    start_at = iso_from_ms(activity.get("beginTimestamp")) or iso_from_gmt(activity.get("startTimeGMT"))
    if not start_at:
        return None
    elapsed_seconds = number_or_none(activity.get("elapsedDuration")) or number_or_none(activity.get("duration")) or 0
    start_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(seconds=elapsed_seconds)
    # A zero-duration activity would violate the `end_at > start_at` CHECK; keep a minimum block.
    if end_dt <= start_dt:
        end_dt = start_dt + timedelta(minutes=1)
    return start_at, end_dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_activities(client: Any, start_date: date, end_date: date) -> list[dict[str, Any]]:
    try:
        activities = client.get_activities_by_date(start_date.isoformat(), end_date.isoformat(), sortorder="asc")
    except Exception as error:  # noqa: BLE001 - surface the message, the service turns it into an error
        raise RuntimeError(f"Garmin activities request failed: {error}") from error

    results: list[dict[str, Any]] = []
    for activity in activities or []:
        window = activity_window(activity)
        if not window:
            continue
        start_at, end_at = window
        activity_type = activity.get("activityType")
        type_key = activity_type.get("typeKey") if isinstance(activity_type, dict) else activity_type
        local_start = activity.get("startTimeLocal") or ""
        details = {
            "trainingEffectLabel": activity.get("trainingEffectLabel"),
            "aerobicTrainingEffect": number_or_none(activity.get("aerobicTrainingEffect")),
            "anaerobicTrainingEffect": number_or_none(activity.get("anaerobicTrainingEffect")),
            "trainingLoad": number_or_none(activity.get("activityTrainingLoad")),
            "elevationGainMeters": number_or_none(activity.get("elevationGain")),
            "steps": int_or_none(activity.get("steps")),
            "averageCadence": number_or_none(activity.get("averageRunningCadenceInStepsPerMinute")),
            "maxSpeedMetersPerSecond": number_or_none(activity.get("maxSpeed")),
            "locationName": activity.get("locationName"),
        }
        duration_seconds = number_or_none(activity.get("duration"))
        moving_seconds = number_or_none(activity.get("movingDuration"))
        results.append({
            "externalId": str(activity.get("activityId")),
            "providerTitle": activity.get("activityName") or type_key or "Activity",
            "activityType": str(type_key or "unknown"),
            "activityDate": local_start[:10] or start_at[:10],
            "startAt": start_at,
            "endAt": end_at,
            "durationMinutes": duration_seconds / 60 if duration_seconds is not None else None,
            "movingMinutes": moving_seconds / 60 if moving_seconds is not None else None,
            "distanceMeters": number_or_none(activity.get("distance")),
            "calories": number_or_none(activity.get("calories")),
            "avgHeartRate": int_or_none(activity.get("averageHR")),
            "maxHeartRate": int_or_none(activity.get("maxHR")),
            "details": {key: value for key, value in details.items() if value is not None},
        })
    return results


def clamp_from(value: str | None, today: date) -> date:
    earliest = today - timedelta(days=MAX_LOOKBACK_DAYS)
    if not value:
        return earliest
    parsed = date.fromisoformat(value)
    return max(parsed, earliest)


def main() -> None:
    request = json.load(sys.stdin)
    today = date.fromisoformat(request["today"])
    sleep_from = clamp_from(request.get("sleepFrom"), today)
    activities_from = clamp_from(request.get("activitiesFrom"), today)

    try:
        client = connect_client()
        result = {
            "sleep": normalize_sleep(client, sleep_from, today),
            "activities": normalize_activities(client, activities_from, today),
        }
    except Exception as error:  # noqa: BLE001 - one JSON error object out, exit 1
        print(json.dumps({"error": str(error)}))
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
