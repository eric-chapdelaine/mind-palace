import os
from datetime import date, timedelta
from sqlmodel import Session, select

from core.database import engine
from models.fitness import (
    Exercise, ScheduledDay, GarminActivity, WorkoutLog, SetLog,
    ExerciseHistory, ExerciseState, DailyStats, TemplateExercise
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


def sync_garmin_for_date(target_date: date, template_id: int | None = None):
    """Sync Garmin for a specific date, creating a scheduled day if needed."""
    try:
        from integrations.garmin_fitness import get_recent_activities
    except Exception as e:
        print(f"⚠️  Garmin integration not available: {e}")
        return None
    
    activities = get_recent_activities(days=7)
    
    matching_activity = None
    strength_activity = None
    
    for act in activities:
        act_date = date.fromisoformat(act["date"])
        if act_date == target_date:
            if act["activity_type"] == "strength_training":
                strength_activity = act
                break
    
    if strength_activity:
        matching_activity = strength_activity
    else:
        for act in activities:
            act_date = date.fromisoformat(act["date"])
            if act_date == target_date:
                if act["activity_type"] == "cycling":
                    duration = act.get("duration_minutes") or 0
                    if duration >= COMMUTE_MAX_DURATION_MINUTES:
                        matching_activity = act
                        break
                elif act["activity_type"] in ("running", "walking"):
                    matching_activity = act
                    break
    
    if not matching_activity:
        return None
    
    with Session(engine) as session:
        _upsert_activity(session, matching_activity)
        
        activity_date = date.fromisoformat(matching_activity["date"])
        activity_type = matching_activity["activity_type"]
        
        garmin_activity = session.exec(
            select(GarminActivity).where(GarminActivity.garmin_id == matching_activity["garmin_id"])
        ).first()
        
        if not garmin_activity:
            session.commit()
            return None
        
        scheduled = session.exec(
            select(ScheduledDay).where(ScheduledDay.day_date == activity_date)
        ).first()
        
        if scheduled:
            if scheduled.status == "matched":
                session.commit()
                return {"status": "already_matched", "scheduled_day_id": scheduled.id}
            
            scheduled.template_id = template_id
            scheduled.session_type = "lift" if activity_type == "strength_training" else activity_type
            scheduled.status = "matched"
        else:
            session_type = "lift" if activity_type == "strength_training" else activity_type
            scheduled = ScheduledDay(
                day_date=activity_date,
                template_id=template_id,
                session_type=session_type,
                status="matched"
            )
            session.add(scheduled)
            session.flush()
        
        log = WorkoutLog(
            scheduled_day_id=scheduled.id,
            garmin_activity_id=garmin_activity.id,
            match_type="auto"
        )
        session.add(log)
        session.flush()
        
        if activity_type == "strength_training":
            _process_strength_workout(session, log, garmin_activity, scheduled)
        
        _update_daily_stats(session)
        session.commit()
        
        return {"status": "success", "scheduled_day_id": scheduled.id, "workout_log_id": log.id}


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
        _process_strength_workout(session, log, garmin_activity, scheduled)


def _process_strength_workout(session: Session, log: WorkoutLog, garmin_activity: GarminActivity, scheduled: ScheduledDay):
    try:
        from integrations.garmin_fitness import _ensure_client
        from garminconnect import Garmin
        import garth
    except Exception as e:
        print(f"⚠️  Garmin strength exercise sets not available: {e}")
        return
    
    try:
        _ensure_client()
        client = Garmin()
        client.garth = garth
        
        exercise_data = client.get_activity_exercise_sets(garmin_activity.garmin_id)
    except Exception as e:
        print(f"⚠️  Failed to get exercise sets: {e}")
        return
    
    exercise_sets = exercise_data.get("exerciseSets", [])
    
    for set_data in exercise_sets:
        if set_data.get("setType") == "REST":
            continue
        
        reps = set_data.get("repetitionCount") or 0
        
        exercises_in_set = set_data.get("exercises", [])
        if not exercises_in_set:
            continue
        
        best_exercise = max(exercises_in_set, key=lambda x: x.get("probability", 0))
        garmin_category = best_exercise.get("category", "").upper()
        
        if not garmin_category:
            continue
        
        exercise = session.exec(
            select(Exercise).where(Exercise.garmin_enum == garmin_category)
        ).first()
        
        if not exercise:
            print(f"⚠️  No matching exercise for garmin_category: {garmin_category}")
            continue
        
        existing_sets_for_ex = session.exec(
            select(SetLog).where(
                SetLog.workout_log_id == log.id,
                SetLog.exercise_id == exercise.id
            )
        ).all()
        
        set_number = len(existing_sets_for_ex) + 1
        
        weight_lbs = 0
        state = session.exec(
            select(ExerciseState).where(ExerciseState.exercise_id == exercise.id)
        ).first()
        
        if state and state.current_weight_lbs:
            weight_lbs = state.current_weight_lbs
        
        session.add(SetLog(
            workout_log_id=log.id,
            exercise_id=exercise.id,
            set_number=set_number,
            reps_completed=reps,
            weight_lbs=weight_lbs
        ))
        
        prescribed_sets = 3
        prescribed_reps = 8
        
        if not state:
            state = ExerciseState(
                exercise_id=exercise.id,
                current_weight_lbs=weight_lbs
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
            sets=[SetResult(set_number, reps, weight_lbs)],
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
            weight_used_lbs=weight_lbs,
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
