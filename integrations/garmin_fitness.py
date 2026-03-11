"""Garmin fitness integration for syncing activities to the local DB.

Used by services/garmin_sync.py for the automatic Garmin sync job.
"""
import json
from datetime import datetime, timedelta


class GarminFitnessError(Exception):
    pass


_client_initialized = False


def _ensure_client():
    global _client_initialized
    if _client_initialized:
        return
    try:
        import garth
        garth.resume("~/.garth")
        _client_initialized = True
    except Exception as e:
        raise GarminFitnessError(f"Failed to resume Garmin session: {e}")


def get_recent_activities(days: int = 2) -> list[dict]:
    """Fetch recent activities from Garmin Connect.

    Returns a list of dicts with: garmin_id, date, activity_type,
    duration_minutes, calories, raw_json.
    """
    _ensure_client()

    try:
        import garth
        from garminconnect import Garmin

        client = Garmin()
        client.garth = garth

        activities = client.get_activities(0, 50)

        # Build type map once (not per-activity)
        type_map = {t["typeId"]: t["typeKey"] for t in client.get_activity_types()}

        result = []
        cutoff = datetime.now() - timedelta(days=days)

        for a in activities:
            start_time_str = a.get("startTimeLocal")
            if not start_time_str:
                continue

            try:
                start_time = datetime.fromisoformat(start_time_str)
            except Exception:
                continue

            if start_time < cutoff:
                continue

            activity_type_id = (
                a.get("activityType", {}).get("typeId", 0)
                if isinstance(a.get("activityType"), dict)
                else 0
            )
            activity_type = type_map.get(activity_type_id, "unknown")

            elapsed = a.get("elapsedDuration", 0) or 0
            duration_minutes = elapsed / 60 if elapsed else None

            result.append({
                "garmin_id": str(a.get("activityId", "")),
                "date": start_time.date().isoformat(),
                "activity_type": activity_type,
                "duration_minutes": duration_minutes,
                "calories": a.get("calories"),
                "raw_json": json.dumps(a),
            })

        return result

    except Exception as e:
        print(f"Garmin fitness error: {e}")
        return []
