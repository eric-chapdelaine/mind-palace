import os
from datetime import date, timedelta
from sqlmodel import Session, select

from core.database import engine
from models.fitness import (
    Exercise, ScheduledDay, GarminActivity, WorkoutLog, SetLog,
    ExerciseHistory, ExerciseState, DailyStats
)
from services.progression import evaluate, Prescription, SessionResult, SetResult


CALORIE_SURPLUS = 300
MISC_MOVEMENT = 300
COMMUTE_MAX_DURATION_MINUTES = 25


def _calculate_bmr() -> int:
    weight_lbs = float(os.getenv("USER_WEIGHT_LBS", "175"))
    height_in = float(os.getenv("USER_HEIGHT_IN", "71"))
    age = int(os.getenv("USER_AGE", "28"))
    
    weight_kg = weight_lbs * 0.453592
    height_cm = height_in * 2.54
    
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    return int(bmr)


def sync_garmin():
    try:
        from integrations.garmin_fitness import get_recent_activities
    except Exception as e:
        print(f"⚠️  Garmin integration not available: {e}")
        return
    
    activities = get_recent_activities(days=2)
    
    if not activities:
        return
    
    with Session(engine) as session:
        for act in activities:
            _upsert_activity(session, act)
        
        for act in activities:
            if act["activity_type"] == "cycling":
                duration = act.get("duration_minutes") or 0
                is_commute = duration < COMMUTE_MAX_DURATION_MINUTES
            else:
                is_commute = False
            
            if not is_commute:
                _match_activity_to_schedule(session, act)
        
        _update_daily_stats(session)
        session.commit()


def _upsert_activity(session: Session, act: dict):
    garmin_id = act["garmin_id"]
    existing = session.exec(
        select(GarminActivity).where(GarminActivity.garmin_id == garmin_id)
    ).first()
    
    if existing:
        existing.duration_minutes = act.get("duration_minutes")
        existing.calories = act.get("calories")
        existing.raw_json = act.get("raw_json")
        
        if act["activity_type"] == "cycling":
            duration = act.get("duration_minutes") or 0
            existing.is_commute = duration < COMMUTE_MAX_DURATION_MINUTES
    else:
        duration = act.get("duration_minutes") or 0
        is_commute = act["activity_type"] == "cycling" and duration < COMMUTE_MAX_DURATION_MINUTES
        
        session.add(GarminActivity(
            garmin_id=garmin_id,
            activity_date=date.fromisoformat(act["date"]),
            activity_type=act["activity_type"],
            duration_minutes=duration,
            calories=act.get("calories"),
            is_commute=is_commute,
            raw_json=act.get("raw_json")
        ))


def _match_activity_to_schedule(session: Session, act: dict):
    activity_date = date.fromisoformat(act["date"])
    activity_type = act["activity_type"]
    
    scheduled = session.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == activity_date)
    ).first()
    
    if not scheduled:
        return
    
    if scheduled.status in ("matched", "skipped"):
        return
    
    matches = False
    if activity_type == "strength_training" and scheduled.session_type == "lift":
        matches = True
    elif activity_type == "cycling" and scheduled.session_type in ("cycle", "rest"):
        matches = True
    elif activity_type == "running" and scheduled.session_type == "run":
        matches = True
    
    if not matches:
        return
    
    garmin_activity = session.exec(
        select(GarminActivity).where(GarminActivity.garmin_id == act["garmin_id"])
    ).first()
    
    if not garmin_activity:
        return
    
    log = WorkoutLog(
        scheduled_day_id=scheduled.id,
        garmin_activity_id=garmin_activity.id,
        match_type="auto"
    )
    session.add(log)
    session.flush()
    
    scheduled.status = "matched"
    
    if activity_type == "strength_training":
        _process_strength_workout(session, log, garmin_activity)


def _process_strength_workout(session: Session, log: WorkoutLog, garmin_activity: GarminActivity):
    try:
        from integrations.garmin_fitness import get_strength_exercise_sets
    except Exception as e:
        print(f"⚠️  Garmin strength exercise sets not available: {e}")
        return
    
    exercise_sets = get_strength_exercise_sets(garmin_activity.garmin_id)
    
    for ex_data in exercise_sets:
        garmin_enum = ex_data.get("exerciseName", "").upper().replace(" ", "_")
        
        exercise = session.exec(
            select(Exercise).where(Exercise.garmin_enum == garmin_enum)
        ).first()
        
        if not exercise:
            print(f"⚠️  No matching exercise for garmin_enum: {garmin_enum}")
            continue
        
        template_ex = session.exec(
            select(Exercise).where(Exercise.id == exercise.id)
        ).first()
        
        sets_data = ex_data.get("sets", [])
        for i, set_data in enumerate(sets_data):
            session.add(SetLog(
                workout_log_id=log.id,
                exercise_id=exercise.id,
                set_number=i + 1,
                reps_completed=set_data.get("reps", 0),
                weight_lbs=set_data.get("weight_lbs", 0)
            ))
        
        prescribed_sets = 3
        prescribed_reps = 8
        
        state = session.exec(
            select(ExerciseState).where(ExerciseState.exercise_id == exercise.id)
        ).first()
        
        if not state:
            state = ExerciseState(
                exercise_id=exercise.id,
                current_weight_lbs=set_data.get("weight_lbs", 0)
            )
            session.add(state)
            session.flush()
        
        prescription = Prescription(
            exercise_id=exercise.id,
            prescribed_sets=prescribed_sets,
            prescribed_reps=prescribed_reps,
            current_weight_lbs=state.current_weight_lbs,
            increment_lbs=exercise.increment_lbs or 5,
            consecutive_fails=state.consecutive_fails,
            consecutive_close=state.consecutive_close,
            last_verdict=state.last_verdict
        )
        
        result = SessionResult(
            exercise_id=exercise.id,
            sets=[
                SetResult(i + 1, s.get("reps", 0), s.get("weight_lbs", 0))
                for i, s in enumerate(sets_data)
            ],
            prescribed_sets=prescribed_sets,
            prescribed_reps=prescribed_reps
        )
        
        eval_result = evaluate(prescription, result)
        
        state.current_weight_lbs = eval_result.next_weight_lbs
        state.consecutive_fails = eval_result.consecutive_fails
        state.consecutive_close = eval_result.consecutive_close
        state.last_verdict = eval_result.verdict
        state.last_session_date = garmin_activity.activity_date
        
        session.add(ExerciseHistory(
            exercise_id=exercise.id,
            history_date=garmin_activity.activity_date,
            verdict=eval_result.verdict,
            weight_used_lbs=set_data.get("weight_lbs", 0),
            sets_prescribed=prescribed_sets,
            reps_prescribed=prescribed_reps,
            avg_completion_pct=eval_result.avg_completion_pct
        ))


def _update_daily_stats(session: Session):
    today = date.today()
    for i in range(2):
        d = today - timedelta(days=i)
        
        activities = session.exec(
            select(GarminActivity).where(
                GarminActivity.activity_date == d,
                GarminActivity.is_commute == False
            )
        ).all()
        
        total_calories = sum(a.calories or 0 for a in activities)
        
        bmr = _calculate_bmr()
        calories_target = bmr + total_calories + MISC_MOVEMENT + CALORIE_SURPLUS
        
        stats = session.exec(
            select(DailyStats).where(DailyStats.stat_date == d)
        ).first()
        
        if stats:
            stats.calories_burned_garmin = total_calories
            stats.calories_target = calories_target
        else:
            session.add(DailyStats(
                stat_date=d,
                calories_burned_garmin=total_calories,
                calories_target=calories_target
            ))
