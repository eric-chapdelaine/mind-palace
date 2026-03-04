from datetime import date as date_type
from typing import Optional
from sqlmodel import Field, SQLModel


class Exercise(SQLModel, table=True):
    """Master exercise list."""
    __tablename__ = "fitness_exercise"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    garmin_enum: Optional[str] = None
    category: Optional[str] = None
    equipment: Optional[str] = None
    increment_lbs: Optional[float] = None


class WorkoutTemplate(SQLModel, table=True):
    """A named session definition (e.g., 'Full Body A')."""
    __tablename__ = "fitness_workout_template"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    session_type: Optional[str] = None
    sort_order: int = 0


class TemplateExercise(SQLModel, table=True):
    """Individual prescribed exercises within a template."""
    __tablename__ = "fitness_template_exercise"
    
    id: Optional[int] = Field(default=None, primary_key=True)
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
    last_verdict: Optional[str] = None
    last_session_date: Optional[date_type] = None


class ScheduledDay(SQLModel, table=True):
    """The rolling instantiated plan."""
    __tablename__ = "fitness_scheduled_day"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    day_date: date_type = Field(unique=True)
    template_id: Optional[int] = Field(default=None, foreign_key="fitness_workout_template.id")
    session_type: Optional[str] = None
    status: str = "planned"


class GarminActivity(SQLModel, table=True):
    """Raw synced Garmin activity records."""
    __tablename__ = "fitness_garmin_activity"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    garmin_id: str = Field(unique=True)
    activity_date: Optional[date_type] = None
    activity_type: Optional[str] = None
    duration_minutes: Optional[float] = None
    calories: Optional[int] = None
    is_commute: bool = False
    raw_json: Optional[str] = None


class WorkoutLog(SQLModel, table=True):
    """Links a scheduled_day to a garmin_activity."""
    __tablename__ = "fitness_workout_log"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    scheduled_day_id: int = Field(foreign_key="fitness_scheduled_day.id")
    garmin_activity_id: Optional[int] = Field(default=None, foreign_key="fitness_garmin_activity.id")
    match_type: Optional[str] = None
    notes: Optional[str] = None


class SetLog(SQLModel, table=True):
    """Individual set outcomes parsed from Garmin strength activity."""
    __tablename__ = "fitness_set_log"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    workout_log_id: int = Field(foreign_key="fitness_workout_log.id")
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    set_number: int = 1
    reps_completed: int = 0
    weight_lbs: float = 0.0


class ExerciseHistory(SQLModel, table=True):
    """Immutable verdict log for each exercise session."""
    __tablename__ = "fitness_exercise_history"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    exercise_id: int = Field(foreign_key="fitness_exercise.id")
    history_date: Optional[date_type] = None
    verdict: Optional[str] = None
    weight_used_lbs: float = 0.0
    sets_prescribed: int = 0
    reps_prescribed: int = 0
    avg_completion_pct: float = 0.0


class DailyStats(SQLModel, table=True):
    """One row per calendar day with body weight and calories."""
    __tablename__ = "fitness_daily_stats"
    
    stat_date: date_type = Field(primary_key=True)
    weight_lbs: Optional[float] = None
    calories_burned_garmin: Optional[int] = 0
    calories_target: Optional[int] = None
