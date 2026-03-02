"""
/fitness — Workout CRUD, scheduling, Garmin match endpoints.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select, desc

from core.database import get_session
from models.fitness import (
    Exercise, WorkoutTemplate, TemplateExercise, ExerciseState,
    ScheduledDay, WorkoutLog, SetLog, ExerciseHistory
)
from services.scheduler import generate_week_schedule
from services.garmin_sync import sync_garmin

router = APIRouter(prefix="/fitness", tags=["fitness"])


class ExerciseStateUpdate(BaseModel):
    weight_lbs: float


class ScheduledDaySkip(BaseModel):
    pass


class ManualMatch(BaseModel):
    garmin_activity_id: int


class WorkoutLogCreate(BaseModel):
    notes: Optional[str] = None


def _get_today() -> date:
    return date.today()


@router.get("/widgets/today-workout")
def get_today_workout(db: Session = Depends(get_session)):
    today = _get_today()
    
    scheduled = db.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == today)
    ).first()
    
    if not scheduled:
        raise HTTPException(status_code=404, detail="No workout scheduled for today")
    
    template = None
    exercises = []
    
    if scheduled.template_id:
        template = db.get(WorkoutTemplate, scheduled.template_id)
        
        template_exercises = db.exec(
            select(TemplateExercise).where(
                TemplateExercise.template_id == scheduled.template_id
            ).order_by(TemplateExercise.sort_order)
        ).all()
        
        for te in template_exercises:
            exercise = db.get(Exercise, te.exercise_id)
            state = db.exec(
                select(ExerciseState).where(ExerciseState.exercise_id == te.exercise_id)
            ).first()
            
            actual_sets = []
            if scheduled.status == "matched":
                log = db.exec(
                    select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
                ).first()
                
                if log:
                    sets = db.exec(
                        select(SetLog).where(SetLog.workout_log_id == log.id)
                    ).all()
                    
                    exercise_sets = {}
                    for s in sets:
                        if s.exercise_id not in exercise_sets:
                            exercise_sets[s.exercise_id] = []
                        exercise_sets[s.exercise_id].append(s)
                    
                    if exercise.id in exercise_sets:
                        for s in exercise_sets[exercise.id]:
                            actual_sets.append({
                                "set_number": s.set_number,
                                "reps_completed": s.reps_completed,
                                "weight_lbs": s.weight_lbs
                            })
            
            exercises.append({
                "exercise_id": exercise.id,
                "name": exercise.name,
                "prescribed_sets": te.prescribed_sets,
                "prescribed_reps": te.prescribed_reps,
                "current_weight_lbs": state.current_weight_lbs if state else 0,
                "last_verdict": state.last_verdict if state else None,
                "actual_sets": actual_sets
            })
    
    garmin_match = None
    if scheduled.status == "matched":
        log = db.exec(
            select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
        ).first()
        
        if log and log.garmin_activity_id:
            from models.fitness import GarminActivity
            activity = db.get(GarminActivity, log.garmin_activity_id)
            if activity:
                garmin_match = {
                    "activity_id": activity.garmin_id,
                    "duration_minutes": activity.duration_minutes,
                    "calories": activity.calories
                }
    
    return {
        "date": today.isoformat(),
        "session_type": scheduled.session_type,
        "template_name": template.name if template else None,
        "status": scheduled.status,
        "garmin_match": garmin_match,
        "exercises": exercises
    }


@router.get("/widgets/week-overview")
def get_week_overview(db: Session = Depends(get_session)):
    today = _get_today()
    monday = today - timedelta(days=today.weekday())
    
    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        
        scheduled = db.exec(
            select(ScheduledDay).where(ScheduledDay.day_date == d)
        ).first()
        
        garmin_calories = 0
        if scheduled and scheduled.status == "matched":
            log = db.exec(
                select(WorkoutLog).where(WorkoutLog.scheduled_day_id == scheduled.id)
            ).first()
            
            if log and log.garmin_activity_id:
                from models.fitness import GarminActivity
                activity = db.get(GarminActivity, log.garmin_activity_id)
                if activity:
                    garmin_calories = activity.calories or 0
        
        if scheduled:
            days.append({
                "date": d.isoformat(),
                "session_type": scheduled.session_type,
                "status": scheduled.status,
                "garmin_calories": garmin_calories
            })
        else:
            days.append({
                "date": d.isoformat(),
                "session_type": "rest",
                "status": "planned",
                "garmin_calories": 0
            })
    
    return days


@router.get("/schedule/this-week")
def get_this_week_schedule(db: Session = Depends(get_session)):
    from services.scheduler import get_this_monday
    
    week_start = get_this_monday()
    sunday = week_start + timedelta(days=6)
    
    existing = db.exec(
        select(ScheduledDay).where(
            ScheduledDay.day_date >= week_start,
            ScheduledDay.day_date <= sunday
        ).order_by(ScheduledDay.day_date)
    ).all()
    
    if existing:
        return [{"date": s.day_date.isoformat(), "session_type": s.session_type, "status": s.status} for s in existing]
    
    templates = db.exec(
        select(WorkoutTemplate).order_by(WorkoutTemplate.sort_order)
    ).all()
    
    template_list = [{"id": t.id, "name": t.name, "session_type": t.session_type} for t in templates]
    
    last_lift = db.exec(
        select(ScheduledDay).where(
            ScheduledDay.session_type == "lift"
        ).order_by(desc(ScheduledDay.day_date))
    ).first()
    
    last_sort = -1
    if last_lift and last_lift.template_id:
        last_template = db.get(WorkoutTemplate, last_lift.template_id)
        if last_template:
            last_sort = last_template.sort_order
    
    schedule = generate_week_schedule(template_list, last_sort)
    
    for sd in schedule:
        db.add(ScheduledDay(
            day_date=sd.date,
            template_id=sd.template_id,
            session_type=sd.session_type,
            status=sd.status
        ))
    
    db.commit()
    
    return [{"date": s.date.isoformat(), "session_type": s.session_type, "status": s.status} for s in schedule]


@router.post("/schedule/generate")
def generate_schedule(db: Session = Depends(get_session)):
    from services.scheduler import get_next_monday
    
    week_start = get_next_monday()
    sunday = week_start + timedelta(days=6)
    
    db.exec(
        select(ScheduledDay).where(
            ScheduledDay.day_date >= week_start,
            ScheduledDay.day_date <= sunday,
            ScheduledDay.status == "planned"
        )
    )
    
    existing = db.exec(
        select(ScheduledDay).where(
            ScheduledDay.day_date >= week_start,
            ScheduledDay.day_date <= sunday,
            ScheduledDay.status == "planned"
        )
    ).all()
    
    for e in existing:
        db.delete(e)
    
    db.commit()
    
    templates = db.exec(
        select(WorkoutTemplate).order_by(WorkoutTemplate.sort_order)
    ).all()
    
    template_list = [{"id": t.id, "name": t.name, "session_type": t.session_type} for t in templates]
    
    last_lift = db.exec(
        select(ScheduledDay).where(
            ScheduledDay.session_type == "lift"
        ).order_by(desc(ScheduledDay.day_date))
    ).first()
    
    last_sort = -1
    if last_lift and last_lift.template_id:
        last_template = db.get(WorkoutTemplate, last_lift.template_id)
        if last_template:
            last_sort = last_template.sort_order
    
    schedule = generate_week_schedule(template_list, last_sort)
    
    for sd in schedule:
        db.add(ScheduledDay(
            day_date=sd.date,
            template_id=sd.template_id,
            session_type=sd.session_type,
            status=sd.status
        ))
    
    db.commit()
    
    return [{"date": s.date.isoformat(), "session_type": s.session_type, "status": s.status} for s in schedule]


@router.get("/exercises/{exercise_id}/history")
def get_exercise_history(exercise_id: int, db: Session = Depends(get_session)):
    history = db.exec(
        select(ExerciseHistory).where(
            ExerciseHistory.exercise_id == exercise_id
        ).order_by(desc(ExerciseHistory.history_date)).limit(10)
    ).all()
    
    return [
        {
            "date": h.history_date.isoformat(),
            "verdict": h.verdict,
            "weight_used_lbs": h.weight_used_lbs,
            "avg_completion_pct": h.avg_completion_pct
        }
        for h in history
    ]


@router.post("/sync/garmin")
def trigger_garmin_sync():
    try:
        sync_garmin()
        return {"status": "success", "message": "Garmin sync completed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.patch("/scheduled-days/{day_id}/skip")
def skip_scheduled_day(day_id: int, db: Session = Depends(get_session)):
    scheduled = db.get(ScheduledDay, day_id)
    if not scheduled:
        raise HTTPException(status_code=404, detail="Scheduled day not found")
    
    scheduled.status = "skipped"
    db.add(scheduled)
    db.commit()
    
    return {"status": "success", "id": day_id}


@router.get("/schedule/{date_str}")
def get_day_details(date_str: str, db: Session = Depends(get_session)):
    from datetime import datetime
    try:
        day_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    scheduled = db.exec(
        select(ScheduledDay).where(ScheduledDay.day_date == day_date)
    ).first()
    
    if not scheduled:
        raise HTTPException(status_code=404, detail="No scheduled day found")
    
    exercises = []
    template = None
    
    if scheduled.template_id:
        template = db.get(WorkoutTemplate, scheduled.template_id)
        template_exercises = db.exec(
            select(TemplateExercise).where(
                TemplateExercise.template_id == scheduled.template_id
            ).order_by(TemplateExercise.sort_order)
        ).all()
        
        for te in template_exercises:
            exercise = db.get(Exercise, te.exercise_id)
            state = db.exec(
                select(ExerciseState).where(ExerciseState.exercise_id == te.exercise_id)
            ).first()
            
            exercises.append({
                "id": exercise.id,
                "name": exercise.name,
                "category": exercise.category,
                "prescribed_sets": te.prescribed_sets,
                "prescribed_reps": te.prescribed_reps,
                "current_weight_lbs": state.current_weight_lbs if state else 0,
                "last_verdict": state.last_verdict if state else None
            })
    
    return {
        "date": scheduled.day_date.isoformat(),
        "session_type": scheduled.session_type,
        "template_name": template.name if template else None,
        "status": scheduled.status,
        "exercises": exercises
    }


@router.post("/workout-logs/{log_id}/manual-match")
def manual_match_workout(
    log_id: int,
    body: ManualMatch,
    db: Session = Depends(get_session)
):
    log = db.get(WorkoutLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Workout log not found")
    
    from models.fitness import GarminActivity
    
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
