"""
/sync — sync data between integrations (Google Calendar, Garmin, Vikunja).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from integrations.vikunja import VikunjaClient, VikunjaError, get_vikunja_client
from integrations.google_calendar import GoogleCalendarClient, GoogleCalendarError, get_google_calendar_client
from integrations.garmin import GarminError, get_garmin_client

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/to-google", status_code=200)
async def sync_to_google(
    project_id: Optional[int] = Query(default=None, description="Filter by Vikunja project ID"),
    include_sleep: bool = Query(default=True, description="Include Garmin sleep data"),
    vikunja: VikunjaClient = Depends(get_vikunja_client),
    gcal: GoogleCalendarClient = Depends(get_google_calendar_client),
):
    """
    Sync Vikunja tasks and Garmin sleep data to Google Calendar.
    
    - Syncs Vikunja tasks with due dates as calendar events
    - Optionally syncs Garmin sleep data as "Sleep" events
    
    Events are tagged with source IDs for tracking.
    """
    results = {
        "tasks": {"synced": 0, "total": 0, "errors": []},
        "sleep": {"synced": 0, "total": 0, "errors": []},
    }

    # Sync Vikunja tasks
    try:
        tasks = await vikunja.get_tasks(project_id=project_id)
    except VikunjaError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    tasks_with_dates = [
        t for t in tasks
        if t.get("due_date") and t.get("due_date") != "0001-01-01T00:00:00Z"
    ]
    results["tasks"]["total"] = len(tasks_with_dates)

    try:
        gcal_events = await gcal.list_events()
    except GoogleCalendarError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    gcal_event_map = {
        (ep.get("extendedProperties", {}).get("private", {}).get("vikunja_task_id")): eid
        for eid, ep in ((e.get("id"), e) for e in gcal_events if e.get("id"))
        if ep.get("extendedProperties", {}).get("private", {}).get("vikunja_task_id")
    }

    for task in tasks_with_dates:
        task_id = str(task.get("id"))
        event_id = gcal_event_map.get(task_id)

        try:
            if event_id:
                await gcal.update_event(event_id, task)
            else:
                await gcal.create_event(task)
            results["tasks"]["synced"] += 1
        except GoogleCalendarError as e:
            results["tasks"]["errors"].append(f"Task {task_id}: {e}")

    # Sync Garmin sleep data
    if include_sleep:
        try:
            garmin = get_garmin_client()
        except GarminError as e:
            results["sleep"]["errors"].append(f"Garmin unavailable: {e}")
        else:
            try:
                sleep_records = garmin.get_sleep_records()
            except GarminError as e:
                results["sleep"]["errors"].append(f"Failed to get sleep data: {e}")
            else:
                results["sleep"]["total"] = len(sleep_records)

                sleep_event_map = {
                    ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date"): eid
                    for eid, ep in ((e.get("id"), e) for e in gcal_events if e.get("id"))
                    if ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date")
                }

                for sleep in sleep_records:
                    if not sleep.bed_time_start or not sleep.bed_time_end:
                        continue

                    sleep_date_str = sleep.date.strftime("%Y-%m-%d")
                    event_id = sleep_event_map.get(sleep_date_str)

                    try:
                        event = sleep.to_calendar_event()
                        if event_id:
                            await gcal.update_sleep_event(event_id, event)
                        else:
                            await gcal.create_sleep_event(event)
                        results["sleep"]["synced"] += 1
                    except GoogleCalendarError as e:
                        results["sleep"]["errors"].append(f"Sleep {sleep_date_str}: {e}")

    return results
