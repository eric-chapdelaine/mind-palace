"""Shared health calculations used by both meal planning and Garmin sync.

Single source of truth for BMR, calorie targets, and macro targets.
Configure via environment variables.
"""
import os

from core.config import settings


def _calculate_bmr() -> int:
    """Mifflin-St Jeor equation for male BMR.

    Environment variables:
        USER_WEIGHT_LBS  (default 175)
        USER_HEIGHT_IN   (default 71)
        USER_AGE         (default 28)
    """
    weight_lbs = float(os.getenv("USER_WEIGHT_LBS", "175"))
    height_in = float(os.getenv("USER_HEIGHT_IN", "71"))
    age = int(os.getenv("USER_AGE", "28"))

    weight_kg = weight_lbs * 0.453592
    height_cm = height_in * 2.54

    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    return int(bmr)


# Calorie planning constants
CALORIE_SURPLUS = int(os.getenv("CALORIE_SURPLUS", "300"))
MISC_MOVEMENT = int(os.getenv("MISC_MOVEMENT", "300"))

# Macro split percentages
MACRO_SPLIT_PROTEIN_PCT = 0.35
MACRO_SPLIT_CARB_PCT = 0.40
MACRO_SPLIT_FAT_PCT = 0.25


def get_calorie_target(calories_burned: int = 0) -> int:
    """Daily calorie target = BMR + exercise calories + surplus."""
    bmr = _calculate_bmr()
    return bmr + calories_burned + CALORIE_SURPLUS


def get_daily_stats_calorie_target(exercise_calories: int = 0) -> int:
    """Calorie target for DailyStats (includes misc movement estimate)."""
    bmr = _calculate_bmr()
    return bmr + exercise_calories + MISC_MOVEMENT + CALORIE_SURPLUS


def get_workout_calorie_estimate(session_type: str | None) -> int:
    """Return a calorie burn estimate for an unsynced workout session.

    Args:
        session_type: "lift", "run", "cycle", "rest", or None.

    Returns:
        Estimated calories burned. 0 for rest or unknown types.
    """
    if session_type in ("run", "cycle"):
        return settings.CARDIO_CALORIES_ESTIMATE
    if session_type == "lift":
        return settings.LIFT_CALORIES_ESTIMATE
    return 0


def get_macro_targets(calorie_target: int) -> dict:
    """Calculate macro targets from a calorie target."""
    protein_g = int((calorie_target * MACRO_SPLIT_PROTEIN_PCT) / 4)
    carbs_g = int((calorie_target * MACRO_SPLIT_CARB_PCT) / 4)
    fat_g = int((calorie_target * MACRO_SPLIT_FAT_PCT) / 9)

    return {
        "protein_g": protein_g,
        "carbs_g": carbs_g,
        "fat_g": fat_g,
    }
