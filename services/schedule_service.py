"""Centralised workout schedule generation.

This module eliminates the 3x duplication of schedule generation logic that
was spread across the fitness router.  Any code that needs to "ensure a
week's schedule exists" should call ``ensure_week_schedule()``.
"""
from datetime import date, timedelta

from sqlmodel import Session, select, desc

from models.fitness import ScheduledDay, WorkoutTemplate
from services.scheduler import generate_week_schedule


def _get_week_bounds(week_start: date) -> tuple[date, date]:
    return week_start, week_start + timedelta(days=6)


def ensure_week_schedule(
    session: Session,
    week_start: date,
) -> list[ScheduledDay]:
    """Return the schedule for a given week, generating it if missing.

    This is the **single** place where schedule rows get created from
    templates.  All router endpoints and services should call this
    instead of reimplementing the same logic.
    """
    monday, sunday = _get_week_bounds(week_start)

    existing = session.exec(
        select(ScheduledDay)
        .where(ScheduledDay.day_date >= monday, ScheduledDay.day_date <= sunday)
        .order_by(ScheduledDay.day_date)
    ).all()

    if existing:
        return list(existing)

    # --- Need to generate ---
    templates = session.exec(
        select(WorkoutTemplate).order_by(WorkoutTemplate.sort_order)
    ).all()
    template_list = [
        {"id": t.id, "name": t.name, "session_type": t.session_type}
        for t in templates
    ]

    last_lift = session.exec(
        select(ScheduledDay)
        .where(ScheduledDay.session_type == "lift")
        .order_by(desc(ScheduledDay.day_date))
    ).first()

    last_sort = -1
    if last_lift and last_lift.template_id:
        last_template = session.get(WorkoutTemplate, last_lift.template_id)
        if last_template:
            last_sort = last_template.sort_order

    schedule = generate_week_schedule(template_list, last_sort, week_start)

    created: list[ScheduledDay] = []
    for sd in schedule:
        row = ScheduledDay(
            day_date=sd.date,
            template_id=sd.template_id,
            session_type=sd.session_type,
            status=sd.status,
        )
        session.add(row)
        created.append(row)

    session.commit()

    # Re-read so IDs are populated
    return list(
        session.exec(
            select(ScheduledDay)
            .where(ScheduledDay.day_date >= monday, ScheduledDay.day_date <= sunday)
            .order_by(ScheduledDay.day_date)
        ).all()
    )


def regenerate_week_schedule(
    session: Session,
    week_start: date,
) -> list[ScheduledDay]:
    """Delete planned (not matched/skipped) days and regenerate."""
    monday, sunday = _get_week_bounds(week_start)

    planned = session.exec(
        select(ScheduledDay).where(
            ScheduledDay.day_date >= monday,
            ScheduledDay.day_date <= sunday,
            ScheduledDay.status == "planned",
        )
    ).all()

    for row in planned:
        session.delete(row)
    session.commit()

    return ensure_week_schedule(session, week_start)
