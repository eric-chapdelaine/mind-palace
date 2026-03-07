"""Request/response schemas for fitness endpoints."""
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ExerciseStateUpdate(BaseModel):
    weight_lbs: float


class ManualMatch(BaseModel):
    garmin_activity_id: int


class WorkoutLogCreate(BaseModel):
    notes: str | None = None


class OverrideWorkout(BaseModel):
    template_id: int
    date: str | None = None


class SetLogCreate(BaseModel):
    exercise_id: int
    set_number: int
    weight_lbs: float
    reps_completed: int


class SetLogUpdate(BaseModel):
    weight_lbs: float | None = None
    reps_completed: int | None = None
    exercise_id: int | None = None


class ExerciseOverrideCreate(BaseModel):
    """Override, skip, or add an exercise for a specific scheduled day."""
    exercise_id: int
    action: str = "override"  # "override" | "skip" | "add"
    prescribed_sets: int | None = None
    prescribed_reps: int | None = None
    sort_order: int | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class SetLogRead(BaseModel):
    id: int
    exercise_id: int
    set_number: int
    weight_lbs: float
    reps_completed: int

    model_config = {"from_attributes": True}


class ExerciseRead(BaseModel):
    id: int
    name: str
    category: str | None = None

    model_config = {"from_attributes": True}


class ExerciseDetail(BaseModel):
    exercise_id: int
    name: str
    prescribed_sets: int
    prescribed_reps: int
    current_weight_lbs: float
    last_verdict: str | None = None
    actual_sets: list[SetLogRead] = []


class GarminMatchRead(BaseModel):
    activity_id: str
    duration_minutes: float | None = None
    calories: int | None = None


class TodayWorkoutRead(BaseModel):
    date: str
    day_id: int | None = None
    session_type: str | None
    template_name: str | None = None
    status: str
    garmin_match: GarminMatchRead | None = None
    workout_log_id: int | None = None
    exercises: list[ExerciseDetail] = []


class WeekDayRead(BaseModel):
    date: str
    session_type: str
    status: str
    garmin_calories: int = 0


class DayDetailRead(BaseModel):
    day_id: int | None = None
    date: str
    session_type: str | None
    template_name: str | None = None
    status: str
    exercises: list[ExerciseDetail] = []


class ExerciseHistoryRead(BaseModel):
    date: str
    verdict: str | None
    weight_used_lbs: float
    avg_completion_pct: float
