"""
/fitness — Workout CRUD, scheduling, Garmin match, exercise overrides.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, desc

from core.database import get_session
from models.fitness import (
    Exercise, WorkoutTemplate, TemplateExercise, ExerciseState,
    ScheduledDay, ScheduledExerciseOverride, WorkoutLog, SetLog,
    ExerciseHistory, GarminActivity, DailyStats,
)
from schemas.fitness import (
    ExerciseOverrideCreate, ManualMatch, OverrideWorkout,
    SetLogCreate, SetLogUpdate, SetLogRead, ExerciseRead,
    ExerciseDetail, GarminMatchRead, TodayWorkoutRead,
    WeekDayRead, DayDetailRead, ExerciseHistoryRead,
)
from services.schedule_service import ensure_week_schedule, regenerate_week_schedule
from services.garmin_sync import sync_garmin
from services.health_calc import get_calorie_target

router = APIRouter(prefix="/fitness", tags=["fitness"])


def _get_today() -> date:
    return date.today()


def _get_week_monday(ref: date | None = None) -> date:
    d = ref or date.today()
    return d - timedelta(days=d.weekday())


# ---------------------------------------------------------------------------
# Widget endpoints
# ---------------------------------------------------------------------------

@router.get("/widgets/today-workout", response_model=TodayWorkoutRead)
def get_today_workout(db: Session = Depends(get_session)):
    """Today's workout with prescribed and actual sets."""
    today = _get_today()

    scheduled = db.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == today)
    ).first()

    if not scheduled:
        # Auto-generate schedule for this week
        ensure_week_schedule(db, _get_week_monday(today))
        scheduled = db.exec(
            select(ScheduledDay).where(ScheduledDay.day_date == today)
        ).first()

    if not scheduled:
        raise HTTPException(status_code=404, detail="No workout scheduled for today")

    template = db.get(WorkoutTemplate, scheduled.template_id) if scheduled.template_id else None

    # Load workout log and sets once (avoid N+1)
    log = None
    all_sets: list[SetLog] = []
    workout_log_id = None

    if scheduled.status == "matched":
        log = db.exec(
            select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
        ).first()
        if log:
            workout_log_id = log.id
            all_sets = list(db.exec(
                select(SetLog).where(SetLog.workout_log_id == log.id)
            ).all())

    # Build exercise list
    exercises: list[ExerciseDetail] = []
    if scheduled.template_id:
        template_exercises = db.exec(
            select(TemplateExercise)
            .where(TemplateExercise.template_id == scheduled.template_id)
            .order_by(TemplateExercise.sort_order)
        ).all()

        # Check for exercise overrides on this day
        overrides = db.exec(
            select(ScheduledExerciseOverride)
            .where(ScheduledExerciseOverride.scheduled_day_id == scheduled.id)
        ).all()
        skip_ids = {o.exercise_id for o in overrides if o.action == "skip"}
        override_map = {o.exercise_id: o for o in overrides if o.action == "override"}

        for te in template_exercises:
            if te.exercise_id in skip_ids:
                continue
            exercise = db.get(Exercise, te.exercise_id)
            if not exercise:
                continue

            state = db.exec(
                select(ExerciseState).where(ExerciseState.exercise_id == te.exercise_id)
            ).first()

            override = override_map.get(te.exercise_id)
            p_sets = override.prescribed_sets if override and override.prescribed_sets else te.prescribed_sets
            p_reps = override.prescribed_reps if override and override.prescribed_reps else te.prescribed_reps

            actual_sets = [
                SetLogRead.model_validate(s)
                for s in all_sets if s.exercise_id == exercise.id
            ]

            exercises.append(ExerciseDetail(
                exercise_id=exercise.id,
                name=exercise.name,
                prescribed_sets=p_sets,
                prescribed_reps=p_reps,
                current_weight_lbs=state.current_weight_lbs if state else 0,
                last_verdict=state.last_verdict if state else None,
                actual_sets=actual_sets,
            ))

        # Add ad-hoc exercises
        for o in overrides:
            if o.action == "add":
                exercise = db.get(Exercise, o.exercise_id)
                if not exercise:
                    continue
                state = db.exec(
                    select(ExerciseState).where(ExerciseState.exercise_id == o.exercise_id)
                ).first()
                actual_sets = [
                    SetLogRead.model_validate(s)
                    for s in all_sets if s.exercise_id == exercise.id
                ]
                exercises.append(ExerciseDetail(
                    exercise_id=exercise.id,
                    name=exercise.name,
                    prescribed_sets=o.prescribed_sets or 3,
                    prescribed_reps=o.prescribed_reps or 8,
                    current_weight_lbs=state.current_weight_lbs if state else 0,
                    last_verdict=state.last_verdict if state else None,
                    actual_sets=actual_sets,
                ))

    garmin_match = None
    if log and log.garmin_activity_id:
        activity = db.get(GarminActivity, log.garmin_activity_id)
        if activity:
            garmin_match = GarminMatchRead(
                activity_id=activity.garmin_id,
                duration_minutes=activity.duration_minutes,
                calories=activity.calories,
            )

    return TodayWorkoutRead(
        date=today.isoformat(),
        session_type=scheduled.session_type,
        template_name=template.name if template else None,
        status=scheduled.status,
        garmin_match=garmin_match,
        workout_log_id=workout_log_id,
        exercises=exercises,
    )


@router.get("/widgets/week-overview", response_model=list[WeekDayRead])
def get_week_overview(db: Session = Depends(get_session)):
    """7-day grid for the current week."""
    monday = _get_week_monday()
    schedule = ensure_week_schedule(db, monday)

    days: list[WeekDayRead] = []
    for i in range(7):
        d = monday + timedelta(days=i)
        scheduled = next((s for s in schedule if s.day_date == d), None)

        garmin_calories = 0
        if scheduled and scheduled.status == "matched":
            log = db.exec(
                select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
            ).first()
            if log and log.garmin_activity_id:
                activity = db.get(GarminActivity, log.garmin_activity_id)
                if activity:
                    garmin_calories = activity.calories or 0

        days.append(WeekDayRead(
            date=d.isoformat(),
            session_type=scheduled.session_type if scheduled else "rest",
            status=scheduled.status if scheduled else "planned",
            garmin_calories=garmin_calories,
        ))

    return days


# ---------------------------------------------------------------------------
# Schedule endpoints
# ---------------------------------------------------------------------------

@router.get("/schedule/this-week", response_model=list[WeekDayRead])
def get_this_week_schedule(db: Session = Depends(get_session)):
    """Get or generate the current week's schedule."""
    monday = _get_week_monday()
    schedule = ensure_week_schedule(db, monday)
    return [
        WeekDayRead(
            date=s.day_date.isoformat(),
            session_type=s.session_type or "rest",
            status=s.status,
        )
        for s in schedule
    ]


@router.post("/schedule/generate", response_model=list[WeekDayRead])
def generate_schedule(db: Session = Depends(get_session)):
    """Regenerate next week's schedule (replaces planned days only)."""
    from services.scheduler import get_next_monday
    week_start = get_next_monday()
    schedule = regenerate_week_schedule(db, week_start)
    return [
        WeekDayRead(
            date=s.day_date.isoformat(),
            session_type=s.session_type or "rest",
            status=s.status,
        )
        for s in schedule
    ]


@router.get("/schedule/{date_str}", response_model=DayDetailRead)
def get_day_details(date_str: str, db: Session = Depends(get_session)):
    """Get details for a specific day including exercises."""
    try:
        day_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    scheduled = db.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == day_date)
    ).first()
    if not scheduled:
        raise HTTPException(status_code=404, detail="No scheduled day found")

    template = db.get(WorkoutTemplate, scheduled.template_id) if scheduled.template_id else None

    exercises: list[ExerciseDetail] = []
    if scheduled.template_id:
        template_exercises = db.exec(
            select(TemplateExercise)
            .where(TemplateExercise.template_id == scheduled.template_id)
            .order_by(TemplateExercise.sort_order)
        ).all()

        for te in template_exercises:
            exercise = db.get(Exercise, te.exercise_id)
            if not exercise:
                continue
            state = db.exec(
                select(ExerciseState).where(ExerciseState.exercise_id == te.exercise_id)
            ).first()
            exercises.append(ExerciseDetail(
                exercise_id=exercise.id,
                name=exercise.name,
                prescribed_sets=te.prescribed_sets,
                prescribed_reps=te.prescribed_reps,
                current_weight_lbs=state.current_weight_lbs if state else 0,
                last_verdict=state.last_verdict if state else None,
            ))

    return DayDetailRead(
        date=scheduled.day_date.isoformat(),
        session_type=scheduled.session_type,
        template_name=template.name if template else None,
        status=scheduled.status,
        exercises=exercises,
    )


@router.patch("/scheduled-days/{day_id}/skip")
def skip_scheduled_day(day_id: int, db: Session = Depends(get_session)):
    """Skip a scheduled workout day."""
    scheduled = db.get(ScheduledDay, day_id)
    if not scheduled:
        raise HTTPException(status_code=404, detail="Scheduled day not found")
    scheduled.status = "skipped"
    db.add(scheduled)
    db.commit()
    return {"status": "success", "id": day_id}


# ---------------------------------------------------------------------------
# Exercise override endpoints
# ---------------------------------------------------------------------------

@router.post("/scheduled-days/{day_id}/overrides")
def add_exercise_override(
    day_id: int,
    body: ExerciseOverrideCreate,
    db: Session = Depends(get_session),
):
    """Override, skip, or add an exercise for a specific scheduled day."""
    scheduled = db.get(ScheduledDay, day_id)
    if not scheduled:
        raise HTTPException(status_code=404, detail="Scheduled day not found")

    exercise = db.get(Exercise, body.exercise_id)
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")

    override = ScheduledExerciseOverride(
        scheduled_day_id=day_id,
        exercise_id=body.exercise_id,
        action=body.action,
        prescribed_sets=body.prescribed_sets,
        prescribed_reps=body.prescribed_reps,
        sort_order=body.sort_order,
    )
    db.add(override)
    db.commit()
    db.refresh(override)
    return {"status": "success", "id": override.id}


@router.delete("/scheduled-days/{day_id}/overrides/{override_id}")
def remove_exercise_override(
    day_id: int, override_id: int, db: Session = Depends(get_session)
):
    """Remove an exercise override."""
    override = db.get(ScheduledExerciseOverride, override_id)
    if not override or override.scheduled_day_id != day_id:
        raise HTTPException(status_code=404, detail="Override not found")
    db.delete(override)
    db.commit()
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Garmin sync endpoints
# ---------------------------------------------------------------------------

@router.post("/sync/garmin")
def trigger_garmin_sync():
    """Trigger a full Garmin sync (last 2 days)."""
    try:
        sync_garmin()
        return {"status": "success", "message": "Garmin sync completed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/sync/garmin/date/{date_str}")
def sync_garmin_for_date_endpoint(
    date_str: str,
    template_id: int | None = None,
    db: Session = Depends(get_session),
):
    """Sync Garmin for a specific date."""
    from services.garmin_sync import sync_garmin_for_date

    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    try:
        result = sync_garmin_for_date(target_date, template_id)
        if result is None:
            return {"status": "no_activity", "message": "No Garmin activity found for this date"}
        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ---------------------------------------------------------------------------
# Workout log / set CRUD
# ---------------------------------------------------------------------------

@router.post("/workout-logs/override")
def override_workout(body: OverrideWorkout, db: Session = Depends(get_session)):
    """Override or create a workout for a specific date."""
    target_date = date.today()
    if body.date:
        try:
            target_date = datetime.strptime(body.date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")

    template = db.get(WorkoutTemplate, body.template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    scheduled = db.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == target_date)
    ).first()

    if scheduled:
        scheduled.template_id = body.template_id
        scheduled.session_type = "lift"
        scheduled.status = "matched"
    else:
        scheduled = ScheduledDay(
            day_date=target_date,
            template_id=body.template_id,
            session_type="lift",
            status="matched",
        )
        db.add(scheduled)

    db.commit()
    db.refresh(scheduled)

    existing_log = db.exec(
        select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
    ).first()

    if existing_log:
        return {"status": "success", "scheduled_day_id": scheduled.id, "workout_log_id": existing_log.id}

    workout_log = WorkoutLog(scheduled_day_id=scheduled.id, match_type="manual")
    db.add(workout_log)
    db.commit()
    db.refresh(workout_log)

    return {"status": "success", "scheduled_day_id": scheduled.id, "workout_log_id": workout_log.id}


@router.post("/workout-logs/{log_id}/manual-match")
def manual_match_workout(log_id: int, body: ManualMatch, db: Session = Depends(get_session)):
    """Manually match a workout log to a Garmin activity."""
    log = db.get(WorkoutLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Workout log not found")

    activity = db.get(GarminActivity, body.garmin_activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Garmin activity not found")

    log.garmin_activity_id = body.garmin_activity_id
    log.match_type = "manual"

    scheduled = db.get(ScheduledDay, log.scheduled_day_id)
    if scheduled:
        scheduled.status = "matched"

    db.add(log)
    db.commit()
    return {"status": "success", "id": log_id}


@router.post("/workout-logs/{log_id}/sets", response_model=SetLogRead)
def add_set_log(log_id: int, body: SetLogCreate, db: Session = Depends(get_session)):
    """Add a set to a workout log."""
    if not db.get(WorkoutLog, log_id):
        raise HTTPException(status_code=404, detail="Workout log not found")
    if not db.get(Exercise, body.exercise_id):
        raise HTTPException(status_code=404, detail="Exercise not found")

    set_log = SetLog(
        workout_log_id=log_id,
        exercise_id=body.exercise_id,
        set_number=body.set_number,
        weight_lbs=body.weight_lbs,
        reps_completed=body.reps_completed,
    )
    db.add(set_log)
    db.commit()
    db.refresh(set_log)
    return set_log


@router.patch("/set-logs/{set_id}", response_model=SetLogRead)
def update_set_log(set_id: int, body: SetLogUpdate, db: Session = Depends(get_session)):
    """Update a set log entry."""
    set_log = db.get(SetLog, set_id)
    if not set_log:
        raise HTTPException(status_code=404, detail="Set log not found")

    if body.weight_lbs is not None:
        set_log.weight_lbs = body.weight_lbs
    if body.reps_completed is not None:
        set_log.reps_completed = body.reps_completed
    if body.exercise_id is not None:
        if not db.get(Exercise, body.exercise_id):
            raise HTTPException(status_code=404, detail="Exercise not found")
        set_log.exercise_id = body.exercise_id

    db.add(set_log)
    db.commit()
    db.refresh(set_log)
    return set_log


@router.delete("/set-logs/{set_id}")
def delete_set_log(set_id: int, db: Session = Depends(get_session)):
    """Delete a set log entry."""
    set_log = db.get(SetLog, set_id)
    if not set_log:
        raise HTTPException(status_code=404, detail="Set log not found")
    db.delete(set_log)
    db.commit()
    return {"status": "success", "id": set_id}


# ---------------------------------------------------------------------------
# Exercise & history endpoints
# ---------------------------------------------------------------------------

@router.get("/exercises", response_model=list[ExerciseRead])
def list_exercises(db: Session = Depends(get_session)):
    """List all exercises."""
    return db.exec(select(Exercise)).all()


@router.get("/exercises/{exercise_id}/history", response_model=list[ExerciseHistoryRead])
def get_exercise_history(exercise_id: int, db: Session = Depends(get_session)):
    """Get recent history for an exercise."""
    history = db.exec(
        select(ExerciseHistory)
        .where(ExerciseHistory.exercise_id == exercise_id)
        .order_by(desc(ExerciseHistory.history_date))
        .limit(10)
    ).all()

    return [
        ExerciseHistoryRead(
            date=h.history_date.isoformat() if h.history_date else "",
            verdict=h.verdict,
            weight_used_lbs=h.weight_used_lbs,
            avg_completion_pct=h.avg_completion_pct,
        )
        for h in history
    ]


# ---------------------------------------------------------------------------
# Daily stats (weight logging)
# ---------------------------------------------------------------------------

@router.post("/daily-stats/weight")
def log_weight(weight_lbs: float, db: Session = Depends(get_session)):
    """Log body weight for today."""
    today = date.today()

    stats = db.exec(
        select(DailyStats).where(DailyStats.stat_date == today)
    ).first()

    if stats:
        stats.weight_lbs = weight_lbs
    else:
        stats = DailyStats(
            stat_date=today,
            weight_lbs=weight_lbs,
            calories_burned_garmin=0,
            calories_target=get_calorie_target(0),
        )
        db.add(stats)

    db.commit()
    return {"status": "success", "weight_lbs": weight_lbs}
