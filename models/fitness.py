from datetime import date as date_type
from sqlmodel import Field, SQLModel


class Exercise(SQLModel, table=True):
    """Master exercise list."""
    __tablename__ = "fitness_exercise"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    garmin_enum: str | None = None
    category: str | None = None
    equipment: str | None = None
    increment_lbs: float | None = None


class WorkoutTemplate(SQLModel, table=True):
    """A named session definition (e.g., 'Full Body A')."""
    __tablename__ = "fitness_workout_template"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    session_type: str | None = None
    sort_order: int = 0


class TemplateExercise(SQLModel, table=True):
    """Individual prescribed exercises within a template."""
    __tablename__ = "fitness_template_exercise"

    id: int | None = Field(default=None, primary_key=True)
    template_id: int = Field(foreign_key="fitness_workout_template.id")
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    prescribed_sets: int = 3
    prescribed_reps: int = 8
    sort_order: int = 0


class ExerciseState(SQLModel, table=True):
    """Current progression state per exercise."""
    __tablename__ = "fitness_exercise_state"

    exercise_id: int = Field(primary_key=True, foreign_key="fitness_exercise.id")
    current_weight_lbs: float = 0.0
    consecutive_fails: int = 0
    consecutive_close: int = 0
    last_verdict: str | None = None
    last_session_date: date_type | None = None


class ScheduledDay(SQLModel, table=True):
    """The rolling instantiated plan."""
    __tablename__ = "fitness_scheduled_day"

    id: int | None = Field(default=None, primary_key=True)
    day_date: date_type = Field(unique=True)
    template_id: int | None = Field(default=None, foreign_key="fitness_workout_template.id")
    session_type: str | None = None
    status: str = "planned"


class ScheduledExerciseOverride(SQLModel, table=True):
    """Per-day exercise overrides: swap, skip, or change sets/reps for a single session."""
    __tablename__ = "fitness_scheduled_exercise_override"

    id: int | None = Field(default=None, primary_key=True)
    scheduled_day_id: int = Field(foreign_key="fitness_scheduled_day.id")
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    action: str = "override"  # "override" | "skip" | "add"
    prescribed_sets: int | None = None
    prescribed_reps: int | None = None
    sort_order: int | None = None


class GarminActivity(SQLModel, table=True):
    """Raw synced Garmin activity records."""
    __tablename__ = "fitness_garmin_activity"

    id: int | None = Field(default=None, primary_key=True)
    garmin_id: str = Field(unique=True)
    activity_date: date_type | None = None
    activity_type: str | None = None
    duration_minutes: float | None = None
    calories: int | None = None
    is_commute: bool = False
    raw_json: str | None = None


class WorkoutLog(SQLModel, table=True):
    """Links a scheduled_day to a garmin_activity."""
    __tablename__ = "fitness_workout_log"

    id: int | None = Field(default=None, primary_key=True)
    scheduled_day_id: int = Field(foreign_key="fitness_scheduled_day.id")
    garmin_activity_id: int | None = Field(default=None, foreign_key="fitness_garmin_activity.id")
    match_type: str | None = None  # "auto" | "manual"
    notes: str | None = None


class SetLog(SQLModel, table=True):
    """Individual set outcomes parsed from Garmin strength activity."""
    __tablename__ = "fitness_set_log"

    id: int | None = Field(default=None, primary_key=True)
    workout_log_id: int = Field(foreign_key="fitness_workout_log.id")
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    set_number: int = 1
    reps_completed: int = 0
    weight_lbs: float = 0.0


class ExerciseHistory(SQLModel, table=True):
    """Immutable verdict log for each exercise session."""
    __tablename__ = "fitness_exercise_history"

    id: int | None = Field(default=None, primary_key=True)
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    history_date: date_type | None = None
    verdict: str | None = None
    weight_used_lbs: float = 0.0
    sets_prescribed: int = 0
    reps_prescribed: int = 0
    avg_completion_pct: float = 0.0


class DailyStats(SQLModel, table=True):
    """One row per calendar day with body weight and calories."""
    __tablename__ = "fitness_daily_stats"

    stat_date: date_type = Field(primary_key=True)
    weight_lbs: float | None = None
    calories_burned_garmin: int | None = 0
    calories_target: int | None = None
