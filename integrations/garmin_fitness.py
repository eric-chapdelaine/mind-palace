import json
import garth
from datetime import datetime, timedelta
from typing import Optional


class GarminFitnessError(Exception):
    pass


def _ensure_client():
    try:
        garth.resume("~/.garth")
    except Exception as e:
        raise GarminFitnessError(f"Failed to resume Garmin session: {e}")


def get_recent_activities(days: int = 2) -> list[dict]:
    _ensure_client()
    
    try:
        from garminconnect import Garmin
        client = Garmin()
        client.garth = garth
        
        activities = client.get_activities(0, 50)
        
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
            
            activity_type_id = a.get("activityType", {}).get("typeId", 0) if isinstance(a.get("activityType"), dict) else 0
            type_map = {t["typeId"]: t["typeKey"] for t in client.get_activity_types()}
            activity_type = type_map.get(activity_type_id, "unknown")
            
            elapsed = a.get("elapsedDuration", 0) or 0
            duration_minutes = elapsed / 60 if elapsed else None
            
            result.append({
                "garmin_id": str(a.get("activityId", "")),
                "date": start_time.date().isoformat(),
                "activity_type": activity_type,
                "duration_minutes": duration_minutes,
                "calories": a.get("calories"),
                "raw_json": json.dumps(a)
            })
        
        return result
        
    except Exception as e:
        print(f"⚠️  Garmin fitness error: {e}")
        return []


def get_strength_exercise_sets(activity_id: str) -> list[dict]:
    _ensure_client()
    
    try:
        from garminconnect import Garmin
        client = Garmin()
        client.garth = garth
        
        details = client.get_activity_details(activity_id)
        
        exercises = []
        current_exercise = None
        
        for item in details.get("exerciseSets", []):
            ex_name = item.get("exerciseName", "")
            
            if ex_name != (current_exercise.get("exerciseName") if current_exercise else ""):
                if current_exercise:
                    exercises.append(current_exercise)
                current_exercise = {
                    "exerciseName": ex_name,
                    "sets": []
                }
            
            if current_exercise:
                weight = item.get("weight", 0) or 0
                weight_lbs = weight * 2.20462 if weight else 0
                
                current_exercise["sets"].append({
                    "reps": item.get("reps", 0) or 0,
                    "weight_lbs": weight_lbs
                })
        
        if current_exercise:
            exercises.append(current_exercise)
        
        return exercises
        
    except Exception as e:
        print(f"⚠️  Garmin strength exercise error: {e}")
        return []
