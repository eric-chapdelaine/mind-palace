import os
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional


TRAINING_AGE = "beginner"
LIFTS_PER_WEEK = int(os.getenv("LIFTS_PER_WEEK", "3"))
NO_LIFT_DAY = 2
GYM_EQUIPMENT = "barbell"
DELOAD_AFTER_FAILS = 3


@dataclass
class ScheduledDayData:
    date: date
    template_id: Optional[int]
    template_name: Optional[str]
    session_type: str
    status: str


def get_this_monday() -> date:
    today = date.today()
    days_ahead = -today.weekday() if today.weekday() != 0 else 0
    return today + timedelta(days=days_ahead)


def get_next_monday() -> date:
    today = date.today()
    days_ahead = 7 - today.weekday() if today.weekday() != 0 else 7
    return today + timedelta(days=days_ahead)


def generate_week_schedule(
    templates: list[dict],
    last_template_sort: int = -1,
    week_start: date | None = None
) -> list[ScheduledDayData]:
    if week_start is None:
        week_start = get_this_monday()
    days = []
    
    available_days = [0, 1, 2, 3, 4, 5, 6]
    available_days.remove(NO_LIFT_DAY)
    
    if LIFTS_PER_WEEK == 3:
        lift_days = [available_days[0], available_days[2], available_days[4]]
    else:
        lift_days = [available_days[0], available_days[1], available_days[2], available_days[3]]
    
    current_template_idx = (last_template_sort + 1) % len(templates)
    
    for i in range(7):
        day_date = week_start + timedelta(days=i)
        
        if i == NO_LIFT_DAY:
            days.append(ScheduledDayData(
                date=day_date,
                template_id=None,
                template_name=None,
                session_type="rest",
                status="planned"
            ))
        elif i in lift_days:
            template = templates[current_template_idx]
            days.append(ScheduledDayData(
                date=day_date,
                template_id=template["id"],
                template_name=template["name"],
                session_type=template["session_type"],
                status="planned"
            ))
            current_template_idx = (current_template_idx + 1) % len(templates)
        else:
            days.append(ScheduledDayData(
                date=day_date,
                template_id=None,
                template_name=None,
                session_type="rest",
                status="planned"
            ))
    
    return days
